#!/usr/bin/env node
// 夜店钟楼 - 游戏服务器 + 4个机器人玩家
// 运行后创建房间，等真人玩家加入后自动开始5人局

const WebSocket = require('ws');

const SUPABASE_URL = 'https://nxeybszulisostkazlkc.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54ZXlic3p1bGlzb3N0a2F6bGtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNDA3NTMsImV4cCI6MjA5MTYxNjc1M30.xGtEfSMKvglwXYZg4mOR_pyIMpjAFQSxUUR6h01P5Xo';

// CLI 参数: --bots N (bot数量, 默认4) --total N (总人数, 默认5)
const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i+1] ? parseInt(args[i+1]) : def; };
const NUM_BOTS = getArg('bots', 4);
const TOTAL_PLAYERS = getArg('total', NUM_BOTS + 1);
const HUMANS_NEEDED = TOTAL_PLAYERS - NUM_BOTS;

const ALL_BOT_NAMES = ['🤖张飞','🤖貂蝉','🤖吕布','🤖孙尚香','🤖曹操','🤖小乔','🤖赵云','🤖黄月英','🤖诸葛亮','🤖甄姬','🤖关羽','🤖大乔','🤖周瑜','🤖马超'];
const BOT_NAMES = ALL_BOT_NAMES.slice(0, NUM_BOTS);

// ============ 角色数据（完整20角色） ============
const FACTION = { PURE: 'pure', SIMP: 'simp', TEAIST: 'teaist', SCUM: 'scum' };
const TAGS = { ATTACK: '攻击性', PROTECT: '保护性', SPY: '窥探性', SOCIAL: '社交性', INFECT: '传染性', STEALTH: '隐蔽性' };

