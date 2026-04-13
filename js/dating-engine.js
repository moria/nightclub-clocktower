// 夜店钟楼 - 约会配对 + 感染结算引擎

import { ROLES, TAGS, getFakeTags } from './roles.js';
import { store } from './game-state.js';

// ============ 配对结算 ============

/**
 * 根据所有玩家的约会选择，计算配对结果
 * @param {Object} datingChoices - { playerId: targetId | 'none' }
 * @returns {Array} pairings - [{ a, b, type, successful }]
 */
export function resolvePairings(datingChoices) {
  const players = store.state.players;
  const pairings = [];
  const processed = new Set();

  for (const player of players) {
    if (!player.alive || processed.has(player.id)) continue;

    const myChoice = datingChoices[player.id];
    const myRole = ROLES[player.roleId];

    if (!myChoice || myChoice === 'none') {
      // 钢铁直男特殊：双方都选"不约"时配对成功
      if (myRole.id === 'gang_tie_zhi_nan') {
        // 找所有也选了"不约"的存活玩家
        for (const other of players) {
          if (!other.alive || other.id === player.id || processed.has(other.id)) continue;
          const otherChoice = datingChoices[other.id];
          if (!otherChoice || otherChoice === 'none') {
            // 钢铁直男与一个随机"不约"的人配对（取第一个）
            pairings.push({
              a: player.id,
              b: other.id,
              type: 'straight_match',
              successful: true,
              noInfectionRisk: true,
            });
            processed.add(player.id);
            processed.add(other.id);
            break;
          }
        }
      }
      continue;
    }

    const targetId = myChoice;
    const targetChoice = datingChoices[targetId];

    // Side 特殊：单向成功
    if (myRole.id === 'side') {
      pairings.push({
        a: player.id,
        b: targetId,
        type: 'side_one_way',
        successful: true,
        sideOnly: true, // 对方不知道
      });
      processed.add(player.id);
      continue;
    }

    // 狗子绑定：绑定后自动配对
    const gouZiBound = store.state.gouZiBound;
    if (myRole.id === 'gou_zi' && gouZiBound[player.id]) {
      const boundTo = gouZiBound[player.id];
      pairings.push({
        a: player.id,
        b: boundTo,
        type: 'dog_bind',
        successful: true,
      });
      processed.add(player.id);
      continue;
    }

    // 普通双向匹配
    if (targetChoice === player.id && !processed.has(targetId)) {
      pairings.push({
        a: player.id,
        b: targetId,
        type: 'mutual',
        successful: true,
      });
      processed.add(player.id);
      processed.add(targetId);

      // 狗子首次配对→永久绑定
      if (myRole.id === 'gou_zi' && !gouZiBound[player.id]) {
        store.updateNested(`gouZiBound.${player.id}`, targetId);
      }
      const targetRole = ROLES[store.getPlayer(targetId)?.roleId];
      if (targetRole?.id === 'gou_zi' && !gouZiBound[targetId]) {
        store.updateNested(`gouZiBound.${targetId}`, player.id);
      }
    }
  }

  return pairings;
}

// ============ 感染结算 ============

/**
 * 根据配对结果进行感染传播
 * @param {Array} pairings
 * @param {Set} guardedPlayerIds - 被肌肉猛1守护的玩家
 * @returns {{ newInfections: string[], tagRewards: Object }}
 */
