// 夜店钟楼 - 薄客户端（纯UI + 广播通信）
// 房主快速开始时，由 HostEngine 在浏览器内驱动游戏

import { ROLES, FACTION_INFO } from './roles.js';
import { store, PHASE } from './game-state.js';
import { supabase } from './supabase-client.js';
import { HostEngine } from './host-engine.js';
import { clientLog, initLogger, LOG_BUFFER } from './logger.js';

let hostEngine = null;

// ============ DOM 工具 ============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function show(viewId) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const view = $(`#${viewId}`);
  if (view) view.classList.add('active');
}

function html(el, content) {
  if (typeof el === 'string') el = $(el);
  if (el) el.innerHTML = content;
}

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', () => {
  // 初始化日志系统
  initLogger(store);

  // 全局错误捕获
  window.addEventListener('error', (e) => {
    clientLog('error', 'js_error', e.message, { filename: e.filename, line: e.lineno, col: e.colno });
  });
  window.addEventListener('unhandledrejection', (e) => {
    clientLog('error', 'js_error', 'Unhandled rejection: ' + (e.reason?.message || e.reason));
  });

  clientLog('info', 'ui', 'App initialized');

  // URL hash 清除缓存
  if (location.hash === '#clear') {
    store.reset();
    location.hash = '';
  }

  // 尝试恢复状态（仅当游戏仍可继续时）
  if (store.restore()) {
    const phase = store.state.phase;
    const hasRoom = !!store.state.roomCode;
    const hasPlayers = store.state.players.length > 0;
    // 如果状态不完整或游戏已结束，重置回首页
    if (!hasRoom || !hasPlayers || phase === 'end') {
      console.log('旧状态无效，重置');
      store.reset();
      show('view-lobby');
    } else {
      console.log('游戏状态已恢复');
      renderCurrentPhase();
    }
  } else {
    show('view-lobby');
  }

  bindEvents();

  // 订阅状态变更
  store.subscribe(() => renderCurrentPhase());
});

// ============ 事件绑定 ============
function bindEvents() {
  // 创建房间
  $('#btn-create')?.addEventListener('click', async () => {
    const name = $('#input-name').value.trim();
    if (!name) return alert('请输入你的昵称');

    try {
      const { room, player, hostId, code } = await supabase.createRoom(name);
      store.update({
        roomCode: code,
        hostId: hostId,
        myPlayerId: hostId,
        phase: PHASE.LOBBY,
        players: [{
          id: hostId,
          name,
          roleId: null,
          alive: true,
          infected: false,
          ghostVoteUsed: false,
          connected: true,
          seatIndex: 0,
        }],
      });
      store.updateNested('_roomDbId', room.id);
      subscribeRoom(code);
      show('view-room');
      renderRoom();
    } catch (e) {
      clientLog('error', 'network', 'Create room failed', { error: e.message });
      console.error(e);
      alert('创建房间失败: ' + e.message);
    }
  });

  // 加入房间
  $('#btn-join')?.addEventListener('click', async () => {
    const name = $('#input-name').value.trim();
    const code = $('#input-code').value.trim().toUpperCase();
    if (!name) return alert('请输入你的昵称');
    if (!code) return alert('请输入房间码');

    try {
      const { room, player, playerId } = await supabase.joinRoom(code, name);
      store.update({
        roomCode: code,
        hostId: room.host_id,
        myPlayerId: playerId,
        phase: PHASE.LOBBY,
      });
      store.updateNested('_roomDbId', room.id);

      // 广播加入
      supabase.broadcastToRoom(code, 'player_joined', {
        id: playerId,
        name,
        seatIndex: player.seat_index,
      });

      subscribeRoom(code);
      show('view-room');
      renderRoom();
    } catch (e) {
      clientLog('error', 'network', 'Join room failed', { error: e.message });
      console.error(e);
      alert('加入失败: ' + e.message);
    }
  });

  // 开始游戏（房主） — 已满人时直接开始
  $('#btn-start')?.addEventListener('click', () => {
    if (!store.isHost()) return;
    const players = store.state.players;
    if (players.length < 5) return alert('至少需要5名玩家');
    if (players.length > 15) return alert('最多支持15名玩家');
    requestStart(players.length);
  });

  // 快速开始 — 房主浏览器内置引擎，直接补AI并开始
  $('#btn-quick-start')?.addEventListener('click', async () => {
    if (!store.isHost()) return;
    const currentCount = store.state.players.length;
    const targetCount = store.state._selectedTotal || Math.max(5, currentCount);
    if (targetCount < 5 || targetCount > 15) return alert('游戏人数需要5-15人');

    const quickBtn = $('#btn-quick-start');
    const startBtn = $('#btn-start');
    if (quickBtn) { quickBtn.textContent = '⏳ 正在补位...'; quickBtn.disabled = true; }
    if (startBtn) startBtn.disabled = true;

    hostEngine = new HostEngine();
    // 注册本地事件处理，让 host 端事件绕过 WS 回程直接渲染
    hostEngine.onLocalEvent((event, payload) => {
      handleRoomEvent(event, payload);
    });
    try {
      await hostEngine.start(targetCount, (msg) => console.log(msg));
    } catch (e) {
      clientLog('error', 'game_event', 'Host engine start failed', { error: e.message });
      console.error('游戏引擎错误:', e);
      alert('游戏启动失败: ' + e.message);
      if (quickBtn) { quickBtn.textContent = '⚡ 重试'; quickBtn.disabled = false; }
    }
  });

  // 新游戏
  $('#btn-new-game')?.addEventListener('click', () => {
    store.reset();
    show('view-lobby');
  });
}