const ROLES = {
  // 清流派
  jian_biao_shi: { id: 'jian_biao_shi', name: '鉴婊师', emoji: '🔍', faction: FACTION.PURE, tags: [TAGS.SPY, TAGS.SOCIAL], nightOrder: 7, mechanic: 'select_one', isInfo: true },
  xiao_hu_shi: { id: 'xiao_hu_shi', name: '小护士', emoji: '💉', faction: FACTION.PURE, tags: [TAGS.PROTECT, TAGS.SPY], nightOrder: 8, mechanic: 'select_one', isInfo: true },
  ji_rou_meng: { id: 'ji_rou_meng', name: '肌肉猛1', emoji: '💪', faction: FACTION.PURE, tags: [TAGS.PROTECT, TAGS.ATTACK], nightOrder: 4, mechanic: 'select_one' },
  mu_la_la: { id: 'mu_la_la', name: '母拉拉', emoji: '👩‍❤️‍👩', faction: FACTION.PURE, tags: [TAGS.SOCIAL, TAGS.SPY], nightOrder: 12, mechanic: 'select_two', isInfo: true },
  hua_fang_gu_niang: { id: 'hua_fang_gu_niang', name: '花房姑娘', emoji: '🌸', faction: FACTION.PURE, tags: [TAGS.SPY, TAGS.SOCIAL], nightOrder: 13, mechanic: 'select_one', isInfo: true },
  hou_zi: { id: 'hou_zi', name: '猴子', emoji: '🐒', faction: FACTION.PURE, tags: [TAGS.SPY, TAGS.SOCIAL], nightOrder: 14, mechanic: 'select_one', isInfo: true },
  cai_zhuang_mu: { id: 'cai_zhuang_mu', name: '彩妆母1', emoji: '💄', faction: FACTION.PURE, tags: [TAGS.SOCIAL, TAGS.SPY], nightOrder: 1, mechanic: 'passive_first_night' },
  cu_kou: { id: 'cu_kou', name: '粗口1s', emoji: '🤬', faction: FACTION.PURE, tags: [TAGS.ATTACK, TAGS.SOCIAL], nightOrder: -1, mechanic: 'daytime' },
  gang_tie_zhi_nan: { id: 'gang_tie_zhi_nan', name: '钢铁直男', emoji: '🏋️', faction: FACTION.PURE, tags: [TAGS.PROTECT, TAGS.SOCIAL], nightOrder: 10, mechanic: 'passive' },
  xiao_san: { id: 'xiao_san', name: '小三', emoji: '💔', faction: FACTION.PURE, tags: [TAGS.SOCIAL, TAGS.SPY], nightOrder: 11, mechanic: 'select_one', isInfo: true },
  bao_zha_ling: { id: 'bao_zha_ling', name: '爆炸0', emoji: '🔥', faction: FACTION.PURE, tags: [TAGS.ATTACK, TAGS.SOCIAL], nightOrder: 16, mechanic: 'passive' },
  // 恋爱脑
  side: { id: 'side', name: 'Side', emoji: '🔄', faction: FACTION.SIMP, tags: [TAGS.SOCIAL, TAGS.STEALTH], nightOrder: -1, mechanic: 'passive' },
  gai_zhuang_che: { id: 'gai_zhuang_che', name: '改装车', emoji: '🚗', faction: FACTION.SIMP, tags: [TAGS.ATTACK, TAGS.STEALTH], nightOrder: -1, mechanic: 'passive' },
  gou_zi: { id: 'gou_zi', name: '狗子', emoji: '🐕', faction: FACTION.SIMP, tags: [TAGS.SOCIAL, TAGS.PROTECT], nightOrder: -1, mechanic: 'passive' },
  ji_nv: { id: 'ji_nv', name: '妓女', emoji: '💃', faction: FACTION.SIMP, tags: [TAGS.SOCIAL, TAGS.INFECT], nightOrder: -1, mechanic: 'passive' },
  // 茶艺师
  zao_yao_jing: { id: 'zao_yao_jing', name: '造谣精', emoji: '📰', faction: FACTION.TEAIST, tags: [TAGS.SOCIAL, TAGS.STEALTH], nightOrder: 3, mechanic: 'select_one' },
  miao_nan: { id: 'miao_nan', name: '秒男', emoji: '⚡', faction: FACTION.TEAIST, tags: [TAGS.ATTACK, TAGS.INFECT], nightOrder: 6, mechanic: 'select_one' },
  zuo_jing: { id: 'zuo_jing', name: '作精', emoji: '😭', faction: FACTION.TEAIST, tags: [TAGS.SOCIAL, TAGS.ATTACK], nightOrder: -1, mechanic: 'daytime' },
  // 渣王
  hiv: { id: 'hiv', name: 'HIV携带者', emoji: '☠️', faction: FACTION.SCUM, tags: [TAGS.ATTACK, TAGS.INFECT], nightOrder: 5, mechanic: 'select_one', isInfected: true },
  fu_sheng_shi: { id: 'fu_sheng_shi', name: '缚绳师', emoji: '⛓️', faction: FACTION.SCUM, tags: [TAGS.ATTACK, TAGS.STEALTH], nightOrder: 5, mechanic: 'select_one' },
};

const INFO_ROLES = ['jian_biao_shi', 'xiao_hu_shi', 'mu_la_la', 'hua_fang_gu_niang', 'hou_zi', 'xiao_san'];

// 人数配置表（从 roles.js 同步）
const PLAYER_CONFIG = {
  5:  { pure: 3, simp: 0, teaist: 1, scum: 1 },
  6:  { pure: 3, simp: 1, teaist: 1, scum: 1 },
  7:  { pure: 4, simp: 1, teaist: 1, scum: 1 },
  8:  { pure: 5, simp: 1, teaist: 1, scum: 1 },
  9:  { pure: 5, simp: 1, teaist: 2, scum: 1 },
  10: { pure: 5, simp: 2, teaist: 1, scum: 2 },
  11: { pure: 6, simp: 2, teaist: 1, scum: 2 },
  12: { pure: 6, simp: 2, teaist: 2, scum: 2 },
  13: { pure: 7, simp: 2, teaist: 2, scum: 2 },
  14: { pure: 7, simp: 3, teaist: 2, scum: 2 },
  15: { pure: 8, simp: 3, teaist: 2, scum: 2 },
};

const ROLE_POOL = {
  scum: ['hiv', 'fu_sheng_shi'],
  teaist: ['zao_yao_jing', 'miao_nan', 'zuo_jing'],
  simp: ['ji_nv', 'gai_zhuang_che', 'gou_zi', 'side'],
  pure: ['jian_biao_shi', 'xiao_hu_shi', 'ji_rou_meng', 'mu_la_la', 'hou_zi', 'hua_fang_gu_niang', 'cai_zhuang_mu', 'cu_kou', 'gang_tie_zhi_nan', 'xiao_san', 'bao_zha_ling'],
};

