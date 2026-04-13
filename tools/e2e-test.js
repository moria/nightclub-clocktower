#!/usr/bin/env node
// 端到端测试：启动 bot-runner + 模拟真人客户端加入并走完整局
// 验证薄客户端通信协议是否正确

const { spawn } = require('child_process');
const WebSocket = require('ws');

const SUPABASE_URL = 'https://nxeybszulisostkazlkc.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54ZXlic3p1bGlzb3N0a2F6bGtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNDA3NTMsImV4cCI6MjA5MTYxNjc1M30.xGtEfSMKvglwXYZg4mOR_pyIMpjAFQSxUUR6h01P5Xo';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (msg) => console.log(`[TEST] ${msg}`);

// ============ Supabase REST ============
async function supaFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation', ...options.headers },
    ...options,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// ============ 模拟薄客户端 ============
class TestClient {
  constructor(name) {
    this.name = name;
    this.playerId = `test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.ws = null;
    this.topic = null;
    this.ref = 0;
    this.events = [];
    this.myRoleId = null;
    this.joined = false;
    this._heartbeat = null;
    this._waiters = []; // { eventName, resolve, since }
  }

  async joinRoom(roomCode) {
    this.topic = `realtime:room:${roomCode}`;

    // REST 加入
    const rooms = await supaFetch(`rooms?code=eq.${roomCode}&select=*`);
    if (rooms.length === 0) throw new Error('房间不存在');
    const room = rooms[0];
    const existing = await supaFetch(`players?room_id=eq.${room.id}&select=*`);
    await supaFetch('players', {
      method: 'POST',
      body: JSON.stringify({
        room_id: room.id, player_id: this.playerId, name: this.name,
        seat_index: existing.length, alive: true, infected: false,
        ghost_vote_used: false, connected: true,
      }),
    });

    // WebSocket 连接
    await this._connectWS();

    // 广播加入
    this._broadcast('player_joined', { id: this.playerId, name: this.name, seatIndex: existing.length });
    this.joined = true;
  }

  _connectWS() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${SUPABASE_URL.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${ANON_KEY}&vsn=1.0.0`);
      this.ws.on('open', () => {
        this._send({ topic: this.topic, event: 'phx_join', payload: { config: { broadcast: { self: true } } }, ref: String(++this.ref) });
        this._heartbeat = setInterval(() => {
          this._send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++this.ref) });
        }, 30000);
        resolve();
      });
      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.event === 'broadcast' && msg.payload) {
            const evt = msg.payload.event;
            const pl = msg.payload.payload;
            if (pl._targetPlayerId && pl._targetPlayerId !== this.playerId) return;
            this.events.push({ event: evt, payload: pl, time: Date.now() });
            this._handleEvent(evt, pl);
            // resolve waiters
            this._waiters = this._waiters.filter(w => {
              if (w.eventName === evt) { w.resolve(pl); return false; }
              return true;
            });
          }
        } catch (e) {}
      });
      this.ws.on('error', (e) => reject(e));
      setTimeout(() => resolve(), 5000); // fallback if join ack never comes
    });
  }

  _send(msg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }

  _broadcast(event, payload) {
    this._send({ topic: this.topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: String(++this.ref) });
  }

  _handleEvent(event, payload) {
    switch (event) {
      case 'role_assigned':
        if (payload.playerId === this.playerId) {
          this.myRoleId = payload.roleId;
          log(`  🎭 ${this.name} → ${payload.roleEmoji || ''} ${payload.roleName || payload.roleId}`);
        }
        break;
      case 'dating_prompt':
        log(`  💘 ${this.name} 自动选择不约`);
        setTimeout(() => this._broadcast('dating_choice', { playerId: this.playerId, targetId: 'none' }), 300);
        break;
      case 'night_action_prompt':
        if (payload.targets?.length > 0) {
          const t = payload.targets[0];
          log(`  🌙 ${this.name}(${payload.roleName}) → ${t.name}`);
          setTimeout(() => this._broadcast('night_action', { playerId: this.playerId, targets: [t.id] }), 300);
        }
        break;
      case 'vote_start':
        log(`  ⚖️ ${this.name} 自动投赞成 (被提名: ${payload.target?.name})`);
        setTimeout(() => this._broadcast('vote_cast', { playerId: this.playerId, inFavor: true }), 300);
        break;
      case 'game_over':
        log(`  🎉 游戏结束: ${payload.winner === 'good' ? '好人胜' : '恶方胜'} — ${payload.reason}`);
        break;
    }
  }

  waitForEvent(eventName, timeoutMs = 30000) {
    // 先检查已有事件
    const existing = this.events.find(e => e.event === eventName);
    if (existing) return Promise.resolve(existing.payload);
    return new Promise((resolve) => {
      this._waiters.push({ eventName, resolve });
      setTimeout(() => {
        this._waiters = this._waiters.filter(w => w.eventName !== eventName || w.resolve !== resolve);
        resolve(null);
      }, timeoutMs);
    });
  }

  hasEvent(eventName) { return this.events.some(e => e.event === eventName); }

  close() {
    clearInterval(this._heartbeat);
    if (this.ws) this.ws.close();
  }
}

