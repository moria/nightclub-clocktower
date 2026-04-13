// 夜店钟楼 - 夜晚流程引擎

import { ROLES, FACTION, NIGHT_ORDER, INFO_ROLES, getSide, getFakeTags, TAGS } from './roles.js';
import { store, PHASE } from './game-state.js';
import {
  resolvePairings, resolveInfection, checkJiNvEffect,
  resolveBaoZhaLing, checkGouZiHeartbreak
} from './dating-engine.js';

// ============ 夜晚流程控制器 ============

export class NightEngine {
  constructor(broadcastFn, sendPrivateFn) {
    // broadcastFn(event, data) — 广播给所有人
    // sendPrivateFn(playerId, event, data) — 私密发送给某玩家
    this.broadcast = broadcastFn;
    this.sendPrivate = sendPrivateFn;
  }

  /** 开始新的一夜 */
  startNight() {
    const dayNumber = store.state.dayNumber + 1;
    store.update({
      phase: PHASE.DATING,
      dayNumber,
      nightRound: {
        datingChoices: {},
        actions: [],
        currentStep: 0,
        pendingPlayers: [],
        deaths: [],
        newInfections: [],
        pairings: [],
        messages: {},
      },
    });

    store.addLog('night_start', `第 ${dayNumber} 夜开始`);
    this.broadcast('phase_change', { phase: PHASE.DATING, dayNumber });

    // 所有存活玩家提交约会选择
    const alive = store.getAlivePlayers();
    store.updateNested('nightRound.pendingPlayers', alive.map(p => p.id));

    for (const p of alive) {
      this.sendPrivate(p.id, 'dating_prompt', {
        message: '选择今晚的约会对象，或选择"不约"',
        excludeSelf: true,
        alivePlayers: alive.filter(a => a.id !== p.id).map(a => ({ id: a.id, name: a.name })),
      });
    }
  }

  /** 玩家提交约会选择 */
  submitDatingChoice(playerId, targetId) {
    store.state.nightRound.datingChoices[playerId] = targetId;

    const pending = store.state.nightRound.pendingPlayers.filter(id => id !== playerId);
    store.updateNested('nightRound.pendingPlayers', pending);

    this.broadcast('dating_progress', {
      submitted: Object.keys(store.state.nightRound.datingChoices).length,
      total: store.getAlivePlayers().length,
    });

    if (pending.length === 0) {
      this._startNightActions();
    }
  }

  /** 开始夜晚行动阶段 */
  _startNightActions() {
    store.update({ phase: PHASE.NIGHT_ACTION });

    const isFirstNight = store.state.dayNumber === 1;

    // 构建本夜需要执行的步骤
    const steps = [];

    // 首夜特殊步骤
    if (isFirstNight) {
      steps.push({ type: 'cai_zhuang_mu', order: 1 });
      steps.push({ type: 'evil_reveal', order: 2 });
    }

    // 按 nightOrder 排序的活跃角色
    const alive = store.getAlivePlayers();
    for (const roleId of NIGHT_ORDER) {
      const player = alive.find(p => p.roleId === roleId);
      if (!player) continue;

      const role = ROLES[roleId];
      if (role.nightPhase === 'first_night_only' && !isFirstNight) continue;
      if (role.nightPhase === 'daytime' || role.nightPhase === 'always_passive') continue;

      // 缚绳师冷却检查
      if (roleId === 'fu_sheng_shi' && store.state.fuShengShiCooldown) {
        store.update({ fuShengShiCooldown: false }); // 解除冷却，跳过本夜
        continue;
      }

      steps.push({ type: 'role_action', roleId, playerId: player.id, order: role.nightOrder });
    }

    // 系统结算步骤
    steps.push({ type: 'pairing_resolve', order: 9 });
    steps.push({ type: 'infection_resolve', order: 15 });
    steps.push({ type: 'explosion_resolve', order: 16 });
    steps.push({ type: 'death_resolve', order: 17 });

    steps.sort((a, b) => a.order - b.order);

    store.updateNested('nightRound.steps', steps);
    store.updateNested('nightRound.currentStep', 0);

    this._processNextStep();
  }

