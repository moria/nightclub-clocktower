// 夜店钟楼 - 房主端游戏引擎
// 当房主点"快速开始"时，由房主浏览器驱动整局游戏
// 通过 Supabase Realtime 广播事件给所有玩家

import { ROLES, FACTION, FACTION_INFO, PLAYER_CONFIG, ROLE_POOL, INFO_ROLES, TAGS, assignRoles, getSide } from './roles.js';
import { store, PHASE } from './game-state.js';
import { supabase } from './supabase-client.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const BOT_NAMES = ['🤖张飞','🤖貂蝉','🤖吕布','🤖孙尚香','🤖曹操','🤖小乔','🤖赵云','🤖黄月英','🤖诸葛亮','🤖甄姬','🤖关羽','🤖大乔','🤖周瑜','🤖马超'];

const SKILLS = {
  jian_biao_shi: '每夜选1人，查看其行为标签',
  xiao_hu_shi: '每夜选1人，查看其是否感染',
  ji_rou_meng: '每夜选1人守护，免疫杀害和感染',
  mu_la_la: '每夜选2人，查验其中是否有恶方',
  hua_fang_gu_niang: '每夜选1人，查看其周围3人的感染数量',
  hou_zi: '每夜选1人，查看其是否发起约会',
  xiao_san: '每夜选1人，查看其与谁配对成功',
  zao_yao_jing: '每夜选1人，若其是信息角色则信息被篡改',
  miao_nan: '每夜选1人，使其感染',
  hiv: '每夜选1人杀害',
  fu_sheng_shi: '隔一夜可杀害1人',
};

export class HostEngine {
  constructor() {
    this.players = [];     // { id, name, roleId, alive, infected, isBot, seatIndex }
    this.dayNumber = 0;
    this.lastGuardTarget = null;
    this.fuShengShiCooldown = false;
    this.datingChoices = {};
    this.pendingActions = new Map();
    this.earlyEvents = new Map();
    this.running = false;
    this._onLog = null;
  }

  log(msg) {
    console.log(`[Engine] ${msg}`);
    if (this._onLog) this._onLog(msg);
  }

  broadcast(event, payload) {
    supabase.broadcastToRoom(store.state.roomCode, event, payload);
  }

  sendToPlayer(playerId, event, payload) {
    this.broadcast(event, { ...payload, _targetPlayerId: playerId });
  }

  getPlayer(id) { return this.players.find(p => p.id === id); }
  getPlayerName(id) { return this.getPlayer(id)?.name || id; }

  // ============ 启动游戏 ============

  async start(targetTotal, onLog) {
    if (this.running) return;
    this.running = true;
    this._onLog = onLog;

    // 复制现有玩家
    this.players = store.state.players.map(p => ({
      id: p.id, name: p.name, roleId: null,
      alive: true, infected: false, isBot: false, seatIndex: p.seatIndex,
    }));

    // 补 bot
    const botsNeeded = targetTotal - this.players.length;
    if (botsNeeded > 0) {
      this.log(`补 ${botsNeeded} 个AI机器人`);
      for (let i = 0; i < botsNeeded; i++) {
        const name = BOT_NAMES[i] || `🤖机器人${i + 1}`;
        const botId = `bot-${i}-${Date.now().toString(36)}`;
        const seatIndex = this.players.length;
        this.players.push({ id: botId, name, roleId: null, alive: true, infected: false, isBot: true, seatIndex });
        // 写入数据库
        try {
          await supabase._fetch('players', {
            method: 'POST',
            body: JSON.stringify({
              room_id: store.state._roomDbId, player_id: botId, name,
              seat_index: seatIndex, alive: true, infected: false,
              ghost_vote_used: false, connected: true,
            }),
          });
        } catch (e) { /* ignore */ }
        this.broadcast('player_joined', { id: botId, name, seatIndex });
        // 同步到 store
        store.state.players.push({ id: botId, name, roleId: null, alive: true, infected: false, ghostVoteUsed: false, connected: true, seatIndex });
      }
      store._notify();
      await sleep(500);
    }

    // 监听真人玩家的广播事件
    this._setupListeners();

    // 分配角色
    this.log(`分配角色 (${this.players.length}人局)`);
    const roles = assignRoles(this.players.length);
    this.players.forEach((p, i) => {
      p.roleId = roles[i];
      p.infected = ROLES[roles[i]]?.isInfected || false;
    });

    // 通知每个玩家角色
    for (const p of this.players) {
      const role = ROLES[p.roleId];
      const side = getSide(p.roleId);
      this.log(`  ${p.name} → ${role.emoji} ${role.name}`);
      this.sendToPlayer(p.id, 'role_assigned', {
        playerId: p.id, roleId: p.roleId,
        roleName: role.name, roleEmoji: role.emoji,
        faction: role.faction, factionName: FACTION_INFO[role.faction].name,
        side, sideName: side === 'good' ? '好人阵营' : '恶方阵营',
        tags: role.tags, skill: SKILLS[p.roleId] || '',
      });
    }

    this.broadcast('phase_change', { phase: PHASE.ROLE_REVEAL });
    store.update({ phase: PHASE.ROLE_REVEAL });
    await sleep(5000);

    // 恶方互认
    const evilPlayers = this.players.filter(p => getSide(p.roleId) === 'evil');
    if (evilPlayers.length > 1) {
      for (const ep of evilPlayers) {
        this.sendToPlayer(ep.id, 'evil_reveal', {
          playerId: ep.id,
          teammates: evilPlayers.filter(e => e.id !== ep.id).map(e => ({
            id: e.id, name: e.name, role: ROLES[e.roleId].name, emoji: ROLES[e.roleId].emoji,
          })),
        });
      }
      await sleep(3000);
    }

    // 开始第一夜
    await this.runNight();
  }

