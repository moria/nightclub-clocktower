#!/usr/bin/env node
// 夜店钟楼 - 平衡性模拟测试脚本
// 用法: node tools/balance-sim.js [玩家数] [模拟局数] [约会策略]
// 例:   node tools/balance-sim.js 8 100 random

// ============ 内联角色数据（避免 ESM import 问题） ============

const FACTION = { PURE: 'pure', SIMP: 'simp', TEAIST: 'teaist', SCUM: 'scum' };

const ROLES = {
  jian_biao_shi: { id: 'jian_biao_shi', faction: FACTION.PURE, nightOrder: 7, isInfo: true },
  xiao_hu_shi:   { id: 'xiao_hu_shi', faction: FACTION.PURE, nightOrder: 8, isInfo: true },
  ji_rou_meng:   { id: 'ji_rou_meng', faction: FACTION.PURE, nightOrder: 4, isGuard: true },
  mu_la_la:      { id: 'mu_la_la', faction: FACTION.PURE, nightOrder: 12, isInfo: true },
  hua_fang_gu_niang: { id: 'hua_fang_gu_niang', faction: FACTION.PURE, nightOrder: 13, isInfo: true },
  hou_zi:        { id: 'hou_zi', faction: FACTION.PURE, nightOrder: 14, isInfo: true },
  cai_zhuang_mu: { id: 'cai_zhuang_mu', faction: FACTION.PURE, nightOrder: 1 },
  cu_kou:        { id: 'cu_kou', faction: FACTION.PURE, nightOrder: -1 },
  gang_tie_zhi_nan: { id: 'gang_tie_zhi_nan', faction: FACTION.PURE, nightOrder: 10 },
  xiao_san:      { id: 'xiao_san', faction: FACTION.PURE, nightOrder: 11, isInfo: true },
  bao_zha_ling:  { id: 'bao_zha_ling', faction: FACTION.PURE, nightOrder: 16 },
  side:          { id: 'side', faction: FACTION.SIMP },
  gai_zhuang_che:{ id: 'gai_zhuang_che', faction: FACTION.SIMP },
  gou_zi:        { id: 'gou_zi', faction: FACTION.SIMP },
  ji_nv:         { id: 'ji_nv', faction: FACTION.SIMP },
  zao_yao_jing:  { id: 'zao_yao_jing', faction: FACTION.TEAIST, nightOrder: 3 },
  miao_nan:      { id: 'miao_nan', faction: FACTION.TEAIST, nightOrder: 6 },
  zuo_jing:      { id: 'zuo_jing', faction: FACTION.TEAIST, nightOrder: -1 },
  hiv:           { id: 'hiv', faction: FACTION.SCUM, nightOrder: 5, isKiller: true },
  fu_sheng_shi:  { id: 'fu_sheng_shi', faction: FACTION.SCUM, nightOrder: 5, isKiller: true },
};

// v4: 最终调参 — 均衡各段
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
  pure: ['jian_biao_shi', 'xiao_hu_shi', 'ji_rou_meng', 'mu_la_la', 'hou_zi',
         'hua_fang_gu_niang', 'cai_zhuang_mu', 'cu_kou', 'gang_tie_zhi_nan', 'xiao_san', 'bao_zha_ling'],
};

// ============ 工具 ============
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const getSide = (roleId) => {
  const f = ROLES[roleId]?.faction;
  return (f === 'pure' || f === 'simp') ? 'good' : 'evil';
};

// ============ 角色分配 ============
function assignRoles(count) {
  const cfg = PLAYER_CONFIG[count];
  const selected = [];
  for (const faction of ['scum', 'teaist', 'simp', 'pure']) {
    const need = cfg[faction];
    const pool = [...ROLE_POOL[faction]];
    if (faction === 'scum') {
      selected.push('hiv');
      pool.splice(pool.indexOf('hiv'), 1);
      for (let i = 1; i < need; i++) selected.push(pool.shift());
    } else {
      for (let i = 0; i < need && pool.length > 0; i++) selected.push(pool.shift());
    }
  }
  return shuffle(selected);
}

