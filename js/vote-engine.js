// 夜店钟楼 - 投票/处决引擎

import { ROLES, FACTION, getSide } from './roles.js';
import { store, PHASE } from './game-state.js';

export class VoteEngine {
  constructor(broadcastFn, sendPrivateFn) {
    this.broadcast = broadcastFn;
    this.sendPrivate = sendPrivateFn;
  }

  // ============ 提名 ============

  /** 玩家发起提名 */
  nominate(nominatorId, targetId) {
    const nominator = store.getPlayer(nominatorId);
    const target = store.getPlayer(targetId);
    if (!nominator || !target || !target.alive) return false;

    // 每天每人只能被提名一次
    const already = store.state.dayState.nominations.some(n => n.targetId === targetId);
    if (already) return false;

    store.state.dayState.nominations.push({ nominatorId, targetId });
    store.addLog('nominate', `${nominator.name} 提名了 ${target.name}`);

    this.broadcast('nomination', {
      nominator: { id: nominator.id, name: nominator.name },
      target: { id: target.id, name: target.name },
    });

    return true;
  }

  /** 开始对某人投票 */
  startVote(targetId) {
    const target = store.getPlayer(targetId);
    if (!target) return false;

    store.update({ phase: PHASE.VOTE });
    store.updateNested('dayState.currentVote', {
      targetId,
      votes: {},
      resolved: false,
    });

    const alive = store.getAlivePlayers();
    const threshold = Math.ceil(alive.length / 2);

    this.broadcast('vote_start', {
      target: { id: target.id, name: target.name },
      threshold,
      totalVoters: alive.length + this._getGhostVoters().length,
    });

    return true;
  }

  /** 玩家投票 */
  castVote(playerId, inFavor) {
    const vote = store.state.dayState.currentVote;
    if (!vote || vote.resolved) return false;

    const player = store.getPlayer(playerId);
    if (!player) return false;

    // 死人只有一次幽灵投票
    if (!player.alive) {
      if (player.ghostVoteUsed) return false;
      player.ghostVoteUsed = true;
    }

    vote.votes[playerId] = inFavor;

    // 黑粉头子秘密操纵（如果有的话，暂不实现）

    this.broadcast('vote_update', {
      playerId: player.id,
      playerName: player.name,
      inFavor,
      totalFor: Object.values(vote.votes).filter(v => v).length,
      totalAgainst: Object.values(vote.votes).filter(v => !v).length,
    });

    // 检查是否所有人都投了
    const eligibleVoters = [
      ...store.getAlivePlayers().map(p => p.id),
      ...this._getGhostVoters().map(p => p.id),
    ];

    const allVoted = eligibleVoters.every(id => id in vote.votes);
    if (allVoted) {
      this._resolveVote();
    }

    return true;
  }

  /** 结算投票 */
  _resolveVote() {
    const vote = store.state.dayState.currentVote;
    vote.resolved = true;

    const forCount = Object.values(vote.votes).filter(v => v).length;
    const alive = store.getAlivePlayers();
    const threshold = Math.ceil(alive.length / 2);

    const executed = forCount >= threshold;

    if (executed) {
      const target = store.getPlayer(vote.targetId);
      target.alive = false;
      store.updateNested('dayState.executed', vote.targetId);

      const faction = ROLES[target.roleId].faction;
      const side = getSide(target.roleId);

      store.addLog('execution', `${target.name} 被处决（${side === 'evil' ? '恶方' : '好人'}）`);

      // 缚绳师升级检查
      if (target.roleId === 'hiv') {
        const fuShengShi = store.state.players.find(p =>
          p.alive && p.roleId === 'fu_sheng_shi'
        );
        if (fuShengShi) {
          store.addLog('upgrade', '缚绳师升级为核心杀手');
          // 缚绳师不再有冷却
          store.update({ fuShengShiCooldown: false });
        }
      }

      this.broadcast('execution', {
        target: { id: target.id, name: target.name },
        side, // 公布阵营但不公布角色
        forCount,
        threshold,
      });
    } else {
      store.addLog('acquit', `${store.getPlayer(vote.targetId)?.name} 无罪释放`);
      this.broadcast('acquittal', {
        target: { id: vote.targetId, name: store.getPlayer(vote.targetId)?.name },
        forCount,
        threshold,
      });
    }

    // 检查胜利条件
    const win = store.checkWinCondition();
    if (win) {
      store.update({ phase: PHASE.END, winner: win.winner, winReason: win.reason });
      this.broadcast('game_over', win);
      return;
    }

    // 返回白天
    store.update({ phase: PHASE.DAY });
  }

  // ============ 白天技能 ============

  /** 粗口1s - 开撕 */
  useCuKou(userId, targetId) {
    if (store.state.dayState.cuKouUsed) return false;
    const user = store.getPlayer(userId);
    if (!user || user.roleId !== 'cu_kou') return false;

    const target = store.getPlayer(targetId);
    if (!target || !target.alive) return false;

    store.updateNested('dayState.cuKouUsed', true);

    const role = ROLES[target.roleId];
    const randomTag = role.tags[Math.floor(Math.random() * role.tags.length)];

    store.addLog('cu_kou', `粗口1s 对 ${target.name} 开撕，暴露标签「${randomTag}」`);

    this.broadcast('cu_kou_reveal', {
      user: { id: user.id, name: user.name },
      target: { id: target.id, name: target.name },
      tag: randomTag,
      flavorText: `🤬 ${user.name} 当众骂了 ${target.name} 一顿，逼出了标签「${randomTag}」`,
    });

    return true;
  }

  /** 作精 - 闹分手 */
  useZuoJing(userId) {
    if (store.state.dayState.zuoJingUsed) return false;
    const user = store.getPlayer(userId);
    if (!user || user.roleId !== 'zuo_jing') return false;

    store.updateNested('dayState.zuoJingUsed', true);
    store.addLog('zuo_jing', `作精 闹分手，取消今天投票`);

    this.broadcast('zuo_jing_tantrum', {
      user: { id: user.id, name: user.name },
      flavorText: `😭 ${user.name} 当场大哭大闹，搞得所有人都没心情投票了！直接入夜。`,
    });

    // 直接入夜（由 app 层调用 nightEngine.startNight()）
    return true;
  }

  // ============ 工具 ============

  _getGhostVoters() {
    return store.state.players.filter(p => !p.alive && !p.ghostVoteUsed);
  }

  getVoteThreshold() {
    return Math.ceil(store.getAlivePlayers().length / 2);
  }
}
