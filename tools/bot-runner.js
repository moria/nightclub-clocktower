#!/usr/bin/env node
// 夜店钟楼 - 游戏服务器 + 4个机器人玩家
// 运行后创建房间，等真人玩家加入后自动开始5人局

const WebSocket = require('ws');

const SUPABASE_URL = 'https://nxeybszulisostkazlkc.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54ZXlic3p1bGlzb3N0a2F6bGtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNDA3NTMsImV4cCI6MjA5MTYxNjc1M30.xGtEfSMKvglwXYZg4mOR_pyIMpjAFQSxUUR6h01P5Xo';

const BOT_NAMES = ['🤖张飞', '🤖貂蝉', '🤖吕布', '🤖孙尚香'];

// ============ 角色数据（内联简化版） ============
const FACTION = { PURE: 'pure', SIMP: 'simp', TEAIST: 'teaist', SCUM: 'scum' };
const TAGS = { ATTACK: '攻击性', PROTECT: '保护性', SPY: '窥探性', SOCIAL: '社交性', INFECT: '传染性', STEALTH: '隐蔽性' };

const ROLES = {
  jian_biao_shi: { id: 'jian_biao_shi', name: '鉴婊师', emoji: '🔍', faction: FACTION.PURE, tags: [TAGS.SPY, TAGS.SOCIAL], nightOrder: 7, mechanic: 'select_one', isInfo: true },
  xiao_hu_shi: { id: 'xiao_hu_shi', name: '小护士', emoji: '💉', faction: FACTION.PURE, tags: [TAGS.PROTECT, TAGS.SPY], nightOrder: 8, mechanic: 'select_one', isInfo: true },
  ji_rou_meng: { id: 'ji_rou_meng', name: '肌肉猛1', emoji: '💪', faction: FACTION.PURE, tags: [TAGS.PROTECT, TAGS.ATTACK], nightOrder: 4, mechanic: 'select_one' },
  zao_yao_jing: { id: 'zao_yao_jing', name: '造谣精', emoji: '📰', faction: FACTION.TEAIST, tags: [TAGS.SOCIAL, TAGS.STEALTH], nightOrder: 3, mechanic: 'select_one' },
  hiv: { id: 'hiv', name: 'HIV携带者', emoji: '☠️', faction: FACTION.SCUM, tags: [TAGS.ATTACK, TAGS.INFECT], nightOrder: 5, mechanic: 'select_one', isInfected: true },
};

const FIVE_PLAYER_ROLES = ['jian_biao_shi', 'xiao_hu_shi', 'ji_rou_meng', 'zao_yao_jing', 'hiv'];
const INFO_ROLES = ['jian_biao_shi', 'xiao_hu_shi'];
const getSide = (roleId) => { const f = ROLES[roleId]?.faction; return (f === FACTION.PURE || f === FACTION.SIMP) ? 'good' : 'evil'; };
const FACTION_NAMES = { pure: '清流派', simp: '恋爱脑', teaist: '茶艺师', scum: '渣王' };
const SIDE_NAMES = { good: '好人阵营', evil: '恶方阵营' };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============ Supabase helpers ============
async function supaFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation', ...options.headers },
    ...options,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// ============ Game State ============
const game = {
  roomId: null,
  roomCode: null,
  players: [],      // { id, name, roleId, alive, infected, isBot, seatIndex }
  humanPlayerId: null,
  dayNumber: 0,
  phase: 'lobby',
  lastGuardTarget: null,
  datingChoices: {},
  pendingActions: new Map(), // playerId -> resolve function
};

// ============ WebSocket ============
let ws = null;
let ref = 0;
let topic = null;