// ============ 房间订阅 ============

/** 过滤定向消息：如果消息带 _targetPlayerId 且不是发给自己的，返回 true（应忽略） */
function shouldIgnore(data) {
  return data._targetPlayerId && data._targetPlayerId !== store.state.myPlayerId;
}

/** 统一事件处理（WS回调和本地引擎共用） */
function handleRoomEvent(event, data) {
  clientLog('info', 'game_event', event, data);
  switch (event) {
    case 'player_joined':
      if (!store.state.players.find(p => p.id === data.id)) {
        store.state.players.push({
          id: data.id, name: data.name, roleId: null,
          alive: true, infected: false, ghostVoteUsed: false,
          connected: true, seatIndex: data.seatIndex,
        });
        store._notify();
        store._persist();
      }
      break;
    case 'phase_change':
      store.update({ phase: data.phase });
      if (data.dayNumber !== undefined) store.updateNested('dayNumber', data.dayNumber);
      if (data.announcements) {
        store.updateNested('dayState.announcements', data.announcements);
        // 存储到事件时间线
        store.state.eventTimeline.push({ day: data.dayNumber || store.state.dayNumber, announcements: data.announcements });
        store._persist();
      }
      if (data.alivePlayers) {
        for (const ap of data.alivePlayers) {
          const p = store.getPlayer(ap.id);
          if (p) p.alive = ap.alive;
        }
        store._notify();
      }
      break;
    case 'role_assigned':
      if (shouldIgnore(data)) return;
      if (data.playerId === store.state.myPlayerId) {
        const me = store.getMyPlayer();
        if (me) me.roleId = data.roleId;
        store._notify();
      }
      break;
    case 'dating_prompt':
      if (shouldIgnore(data)) return;
      renderDatingPrompt(data);
      break;
    case 'night_action_prompt':
      if (shouldIgnore(data)) return;
      renderNightActionPrompt(data);
      break;
    case 'night_results':
      if (shouldIgnore(data)) return;
      // 存储夜间情报
      if (data.messages && data.messages.length > 0) {
        store.state.intelHistory.push({ day: store.state.dayNumber, messages: data.messages });
        store._persist();
      }
      renderNightResults(data.messages);
      break;
    case 'evil_reveal':
      if (shouldIgnore(data)) return;
      // 存储恶方队友
      if (data.teammates) {
        store.update({ evilTeammates: data.teammates.map(t => ({ id: t.id, name: t.name, role: t.role, emoji: t.emoji })) });
      }
      renderEvilReveal(data);
      break;
    case 'dating_result':
      if (shouldIgnore(data)) return;
      // 存储约会历史
      store.state.datingHistory.push({
        day: data.day,
        myChoice: data.myChoice,
        myChoiceName: data.myChoiceName,
        paired: data.paired,
        partnerName: data.partnerName,
        tagReceived: data.tagReceived,
      });
      store._persist();
      break;
    case 'vote_start':
      renderVotePanel(data);
      break;
    case 'vote_update':
      updateVoteDisplay(data);
      break;
    case 'execution':
      // 存储投票历史
      store.state.voteHistory.push({
        day: store.state.dayNumber,
        target: data.target.id,
        targetName: data.target.name,
        forCount: data.forCount,
        threshold: data.threshold,
        executed: true,
        side: data.side,
      });
      store._persist();
      renderExecution(data);
      break;
    case 'acquittal':
      // 存储投票历史
      store.state.voteHistory.push({
        day: store.state.dayNumber,
        target: data.target.id,
        targetName: data.target.name,
        forCount: data.forCount,
        threshold: data.threshold,
        executed: false,
        side: null,
      });
      store._persist();
      renderAcquittal(data);
      break;
    case 'game_over':
      store.update({ phase: PHASE.END });
      renderGameOver(data);
      break;
    case 'cu_kou_reveal':
      renderCuKouReveal(data);
      break;
    case 'zuo_jing_tantrum':
      renderZuoJingTantrum(data);
      break;
  }
}