// ============ 模拟单局 ============
function simulateGame(playerCount, datingStrategy) {
  const roles = assignRoles(playerCount);
  const players = roles.map((roleId, i) => ({
    id: i,
    roleId,
    alive: true,
    infected: roleId === 'hiv',
    side: getSide(roleId),
  }));

  let round = 0;
  const maxRounds = 20;
  const stats = { rounds: 0, infectionCurve: [], deaths: [] };

  while (round < maxRounds) {
    round++;
    const alive = players.filter(p => p.alive);
    const aliveGood = alive.filter(p => p.side === 'good');
    const aliveEvil = alive.filter(p => p.side === 'evil');

    // === 夜晚：约会 ===
    const datingChoices = {};
    for (const p of alive) {
      const others = alive.filter(o => o.id !== p.id);
      if (others.length === 0) continue;

      switch (datingStrategy) {
        case 'aggressive':
          datingChoices[p.id] = pick(others).id;
          break;
        case 'conservative':
          datingChoices[p.id] = Math.random() < 0.3 ? pick(others).id : 'none';
          break;
        case 'random':
        default:
          datingChoices[p.id] = Math.random() < 0.5 ? pick(others).id : 'none';
      }
    }

    // 配对结算
    const pairings = [];
    const paired = new Set();
    for (const p of alive) {
      if (paired.has(p.id)) continue;
      const myChoice = datingChoices[p.id];
      if (!myChoice || myChoice === 'none') continue;

      // Side 特殊
      if (p.roleId === 'side') {
        pairings.push([p.id, myChoice]);
        paired.add(p.id);
        continue;
      }

      if (datingChoices[myChoice] === p.id && !paired.has(myChoice)) {
        pairings.push([p.id, myChoice]);
        paired.add(p.id);
        paired.add(myChoice);
      }
    }

    // 感染传播
    for (const [a, b] of pairings) {
      const pa = players[a], pb = players[b];
      // 肌肉猛1守护（随机守护一个好人）
      const guard = alive.find(p => p.roleId === 'ji_rou_meng');
      const guardTarget = guard ? pick(aliveGood.filter(g => g.id !== guard.id))?.id : null;

      if (pa.infected && !pb.infected && pb.id !== guardTarget) pb.infected = true;
      if (pb.infected && !pa.infected && pa.id !== guardTarget) pa.infected = true;
    }

    // 秒男感染
    const miaoNan = alive.find(p => p.roleId === 'miao_nan');
    if (miaoNan) {
      const target = pick(aliveGood.filter(p => !p.infected));
      if (target) target.infected = true;
    }

    // === 夜晚：杀人 ===
    const hiv = alive.find(p => p.roleId === 'hiv');
    const fuSheng = alive.find(p => p.roleId === 'fu_sheng_shi');
    const guard = alive.find(p => p.roleId === 'ji_rou_meng');
    const guardTarget = guard ? pick(aliveGood.filter(g => g.id !== guard.id))?.id : null;

    // 妓女阻挡
    let hivBlocked = false;
    const jiNv = alive.find(p => p.roleId === 'ji_nv');
    if (jiNv && hiv) {
      for (const [a, b] of pairings) {
        if ((a === jiNv.id && b === hiv.id) || (b === jiNv.id && a === hiv.id)) {
          hivBlocked = true;
          jiNv.infected = true;
          break;
        }
      }
    }

    const nightDeaths = [];
    if (hiv && !hivBlocked) {
      const target = pick(aliveGood);
      if (target && target.id !== guardTarget) {
        target.alive = false;
        nightDeaths.push(target.id);
      }
    }

    // 缚绳师（隔夜杀，简化为50%概率出手）
    if (fuSheng && Math.random() < 0.5) {
      const target = pick(aliveGood.filter(p => p.alive));
      if (target && target.id !== guardTarget && !nightDeaths.includes(target.id)) {
        target.alive = false;
        nightDeaths.push(target.id);
      }
    }

    // 爆炸0
    const baoZha = alive.find(p => p.roleId === 'bao_zha_ling' && p.infected);
    if (baoZha) {
      baoZha.alive = false;
      nightDeaths.push(baoZha.id);
      for (const [a, b] of pairings) {
        if (a === baoZha.id) { players[b].alive = false; nightDeaths.push(b); }
        if (b === baoZha.id) { players[a].alive = false; nightDeaths.push(a); }
      }
    }

    // 记录感染曲线
    const infectedGoodCount = players.filter(p => p.alive && p.side === 'good' && p.infected).length;
    stats.infectionCurve.push(infectedGoodCount);
    stats.deaths.push(nightDeaths.length);

    // 检查恶方减员胜利
    const currentAliveGood = players.filter(p => p.alive && p.side === 'good');
    if (currentAliveGood.length <= 2) {
      stats.rounds = round;
      return { winner: 'evil', reason: 'reduction', stats };
    }

    // === 白天：投票（简化模型） ===
    // 好人有一定概率投对恶人
    const currentAlive = players.filter(p => p.alive);
    const currentEvil = currentAlive.filter(p => p.side === 'evil');

    // 信息角色越多，命中率越高
    const infoCount = currentAlive.filter(p => ROLES[p.roleId]?.isInfo && p.side === 'good').length;
    // v2: 提升基础命中率（真实游戏中讨论+推理效果更强）
    const baseAccuracy = 0.3 + infoCount * 0.1 + round * 0.03; // 随轮数积累信息
    const accuracy = Math.min(baseAccuracy, 0.75);

    let executed = null;
    if (Math.random() < accuracy && currentEvil.length > 0) {
      // 投中恶人
      executed = pick(currentEvil);
    } else if (Math.random() < 0.3) {
      // 误投好人
      executed = pick(currentAliveGood.filter(p => p.alive));
    }
    // 否则无人被处决

    if (executed) {
      executed.alive = false;

      // 缚绳师升级
      if (executed.roleId === 'hiv') {
        // 检查感染否决
        const finalAliveGood = players.filter(p => p.alive && p.side === 'good');
        const finalInfected = finalAliveGood.filter(p => p.infected).length;
        if (finalInfected >= Math.ceil(finalAliveGood.length / 2)) {
          stats.rounds = round;
          return { winner: 'evil', reason: 'infection', stats };
        }
      }

      // 检查所有渣王死亡
      const aliveScum = players.filter(p => p.alive && ROLES[p.roleId]?.faction === 'scum');
      if (aliveScum.length === 0) {
        const finalAliveGood = players.filter(p => p.alive && p.side === 'good');
        const finalInfected = finalAliveGood.filter(p => p.infected).length;
        if (finalInfected >= Math.ceil(finalAliveGood.length / 2)) {
          stats.rounds = round;
          return { winner: 'evil', reason: 'infection', stats };
        }
        stats.rounds = round;
        return { winner: 'good', reason: 'execution', stats };
      }
    }
  }

  stats.rounds = round;
  return { winner: 'draw', reason: 'timeout', stats };
}