function wsSend(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(event, payload) {
  wsSend({ topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: String(++ref) });
}

function sendToPlayer(playerId, event, payload) {
  // 通过 broadcast 发送但带 playerId 标记，客户端自行过滤
  broadcast(event, { ...payload, _targetPlayerId: playerId });
}

// ============ Main ============
async function main() {
  game.roomCode = genCode();
  topic = `realtime:room:${game.roomCode}`;

  // 1. 创建房间
  const [room] = await supaFetch('rooms', {
    method: 'POST',
    body: JSON.stringify({ code: game.roomCode, host_id: 'server', state: {}, phase: 'lobby' }),
  });
  game.roomId = room.id;

  // 2. 添加 4 个 bot
  for (let i = 0; i < 4; i++) {
    const botId = `bot-${i}-${Date.now().toString(36)}`;
    await supaFetch('players', {
      method: 'POST',
      body: JSON.stringify({ room_id: room.id, player_id: botId, name: BOT_NAMES[i], seat_index: i + 1, alive: true, infected: false, ghost_vote_used: false, connected: true }),
    });
    game.players.push({ id: botId, name: BOT_NAMES[i], roleId: null, alive: true, infected: false, isBot: true, seatIndex: i + 1 });
  }

  console.log('\n🎪 夜店钟楼 - 游戏服务器');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔑 房间码: ${game.roomCode}`);
  console.log('🤖 张飞、貂蝉、吕布、孙尚香 已就位');
  console.log('⏳ 等待真人玩家加入...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 3. 连接 WebSocket
  connectWS();

  // 4. 轮询数据库检测真人玩家加入（不依赖 WebSocket broadcast）
  const pollForHuman = setInterval(async () => {
    if (game.humanPlayerId) { clearInterval(pollForHuman); return; }
    try {
      const players = await supaFetch(`players?room_id=eq.${game.roomId}&order=seat_index`);
      const newHuman = players.find(p => !p.player_id.startsWith('bot-'));
      if (newHuman && !game.players.find(pp => pp.id === newHuman.player_id)) {
        game.players.push({
          id: newHuman.player_id, name: newHuman.name, roleId: null,
          alive: true, infected: false, isBot: false, seatIndex: newHuman.seat_index,
        });
        game.humanPlayerId = newHuman.player_id;
        log(`✅ 真人玩家 "${newHuman.name}" 加入！(从数据库检测到)`);
        clearInterval(pollForHuman);

        if (game.players.length >= 5) {
          log('🎮 5人到齐！3秒后自动开始...');
          setTimeout(() => startGame(), 3000);
        }
      }
    } catch (e) {}
  }, 2000);
}

function connectWS() {
  ws = new WebSocket(`${SUPABASE_URL.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${ANON_KEY}&vsn=1.0.0`);

  ws.on('open', () => {
    log('📡 WebSocket 已连接');
    wsSend({ topic, event: 'phx_join', payload: { config: { broadcast: { self: true } } }, ref: String(++ref) });
    setInterval(() => wsSend({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }), 30000);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.event === 'broadcast' && msg.payload) {
        handleClientEvent(msg.payload.event, msg.payload.payload);
      }
    } catch (e) {}
  });

  ws.on('close', () => { log('📡 断开，3秒后重连'); setTimeout(connectWS, 3000); });
  ws.on('error', (e) => log('❌ WS error: ' + e.message));
}

// ============ 处理客户端事件 ============
function handleClientEvent(event, payload) {
  switch (event) {
    case 'player_joined': {
      if (game.players.find(p => p.id === payload.id)) return;
      game.players.push({ id: payload.id, name: payload.name, roleId: null, alive: true, infected: false, isBot: false, seatIndex: payload.seatIndex || 0 });
      game.humanPlayerId = payload.id;
      log(`✅ 真人玩家 "${payload.name}" 加入！(共${game.players.length}人)`);

      // 5人到齐，3秒后自动开始
      if (game.players.length >= 5) {
        log('🎮 5人到齐！3秒后自动开始...');
        setTimeout(() => startGame(), 3000);
      }
      break;
    }

    case 'request_start': {
      // 真人房主从浏览器触发开始
      if (game.phase !== 'lobby') return;
      if (game.players.length < 5) {
        log(`⚠️ 收到开始请求但人数不足 (${game.players.length}/5)`);
        return;
      }
      log('🎮 收到房主开始请求，启动游戏...');
      startGame();
      break;
    }

    case 'dating_choice': {
      if (!payload.playerId) return;
      game.datingChoices[payload.playerId] = payload.targetId;
      log(`💘 ${getPlayerName(payload.playerId)} 提交了约会选择`);
      // 不在这里触发 processNightAfterDating，由 runNight 的 waitForAllDating 统一推进
      break;
    }

    case 'night_action': {
      if (!payload.playerId) return;
      const resolve = game.pendingActions.get(payload.playerId);
      if (resolve) {
        resolve(payload.targets);
        game.pendingActions.delete(payload.playerId);
      }
      break;
    }

    case 'vote_cast': {
      if (!payload.playerId) return;
      const resolve = game.pendingActions.get('vote_' + payload.playerId);
      if (resolve) {
        resolve(payload.inFavor);
        game.pendingActions.delete('vote_' + payload.playerId);
      }
      break;
    }
  }
}

// ============ 游戏流程 ============
async function startGame() {
  log('\n🎲 分配角色...');
  const roles = shuffle([...FIVE_PLAYER_ROLES]);

  game.players.forEach((p, i) => {
    p.roleId = roles[i];
    p.infected = ROLES[roles[i]]?.isInfected || false;
  });

  // 通知每个玩家角色
  for (const p of game.players) {
    const role = ROLES[p.roleId];
    const side = getSide(p.roleId);
    log(`   ${p.name} → ${role.emoji} ${role.name} (${FACTION_NAMES[role.faction]})`);

    sendToPlayer(p.id, 'role_assigned', {
      playerId: p.id,
      roleId: p.roleId,
      roleName: role.name,
      roleEmoji: role.emoji,
      faction: role.faction,
      factionName: FACTION_NAMES[role.faction],
      side,
      sideName: SIDE_NAMES[side],
      tags: role.tags,
      skill: describeSkill(p.roleId),
    });
  }

  broadcast('phase_change', { phase: 'reveal' });
  await sleep(5000); // 给玩家5秒看角色

  // 恶方互认
  const evilPlayers = game.players.filter(p => getSide(p.roleId) === 'evil');
  if (evilPlayers.length > 1) {
    for (const ep of evilPlayers) {
      sendToPlayer(ep.id, 'evil_reveal', {
        playerId: ep.id,
        teammates: evilPlayers.filter(e => e.id !== ep.id).map(e => ({ id: e.id, name: e.name, role: ROLES[e.roleId].name, emoji: ROLES[e.roleId].emoji })),
      });
    }
    await sleep(3000);
  }

  // 开始第一夜
  await runNight();
}

async function runNight() {
  game.dayNumber++;
  game.datingChoices = {};
  game.phase = 'night';

  log(`\n🌙 ===== 第 ${game.dayNumber} 夜 =====`);
  broadcast('phase_change', { phase: 'dating', dayNumber: game.dayNumber });

  // 所有存活玩家提交约会选择
  const alive = game.players.filter(p => p.alive);

  // 给真人玩家发约会提示
  for (const p of alive) {
    if (!p.isBot) {
      sendToPlayer(p.id, 'dating_prompt', {
        playerId: p.id,
        message: '选择今晚的约会对象，或选择"不约"',
        alivePlayers: alive.filter(a => a.id !== p.id).map(a => ({ id: a.id, name: a.name })),
      });
    }
  }

  // Bot 自动约会
  await sleep(1000);
  for (const p of alive) {
    if (p.isBot) {
      const others = alive.filter(a => a.id !== p.id);
      const choice = Math.random() < 0.5 ? pick(others).id : 'none';
      game.datingChoices[p.id] = choice;
      log(`   🤖 ${p.name} 约会: ${choice === 'none' ? '不约' : getPlayerName(choice)}`);
    }
  }

  // 等待真人玩家的约会选择（最多30秒超时）
  log('   ⏳ 等待真人玩家选择约会对象...');
  await waitForAllDating(30000);

  // 所有约会选择已收齐，推进到夜间行动
  await processNightAfterDating();
}

function waitForAllDating(timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const alive = game.players.filter(p => p.alive);
      const allDone = alive.every(p => game.datingChoices[p.id] !== undefined);
      if (allDone || Date.now() - start > timeout) {
        // 超时的玩家默认"不约"
        for (const p of alive) {
          if (game.datingChoices[p.id] === undefined) {
            game.datingChoices[p.id] = 'none';
            log(`   ⏰ ${p.name} 超时，默认不约`);
          }
        }
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

async function processNightAfterDating() {
  // 如果已经在处理就跳过
  if (game.phase === 'night_processing') return;
  game.phase = 'night_processing';

  log('\n   🔄 夜晚行动阶段...');
  broadcast('phase_change', { phase: 'night_action', dayNumber: game.dayNumber });

  const alive = game.players.filter(p => p.alive);
  const nightMessages = {}; // playerId -> [messages]
  const addMsg = (pid, text) => { nightMessages[pid] = nightMessages[pid] || []; nightMessages[pid].push({ type: 'info', text }); };

  let guardTarget = null;
  let hivKillTarget = null;
  let hivBlocked = false;
  let zaoYaoTarget = null;

  // 按 nightOrder 排序处理角色
  const actionOrder = alive
    .filter(p => ROLES[p.roleId]?.nightOrder > 0)
    .sort((a, b) => ROLES[a.roleId].nightOrder - ROLES[b.roleId].nightOrder);

  for (const player of actionOrder) {
    const role = ROLES[player.roleId];
    const others = alive.filter(a => a.id !== player.id);
    let targets;

    if (player.isBot) {
      // Bot 随机选目标
      await sleep(500);
      if (role.id === 'ji_rou_meng') {
        const goodOthers = others.filter(o => o.id !== game.lastGuardTarget);
        targets = goodOthers.length > 0 ? [pick(goodOthers).id] : [pick(others).id];
      } else {
        targets = [pick(others).id];
      }
      log(`   🤖 ${player.name}(${role.name}) 行动 → ${getPlayerName(targets[0])}`);
    } else {
      // 真人玩家
      sendToPlayer(player.id, 'night_action_prompt', {
        playerId: player.id,
        type: 'select_one',
        roleEmoji: role.emoji,
        roleName: role.name,
        message: describeSkill(role.id),
        targets: others.map(o => ({ id: o.id, name: o.name })),
      });

      log(`   ⏳ 等待 ${player.name}(${role.name}) 行动...`);
      targets = await waitForAction(player.id, 25000);
      if (!targets) {
        targets = [pick(others).id];
        log(`   ⏰ ${player.name} 超时，随机选择`);
      }
      log(`   👤 ${player.name}(${role.name}) 行动 → ${getPlayerName(targets[0])}`);
    }

    // 结算行动
    switch (role.id) {
      case 'zao_yao_jing':
        zaoYaoTarget = targets[0];
        break;
      case 'ji_rou_meng':
        guardTarget = targets[0];
        game.lastGuardTarget = targets[0];
        break;
      case 'hiv':
        hivKillTarget = targets[0];
        break;
      case 'jian_biao_shi': {
        const t = getPlayer(targets[0]);
        const tRole = ROLES[t.roleId];
        let tags = [...tRole.tags];
        if (zaoYaoTarget === player.id && INFO_ROLES.includes(role.id)) {
          tags = [pick(Object.values(TAGS)), pick(Object.values(TAGS))];
        }
        addMsg(player.id, `🔍 你翻了 ${t.name} 的相册：「${tags[0]}」「${tags[1]}」`);
        break;
      }
      case 'xiao_hu_shi': {
        const t = getPlayer(targets[0]);
        let result = t.infected ? '阳性 🔴' : '阴性 🟢';
        if (zaoYaoTarget === player.id && INFO_ROLES.includes(role.id)) {
          result = t.infected ? '阴性 🟢' : '阳性 🔴';
        }
        addMsg(player.id, `💉 ${t.name} 的检测报告：${result}`);
        break;
      }
    }
  }

  // 配对结算
  const pairings = [];
  const paired = new Set();
  for (const p of alive) {
    if (paired.has(p.id)) continue;
    const myChoice = game.datingChoices[p.id];
    if (!myChoice || myChoice === 'none') continue;
    const theirChoice = game.datingChoices[myChoice];
    if (theirChoice === p.id && !paired.has(myChoice)) {
      pairings.push([p.id, myChoice]);
      paired.add(p.id);
      paired.add(myChoice);
      log(`   💕 ${p.name} ↔ ${getPlayerName(myChoice)} 配对成功！`);
    }
  }

  // 感染传播
  const newInfections = [];
  for (const [a, b] of pairings) {
    const pa = getPlayer(a), pb = getPlayer(b);
    if (pa.infected && !pb.infected && b !== guardTarget) { pb.infected = true; newInfections.push(b); }
    if (pb.infected && !pa.infected && a !== guardTarget) { pa.infected = true; newInfections.push(a); }
  }

  // 配对标签奖励
  for (const [a, b] of pairings) {
    const ra = ROLES[getPlayer(a).roleId], rb = ROLES[getPlayer(b).roleId];
    addMsg(a, `🌹 约会收获：对方标签「${rb.tags[Math.floor(Math.random() * rb.tags.length)]}」`);
    addMsg(b, `🌹 约会收获：对方标签「${ra.tags[Math.floor(Math.random() * ra.tags.length)]}」`);
  }

  // 死亡结算
  const deaths = [];
  if (hivKillTarget && hivKillTarget !== guardTarget && !hivBlocked) {
    deaths.push(hivKillTarget);
  }

  for (const pid of deaths) {
    const p = getPlayer(pid);
    if (p) p.alive = false;
  }

  if (newInfections.length > 0) log(`   🦠 新增感染 ${newInfections.length} 人`);
  if (deaths.length > 0) log(`   ☠️ 死亡: ${deaths.map(id => getPlayerName(id)).join(', ')}`);
  else log('   🌅 今夜平安');

  // 发送夜晚结果给每个玩家
  for (const [pid, msgs] of Object.entries(nightMessages)) {
    sendToPlayer(pid, 'night_results', { playerId: pid, messages: msgs });
  }

  await sleep(3000);

  // 检查胜负
  const win = checkWin();
  if (win) { endGame(win); return; }

  // 进入白天
  await runDay(deaths, newInfections);
}

async function runDay(deaths, newInfections) {
  game.phase = 'day';
  log(`\n☀️ ===== 第 ${game.dayNumber} 天 =====`);

  const announcements = [];
  if (deaths.length > 0) {
    announcements.push({ type: 'death', text: `☠️ 昨夜死亡: ${deaths.map(id => getPlayerName(id)).join(', ')}` });
  } else {
    announcements.push({ type: 'info', text: '🌅 昨夜平安无事' });
  }
  if (newInfections.length > 0) {
    announcements.push({ type: 'warning', text: `🦠 昨夜有 ${newInfections.length} 人新增感染` });
  }

  broadcast('phase_change', {
    phase: 'day',
    dayNumber: game.dayNumber,
    announcements,
    alivePlayers: game.players.filter(p => p.alive).map(p => ({ id: p.id, name: p.name, alive: p.alive })),
  });

  // 白天讨论 5 秒
  log('   💬 白天讨论中 (5秒)...');
  await sleep(5000);

  // 投票：随机提名一个人
  const alive = game.players.filter(p => p.alive);
  const nominated = pick(alive);
  log(`   📋 提名: ${nominated.name}`);

  broadcast('vote_start', {
    target: { id: nominated.id, name: nominated.name },
    threshold: Math.ceil(alive.length / 2),
  });

  // 收集投票
  const votes = {};
  await sleep(1000);

  // Bot 自动投票
  for (const p of alive) {
    if (p.isBot) {
      const isEvil = getSide(p.roleId) === 'evil';
      const targetIsEvil = getSide(nominated.roleId) === 'evil';
      // Bot 策略：恶方保护自己人，好人随机
      let inFavor;
      if (isEvil && targetIsEvil) inFavor = false;
      else if (isEvil && !targetIsEvil) inFavor = Math.random() < 0.7;
      else inFavor = Math.random() < 0.5;

      votes[p.id] = inFavor;
      log(`   🤖 ${p.name} 投票: ${inFavor ? '处决' : '反对'}`);
    }
  }

  // 等待真人投票
  for (const p of alive) {
    if (!p.isBot) {
      log(`   ⏳ 等待 ${p.name} 投票...`);
      const result = await waitForVote(p.id, 20000);
      votes[p.id] = result !== null ? result : Math.random() < 0.5;
      log(`   👤 ${p.name} 投票: ${votes[p.id] ? '处决' : '反对'}`);
    }
  }

  const forCount = Object.values(votes).filter(v => v).length;
  const threshold = Math.ceil(alive.length / 2);
  const executed = forCount >= threshold;

  if (executed) {
    nominated.alive = false;
    const side = getSide(nominated.roleId);
    log(`   ☠️ ${nominated.name} 被处决了！阵营: ${side === 'evil' ? '恶方' : '好人'}`);

    broadcast('execution', {
      target: { id: nominated.id, name: nominated.name },
      side,
      forCount,
      threshold,
    });
  } else {
    log(`   ✋ ${nominated.name} 无罪释放 (${forCount}/${threshold}票)`);
    broadcast('acquittal', {
      target: { id: nominated.id, name: nominated.name },
      forCount,
      threshold,
    });
  }

  await sleep(3000);

  // 检查胜负
  const win = checkWin();
  if (win) { endGame(win); return; }

  // 下一夜
  await runNight();
}

// ============ 胜负判定 ============
function checkWin() {
  const aliveGood = game.players.filter(p => p.alive && getSide(p.roleId) === 'good');
  const aliveEvil = game.players.filter(p => p.alive && getSide(p.roleId) === 'evil');
  const aliveScum = game.players.filter(p => p.alive && ROLES[p.roleId]?.faction === FACTION.SCUM);

  // 恶方人数 >= 好人人数 → 恶方胜（数量压制）
  if (aliveEvil.length >= aliveGood.length && aliveEvil.length > 0) {
    return { winner: 'evil', reason: '恶方势力压过好人，渣王称霸夜店！' };
  }
  // 所有渣王被处决 → 检查感染否决
  if (aliveScum.length === 0) {
    const infected = aliveGood.filter(p => p.infected).length;
    if (infected >= Math.ceil(aliveGood.length / 2)) {
      return { winner: 'evil', reason: `渣王虽死，但感染已扩散至 ${infected}/${aliveGood.length} 人！` };
    }
    return { winner: 'good', reason: '所有渣王被处决，清流派净化了夜店！' };
  }
  return null;
}

function endGame(win) {
  log(`\n${'━'.repeat(40)}`);
  log(`🎉 游戏结束! ${win.winner === 'good' ? '💧 好人胜!' : '👑 恶方胜!'}`);
  log(`   ${win.reason}`);
  log('');
  log('   角色揭晓:');
  for (const p of game.players) {
    const r = ROLES[p.roleId];
    log(`   ${p.alive ? '✅' : '💀'} ${p.name} → ${r.emoji} ${r.name} (${FACTION_NAMES[r.faction]}) ${p.infected ? '🦠' : ''}`);
  }
  log(`${'━'.repeat(40)}\n`);

  broadcast('game_over', {
    winner: win.winner,
    reason: win.reason,
    players: game.players.map(p => ({
      id: p.id, name: p.name, roleId: p.roleId,
      roleName: ROLES[p.roleId].name, roleEmoji: ROLES[p.roleId].emoji,
      faction: ROLES[p.roleId].faction, alive: p.alive, infected: p.infected,
    })),
  });

  // 清理
  setTimeout(async () => {
    try {
      await supaFetch(`players?room_id=eq.${game.roomId}`, { method: 'DELETE', headers: { 'Prefer': '' } });
      await supaFetch(`rooms?id=eq.${game.roomId}`, { method: 'DELETE', headers: { 'Prefer': '' } });
      log('🧹 房间已清理');
    } catch (e) {}
    process.exit(0);
  }, 5000);
}

// ============ 等待玩家操作 ============
function waitForAction(playerId, timeout) {
  return new Promise((resolve) => {
    game.pendingActions.set(playerId, resolve);
    setTimeout(() => {
      if (game.pendingActions.has(playerId)) {
        game.pendingActions.delete(playerId);
        resolve(null);
      }
    }, timeout);
  });
}

function waitForVote(playerId, timeout) {
  return new Promise((resolve) => {
    game.pendingActions.set('vote_' + playerId, resolve);
    setTimeout(() => {
      const key = 'vote_' + playerId;
      if (game.pendingActions.has(key)) {
        game.pendingActions.delete(key);
        resolve(null);
      }
    }, timeout);
  });
}

// ============ 工具 ============
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = ''; for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function getPlayer(id) { return game.players.find(p => p.id === id); }
function getPlayerName(id) { return getPlayer(id)?.name || id; }
function log(msg) { console.log(msg); }

function describeSkill(roleId) {
  const skills = {
    jian_biao_shi: '每夜选1人，查看其行为标签（翻他手机相册）',
    xiao_hu_shi: '每夜选1人，查看其是否感染（偷偷做检测）',
    ji_rou_meng: '每夜选1人守护，免疫杀害和感染',
    zao_yao_jing: '每夜选1人，若其是信息角色则信息被篡改',
    hiv: '每夜选1人杀害，自身永久携带感染',
  };
  return skills[roleId] || '';
}

// 优雅退出
process.on('SIGINT', async () => {
  log('\n🧹 清理...');
  try {
    await supaFetch(`players?room_id=eq.${game.roomId}`, { method: 'DELETE', headers: { 'Prefer': '' } });
    await supaFetch(`rooms?id=eq.${game.roomId}`, { method: 'DELETE', headers: { 'Prefer': '' } });
  } catch (e) {}
  process.exit(0);
});

main().catch(e => { console.error('❌', e.message); process.exit(1); });