  /** 处理下一步 */
  _processNextStep() {
    const { steps, currentStep } = store.state.nightRound;
    if (currentStep >= steps.length) {
      this._endNight();
      return;
    }

    const step = steps[currentStep];

    switch (step.type) {
      case 'evil_reveal':
        this._handleEvilReveal();
        this._advanceStep();
        break;

      case 'cai_zhuang_mu':
        this._handleCaiZhuangMu();
        this._advanceStep();
        break;

      case 'role_action':
        this._promptRoleAction(step.playerId, step.roleId);
        break;

      case 'pairing_resolve':
        this._handlePairingResolve();
        this._advanceStep();
        break;

      case 'infection_resolve':
        this._handleInfectionResolve();
        this._advanceStep();
        break;

      case 'explosion_resolve':
        this._handleExplosionResolve();
        this._advanceStep();
        break;

      case 'death_resolve':
        this._handleDeathResolve();
        this._advanceStep();
        break;

      default:
        this._advanceStep();
    }
  }

  _advanceStep() {
    store.updateNested('nightRound.currentStep', store.state.nightRound.currentStep + 1);
    this._processNextStep();
  }

  // ============ 首夜特殊 ============

  _handleEvilReveal() {
    // 恶方互相知道队友
    const evilPlayers = store.state.players.filter(p =>
      p.alive && getSide(p.roleId) === 'evil'
    );
    const evilInfo = evilPlayers.map(p => ({
      id: p.id,
      name: p.name,
      role: ROLES[p.roleId].name,
      emoji: ROLES[p.roleId].emoji,
    }));

    for (const ep of evilPlayers) {
      this.sendPrivate(ep.id, 'evil_reveal', {
        teammates: evilInfo.filter(e => e.id !== ep.id),
        message: '以下是你的恶方队友：',
      });
    }
  }

  _handleCaiZhuangMu() {
    const player = store.state.players.find(p =>
      p.alive && p.roleId === 'cai_zhuang_mu'
    );
    if (!player) return;

    // 收集恶方所有标签
    const evilPlayers = store.state.players.filter(p => getSide(p.roleId) === 'evil');
    const allEvilTags = [];
    for (const ep of evilPlayers) {
      allEvilTags.push(...ROLES[ep.roleId].tags);
    }

    // 随机抽2个（可重复）
    const shuffled = allEvilTags.sort(() => Math.random() - 0.5);
    const revealed = shuffled.slice(0, 2);

    this._addMessage(player.id, 'info', `💄 你在化妆间偷听到的八卦：恶方的特征包括「${revealed[0]}」和「${revealed[1]}」`);
  }

  // ============ 角色行动提示 ============

  _promptRoleAction(playerId, roleId) {
    const role = ROLES[roleId];
    const alive = store.getAlivePlayers().filter(p => p.id !== playerId);

    let prompt = {};

    switch (role.mechanic) {
      case 'select_one':
      case 'select_one_kill':
        prompt = {
          type: 'select_one',
          roleEmoji: role.emoji,
          roleName: role.name,
          message: role.flavorText,
          targets: alive.map(p => ({ id: p.id, name: p.name })),
        };
        break;

      case 'select_one_not_self_not_repeat':
        const lastGuard = store.state.lastGuardTarget;
        prompt = {
          type: 'select_one',
          roleEmoji: role.emoji,
          roleName: role.name,
          message: role.flavorText,
          targets: alive
            .filter(p => p.id !== lastGuard)
            .map(p => ({ id: p.id, name: p.name })),
        };
        break;

      case 'select_one_kill_cooldown':
        // 缚绳师可选择不杀
        prompt = {
          type: 'select_one_optional',
          roleEmoji: role.emoji,
          roleName: role.name,
          message: role.flavorText + '（你也可以选择今晚不出手）',
          targets: alive.map(p => ({ id: p.id, name: p.name })),
          canSkip: true,
        };
        break;

      case 'select_two':
        prompt = {
          type: 'select_two',
          roleEmoji: role.emoji,
          roleName: role.name,
          message: role.flavorText,
          targets: alive.map(p => ({ id: p.id, name: p.name })),
        };
        break;

      default:
        this._advanceStep();
        return;
    }

    store.updateNested('nightRound.pendingPlayers', [playerId]);
    this.sendPrivate(playerId, 'night_action_prompt', prompt);
  }