function subscribeRoom(code) {
  supabase.connect();

  // WS 回调：如果 hostEngine 在运行，跳过渲染类事件（已由本地 handler 处理）
  // 但仍需转发玩家操作给 hostEngine（dating_choice, night_action, vote_cast）
  const wsHandler = (event, data) => {
    if (hostEngine?.running) {
      // 房主端：本地 handler 已处理渲染事件，WS 回程只负责转发玩家操作给引擎
      hostEngine.handleEvent(event, data);
      return;
    }
    // 非房主端：正常处理所有事件
    handleRoomEvent(event, data);
  };

  supabase.subscribeRoom(code, {
    'player_joined': (data) => handleRoomEvent('player_joined', data), // 始终处理（加人需要更新列表）
    '*': (event, payload) => {
      console.log(`[Room] ${event}:`, payload);
      wsHandler(event, payload);
    },
  });
}

// ============ 游戏启动由服务端驱动，客户端无需本地引擎 ============

function requestStart(targetTotal) {
  supabase.broadcastToRoom(store.state.roomCode, 'request_start', {
    hostId: store.state.hostId,
    targetTotal,
    currentPlayers: store.state.players.map(p => ({ id: p.id, name: p.name })),
  });
  const startBtn = $('#btn-start');
  const quickBtn = $('#btn-quick-start');
  if (startBtn) { startBtn.textContent = '⏳ 等待服务器...'; startBtn.disabled = true; }
  if (quickBtn) { quickBtn.textContent = '⏳ 正在补位...'; quickBtn.disabled = true; }
}

// ============ 视图渲染 ============

function renderCurrentPhase() {
  updateStatusBar();
  updateFloatingButtons();
  switch (store.state.phase) {
    case PHASE.LOBBY: show('view-lobby'); break;
    case PHASE.ROLE_REVEAL: show('view-reveal'); renderRoleReveal(); break;
    case PHASE.DATING:
    case PHASE.NIGHT_ACTION:
    case PHASE.NIGHT:
      show('view-night');
      // 如果 night-content 为空（还没收到具体提示），显示等待
      if (!$('#night-content')?.innerHTML?.trim()) {
        html('#night-content', `
          <div class="waiting">
            <div class="spinner"></div>
            <div class="waiting-text">🌙 第 ${store.state.dayNumber || 1} 夜 · 准备中...</div>
          </div>
        `);
      }
      break;
    case PHASE.DAY: show('view-day'); renderDay(); break;
    case PHASE.VOTE:
      show('view-vote');
      if (!$('#vote-content')?.innerHTML?.trim()) {
        html('#vote-content', `
          <div class="waiting">
            <div class="spinner"></div>
            <div class="waiting-text">等待投票...</div>
          </div>
        `);
      }
      break;
    case PHASE.END: show('view-end'); break;
  }
}

function renderRoom() {
  html('#room-code-display', store.state.roomCode || '');
  renderPlayerList();
}

function renderPlayerList() {
  const players = store.state.players;
  html('#player-list', players.map((p, i) => `
    <li class="player-item">
      <div class="avatar">${i + 1}</div>
      <span class="name">${p.name}</span>
      <span class="status">${p.id === store.state.hostId ? '👑 房主' : '✅ 已加入'}</span>
    </li>
  `).join(''));

  const controls = $('#start-controls');
  if (controls) controls.style.display = store.isHost() ? 'block' : 'none';

  const startBtn = $('#btn-start');
  if (startBtn) {
    startBtn.disabled = players.length < 5;
    startBtn.textContent = `🎲 开始游戏 (${players.length}人)`;
  }

  // 人数选择器
  const optionsEl = $('#player-count-options');
  if (optionsEl && store.isHost()) {
    const current = players.length;
    const selected = store.state._selectedTotal || Math.max(5, current);
    optionsEl.innerHTML = [5,6,7,8,9,10,12,15].map(n => `
      <button class="btn ${n === selected ? 'btn-primary' : 'btn-ghost'}"
              style="min-width:44px;padding:6px 10px;font-size:0.9rem"
              onclick="window._selectTotal(${n})" ${n < current ? 'disabled' : ''}>
        ${n}人
      </button>
    `).join('');

    const botsNeeded = Math.max(0, selected - current);
    const quickBtn = $('#btn-quick-start');
    if (quickBtn) {
      if (botsNeeded > 0) {
        quickBtn.textContent = `⚡ 快速开始（补 ${botsNeeded} 个AI）`;
        quickBtn.style.display = 'flex';
      } else {
        quickBtn.style.display = 'none';
      }
    }
  }
}

window._selectTotal = (n) => {
  store.state._selectedTotal = n;
  renderPlayerList();
};