// ============ 批量模拟 ============
function runSimulation(playerCount, numGames, datingStrategy) {
  const results = { good: 0, evil: 0, draw: 0 };
  const evilReasons = { reduction: 0, infection: 0 };
  let totalRounds = 0;
  const infectionCurves = [];

  for (let i = 0; i < numGames; i++) {
    const result = simulateGame(playerCount, datingStrategy);
    results[result.winner]++;
    totalRounds += result.stats.rounds;
    infectionCurves.push(result.stats.infectionCurve);

    if (result.winner === 'evil') {
      evilReasons[result.reason] = (evilReasons[result.reason] || 0) + 1;
    }
  }

  // 平均感染曲线
  const maxLen = Math.max(...infectionCurves.map(c => c.length));
  const avgCurve = [];
  for (let i = 0; i < maxLen; i++) {
    const vals = infectionCurves.filter(c => c[i] !== undefined).map(c => c[i]);
    avgCurve.push(vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 0);
  }

  return {
    playerCount,
    numGames,
    datingStrategy,
    goodWinRate: ((results.good / numGames) * 100).toFixed(1) + '%',
    evilWinRate: ((results.evil / numGames) * 100).toFixed(1) + '%',
    drawRate: ((results.draw / numGames) * 100).toFixed(1) + '%',
    evilReasons,
    avgRounds: (totalRounds / numGames).toFixed(1),
    avgInfectionCurve: avgCurve,
  };
}

// ============ CLI 入口 ============
const args = process.argv.slice(2);
const playerCount = parseInt(args[0]) || 8;
const numGames = parseInt(args[1]) || 100;
const strategy = args[2] || 'random';

console.log(`\n🎲 夜店钟楼 平衡性模拟`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`玩家数: ${playerCount}  |  模拟局数: ${numGames}  |  约会策略: ${strategy}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

// 单策略
const result = runSimulation(playerCount, numGames, strategy);
console.log(`📊 结果:`);
console.log(`  好人胜率: ${result.goodWinRate}`);
console.log(`  恶方胜率: ${result.evilWinRate}`);
console.log(`  平局率:   ${result.drawRate}`);
console.log(`  平均轮数: ${result.avgRounds}`);
console.log(`  恶方胜因: 减员=${result.evilReasons.reduction || 0}  感染=${result.evilReasons.infection || 0}`);
console.log(`  感染曲线(平均每轮好人感染数): [${result.avgInfectionCurve.join(', ')}]`);

// 三种策略对比
console.log(`\n📈 三种约会策略对比 (${playerCount}人):`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
for (const s of ['conservative', 'random', 'aggressive']) {
  const r = runSimulation(playerCount, numGames, s);
  const bar = (pct) => {
    const n = Math.round(parseFloat(pct) / 2);
    return '█'.repeat(n) + '░'.repeat(50 - n);
  };
  console.log(`  ${s.padEnd(14)} 好人 ${r.goodWinRate.padStart(6)} ${bar(r.goodWinRate)}`);
  console.log(`  ${''.padEnd(14)} 恶方 ${r.evilWinRate.padStart(6)} (减员:${r.evilReasons.reduction} 感染:${r.evilReasons.infection})`);
  console.log(`  ${''.padEnd(14)} 轮数 ${r.avgRounds} | 感染曲线 [${r.avgInfectionCurve.slice(0, 5).join(',')}...]`);
  console.log();
}

// 不同人数对比
console.log(`\n📊 不同人数胜率对比 (${strategy}策略):`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  人数  | 好人胜率 | 恶方胜率 | 平均轮数 | 恶方胜因(减/染)`);
console.log(`  ------+----------+----------+----------+----------------`);
for (const n of [5, 7, 8, 10, 12, 15]) {
  const r = runSimulation(n, numGames, strategy);
  console.log(`  ${String(n).padStart(4)}  | ${r.goodWinRate.padStart(8)} | ${r.evilWinRate.padStart(8)} | ${r.avgRounds.padStart(8)} | ${r.evilReasons.reduction || 0}/${r.evilReasons.infection || 0}`);
}

console.log(`\n✅ 平衡性目标: 好人胜率 45-55%`);
console.log(`⚠️  偏离较大的人数段可能需要调参\n`);