  /** 玩家提交夜晚行动 */
  submitNightAction(playerId, targets) {
    const player = store.getPlayer(playerId);
    if (!player) return;

    const roleId = player.roleId;
    const role = ROLES[roleId];

    // 记录行动
    store.state.nightRound.actions.push({
      playerId,
      roleId,
      targets,
    });

    // 处理行动结果
    this._resolveAction(playerId, roleId, targets);

    // 推进到下一步
    store.updateNested('nightRound.pendingPlayers', []);
    this._advanceStep();
  }

  // ============ 行动结算 ============

  _resolveAction(playerId, roleId, targets) {
    const isCorrupted = this._isCorruptedByZaoYaoJing(playerId);

    switch (roleId) {
      case 'ji_rou_meng': {
        store.update({ lastGuardTarget: targets[0] });
        store.addLog('guard', `肌肉猛1 守护了 ${store.getPlayer(targets[0])?.name}`);
        break;
      }

      case 'hiv': {
        // 杀人目标记录，稍后在 death_resolve 中处理
        store.state.nightRound._hivKillTarget = targets[0];
        store.addLog('kill_attempt', `HIV携带者 尝试击杀 ${store.getPlayer(targets[0])?.name}`);
        break;
      }

      case 'fu_sheng_shi': {
        if (targets[0] !== 'skip') {
          store.state.nightRound._fuShengShiKillTarget = targets[0];
          store.update({ fuShengShiCooldown: true });
          store.addLog('kill_attempt', `缚绳师 尝试击杀 ${store.getPlayer(targets[0])?.name}`);
        }
        break;
      }

      case 'miao_nan': {
        const target = store.getPlayer(targets[0]);
        if (target && !target.infected) {
          target.infected = true;
          store.state.nightRound.newInfections.push(targets[0]);
          store.addLog('infect', `秒男 感染了 ${target.name}`);
        }
        break;
      }

      case 'jian_biao_shi': {
        const target = store.getPlayer(targets[0]);
        if (!target) break;
        const targetRole = ROLES[target.roleId];
        let tags = targetRole.id === 'gai_zhuang_che' ? getFakeTags() : [...targetRole.tags];
        if (isCorrupted) tags = getFakeTags();
        this._addMessage(playerId, 'info', `🔍 你翻了 ${target.name} 的相册，看到了：「${tags[0]}」「${tags[1]}」`);
        break;
      }

      case 'xiao_hu_shi': {
        const target = store.getPlayer(targets[0]);
        if (!target) break;
        let result = target.infected ? '阳性 🔴' : '阴性 🟢';
        if (isCorrupted) result = target.infected ? '阴性 🟢' : '阳性 🔴';
        this._addMessage(playerId, 'info', `💉 ${target.name} 的检测报告：${result}`);
        break;
      }

      case 'mu_la_la': {
        const t1 = store.getPlayer(targets[0]);
        const t2 = store.getPlayer(targets[1]);
        if (!t1 || !t2) break;
        const hasEvil = getSide(t1.roleId) === 'evil' || getSide(t2.roleId) === 'evil';
        let result = hasEvil ? '有渣！🚨' : '都挺正的 ✅';
        if (isCorrupted) result = hasEvil ? '都挺正的 ✅' : '有渣！🚨';
        this._addMessage(playerId, 'info', `👩‍❤️‍👩 ${t1.name} 和 ${t2.name} 之间：${result}`);
        break;
      }

      case 'hua_fang_gu_niang': {
        const target = store.getPlayer(targets[0]);
        if (!target) break;
        const neighbors = this._getNeighbors(target.id);
        const group = [target, ...neighbors.map(id => store.getPlayer(id))].filter(Boolean);
        let infectedCount = group.filter(p => p.infected).length;
        const hasInfectTag = group.some(p => ROLES[p.roleId].tags.includes(TAGS.INFECT));
        const hasAttackTag = group.some(p => ROLES[p.roleId].tags.includes(TAGS.ATTACK));
        if (isCorrupted) infectedCount = Math.max(0, infectedCount + (Math.random() > 0.5 ? 1 : -1));
        this._addMessage(playerId, 'info',
          `🌸 ${target.name} 及邻座共 ${group.length} 人中：${infectedCount} 人感染` +
          (hasInfectTag ? '，有「传染性」标签' : '') +
          (hasAttackTag ? '，有「攻击性」标签' : '')
        );
        break;
      }

      case 'hou_zi': {
        const target = store.getPlayer(targets[0]);
        if (!target) break;
        const choice = store.state.nightRound.datingChoices[target.id];
        const didDate = choice && choice !== 'none';
        // 配对是否成功需要在配对结算后才知道，此处先记录
        let msg = didDate ? '出门约会了 🚶' : '今晚宅家了 🏠';
        if (isCorrupted) msg = didDate ? '今晚宅家了 🏠' : '出门约会了 🚶';
        this._addMessage(playerId, 'info', `🐒 你蹲在 ${target.name} 楼下：他${msg}`);
        break;
      }

      case 'xiao_san': {
        // 需要在配对结算后才能给出结果，先记录目标
        store.state.nightRound._xiaoSanTarget = { playerId, targetId: targets[0] };
        break;
      }

      case 'zao_yao_jing': {
        store.state.nightRound._zaoYaoJingTarget = targets[0];
        store.addLog('rumor', `造谣精 干扰了 ${store.getPlayer(targets[0])?.name}`);
        break;
      }
    }
  }