function renderRoleReveal() {
  const role = store.getMyRole();
  if (!role) {
    // 角色数据还没到，先显示等待（WS 回程竞态防御）
    html('#reveal-content', `
      <div class="waiting">
        <div class="spinner"></div>
        <div class="waiting-text">正在揭示角色...</div>
      </div>
    `);
    return;
  }
  const faction = FACTION_INFO[role.faction];

  html('#reveal-content', `
    <div class="role-card faction-${role.faction}">
      <div class="role-emoji">${role.emoji}</div>
      <div class="role-name">${role.name}</div>
      <div class="role-faction" style="color:${faction.color}">
        ${faction.emoji} ${faction.name} · ${faction.side === 'good' ? '好人阵营' : '恶方阵营'}
      </div>
      <div class="role-tags">
        ${role.tags.map(t => `<span class="tag">${t}</span>`).join('')}
      </div>
      <div class="role-skill">${role.skill}</div>
      <p class="text-dim mt-16" style="font-style:italic">"${role.flavorText}"</p>
    </div>
    <button class="btn btn-primary btn-block mt-16" onclick="window._confirmRole()">
      ✅ 我记住了
    </button>
  `);
}

window._confirmRole = () => {
  html('#reveal-content', `
    <div class="waiting">
      <div class="spinner"></div>
      <div class="waiting-text">等待其他玩家确认角色...</div>
    </div>
  `);
  // TODO: 广播确认，全员确认后房主触发首夜
};

function renderDatingPrompt(data) {
  if (data.playerId && data.playerId !== store.state.myPlayerId) return;
  show('view-night');

  html('#night-content', `
    <div class="night-header">
      <h2>🌙 第 ${store.state.dayNumber} 夜</h2>
    </div>
    <div class="dating-panel">
      <h3>💘 选择今晚的约会对象</h3>
      <p class="text-dim">约会成功可获取对方标签，但有感染风险</p>
      <div class="target-grid mt-16">
        ${data.alivePlayers.map(p => `
          <button class="target-btn" data-id="${p.id}" onclick="window._selectDate('${p.id}')">
            ${p.name}
          </button>
        `).join('')}
      </div>
      <button class="btn btn-ghost btn-block mt-16" onclick="window._selectDate('none')">
        🏠 今晚不约
      </button>
    </div>
  `);
}

window._selectDate = (targetId) => {
  $$('.target-btn').forEach(b => b.classList.remove('selected'));
  if (targetId !== 'none') {
    $(`.target-btn[data-id="${targetId}"]`)?.classList.add('selected');
  }

  html('#night-content', `
    <div class="waiting">
      <div class="spinner"></div>
      <div class="waiting-text">已提交，等待其他玩家...</div>
    </div>
  `);

  // 提交约会选择到服务端
  supabase.broadcastToRoom(store.state.roomCode, 'dating_choice', {
    playerId: store.state.myPlayerId,
    targetId,
  });
};

function renderNightActionPrompt(data) {
  if (data.playerId && data.playerId !== store.state.myPlayerId) return;
  show('view-night');

  const isOptional = data.type === 'select_one_optional';

  html('#night-content', `
    <div class="night-header">
      <h2>🌙 第 ${store.state.dayNumber} 夜</h2>
    </div>
    <div class="night-action-panel">
      <div class="text-center">
        <span style="font-size:2rem">${data.roleEmoji}</span>
        <h3>${data.roleName}</h3>
        <p class="text-dim mt-8">${data.message}</p>
      </div>
      <div class="target-grid mt-16">
        ${data.targets.map(p => `
          <button class="target-btn" data-id="${p.id}" onclick="window._selectTarget('${p.id}', ${data.type === 'select_two'})">
            ${p.name}
          </button>
        `).join('')}
      </div>
      ${isOptional ? `
        <button class="btn btn-ghost btn-block mt-8" onclick="window._submitAction(['skip'])">
          跳过，今晚不出手
        </button>
      ` : ''}
      <button class="btn btn-primary btn-block mt-8" id="btn-confirm-action" disabled onclick="window._confirmAction()">
        确认
      </button>
    </div>
  `);

  window._selectedTargets = [];
  window._maxTargets = data.type === 'select_two' ? 2 : 1;
}

window._selectTarget = (targetId, isMulti) => {
  const max = window._maxTargets || 1;
  const btn = $(`.target-btn[data-id="${targetId}"]`);

  if (btn.classList.contains('selected')) {
    btn.classList.remove('selected');
    window._selectedTargets = window._selectedTargets.filter(id => id !== targetId);
  } else {
    if (window._selectedTargets.length >= max) {
      // 替换最后一个
      const lastId = window._selectedTargets.pop();
      $(`.target-btn[data-id="${lastId}"]`)?.classList.remove('selected');
    }
    window._selectedTargets.push(targetId);
    btn.classList.add('selected');
  }

  const confirmBtn = $('#btn-confirm-action');
  if (confirmBtn) confirmBtn.disabled = window._selectedTargets.length < (window._maxTargets || 1);
};