  _setupListeners() {
    // 不单独 subscribe — 由 app.js 的 '*' handler 转发事件
    // 见 app.js subscribeRoom 中的 hostEngine?.handleEvent 调用
  }

  /** 由 app.js 的 subscribeRoom '*' handler 调用 */
  handleEvent(event, payload) {
    switch (event) {
      case 'dating_choice':
        if (payload.playerId) this.datingChoices[payload.playerId] = payload.targetId;
        break;
      case 'night_action':
        if (payload.playerId) {
          const resolve = this.pendingActions.get(payload.playerId);
          if (resolve) { resolve(payload.targets); this.pendingActions.delete(payload.playerId); }
          else this.earlyEvents.set(payload.playerId, payload.targets);
        }
        break;
      case 'vote_cast':
        if (payload.playerId) {
          const key = 'vote_' + payload.playerId;
          const resolve = this.pendingActions.get(key);
          if (resolve) { resolve(payload.inFavor); this.pendingActions.delete(key); }
          else this.earlyEvents.set(key, payload.inFavor);
        }
        break;
    }
  }

  // ============ 等待玩家操作 ============

  waitForAction(playerId, timeout = 25000) {
    if (this.earlyEvents.has(playerId)) {
      const val = this.earlyEvents.get(playerId);
      this.earlyEvents.delete(playerId);
      return Promise.resolve(val);
    }
    return new Promise(resolve => {
      this.pendingActions.set(playerId, resolve);
      setTimeout(() => {
        if (this.pendingActions.has(playerId)) {
          this.pendingActions.delete(playerId);
          resolve(null);
        }
      }, timeout);
    });
  }

  waitForVote(playerId, timeout = 20000) {
    const key = 'vote_' + playerId;
    if (this.earlyEvents.has(key)) {
      const val = this.earlyEvents.get(key);
      this.earlyEvents.delete(key);
      return Promise.resolve(val);
    }
    return new Promise(resolve => {
      this.pendingActions.set(key, resolve);
      setTimeout(() => {
        if (this.pendingActions.has(key)) {
          this.pendingActions.delete(key);
          resolve(null);
        }
      }, timeout);
    });
  }

  // ============ 夜晚 ============