  // ============ 系统结算阶段 ============

  _handlePairingResolve() {
    const pairings = resolvePairings(store.state.nightRound.datingChoices);
    store.updateNested('nightRound.pairings', pairings);

    // 小三结果
    const xiaoSan = store.state.nightRound._xiaoSanTarget;
    if (xiaoSan) {
      const targetPair = pairings.find(p =>
        p.successful && (p.a === xiaoSan.targetId || p.b === xiaoSan.targetId)
      );
      const isCorrupted = this._isCorruptedByZaoYaoJing(xiaoSan.playerId);
      const target = store.getPlayer(xiaoSan.targetId);

      if (targetPair) {
        const partnerId = targetPair.a === xiaoSan.targetId ? targetPair.b : targetPair.a;
        const partner = store.getPlayer(partnerId);
        let msg = `💔 ${target.name} 今晚和 ${partner.name} 在一起了`;
        if (isCorrupted) {
          // 给假信息：随机一个其他人
          const others = store.getAlivePlayers().filter(p =>
            p.id !== xiaoSan.targetId && p.id !== partnerId
          );
          if (others.length > 0) {
            const fake = others[Math.floor(Math.random() * others.length)];
            msg = `💔 ${target.name} 今晚和 ${fake.name} 在一起了`;
          }
        }
        this._addMessage(xiaoSan.playerId, 'info', msg);
      } else {
        this._addMessage(xiaoSan.playerId, 'info', `💔 ${target.name} 今晚独自一人`);
      }
    }

    // 妓女效果
    const jiNvEffect = checkJiNvEffect(pairings);
    if (jiNvEffect.hivBlocked) {
      store.state.nightRound._hivBlocked = true;
      if (jiNvEffect.jiNvInfected) {
        const jn = store.getPlayer(jiNvEffect.jiNvInfected);
        if (jn) jn.infected = true;
        store.state.nightRound.newInfections.push(jiNvEffect.jiNvInfected);
      }
      store.addLog('ji_nv_block', '妓女阻止了HIV携带者的杀人');
    }
  }

  _handleInfectionResolve() {
    const guardedIds = new Set();
    if (store.state.lastGuardTarget) {
      guardedIds.add(store.state.lastGuardTarget);
    }

    const { newInfections, tagRewards } = resolveInfection(
      store.state.nightRound.pairings,
      guardedIds
    );

    store.state.nightRound.newInfections.push(...newInfections);

    // 发送标签奖励
    for (const [pid, tags] of Object.entries(tagRewards)) {
      if (tags.length > 0) {
        this._addMessage(pid, 'dating_reward',
          `🌹 约会收获：你获得了对方的标签「${tags.join('」「')}」`
        );
      }
    }
  }