window._confirmAction = () => {
  window._submitAction(window._selectedTargets);
};

window._submitAction = (targets) => {
  html('#night-content', `
    <div class="waiting">
      <div class="spinner"></div>
      <div class="waiting-text">行动已提交，等待其他角色...</div>
    </div>
  `);

  // 提交夜间行动到服务端
  supabase.broadcastToRoom(store.state.roomCode, 'night_action', {
    playerId: store.state.myPlayerId,
    targets,
  });
};

function renderNightResults(messages) {
  if (!messages || messages.length === 0) return;

  html('#night-content', `
    <div class="night-header">
      <h2>🌙 夜晚情报</h2>
    </div>
    <div class="flex-col gap-12" style="padding:16px">
      ${messages.map(m => `
        <div class="info-message ${m.type === 'danger' ? 'danger' : ''}">
          ${m.text}
        </div>
      `).join('')}
      <button class="btn btn-secondary btn-block mt-16" onclick="window._dismissNightResults()">
        知道了
      </button>
    </div>
  `);
}

window._dismissNightResults = () => {
  html('#night-content', `
    <div class="waiting">
      <div class="spinner"></div>
      <div class="waiting-text">等待天亮...</div>
    </div>
  `);
};

function renderEvilReveal(data) {
  if (data.playerId && data.playerId !== store.state.myPlayerId) return;

  html('#night-content', `
    <div class="night-header">
      <h2>🌙 恶方互认</h2>
    </div>
    <div class="flex-col gap-12" style="padding:16px;text-align:center">
      <p>你的队友：</p>
      ${data.teammates.map(t => `
        <div class="card card-glow-pink">
          <span style="font-size:1.5rem">${t.emoji}</span> ${t.name} — ${t.role}
        </div>
      `).join('')}
      <div class="timer mt-16" id="evil-timer">30</div>
      <p class="text-dim">记住你的队友！</p>
    </div>
  `);

  // 30秒倒计时
  let sec = 30;
  const timer = setInterval(() => {
    sec--;
    const el = $('#evil-timer');
    if (el) el.textContent = sec;
    if (sec <= 5 && el) el.classList.add('urgent');
    if (sec <= 0) clearInterval(timer);
  }, 1000);
}

function renderDay() {
  const announcements = store.state.dayState?.announcements || [];
  const alive = store.getAlivePlayers();
  const myRole = store.getMyRole();

  html('#day-content', `
    <div class="text-center">
      <h2>☀️ 第 ${store.state.dayNumber} 天</h2>
    </div>

    ${announcements.map(a => `
      <div class="info-message ${a.type === 'death' ? 'danger' : 'warning'}">
        ${a.text}
      </div>
    `).join('')}

    <div class="seat-circle">
      ${alive.map((p, i) => {
        const angle = (i / alive.length) * 2 * Math.PI - Math.PI / 2;
        const x = 150 + 120 * Math.cos(angle);
        const y = 150 + 120 * Math.sin(angle);
        return `
          <div class="seat ${p.alive ? '' : 'dead'}"
               style="left:${x}px;top:${y}px"
               data-id="${p.id}"
               onclick="window._nominateTarget('${p.id}')">
            ${p.name}
          </div>
        `;
      }).join('')}
    </div>

    <div class="flex-col gap-8">
      ${myRole?.id === 'cu_kou' && !store.state.dayState?.cuKouUsed ? `
        <button class="btn btn-danger btn-block" onclick="window._useCuKou()">
          🤬 开撕（强制暴露1人标签）
        </button>
      ` : ''}
      ${myRole?.id === 'zuo_jing' && !store.state.dayState?.zuoJingUsed ? `
        <button class="btn btn-danger btn-block" onclick="window._useZuoJing()">
          😭 闹分手（取消今天投票）
        </button>
      ` : ''}
      <button class="btn btn-secondary btn-block" onclick="window._goToNight()">
        🌙 结束讨论，进入夜晚
      </button>
    </div>
  `);
}

window._nominateTarget = (targetId) => {
  supabase.broadcastToRoom(store.state.roomCode, 'nominate', {
    playerId: store.state.myPlayerId,
    targetId,
  });
};

window._useCuKou = () => {
  // 选择目标
  const alive = store.getAlivePlayers().filter(p => p.id !== store.state.myPlayerId);
  html('#day-content', `
    <h3 class="text-center">🤬 选择开撕对象</h3>
    <div class="target-grid mt-16">
      ${alive.map(p => `
        <button class="target-btn" onclick="window._confirmCuKou('${p.id}')">
          ${p.name}
        </button>
      `).join('')}
    </div>
    <button class="btn btn-ghost btn-block mt-16" onclick="renderDay()">取消</button>
  `);
};