export function resolveInfection(pairings, guardedPlayerIds) {
  const newInfections = [];
  const tagRewards = {}; // { playerId: [tag1, tag2] }

  for (const pair of pairings) {
    if (!pair.successful) continue;

    const playerA = store.getPlayer(pair.a);
    const playerB = store.getPlayer(pair.b);
    if (!playerA || !playerB) continue;

    const roleA = ROLES[playerA.roleId];
    const roleB = ROLES[playerB.roleId];

    // 感染传播（除非零感染风险 或 被守护）
    if (!pair.noInfectionRisk) {
      const aInfected = playerA.infected;
      const bInfected = playerB.infected;

      if (aInfected && !bInfected && !guardedPlayerIds.has(pair.b)) {
        newInfections.push(pair.b);
      }
      if (bInfected && !aInfected && !guardedPlayerIds.has(pair.a)) {
        // side 单向配对：对方不知道，但感染照传
        newInfections.push(pair.a);
      }
    }

    // 行为标签奖励
    if (!pair.sideOnly || pair.type === 'side_one_way') {
      // A 获取 B 的标签
      const bTags = roleB.id === 'gai_zhuang_che' ? getFakeTags() : [...roleB.tags];
      const aReward = maybeCorrupt(playerA, bTags);
      tagRewards[pair.a] = tagRewards[pair.a] || [];
      tagRewards[pair.a].push(...aReward);
    }

    if (!pair.sideOnly) {
      // B 获取 A 的标签（side 单向配对时 B 不获取）
      const aTags = roleA.id === 'gai_zhuang_che' ? getFakeTags() : [...roleA.tags];
      const bReward = maybeCorrupt(playerB, aTags);
      tagRewards[pair.b] = tagRewards[pair.b] || [];
      tagRewards[pair.b].push(...bReward);
    }
  }

  // 应用感染
  for (const pid of newInfections) {
    const p = store.getPlayer(pid);
    if (p) p.infected = true;
  }

  return { newInfections, tagRewards };
}

/**
 * 感染者获得标签有30%概率篡改
 */
function maybeCorrupt(player, tags) {
  if (!player.infected) return tags;
  return tags.map(tag => {
    if (Math.random() < 0.3) {
      // 替换为随机其他标签
      const allTags = Object.values(TAGS).filter(t => t !== tag);
      return allTags[Math.floor(Math.random() * allTags.length)];
    }
    return tag;
  });
}

// ============ 妓女效果检查 ============

/**
 * 检查妓女是否与HIV携带者配对成功
 * @returns {{ hivBlocked: boolean, jiNvInfected: string|null }}
 */
export function checkJiNvEffect(pairings) {
  for (const pair of pairings) {
    if (!pair.successful) continue;
    const playerA = store.getPlayer(pair.a);
    const playerB = store.getPlayer(pair.b);
    if (!playerA || !playerB) continue;

    const roleA = ROLES[playerA.roleId];
    const roleB = ROLES[playerB.roleId];

    if (roleA.id === 'ji_nv' && roleB.id === 'hiv') {
      return { hivBlocked: true, jiNvInfected: pair.a };
    }
    if (roleB.id === 'ji_nv' && roleA.id === 'hiv') {
      return { hivBlocked: true, jiNvInfected: pair.b };
    }
  }
  return { hivBlocked: false, jiNvInfected: null };
}

// ============ 爆炸0结算 ============

/**
 * 检查爆炸0是否被感染，若是则爆炸
 * @returns {{ exploded: boolean, deaths: string[] }}
 */
export function resolveBaoZhaLing(pairings) {
  const deaths = [];

  for (const player of store.state.players) {
    if (!player.alive) continue;
    const role = ROLES[player.roleId];
    if (role.id !== 'bao_zha_ling') continue;

    if (player.infected) {
      deaths.push(player.id); // 爆炸0自己死

      // 当夜与其配对成功的人也死
      for (const pair of pairings) {
        if (!pair.successful) continue;
        if (pair.a === player.id) deaths.push(pair.b);
        if (pair.b === player.id) deaths.push(pair.a);
      }
    }
  }

  return { exploded: deaths.length > 0, deaths: [...new Set(deaths)] };
}

// ============ 狗子心碎检查 ============

/**
 * 检查绑定对象死亡后狗子是否心碎死亡
 * @param {string[]} deathIds - 本夜死亡的玩家ID
 * @returns {string[]} 额外死亡的狗子ID
 */
export function checkGouZiHeartbreak(deathIds) {
  const extraDeaths = [];
  const gouZiBound = store.state.gouZiBound;

  for (const [gouZiId, boundToId] of Object.entries(gouZiBound)) {
    if (deathIds.includes(boundToId)) {
      const gouZi = store.getPlayer(gouZiId);
      if (gouZi?.alive) {
        extraDeaths.push(gouZiId);
      }
    }
  }

  return extraDeaths;
}