  _handleExplosionResolve() {
    const { exploded, deaths } = resolveBaoZhaLing(store.state.nightRound.pairings);
    if (exploded) {
      store.state.nightRound.deaths.push(...deaths);
      store.addLog('explosion', `爆炸0 引爆，波及 ${deaths.length} 人`);
    }
  }

  _handleDeathResolve() {
    const deaths = [...store.state.nightRound.deaths];
    const guardedId = store.state.lastGuardTarget;

    // HIV携带者杀人
    const hivTarget = store.state.nightRound._hivKillTarget;
    if (hivTarget && !store.state.nightRound._hivBlocked && hivTarget !== guardedId) {
      deaths.push(hivTarget);
    }

    // 缚绳师杀人
    const fuTarget = store.state.nightRound._fuShengShiKillTarget;
    if (fuTarget && fuTarget !== guardedId) {
      deaths.push(fuTarget);
    }

    // 狗子心碎
    const gouZiDeaths = checkGouZiHeartbreak(deaths);
    deaths.push(...gouZiDeaths);

    // 去重并执行死亡
    const uniqueDeaths = [...new Set(deaths)];
    for (const pid of uniqueDeaths) {
      const p = store.getPlayer(pid);
      if (p) p.alive = false;
    }

    store.updateNested('nightRound.deaths', uniqueDeaths);
    store.addLog('deaths', `本夜死亡: ${uniqueDeaths.map(id => store.getPlayer(id)?.name).join(', ') || '无'}`);
  }

  // ============ 结束夜晚 ============

  _endNight() {
    // 发送所有私密消息
    const messages = store.state.nightRound.messages;
    for (const [pid, msgs] of Object.entries(messages)) {
      this.sendPrivate(pid, 'night_results', { messages: msgs });
    }

    // 检查胜利条件
    const win = store.checkWinCondition();
    if (win) {
      store.update({ phase: PHASE.END, winner: win.winner, winReason: win.reason });
      this.broadcast('game_over', win);
      return;
    }

    // 进入白天
    const deaths = store.state.nightRound.deaths;
    const newInfections = store.state.nightRound.newInfections;

    store.update({
      phase: PHASE.DAY,
      dayState: {
        announcements: [
          {
            type: 'death',
            text: deaths.length > 0
              ? `☠️ 昨夜死亡: ${deaths.map(id => store.getPlayer(id)?.name).join(', ')}`
              : '🌅 昨夜平安无事',
          },
          {
            type: 'infection',
            text: newInfections.length > 0
              ? `🦠 昨夜有 ${newInfections.length} 人新增感染`
              : null,
          },
        ].filter(a => a.text),
        nominations: [],
        currentVote: null,
        executed: null,
        cuKouUsed: store.state.dayState?.cuKouUsed || false,
        zuoJingUsed: store.state.dayState?.zuoJingUsed || false,
      },
    });

    this.broadcast('phase_change', {
      phase: PHASE.DAY,
      dayNumber: store.state.dayNumber,
      announcements: store.state.dayState.announcements,
    });
  }

  // ============ 工具方法 ============

  _addMessage(playerId, type, text) {
    if (!store.state.nightRound.messages[playerId]) {
      store.state.nightRound.messages[playerId] = [];
    }
    store.state.nightRound.messages[playerId].push({ type, text });
  }

  _isCorruptedByZaoYaoJing(playerId) {
    const target = store.state.nightRound._zaoYaoJingTarget;
    if (!target) return false;
    return target === playerId && INFO_ROLES.includes(store.getPlayer(playerId)?.roleId);
  }

  _getNeighbors(playerId) {
    const players = store.state.players;
    const alive = players.filter(p => p.alive);
    const idx = alive.findIndex(p => p.id === playerId);
    if (idx === -1) return [];
    const prev = alive[(idx - 1 + alive.length) % alive.length];
    const next = alive[(idx + 1) % alive.length];
    return [prev.id, next.id].filter(id => id !== playerId);
  }
}