window._confirmCuKou = (targetId) => {
  supabase.broadcastToRoom(store.state.roomCode, 'use_cu_kou', {
    playerId: store.state.myPlayerId,
    targetId,
  });
};

window._useZuoJing = () => {
  supabase.broadcastToRoom(store.state.roomCode, 'use_zuo_jing', {
    playerId: store.state.myPlayerId,
  });
};

window._goToNight = () => {
  if (store.isHost()) {
    supabase.broadcastToRoom(store.state.roomCode, 'request_next_night', {
      hostId: store.state.myPlayerId,
    });
  }
};

function renderVotePanel(data) {
  show('view-vote');
  html('#vote-content', `
    <div class="vote-panel">
      <h2>⚖️ 投票处决</h2>
      <p class="mt-8">被提名: <strong class="text-pink">${data.target.name}</strong></p>
      <div class="vote-count mt-16" id="vote-for">0</div>
      <div class="vote-threshold">需要 ≥${data.threshold} 票处决</div>
      <div class="vote-buttons mt-16">
        <button class="btn btn-danger" onclick="window._castVote(true)">
          ☠️ 处决
        </button>
        <button class="btn btn-secondary" onclick="window._castVote(false)">
          ✋ 反对
        </button>
      </div>
    </div>
  `);
}

window._castVote = (inFavor) => {
  supabase.broadcastToRoom(store.state.roomCode, 'vote_cast', {
    playerId: store.state.myPlayerId,
    inFavor,
  });
  html('#vote-content', `
    <div class="waiting">
      <div class="spinner"></div>
      <div class="waiting-text">等待其他人投票...</div>
    </div>
  `);
};

function updateVoteDisplay(data) {
  const el = $('#vote-for');
  if (el) el.textContent = data.totalFor;
}

function renderExecution(data) {
  html('#vote-content', `
    <div class="text-center">
      <h2 class="text-pink">☠️ 处决成功</h2>
      <p class="mt-8"><strong>${data.target.name}</strong> 被处决了</p>
      <p class="mt-4">阵营: <span class="badge ${data.side === 'evil' ? 'badge-evil' : 'badge-good'}">
        ${data.side === 'evil' ? '恶方' : '好人'}
      </span></p>
      <p class="text-dim mt-8">${data.forCount} 票赞成 / 需要 ${data.threshold} 票</p>
    </div>
  `);
}

function renderAcquittal(data) {
  html('#vote-content', `
    <div class="text-center">
      <h2 class="text-cyan">✋ 无罪释放</h2>
      <p class="mt-8"><strong>${data.target.name}</strong> 逃过一劫</p>
      <p class="text-dim mt-8">${data.forCount} 票赞成 / 需要 ${data.threshold} 票</p>
    </div>
  `);
}

function renderGameOver(data) {
  show('view-end');
  const isGoodWin = data.winner === 'good';

  // 优先用 data.players（引擎传入完整角色信息），fallback 到 store
  const players = data.players || store.state.players;

  html('#end-content', `
    <div class="game-over ${isGoodWin ? 'good-wins' : 'evil-wins'}">
      <h1>${isGoodWin ? '💧 清流派胜利!' : '👑 渣王称霸!'}</h1>
      <p class="win-reason">${data.reason}</p>

      <h3 class="mt-24">角色揭晓</h3>
      <div class="flex-col gap-8 mt-16">
        ${players.map(p => {
          const role = ROLES[p.roleId];
          if (!role) return '';
          const faction = FACTION_INFO[role.faction];
          return `
            <div class="player-item ${p.alive ? '' : 'dead'}">
              <div class="avatar" style="background:${faction.color}">${role.emoji}</div>
              <span class="name">${p.name}</span>
              <span class="status" style="color:${faction.color}">${role.name}</span>
            </div>
          `;
        }).join('')}
      </div>

      <button class="btn btn-primary btn-block mt-24" id="btn-new-game">
        🎲 再来一局
      </button>
    </div>
  `);
}

function renderCuKouReveal(data) {
  // 弹出惩罚样式的通知
  const overlay = document.createElement('div');
  overlay.className = 'punishment-overlay';
  overlay.innerHTML = `
    <div class="punishment-card">
      <div class="emoji">🤬</div>
      <h3>开撕!</h3>
      <p>${data.flavorText}</p>
      <button class="btn btn-secondary mt-16" onclick="this.closest('.punishment-overlay').remove()">
        知道了
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
}

function renderZuoJingTantrum(data) {
  const overlay = document.createElement('div');
  overlay.className = 'punishment-overlay';
  overlay.innerHTML = `
    <div class="punishment-card">
      <div class="emoji">😭</div>
      <h3>闹分手!</h3>
      <p>${data.flavorText}</p>
      <button class="btn btn-secondary mt-16" onclick="this.closest('.punishment-overlay').remove()">
        行吧...
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
}

