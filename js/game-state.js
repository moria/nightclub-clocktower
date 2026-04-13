// 夜店钟楼 - 游戏状态管理

import { ROLES, FACTION, FACTION_INFO, getSide } from './roles.js';

// ============ 游戏阶段 ============
export const PHASE = {
  LOBBY: 'lobby',         // 等待玩家加入
  ROLE_REVEAL: 'reveal',  // 查看角色
  NIGHT: 'night',         // 夜晚
  DATING: 'dating',       // 约会选择（夜晚子阶段）
  NIGHT_ACTION: 'night_action', // 夜晚行动
  DAY: 'day',             // 白天讨论
  VOTE: 'vote',           // 投票处决
  END: 'end',             // 游戏结束
};

// ============ 状态管理 ============
class GameStore {
  constructor() {
    this._state = this._defaultState();
    this._listeners = new Map();
    this._listenerIdCounter = 0;
  }

  _defaultState() {
    return {
      roomCode: null,
      hostId: null,
      phase: PHASE.LOBBY,
      dayNumber: 0,
      myPlayerId: null,

      players: [],
      // player: { id, name, roleId, alive, infected, ghostVoteUsed, connected, seatIndex }

      nightRound: {
        datingChoices: {},   // { playerId: targetId | 'none' }
        actions: [],         // [{ playerId, roleId, actionType, targets, result }]
        currentStep: 0,
        pendingPlayers: [],  // players who need to submit actions
        deaths: [],          // playerIds who die this night
        newInfections: [],   // playerIds newly infected
        pairings: [],        // [{ a, b, successful }]
        messages: {},        // { playerId: [{ type, text }] }
      },

      dayState: {
        announcements: [],   // [{ type, text }]
        nominations: [],     // [{ nominatorId, targetId }]
        currentVote: null,   // { targetId, votes: { playerId: bool }, resolved }
        executed: null,      // playerId
        cuKouUsed: false,
        zuoJingUsed: false,
      },

      log: [],             // [{ round, phase, event, detail }]
      winner: null,        // 'good' | 'evil' | null
      winReason: '',

      // 历史记录（情报本用）
      intelHistory: [],    // [{day, messages: [{type, text}]}] — 夜间情报
      voteHistory: [],     // [{day, target, targetName, forCount, threshold, executed, side}]
      datingHistory: [],   // [{day, myChoice, myChoiceName, paired, partnerName, tagReceived}]
      eventTimeline: [],   // [{day, announcements: [{type, text}]}]
      evilTeammates: [],   // [{id, name, role, emoji}] — 恶方互认

      // 持久化标记
      fuShengShiCooldown: false,  // 缚绳师冷却
      gouZiBound: {},             // { playerId: boundToPlayerId }
      lastGuardTarget: null,      // 肌肉猛1上夜守护对象
    };
  }

  get state() {
    return this._state;
  }

  /** 更新状态（浅合并） */
  update(partial) {
    Object.assign(this._state, partial);
    this._notify();
    this._persist();
  }

  /** 深度更新嵌套对象 */
  updateNested(path, value) {
    const keys = path.split('.');
    let obj = this._state;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this._notify();
    this._persist();
  }

  /** 订阅状态变更 */
  subscribe(callback) {
    const id = ++this._listenerIdCounter;
    this._listeners.set(id, callback);
    return () => this._listeners.delete(id);
  }

  /** 通知所有监听者 */
  _notify() {
    this._listeners.forEach(fn => {
      try { fn(this._state); } catch (e) { console.error('Listener error:', e); }
    });
  }

  /** 持久化到 localStorage */
  _persist() {
    try {
      localStorage.setItem('nightclub_clocktower_state', JSON.stringify(this._state));
    } catch (e) {
      console.warn('持久化失败:', e);
    }
  }

  /** 从 localStorage 恢复 */
  restore() {
    try {
      const saved = localStorage.getItem('nightclub_clocktower_state');
      if (saved) {
        this._state = { ...this._defaultState(), ...JSON.parse(saved) };
        return true;
      }
    } catch (e) {
      console.warn('恢复失败:', e);
    }
    return false;
  }

  /** 重置游戏 */
  reset() {
    this._state = this._defaultState();
    localStorage.removeItem('nightclub_clocktower_state');
    this._notify();
  }

  // ============ 便捷查询 ============

  getPlayer(id) {
    return this._state.players.find(p => p.id === id);
  }

  getMyPlayer() {
    return this.getPlayer(this._state.myPlayerId);
  }

  getMyRole() {
    const me = this.getMyPlayer();
    return me ? ROLES[me.roleId] : null;
  }

  getAlivePlayers() {
    return this._state.players.filter(p => p.alive);
  }

  getAliveGoodPlayers() {
    return this.getAlivePlayers().filter(p => getSide(p.roleId) === 'good');
  }

  getAliveEvilPlayers() {
    return this.getAlivePlayers().filter(p => getSide(p.roleId) === 'evil');
  }

  getInfectedGoodCount() {
    return this.getAliveGoodPlayers().filter(p => p.infected).length;
  }

  isHost() {
    return this._state.myPlayerId === this._state.hostId;
  }

  // ============ 胜利判定 ============

  checkWinCondition() {
    const alive = this.getAlivePlayers();
    const aliveGood = this.getAliveGoodPlayers();
    const aliveEvil = this.getAliveEvilPlayers();

    // 恶方人数 >= 好人人数 → 恶方胜（数量压制）
    if (aliveEvil.length >= aliveGood.length && aliveEvil.length > 0) {
      return { winner: 'evil', reason: '恶方势力压过好人，渣王称霸夜店！' };
    }

    // 检查渣王是否全部被处决
    const aliveScum = alive.filter(p => ROLES[p.roleId].faction === FACTION.SCUM);
    if (aliveScum.length === 0) {
      const infectedGood = this.getInfectedGoodCount();
      const totalGood = aliveGood.length;
      if (infectedGood >= Math.ceil(totalGood / 2)) {
        return { winner: 'evil', reason: `渣王虽死，但感染已扩散至 ${infectedGood}/${totalGood} 人，病毒胜利！` };
      }
      return { winner: 'good', reason: '所有渣王已被处决，清流派净化了夜店！' };
    }

    return null; // 游戏继续
  }

  /** 添加日志 */
  addLog(event, detail = '') {
    this._state.log.push({
      round: this._state.dayNumber,
      phase: this._state.phase,
      event,
      detail,
      timestamp: Date.now(),
    });
  }
}

// 单例
export const store = new GameStore();