function assignRoles(playerCount) {
  const config = PLAYER_CONFIG[playerCount];
  if (!config) throw new Error(`不支持 ${playerCount} 人游戏`);
  const selected = [];
  for (const faction of ['scum', 'teaist', 'simp', 'pure']) {
    const needed = config[faction];
    const pool = [...ROLE_POOL[faction]];
    if (faction === 'scum') {
      selected.push('hiv');
      pool.splice(pool.indexOf('hiv'), 1);
      for (let i = 1; i < needed; i++) selected.push(pool.shift());
    } else {
      for (let i = 0; i < needed && pool.length > 0; i++) selected.push(pool.shift());
    }
  }
  return shuffle(selected);
}

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
  fuShengShiCooldown: false,
  datingChoices: {},
  pendingActions: new Map(),
  earlyEvents: new Map(), // 缓存在 pending 注册前到达的客户端事件
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
  // 0. 清理残留数据（上次异常退出可能留下的）
  try {
    const staleRooms = await supaFetch('rooms?host_id=eq.server&select=id');
    for (const r of staleRooms) {
      await supaFetch(`players?room_id=eq.${r.id}`, { method: 'DELETE', headers: { 'Prefer': '' } });
      await supaFetch(`rooms?id=eq.${r.id}`, { method: 'DELETE', headers: { 'Prefer': '' } });
    }
    if (staleRooms.length > 0) log(`🧹 清理了 ${staleRooms.length} 个残留房间`);
  } catch (e) { /* 忽略清理失败 */ }

  game.roomCode = genCode();
  topic = `realtime:room:${game.roomCode}`;

  // 1. 创建房间
  const [room] = await supaFetch('rooms', {
    method: 'POST',
    body: JSON.stringify({ code: game.roomCode, host_id: 'server', state: {}, phase: 'lobby' }),
  });
  game.roomId = room.id;

  // 2. 添加 N 个 bot
  for (let i = 0; i < NUM_BOTS; i++) {
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
  console.log(`🤖 ${BOT_NAMES.join('、')} 已就位 (${NUM_BOTS} bot)`);
  console.log(`⏳ 等待 ${HUMANS_NEEDED} 名真人玩家加入... (总${TOTAL_PLAYERS}人局)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 3. 连接 WebSocket
  connectWS();

  // 4. 轮询数据库检测真人玩家加入
  const pollForHumans = setInterval(async () => {
    try {
      const players = await supaFetch(`players?room_id=eq.${game.roomId}&order=seat_index`);
      for (const p of players) {
        if (p.player_id.startsWith('bot-')) continue;
        if (game.players.find(pp => pp.id === p.player_id)) continue;
        game.players.push({
          id: p.player_id, name: p.name, roleId: null,
          alive: true, infected: false, isBot: false, seatIndex: p.seat_index,
        });
        log(`✅ 真人玩家 "${p.name}" 加入！(${game.players.length}/${TOTAL_PLAYERS})`);
      }
      if (game.players.length >= TOTAL_PLAYERS && game.phase === 'lobby') {
        clearInterval(pollForHumans);
        log(`🎮 ${TOTAL_PLAYERS}人到齐！3秒后自动开始...`);
        setTimeout(() => startGame(), 3000);
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
async function handleClientEvent(event, payload) {
  switch (event) {
    case 'player_joined': {
      if (game.players.find(p => p.id === payload.id)) return;
      game.players.push({ id: payload.id, name: payload.name, roleId: null, alive: true, infected: false, isBot: false, seatIndex: payload.seatIndex || 0 });
      log(`✅ 真人玩家 "${payload.name}" 加入！(${game.players.length}/${TOTAL_PLAYERS})`);

      if (game.players.length >= TOTAL_PLAYERS && game.phase === 'lobby') {
        log(`🎮 ${TOTAL_PLAYERS}人到齐！3秒后自动开始...`);
        setTimeout(() => startGame(), 3000);
      }
      break;
    }

    case 'request_start': {
      // 真人房主从浏览器触发开始，自动补 bot
      if (game.phase !== 'lobby') return;
      const targetTotal = payload.targetTotal || TOTAL_PLAYERS;
      if (targetTotal < 5 || targetTotal > 15) {
        log(`⚠️ 不支持 ${targetTotal} 人游戏`);
        return;
      }
      const botsNeeded = targetTotal - game.players.length;
      if (botsNeeded > 0) {
        log(`🤖 自动补 ${botsNeeded} 个机器人...`);
        await fillBots(botsNeeded);
      }
      log(`🎮 收到房主开始请求 (${game.players.length}人)，启动游戏...`);
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
      } else {
        // 缓存早到的事件
        game.earlyEvents.set(payload.playerId, payload.targets);
      }
      break;
    }

    case 'vote_cast': {
      if (!payload.playerId) return;
      const key = 'vote_' + payload.playerId;
      const resolve = game.pendingActions.get(key);
      if (resolve) {
        resolve(payload.inFavor);
        game.pendingActions.delete(key);
      } else {
        game.earlyEvents.set(key, payload.inFavor);
      }
      break;
    }
  }
}

// ============ 动态补 Bot ============
async function fillBots(count) {
  const existingBotCount = game.players.filter(p => p.isBot).length;
  for (let i = 0; i < count; i++) {
    const idx = existingBotCount + i;
    const name = ALL_BOT_NAMES[idx] || `🤖机器人${idx + 1}`;
    const botId = `bot-${idx}-${Date.now().toString(36)}`;
    const seatIndex = game.players.length + 1;
    try {
      await supaFetch('players', {
        method: 'POST',
        body: JSON.stringify({ room_id: game.roomId, player_id: botId, name, seat_index: seatIndex, alive: true, infected: false, ghost_vote_used: false, connected: true }),
      });
      game.players.push({ id: botId, name, roleId: null, alive: true, infected: false, isBot: true, seatIndex });
      broadcast('player_joined', { id: botId, name, seatIndex });
      log(`   🤖 ${name} 加入`);
    } catch (e) {
      log(`   ⚠️ 补 bot 失败: ${e.message}`);
    }
  }
}

// ============ 游戏流程 ============
async function startGame() {
  log(`\n🎲 分配角色 (${game.players.length}人局)...`);
  const roles = assignRoles(game.players.length);

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
  let fuShengShiKillTarget = null;
  let hivBlocked = false;
  let zaoYaoTarget = null;
  let miaoNanInfections = [];
  let xioaSanQuery = null;

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
      await sleep(300);
      if (role.id === 'ji_rou_meng') {
        const goodOthers = others.filter(o => o.id !== game.lastGuardTarget);
        targets = goodOthers.length > 0 ? [pick(goodOthers).id] : [pick(others).id];
      } else if (role.mechanic === 'select_two') {
        const shuffled = shuffle(others);
        targets = [shuffled[0].id, shuffled[1]?.id || shuffled[0].id];
      } else {
        targets = [pick(others).id];
      }
      log(`   🤖 ${player.name}(${role.name}) 行动 → ${targets.map(t => getPlayerName(t)).join(', ')}`);
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
    const isJammed = zaoYaoTarget === player.id && INFO_ROLES.includes(role.id);
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
      case 'fu_sheng_shi':
        if (!game.fuShengShiCooldown) { fuShengShiKillTarget = targets[0]; game.fuShengShiCooldown = true; }
        else { game.fuShengShiCooldown = false; addMsg(player.id, '⛓️ 冷却中，本夜无法行动'); }
        break;
      case 'miao_nan': {
        const t = getPlayer(targets[0]);
        if (t && !t.infected) { t.infected = true; miaoNanInfections.push(t.id); }
        break;
      }
      case 'jian_biao_shi': {
        const t = getPlayer(targets[0]);
        const tRole = ROLES[t.roleId];
        let tags = [...tRole.tags];
        if (isJammed) tags = [pick(Object.values(TAGS)), pick(Object.values(TAGS))];
        addMsg(player.id, `🔍 你翻了 ${t.name} 的相册：「${tags[0]}」「${tags[1] || tags[0]}」`);
        break;
      }
      case 'xiao_hu_shi': {
        const t = getPlayer(targets[0]);
        let result = t.infected ? '阳性 🔴' : '阴性 🟢';
        if (isJammed) result = t.infected ? '阴性 🟢' : '阳性 🔴';
        addMsg(player.id, `💉 ${t.name} 的检测报告：${result}`);
        break;
      }
      case 'mu_la_la': {
        const t1 = getPlayer(targets[0]), t2 = getPlayer(targets[1] || targets[0]);
        let hasEvil = getSide(t1.roleId) === 'evil' || getSide(t2.roleId) === 'evil';
        if (isJammed) hasEvil = !hasEvil;
        addMsg(player.id, `👩‍❤️‍👩 ${t1.name} 和 ${t2.name} 中${hasEvil ? '至少有1人是恶方' : '都不是恶方'}`);
        break;
      }
      case 'hua_fang_gu_niang': {
        const t = getPlayer(targets[0]);
        const idx = alive.findIndex(a => a.id === t.id);
        const neighbors = [alive[(idx - 1 + alive.length) % alive.length], t, alive[(idx + 1) % alive.length]];
        let infected = neighbors.filter(n => n.infected).length;
        if (isJammed) infected = Math.min(3, 3 - infected);
        addMsg(player.id, `🌸 ${t.name} 周围3人中有 ${infected} 人感染`);
        break;
      }
      case 'hou_zi': {
        const t = getPlayer(targets[0]);
        const dated = game.datingChoices[t.id] && game.datingChoices[t.id] !== 'none';
        let msg = dated ? '今晚有约' : '今晚没约';
        if (isJammed) msg = dated ? '今晚没约' : '今晚有约';
        addMsg(player.id, `🐒 ${t.name} ${msg}`);
        break;
      }
      case 'xiao_san': {
        const t = getPlayer(targets[0]);
        // 配对结果要等后面算，先记下来
        xioaSanQuery = { playerId: player.id, targetId: t.id, jammed: isJammed };
        break;
      }
      // 被动角色（无夜间操作）: cai_zhuang_mu, gang_tie_zhi_nan, bao_zha_ling 等不进入这里
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

  // 小三查询（配对后结算）
  if (xioaSanQuery) {
    const paired = pairings.find(([a, b]) => a === xioaSanQuery.targetId || b === xioaSanQuery.targetId);
    let msg;
    if (paired) {
      const partner = paired[0] === xioaSanQuery.targetId ? paired[1] : paired[0];
      msg = `💔 ${getPlayerName(xioaSanQuery.targetId)} 今晚和 ${getPlayerName(partner)} 配对了`;
    } else {
      msg = `💔 ${getPlayerName(xioaSanQuery.targetId)} 今晚没有配对`;
    }
    if (xioaSanQuery.jammed) msg = `💔 ${getPlayerName(xioaSanQuery.targetId)} 的情况看不清（信息被干扰）`;
    addMsg(xioaSanQuery.playerId, msg);
  }

  // 死亡结算
  const deaths = [];
  if (hivKillTarget && hivKillTarget !== guardTarget && !hivBlocked) {
    deaths.push(hivKillTarget);
  }
  if (fuShengShiKillTarget && fuShengShiKillTarget !== guardTarget) {
    if (!deaths.includes(fuShengShiKillTarget)) deaths.push(fuShengShiKillTarget);
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

  // 白天讨论 2 秒
  log('   💬 白天讨论中 (2秒)...');
  await sleep(2000);

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
  // 检查是否已有缓存的早到事件
  if (game.earlyEvents.has(playerId)) {
    const val = game.earlyEvents.get(playerId);
    game.earlyEvents.delete(playerId);
    return Promise.resolve(val);
  }
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
  const key = 'vote_' + playerId;
  // 检查缓存
  if (game.earlyEvents.has(key)) {
    const val = game.earlyEvents.get(key);
    game.earlyEvents.delete(key);
    return Promise.resolve(val);
  }
  return new Promise((resolve) => {
    game.pendingActions.set(key, resolve);
    setTimeout(() => {
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
    mu_la_la: '每夜选2人，查验其中是否有恶方',
    hua_fang_gu_niang: '每夜选1人，查看其周围3人的感染数量',
    hou_zi: '每夜选1人，查看其是否发起约会',
    xiao_san: '每夜选1人，查看其与谁配对成功',
    zao_yao_jing: '每夜选1人，若其是信息角色则信息被篡改',
    miao_nan: '每夜选1人，使其感染（目标不知情）',
    hiv: '每夜选1人杀害，自身永久携带感染',
    fu_sheng_shi: '隔一夜可杀害1人（冷却机制）',
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