// ============ 轮次指示器 ============

function updateStatusBar() {
  const bar = $('#game-status-bar');
  if (!bar) return;
  const { phase, dayNumber } = store.state;
  if (phase === PHASE.LOBBY || phase === PHASE.END) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  const roundEl = $('#status-round');
  const phaseEl = $('#status-phase');
  if (roundEl) roundEl.textContent = `第 ${dayNumber || 1} 轮`;
  const phaseMap = {
    [PHASE.ROLE_REVEAL]: '角色揭示',
    [PHASE.NIGHT]: '夜晚',
    [PHASE.DATING]: '约会阶段',
    [PHASE.NIGHT_ACTION]: '夜间行动',
    [PHASE.DAY]: '白天讨论',
    [PHASE.VOTE]: '投票处决',
  };
  if (phaseEl) phaseEl.textContent = phaseMap[phase] || phase;
}

// ============ 浮动按钮显示控制 ============

function updateFloatingButtons() {
  const journalBtn = $('#btn-journal');
  const roleBtn = $('#btn-role-card');
  if (!journalBtn || !roleBtn) return;
  const phase = store.state.phase;
  const inGame = phase !== PHASE.LOBBY && phase !== PHASE.END && store.state.players.length > 0;
  journalBtn.style.display = inGame ? 'flex' : 'none';
  roleBtn.style.display = inGame ? 'flex' : 'none';
}

// ============ 情报本 ============

let journalCurrentTab = 'intel';

function openJournal() {
  const panel = $('#journal-panel');
  if (panel) {
    panel.style.display = 'flex';
    renderJournal();
  }
}

function closeJournal() {
  const panel = $('#journal-panel');
  if (panel) panel.style.display = 'none';
}

function renderJournal() {
  const tabs = ['intel', 'vote', 'dating', 'event'];
  const tabNames = { intel: '情报', vote: '投票', dating: '约会', event: '事件' };

  const tabsHtml = tabs.map(t =>
    `<button class="journal-tab ${t === journalCurrentTab ? 'active' : ''}" onclick="window._switchJournalTab('${t}')">${tabNames[t]}</button>`
  ).join('');

  let contentHtml = '';
  switch (journalCurrentTab) {
    case 'intel':
      contentHtml = renderJournalIntel();
      break;
    case 'vote':
      contentHtml = renderJournalVote();
      break;
    case 'dating':
      contentHtml = renderJournalDating();
      break;
    case 'event':
      contentHtml = renderJournalEvent();
      break;
  }

  html('#journal-content', `
    <div class="journal-tabs">${tabsHtml}</div>
    <div class="journal-body">${contentHtml}</div>
  `);
}

function renderJournalIntel() {
  const history = store.state.intelHistory;
  if (history.length === 0) return '<p class="text-dim text-center mt-16">暂无情报</p>';
  return history.map(entry => `
    <div class="journal-group">
      <div class="journal-day-label">第 ${entry.day} 夜</div>
      ${entry.messages.map(m => `<div class="journal-item ${m.type === 'danger' ? 'danger' : ''}">${m.text}</div>`).join('')}
    </div>
  `).join('');
}

function renderJournalVote() {
  const history = store.state.voteHistory;
  if (history.length === 0) return '<p class="text-dim text-center mt-16">暂无投票记录</p>';
  return history.map(entry => `
    <div class="journal-group">
      <div class="journal-day-label">第 ${entry.day} 天</div>
      <div class="journal-item">
        <strong>${entry.targetName}</strong>
        ${entry.executed
          ? `<span class="badge badge-evil">处决</span> (${entry.side === 'evil' ? '恶方' : '好人'})`
          : `<span class="badge badge-good">释放</span>`}
        <span class="text-dim"> · ${entry.forCount}/${entry.threshold} 票</span>
      </div>
    </div>
  `).join('');
}

function renderJournalDating() {
  const history = store.state.datingHistory;
  if (history.length === 0) return '<p class="text-dim text-center mt-16">暂无约会记录</p>';
  return history.map(entry => `
    <div class="journal-group">
      <div class="journal-day-label">第 ${entry.day} 夜</div>
      <div class="journal-item">
        ${entry.myChoice === 'none'
          ? '今晚没约'
          : `邀请了 <strong>${entry.myChoiceName || entry.myChoice}</strong>`}
        ${entry.paired
          ? ` · 配对成功 (${entry.partnerName})${entry.tagReceived ? ` · 标签「${entry.tagReceived}」` : ''}`
          : entry.myChoice !== 'none' ? ' · 未配对' : ''}
      </div>
    </div>
  `).join('');
}

