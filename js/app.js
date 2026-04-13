// 夜店钟楼 - 薄客户端（纯UI + 广播通信）
// 房主快速开始时，由 HostEngine 在浏览器内驱动游戏

import { ROLES, FACTION_INFO } from './roles.js';
import { store, PHASE } from './game-state.js';
import { supabase } from './supabase-client.js';
import { HostEngine } from './host-engine.js';

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
  // 尝试恢复状态
  if (store.restore()) {
    console.log('游戏状态已恢复');
    renderCurrentPhase();
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
    try {
      await hostEngine.start(targetCount, (msg) => console.log(msg));
    } catch (e) {
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

function subscribeRoom(code) {
  supabase.connect();
  supabase.subscribeRoom(code, {
    'player_joined': (data) => {
      if (!store.state.players.find(p => p.id === data.id)) {
        store.state.players.push({
          id: data.id,
          name: data.name,
          roleId: null,
          alive: true,
          infected: false,
          ghostVoteUsed: false,
          connected: true,
          seatIndex: data.seatIndex,
        });
        store._notify();
        store._persist();
      }
    },

    'phase_change': (data) => {
      store.update({ phase: data.phase });
      if (data.dayNumber !== undefined) store.updateNested('dayNumber', data.dayNumber);
      if (data.announcements) store.updateNested('dayState.announcements', data.announcements);
      if (data.alivePlayers) {
        // 同步存活状态
        for (const ap of data.alivePlayers) {
          const p = store.getPlayer(ap.id);
          if (p) p.alive = ap.alive;
        }
        store._notify();
      }
    },

    'role_assigned': (data) => {
      if (shouldIgnore(data)) return;
      if (data.playerId === store.state.myPlayerId) {
        const me = store.getMyPlayer();
        if (me) me.roleId = data.roleId;
        store._notify();
      }
    },

    'dating_prompt': (data) => {
      if (shouldIgnore(data)) return;
      renderDatingPrompt(data);
    },

    'night_action_prompt': (data) => {
      if (shouldIgnore(data)) return;
      renderNightActionPrompt(data);
    },

    'night_results': (data) => {
      if (shouldIgnore(data)) return;
      renderNightResults(data.messages);
    },

    'evil_reveal': (data) => {
      if (shouldIgnore(data)) return;
      renderEvilReveal(data);
    },

    'vote_start': (data) => {
      renderVotePanel(data);
    },

    'vote_update': (data) => {
      updateVoteDisplay(data);
    },

    'execution': (data) => {
      renderExecution(data);
    },

    'acquittal': (data) => {
      renderAcquittal(data);
    },

    'game_over': (data) => {
      store.update({ phase: PHASE.END });
      renderGameOver(data);
    },

    'cu_kou_reveal': (data) => {
      renderCuKouReveal(data);
    },

    'zuo_jing_tantrum': (data) => {
      renderZuoJingTantrum(data);
    },

    '*': (event, payload) => {
      console.log(`[Room] ${event}:`, payload);
      // 转发给房主引擎（如果在运行）
      if (hostEngine?.running) hostEngine.handleEvent(event, payload);
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

  html('#end-content', `
    <div class="game-over ${isGoodWin ? 'good-wins' : 'evil-wins'}">
      <h1>${isGoodWin ? '💧 清流派胜利!' : '👑 渣王称霸!'}</h1>
      <p class="win-reason">${data.reason}</p>

      <h3 class="mt-24">角色揭晓</h3>
      <div class="flex-col gap-8 mt-16">
        ${store.state.players.map(p => {
          const role = ROLES[p.roleId];
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
