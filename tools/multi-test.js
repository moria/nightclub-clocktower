#!/usr/bin/env node
// 多人数端到端测试：分别测试 5人/7人/10人 局
// 每个测试启动 bot-runner + N 个模拟客户端，走完整局

const { spawn } = require('child_process');
const WebSocket = require('ws');

const SUPABASE_URL = 'https://nxeybszulisostkazlkc.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54ZXlic3p1bGlzb3N0a2F6bGtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNDA3NTMsImV4cCI6MjA5MTYxNjc1M30.xGtEfSMKvglwXYZg4mOR_pyIMpjAFQSxUUR6h01P5Xo';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (msg) => console.log(msg);

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

// ============ 模拟客户端 ============
class SimClient {
  constructor(name) {
    this.name = name;
    this.playerId = `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.ws = null;
    this.topic = null;
    this.ref = 0;
    this.events = [];
    this._heartbeat = null;
  }

  async joinRoom(roomCode, roomId) {
    this.topic = `realtime:room:${roomCode}`;

    // 1. 先连 WS 并确认 channel join
    await new Promise((resolve, reject) => {
      const joinRef = String(++this.ref);
      this.ws = new WebSocket(`${SUPABASE_URL.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${ANON_KEY}&vsn=1.0.0`);
      let joined = false;
      this.ws.on('open', () => {
        this._send({ topic: this.topic, event: 'phx_join', payload: { config: { broadcast: { self: true } } }, ref: joinRef });
        this._heartbeat = setInterval(() => this._send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++this.ref) }), 30000);
      });
      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.event === 'phx_reply' && msg.ref === joinRef && !joined) { joined = true; resolve(); }
          if (msg.event === 'broadcast' && msg.payload) {
            const { event, payload } = msg.payload;
            if (payload._targetPlayerId && payload._targetPlayerId !== this.playerId) return;
            this.events.push({ event, payload, time: Date.now() });
            this._autoRespond(event, payload);
          }
        } catch (e) {}
      });
      this.ws.on('error', reject);
      setTimeout(() => { if (!joined) resolve(); }, 5000);
    });

    // 2. WS 就绪后再 REST 写入数据库
    const existing = await supaFetch(`players?room_id=eq.${roomId}&select=seat_index&order=seat_index.desc&limit=1`);
    const nextSeat = (existing.length > 0 ? existing[0].seat_index : 0) + 1;
    await supaFetch('players', {
      method: 'POST',
      body: JSON.stringify({
        room_id: roomId, player_id: this.playerId, name: this.name,
        seat_index: nextSeat, alive: true, infected: false,
        ghost_vote_used: false, connected: true,
      }),
    });

    // 3. 广播加入
    this._broadcast('player_joined', { id: this.playerId, name: this.name, seatIndex: nextSeat });
  }

  _send(msg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }

  _broadcast(event, payload) {
    this._send({ topic: this.topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: String(++this.ref) });
  }

  _autoRespond(event, payload) {
    switch (event) {
      case 'dating_prompt':
        // 50% 约第一个人, 50% 不约
        if (payload.alivePlayers?.length > 0 && Math.random() < 0.5) {
          const target = payload.alivePlayers[Math.floor(Math.random() * payload.alivePlayers.length)];
          setTimeout(() => this._broadcast('dating_choice', { playerId: this.playerId, targetId: target.id }), 200 + Math.random() * 500);
        } else {
          setTimeout(() => this._broadcast('dating_choice', { playerId: this.playerId, targetId: 'none' }), 200 + Math.random() * 500);
        }
        break;
      case 'night_action_prompt':
        if (payload.targets?.length > 0) {
          const targets = [payload.targets[Math.floor(Math.random() * payload.targets.length)].id];
          // select_two: add second target
          if (payload.type === 'select_two' && payload.targets.length > 1) {
            const second = payload.targets.filter(t => t.id !== targets[0]);
            if (second.length > 0) targets.push(second[Math.floor(Math.random() * second.length)].id);
          }
          setTimeout(() => this._broadcast('night_action', { playerId: this.playerId, targets }), 200 + Math.random() * 500);
        }
        break;
      case 'vote_start':
        const inFavor = Math.random() < 0.6;
        setTimeout(() => this._broadcast('vote_cast', { playerId: this.playerId, inFavor }), 200 + Math.random() * 500);
        break;
    }
  }

  hasEvent(name) { return this.events.some(e => e.event === name); }

  close() {
    clearInterval(this._heartbeat);
    if (this.ws) this.ws.close();
  }
}

// ============ 单次测试 ============
async function runTest(totalPlayers, numBots) {
  const numHumans = totalPlayers - numBots;
  log(`\n${'═'.repeat(60)}`);
  log(`  🧪 ${totalPlayers}人局测试 (${numBots} bot + ${numHumans} 模拟真人)`);
  log(`${'═'.repeat(60)}`);

  let botProc = null;
  const clients = [];
  let passed = 0, failed = 0;

  function check(ok, msg) {
    if (ok) { log(`    ✅ ${msg}`); passed++; }
    else { log(`    ❌ ${msg}`); failed++; }
  }

  try {
    // 1. 启动 bot-runner
    log(`  [1] 启动 bot-runner --bots ${numBots} --total ${totalPlayers}`);
    botProc = spawn('node', ['tools/bot-runner.js', '--bots', String(numBots), '--total', String(totalPlayers)], { stdio: 'pipe' });
    let botOut = '';
    botProc.stdout.on('data', d => botOut += d.toString());
    botProc.stderr.on('data', d => botOut += d.toString());

    let roomCode = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const m = botOut.match(/房间码:\s*([A-Z0-9]{6})/);
      if (m) { roomCode = m[1]; break; }
    }
    check(!!roomCode, `服务器启动, 房间码: ${roomCode}`);
    if (!roomCode) throw new Error('无法获取房间码');

    // 等 WS
    for (let i = 0; i < 10; i++) {
      if (botOut.includes('WebSocket 已连接')) break;
      await sleep(500);
    }

    // 2. 获取房间 ID
    const rooms = await supaFetch(`rooms?code=eq.${roomCode}&select=*`);
    const roomId = rooms[0]?.id;
    check(!!roomId, `房间已创建 (DB id: ${roomId})`);

    // 3. 模拟客户端加入
    log(`  [2] ${numHumans} 个模拟客户端加入...`);
    for (let i = 0; i < numHumans; i++) {
      const client = new SimClient(`👤玩家${i + 1}`);
      await client.joinRoom(roomCode, roomId);
      clients.push(client);
      await sleep(800); // 错开加入避免竞态
    }
    check(clients.length === numHumans, `${numHumans} 客户端全部加入`);

    // 4. 等待游戏开始和结束
    log(`  [3] 等待游戏完成...`);
    const maxWait = totalPlayers >= 10 ? 300000 : 180000; // 10人5分钟, 其余3分钟
    const start = Date.now();
    let gameOver = false;
    while (Date.now() - start < maxWait) {
      gameOver = clients.some(c => c.hasEvent('game_over'));
      if (gameOver) break;
      await sleep(500);
    }
    check(gameOver, '游戏正常结束');

    // 5. 验证每个客户端收到的关键事件
    log(`  [4] 验证客户端事件...`);
    for (const c of clients) {
      const roleOk = c.hasEvent('role_assigned');
      const datingOk = c.hasEvent('dating_prompt') || c.hasEvent('phase_change');
      check(roleOk, `${c.name} 收到角色分配`);
      if (!roleOk) log(`       事件: ${c.events.map(e => e.event).join(', ')}`);
    }

    // 6. 检查服务端日志
    const hasRoleAssign = botOut.includes('分配角色');
    const hasNight = botOut.includes('夜 =====');
    const hasEnd = botOut.includes('游戏结束');
    check(hasRoleAssign && hasNight, '服务端完成角色分配和夜晚');
    check(hasEnd, '服务端确认游戏结束');
    if (!hasEnd) {
      // 打印服务端最后20行帮助诊断
      const lines = botOut.split('\n').filter(l => l.trim());
      log('    📋 服务端最后日志:');
      lines.slice(-15).forEach(l => log(`       ${l}`));
    }

    // 统计
    const gameOverEvt = clients[0]?.events.find(e => e.event === 'game_over');
    if (gameOverEvt) {
      log(`    🏆 ${gameOverEvt.payload.winner === 'good' ? '好人胜' : '恶方胜'}: ${gameOverEvt.payload.reason}`);
    }

    // 找白天/投票
    const hadDay = botOut.includes('天 =====');
    const hadVote = botOut.includes('提名:');
    log(`    ℹ️  白天: ${hadDay ? '✅' : '⏭️'}  投票: ${hadVote ? '✅' : '⏭️'}`);

  } catch (e) {
    log(`    ❌ 异常: ${e.message}`);
    failed++;
  } finally {
    for (const c of clients) c.close();
    if (botProc) {
      botProc.kill('SIGINT');
      await sleep(3000);
      try { botProc.kill('SIGKILL'); } catch (e) {}
    }
  }

  return { passed, failed };
}

// ============ 主流程 ============
async function main() {
  log('\n🧪 夜店钟楼 — 多人数端到端测试');
  log('━'.repeat(60));

  const tests = [
    { total: 5,  bots: 4 },   // 5人: 4 bot + 1 human
    { total: 7,  bots: 5 },   // 7人: 5 bot + 2 humans
    { total: 10, bots: 7 },   // 10人: 7 bot + 3 humans
  ];

  let totalPassed = 0, totalFailed = 0;

  for (const t of tests) {
    const result = await runTest(t.total, t.bots);
    totalPassed += result.passed;
    totalFailed += result.failed;
    await sleep(2000); // 等残留清理
  }

  log(`\n${'━'.repeat(60)}`);
  log(`🏁 总结: ${totalPassed} passed, ${totalFailed} failed`);
  log(`${'━'.repeat(60)}`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