function renderJournalEvent() {
  const history = store.state.eventTimeline;
  if (history.length === 0) return '<p class="text-dim text-center mt-16">暂无事件</p>';
  return history.map(entry => `
    <div class="journal-group">
      <div class="journal-day-label">第 ${entry.day} 天</div>
      ${entry.announcements.map(a => `<div class="journal-item ${a.type === 'death' ? 'danger' : a.type === 'warning' ? 'warning' : ''}">${a.text}</div>`).join('')}
    </div>
  `).join('');
}

window._switchJournalTab = (tab) => {
  journalCurrentTab = tab;
  renderJournal();
};

window._openJournal = () => openJournal();
window._closeJournal = () => closeJournal();

// ============ 角色卡弹窗 ============

function openRoleCard() {
  const panel = $('#role-card-panel');
  if (!panel) return;
  const role = store.getMyRole();
  if (!role) return;
  const faction = FACTION_INFO[role.faction];
  const evilTeammates = store.state.evilTeammates;

  let teammatesHtml = '';
  if (evilTeammates.length > 0) {
    teammatesHtml = `
      <div class="mt-16" style="border-top:1px solid var(--border-subtle);padding-top:12px">
        <p class="text-dim" style="font-size:0.85rem;margin-bottom:8px">恶方队友</p>
        ${evilTeammates.map(t => `
          <div class="journal-item" style="display:flex;align-items:center;gap:8px">
            <span style="font-size:1.2rem">${t.emoji}</span> ${t.name} — ${t.role}
          </div>
        `).join('')}
      </div>
    `;
  }

  html('#role-card-content', `
    <div class="role-card faction-${role.faction}">
      <div class="role-emoji">${role.emoji}</div>
      <div class="role-name">${role.name}</div>
      <div class="role-faction" style="color:${faction.color}">
        ${faction.emoji} ${faction.name} · ${faction.side === 'good' ? '好人阵营' : '恶方阵营'}
      </div>
      <div class="role-tags">
        ${role.tags.map(t => `<span class="tag">${t}</span>`).join('')}
      </div>
      <div class="role-skill">${role.skill}</div>
      ${teammatesHtml}
    </div>
  `);
  panel.style.display = 'flex';
}

function closeRoleCard() {
  const panel = $('#role-card-panel');
  if (panel) panel.style.display = 'none';
}

window._openRoleCard = () => openRoleCard();
window._closeRoleCard = () => closeRoleCard();

// ============ Debug 面板 ============

let _debugTapCount = 0;
let _debugTapTimer = null;

// 连按标题 5 次打开 debug
document.addEventListener('click', (e) => {
  if (e.target.closest('h1') || e.target.closest('.header h2')) {
    _debugTapCount++;
    clearTimeout(_debugTapTimer);
    _debugTapTimer = setTimeout(() => { _debugTapCount = 0; }, 2000);
    if (_debugTapCount >= 5) {
      _debugTapCount = 0;
      window._openDebug();
    }
  }
});

// #debug hash 打开
if (location.hash === '#debug') {
  setTimeout(() => window._openDebug(), 500);
}
window.addEventListener('hashchange', () => {
  if (location.hash === '#debug') window._openDebug();
});

const LEVEL_COLORS = { error: '#f44', warn: '#fa0', info: '#0f0', event: '#0af' };

function renderDebugLogs() {
  const panel = $('#debug-log-list');
  const countEl = $('#debug-count');
  const filterEl = $('#debug-filter');
  if (!panel) return;

  const filter = filterEl?.value || 'all';
  const logs = filter === 'all' ? LOG_BUFFER : LOG_BUFFER.filter(l => l.level === filter);

  countEl.textContent = logs.length;
  panel.innerHTML = logs.slice().reverse().map(l => {
    const color = LEVEL_COLORS[l.level] || '#0f0';
    const time = l.time.split('T')[1]?.split('.')[0] || l.time;
    const details = Object.keys(l.details).length > 0 ? ` ${JSON.stringify(l.details).substring(0, 120)}` : '';
    return `<div style="color:${color};margin-bottom:2px;word-break:break-all"><span style="color:#888">${time}</span> [${l.level}] ${l.category}: ${l.message}${details}</div>`;
  }).join('');
}

window._openDebug = () => {
  const panel = $('#debug-panel');
  if (panel) {
    panel.style.display = 'flex';
    renderDebugLogs();
  }
};

window._closeDebug = () => {
  const panel = $('#debug-panel');
  if (panel) panel.style.display = 'none';
};

window._copyDebugLogs = () => {
  const text = LOG_BUFFER.map(l => `${l.time} [${l.level}] ${l.category}: ${l.message} ${JSON.stringify(l.details)}`).join('\n');
  navigator.clipboard?.writeText(text).then(() => alert('Copied!')).catch(() => {});
};

window._clearDebugLogs = () => {
  LOG_BUFFER.length = 0;
  renderDebugLogs();
};

// 过滤器联动
document.addEventListener('change', (e) => {
  if (e.target.id === 'debug-filter') renderDebugLogs();
});