// ============ 主测试 ============
async function main() {
  let botProc = null;
  let client = null;
  let passed = 0, failed = 0;

  function check(ok, msg) {
    if (ok) { console.log(`  ✅ ${msg}`); passed++; }
    else { console.log(`  ❌ ${msg}`); failed++; }
  }

  try {
    log('===== 夜店钟楼 端到端测试 =====\n');

    // 1) 启动 bot-runner
    log('[1] 启动 bot-runner...');
    botProc = spawn('node', ['tools/bot-runner.js'], { stdio: 'pipe' });
    let botOut = '';
    botProc.stdout.on('data', d => { const s = d.toString(); botOut += s; process.stdout.write('[SERVER] ' + s); });
    botProc.stderr.on('data', d => { botOut += d.toString(); });

    let roomCode = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const m = botOut.match(/房间码:\s*([A-Z0-9]{6})/);
      if (m) { roomCode = m[1]; break; }
    }
    check(!!roomCode, `bot-runner 启动, 房间码: ${roomCode}`);
    if (!roomCode) throw new Error('无法获取房间码');

    // 等 WS 连接
    for (let i = 0; i < 10; i++) {
      if (botOut.includes('WebSocket 已连接')) break;
      await sleep(500);
    }
    check(botOut.includes('WebSocket 已连接'), 'bot-runner WebSocket 就绪');

    // 2) 客户端加入
    log('\n[2] 客户端加入房间...');
    client = new TestClient('🧪小明');
    await client.joinRoom(roomCode);
    check(client.joined, '客户端加入成功');

    // 3) 等角色分配
    log('\n[3] 等待角色分配...');
    const role = await client.waitForEvent('role_assigned', 20000);
    check(!!role, `角色分配: ${role?.roleName || role?.roleId || '未收到'}`);

    // 4) 等约会
    log('\n[4] 等待约会阶段...');
    const dating = await client.waitForEvent('dating_prompt', 20000);
    check(!!dating, '约会阶段');

    // 5) 等夜间行动 或 夜晚结果
    log('\n[5] 等待夜间行动...');
    const nightAction = await client.waitForEvent('night_action_prompt', 20000);
    // 有些角色没有夜间行动，所以只要有结果也算通过
    if (!nightAction) {
      const nightResult = await client.waitForEvent('night_results', 15000);
      check(!!nightResult || client.hasEvent('game_over'), '夜间阶段完成');
    } else {
      check(true, `夜间行动: ${nightAction.roleName}`);
    }

    // 6) 等待游戏完成（可能经过多个白天/夜晚轮次）
    log('\n[6] 等待游戏完成...');
    for (let i = 0; i < 180; i++) {
      if (client.hasEvent('game_over')) break;
      await sleep(500);
    }
    check(client.hasEvent('game_over'), '游戏结束');

    // 检查是否经历了白天+投票（信息性，不算 pass/fail）
    const hadDay = client.events.some(e => e.event === 'phase_change' && e.payload.phase === 'day');
    const hadVote = client.hasEvent('vote_start');
    const hadVoteResult = client.hasEvent('execution') || client.hasEvent('acquittal');
    log(`  ℹ️  白天: ${hadDay ? '✅' : '⏭️'}  投票: ${hadVote ? '✅' : '⏭️'}  结果: ${hadVoteResult ? '✅' : '⏭️'}`);
    if (hadDay) check(hadVote, '白天→投票流转');
    if (hadVote) check(hadVoteResult, '投票→结果流转');

    // 事件统计
    log('\n===== 事件统计 =====');
    const counts = {};
    for (const e of client.events) counts[e.event] = (counts[e.event] || 0) + 1;
    for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      log(`  ${k}: ${v}`);
    }

  } catch (e) {
    console.log(`  ❌ 异常: ${e.message}`);
    failed++;
  } finally {
    if (client) client.close();
    if (botProc) {
      botProc.kill('SIGINT');
      await sleep(4000);
      try { botProc.kill('SIGKILL'); } catch (e) {}
    }

    log(`\n===== 结果: ${passed} passed, ${failed} failed =====`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