  async runNight() {
    this.dayNumber++;
    this.datingChoices = {};

    this.log(`\n🌙 第 ${this.dayNumber} 夜`);
    this.broadcast('phase_change', { phase: PHASE.DATING, dayNumber: this.dayNumber });
    store.update({ phase: PHASE.DATING, dayNumber: this.dayNumber });

    const alive = this.players.filter(p => p.alive);

    // 给真人发约会提示
    for (const p of alive) {
      if (!p.isBot) {
        this.sendToPlayer(p.id, 'dating_prompt', {
          playerId: p.id,
          message: '选择今晚的约会对象',
          alivePlayers: alive.filter(a => a.id !== p.id).map(a => ({ id: a.id, name: a.name })),
        });
      }
    }

    // Bot 自动约会
    await sleep(500);
    for (const p of alive) {
      if (p.isBot) {
        const others = alive.filter(a => a.id !== p.id);
        this.datingChoices[p.id] = Math.random() < 0.5 ? pick(others).id : 'none';
      }
    }

    // 等待真人约会选择
    await this._waitForAllDating(alive, 30000);

    // 进入夜间行动
    await this._processNight(alive);
  }

  async _waitForAllDating(alive, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (alive.every(p => this.datingChoices[p.id] !== undefined)) break;
      await sleep(300);
    }
    for (const p of alive) {
      if (this.datingChoices[p.id] === undefined) this.datingChoices[p.id] = 'none';
    }
  }

  async _processNight(alive) {
    this.broadcast('phase_change', { phase: PHASE.NIGHT_ACTION, dayNumber: this.dayNumber });
    store.update({ phase: PHASE.NIGHT_ACTION });

    const nightMessages = {};
    const addMsg = (pid, text) => { nightMessages[pid] = nightMessages[pid] || []; nightMessages[pid].push({ type: 'info', text }); };

    let guardTarget = null, hivKillTarget = null, fuKillTarget = null;
    let zaoYaoTarget = null, miaoNanInfections = [], xioaSanQuery = null;

    // 按 nightOrder 排序
    const actionOrder = alive
      .filter(p => ROLES[p.roleId]?.nightOrder > 0)
      .sort((a, b) => ROLES[a.roleId].nightOrder - ROLES[b.roleId].nightOrder);

    for (const player of actionOrder) {
      const role = ROLES[player.roleId];
      const others = alive.filter(a => a.id !== player.id);
      let targets;

      if (player.isBot) {
        await sleep(300);
        if (role.id === 'ji_rou_meng') {
          const pool = others.filter(o => o.id !== this.lastGuardTarget);
          targets = pool.length > 0 ? [pick(pool).id] : [pick(others).id];
        } else if (role.mechanic === 'select_two') {
          const s = shuffle(others);
          targets = [s[0].id, s[1]?.id || s[0].id];
        } else {
          targets = [pick(others).id];
        }
      } else {
        // 真人
        this.sendToPlayer(player.id, 'night_action_prompt', {
          playerId: player.id,
          type: role.mechanic === 'select_two' ? 'select_two' : 'select_one',
          roleEmoji: role.emoji, roleName: role.name,
          message: SKILLS[role.id] || '',
          targets: others.map(o => ({ id: o.id, name: o.name })),
        });
        targets = await this.waitForAction(player.id);
        if (!targets) targets = [pick(others).id];
      }

      // 结算
      const isJammed = zaoYaoTarget === player.id && INFO_ROLES.includes(role.id);
      switch (role.id) {
        case 'zao_yao_jing': zaoYaoTarget = targets[0]; break;
        case 'ji_rou_meng': guardTarget = targets[0]; this.lastGuardTarget = targets[0]; break;
        case 'hiv': hivKillTarget = targets[0]; break;
        case 'fu_sheng_shi':
          if (!this.fuShengShiCooldown) { fuKillTarget = targets[0]; this.fuShengShiCooldown = true; }
          else { this.fuShengShiCooldown = false; }
          break;
        case 'miao_nan': {
          const t = this.getPlayer(targets[0]);
          if (t && !t.infected) { t.infected = true; miaoNanInfections.push(t.id); }
          break;
        }
        case 'jian_biao_shi': {
          const t = this.getPlayer(targets[0]);
          let tags = [...ROLES[t.roleId].tags];
          if (isJammed) tags = [pick(Object.values(TAGS)), pick(Object.values(TAGS))];
          addMsg(player.id, `🔍 你翻了 ${t.name} 的相册：「${tags[0]}」「${tags[1] || tags[0]}」`);
          break;
        }
        case 'xiao_hu_shi': {
          const t = this.getPlayer(targets[0]);
          let result = t.infected ? '阳性 🔴' : '阴性 🟢';
          if (isJammed) result = t.infected ? '阴性 🟢' : '阳性 🔴';
          addMsg(player.id, `💉 ${t.name} 的检测报告：${result}`);
          break;
        }
        case 'mu_la_la': {
          const t1 = this.getPlayer(targets[0]), t2 = this.getPlayer(targets[1] || targets[0]);
          let hasEvil = getSide(t1.roleId) === 'evil' || getSide(t2.roleId) === 'evil';
          if (isJammed) hasEvil = !hasEvil;
          addMsg(player.id, `👩‍❤️‍👩 ${t1.name} 和 ${t2.name} 中${hasEvil ? '至少有1人是恶方' : '都不是恶方'}`);
          break;
        }
        case 'hua_fang_gu_niang': {
          const t = this.getPlayer(targets[0]);
          const idx = alive.findIndex(a => a.id === t.id);
          const neighbors = [alive[(idx - 1 + alive.length) % alive.length], t, alive[(idx + 1) % alive.length]];
          let cnt = neighbors.filter(n => n.infected).length;
          if (isJammed) cnt = Math.min(3, 3 - cnt);
          addMsg(player.id, `🌸 ${t.name} 周围3人中有 ${cnt} 人感染`);
          break;
        }
        case 'hou_zi': {
          const t = this.getPlayer(targets[0]);
          const dated = this.datingChoices[t.id] && this.datingChoices[t.id] !== 'none';
          let msg = dated ? '今晚有约' : '今晚没约';
          if (isJammed) msg = dated ? '今晚没约' : '今晚有约';
          addMsg(player.id, `🐒 ${t.name} ${msg}`);
          break;
        }
        case 'xiao_san':
          xioaSanQuery = { playerId: player.id, targetId: targets[0], jammed: isJammed };
          break;
      }
    }

    // 配对
    const pairings = [];
    const paired = new Set();
    for (const p of alive) {
      if (paired.has(p.id)) continue;
      const myChoice = this.datingChoices[p.id];
      if (!myChoice || myChoice === 'none') continue;
      if (this.datingChoices[myChoice] === p.id && !paired.has(myChoice)) {
        pairings.push([p.id, myChoice]);
        paired.add(p.id);
        paired.add(myChoice);
      }
    }

    // 感染
    const newInfections = [];
    for (const [a, b] of pairings) {
      const pa = this.getPlayer(a), pb = this.getPlayer(b);
      if (pa.infected && !pb.infected && b !== guardTarget) { pb.infected = true; newInfections.push(b); }
      if (pb.infected && !pa.infected && a !== guardTarget) { pa.infected = true; newInfections.push(a); }
    }

    // 配对标签
    for (const [a, b] of pairings) {
      const ra = ROLES[this.getPlayer(a).roleId], rb = ROLES[this.getPlayer(b).roleId];
      addMsg(a, `🌹 约会收获：对方标签「${rb.tags[Math.floor(Math.random() * rb.tags.length)]}」`);
      addMsg(b, `🌹 约会收获：对方标签「${ra.tags[Math.floor(Math.random() * ra.tags.length)]}」`);
    }

    // 小三查询
    if (xioaSanQuery) {
      const pr = pairings.find(([a, b]) => a === xioaSanQuery.targetId || b === xioaSanQuery.targetId);
      let msg;
      if (pr) {
        const partner = pr[0] === xioaSanQuery.targetId ? pr[1] : pr[0];
        msg = `💔 ${this.getPlayerName(xioaSanQuery.targetId)} 今晚和 ${this.getPlayerName(partner)} 配对了`;
      } else {
        msg = `💔 ${this.getPlayerName(xioaSanQuery.targetId)} 今晚没有配对`;
      }
      if (xioaSanQuery.jammed) msg = `💔 信息被干扰`;
      addMsg(xioaSanQuery.playerId, msg);
    }

    // 死亡
    const deaths = [];
    if (hivKillTarget && hivKillTarget !== guardTarget) deaths.push(hivKillTarget);
    if (fuKillTarget && fuKillTarget !== guardTarget && !deaths.includes(fuKillTarget)) deaths.push(fuKillTarget);

    for (const pid of deaths) {
      const p = this.getPlayer(pid);
      if (p) p.alive = false;
    }

    // 发送夜晚结果
    for (const [pid, msgs] of Object.entries(nightMessages)) {
      this.sendToPlayer(pid, 'night_results', { playerId: pid, messages: msgs });
    }

    await sleep(2000);

    // 胜负判定
    const win = this.checkWin();
    if (win) { this.endGame(win); return; }

    // 白天
    await this.runDay(deaths, newInfections);
  }

  // ============ 白天 ============

  async runDay(deaths, newInfections) {
    this.log(`\n☀️ 第 ${this.dayNumber} 天`);

    const announcements = [];
    if (deaths.length > 0) {
      announcements.push({ type: 'death', text: `☠️ 昨夜死亡: ${deaths.map(id => this.getPlayerName(id)).join(', ')}` });
    } else {
      announcements.push({ type: 'info', text: '🌅 昨夜平安无事' });
    }
    if (newInfections.length > 0) {
      announcements.push({ type: 'warning', text: `🦠 昨夜有 ${newInfections.length} 人新增感染` });
    }

    const alive = this.players.filter(p => p.alive);
    this.broadcast('phase_change', {
      phase: PHASE.DAY, dayNumber: this.dayNumber, announcements,
      alivePlayers: alive.map(p => ({ id: p.id, name: p.name, alive: p.alive })),
    });
    store.update({ phase: PHASE.DAY });
    store.updateNested('dayState.announcements', announcements);

    await sleep(5000);

    // 投票
    const nominated = pick(alive);
    const threshold = Math.ceil(alive.length / 2);
    this.broadcast('vote_start', {
      target: { id: nominated.id, name: nominated.name },
      threshold,
    });

    // Bot 自动投票
    const votes = {};
    for (const p of alive) {
      if (p.isBot) {
        const isEvil = getSide(p.roleId) === 'evil';
        const targetIsEvil = getSide(nominated.roleId) === 'evil';
        if (isEvil && targetIsEvil) votes[p.id] = false;
        else if (isEvil) votes[p.id] = Math.random() < 0.7;
        else votes[p.id] = Math.random() < 0.5;
      }
    }

    // 等真人投票
    for (const p of alive) {
      if (!p.isBot) {
        const result = await this.waitForVote(p.id);
        votes[p.id] = result !== null ? result : Math.random() < 0.5;
      }
    }

    const forCount = Object.values(votes).filter(v => v).length;
    const executed = forCount >= threshold;

    if (executed) {
      nominated.alive = false;
      const side = getSide(nominated.roleId);
      this.broadcast('execution', {
        target: { id: nominated.id, name: nominated.name },
        side, forCount, threshold,
      });
    } else {
      this.broadcast('acquittal', {
        target: { id: nominated.id, name: nominated.name },
        forCount, threshold,
      });
    }

    await sleep(3000);

    const win = this.checkWin();
    if (win) { this.endGame(win); return; }

    await this.runNight();
  }

  // ============ 胜负 ============

  checkWin() {
    const aliveGood = this.players.filter(p => p.alive && getSide(p.roleId) === 'good');
    const aliveEvil = this.players.filter(p => p.alive && getSide(p.roleId) === 'evil');
    const aliveScum = this.players.filter(p => p.alive && ROLES[p.roleId]?.faction === FACTION.SCUM);

    if (aliveEvil.length >= aliveGood.length && aliveEvil.length > 0) {
      return { winner: 'evil', reason: '恶方势力压过好人，渣王称霸夜店！' };
    }
    if (aliveScum.length === 0) {
      const infected = aliveGood.filter(p => p.infected).length;
      if (infected >= Math.ceil(aliveGood.length / 2)) {
        return { winner: 'evil', reason: `渣王虽死，但感染已扩散至 ${infected}/${aliveGood.length} 人！` };
      }
      return { winner: 'good', reason: '所有渣王被处决，清流派净化了夜店！' };
    }
    return null;
  }

  endGame(win) {
    this.log(`\n🎉 游戏结束: ${win.winner === 'good' ? '好人胜' : '恶方胜'}`);
    this.broadcast('game_over', {
      winner: win.winner, reason: win.reason,
      players: this.players.map(p => ({
        id: p.id, name: p.name, roleId: p.roleId,
        roleName: ROLES[p.roleId].name, roleEmoji: ROLES[p.roleId].emoji,
        faction: ROLES[p.roleId].faction, alive: p.alive, infected: p.infected,
      })),
    });
    store.update({ phase: PHASE.END });
    this.running = false;
  }
}
