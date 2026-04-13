// 夜店钟楼 - 角色数据定义
// 20个角色 + 行为标签系统 + 阵营配比

// ============ 行为标签 ============
export const TAGS = {
  ATTACK: '攻击性',
  PROTECT: '保护性',
  SPY: '窥探性',
  SOCIAL: '社交性',
  INFECT: '传染性',
  STEALTH: '隐蔽性',
};

// ============ 阵营 ============
export const FACTION = {
  PURE: 'pure',       // 清流派（好人主力）
  SIMP: 'simp',       // 恋爱脑（好人累赘）
  TEAIST: 'teaist',   // 茶艺师（恶方辅助）
  SCUM: 'scum',       // 渣王（恶方核心）
};

export const FACTION_INFO = {
  [FACTION.PURE]:   { name: '清流派', side: 'good', color: '#00f0ff', emoji: '💧', desc: '好人主力，信息与保护' },
  [FACTION.SIMP]:   { name: '恋爱脑', side: 'good', color: '#ffcc00', emoji: '💛', desc: '好人累赘，被动混乱' },
  [FACTION.TEAIST]: { name: '茶艺师', side: 'evil', color: '#b44dff', emoji: '🍵', desc: '恶方辅助，干扰感染' },
  [FACTION.SCUM]:   { name: '渣王',   side: 'evil', color: '#ff2d7b', emoji: '👑', desc: '恶方核心，杀人感染' },
};

// ============ 夜晚行动阶段 ============
export const NIGHT_PHASE = {
  FIRST_NIGHT_ONLY: 'first_night_only',
  EVIL_REVEAL: 'evil_reveal',
  ACTIVE: 'active',        // 需要玩家操作
  PASSIVE: 'passive',      // 系统自动结算
  DAYTIME: 'daytime',      // 白天发动
  ALWAYS_PASSIVE: 'always_passive', // 全程被动
};

// ============ 角色定义 ============
export const ROLES = {
  // -------- 清流派 (好人主力) --------
  jian_biao_shi: {
    id: 'jian_biao_shi',
    name: '鉴婊师',
    emoji: '🔍',
    faction: FACTION.PURE,
    tags: [TAGS.SPY, TAGS.SOCIAL],
    nightPhase: NIGHT_PHASE.ACTIVE,
    nightOrder: 7,
    desc: '每晚翻一个人的手机相册',
    skill: '每夜选择1名玩家，查验其行为标签池（获得该角色的2个标签）。',
    mechanic: 'select_one',
    flavorText: '你翻了他的手机相册，看到了以下内容……',
  },

  xiao_hu_shi: {
    id: 'xiao_hu_shi',
    name: '小护士',
    emoji: '💉',
    faction: FACTION.PURE,
    tags: [TAGS.PROTECT, TAGS.SPY],
    nightPhase: NIGHT_PHASE.ACTIVE,
    nightOrder: 8,
    desc: '每晚偷偷给一个人做检测',
    skill: '每夜选择1名玩家，查验其是否处于感染状态。返回"阳性"或"阴性"。',
    mechanic: 'select_one',
    flavorText: '你偷偷给他做了检测，报告出来了——',
  },

  ji_rou_meng: {
    id: 'ji_rou_meng',
    name: '肌肉猛1',
    emoji: '💪',
    faction: FACTION.PURE,
    tags: [TAGS.PROTECT, TAGS.ATTACK],
    nightPhase: NIGHT_PHASE.ACTIVE,
    nightOrder: 4,
    desc: '每晚贴身保护一个人',
    skill: '每夜选择1名玩家守护。被守护者当夜免疫杀害和配对感染。不能守自己，不能连续两夜守同一人。不挡造谣精。',
    mechanic: 'select_one_not_self_not_repeat',
    flavorText: '你今晚贴身保护了他，寸步不离，别人都在传你俩的八卦。',
  },

  mu_la_la: {
    id: 'mu_la_la',
    name: '母拉拉',
    emoji: '👩‍❤️‍👩',
    faction: FACTION.PURE,
    tags: [TAGS.SOCIAL, TAGS.SPY],
    nightPhase: NIGHT_PHASE.ACTIVE,
    nightOrder: 12,
    desc: '同时撩两个人试探阵营',
    skill: '每夜选择2名玩家，系统告知其中是否至少有1人属于恶方阵营。',
    mechanic: 'select_two',
    flavorText: '你在群聊里同时撩了这两个人，根据他们的反应你判断……',
  },

  hua_fang_gu_niang: {
    id: 'hua_fang_gu_niang',
    name: '花房姑娘',
    emoji: '🌸',
    faction: FACTION.PURE,
    tags: [TAGS.SPY, TAGS.SOCIAL],
    nightPhase: NIGHT_PHASE.ACTIVE,
    nightOrder: 13,
    desc: '打听一片人的健康状况',
    skill: '每夜选1人，得知该玩家及其左右邻座共3人中：感染者数量(0-3)，以及是否有"传染性"或"攻击性"标签。',
    mechanic: 'select_one',
    flavorText: '你假装不经意地问了他和他朋友们最近的"健康状况"……',
  },

  hou_zi: {
    id: 'hou_zi',
    name: '猴子',
    emoji: '🐒',
    faction: FACTION.PURE,
    tags: [TAGS.SPY, TAGS.SOCIAL],
    nightPhase: NIGHT_PHASE.ACTIVE,
    nightOrder: 14,
    desc: '蹲在别人楼下偷窥',
    skill: '每夜选1人，得知其当夜是否发起了约会邀请、是否配对成功。不告知对象。',
    mechanic: 'select_one',
    flavorText: '你蹲在他家楼下看他今晚有没有人来……',
  },

  cai_zhuang_mu: {
    id: 'cai_zhuang_mu',
    name: '彩妆母1',
    emoji: '💄',
    faction: FACTION.PURE,
    tags: [TAGS.SOCIAL, TAGS.SPY],
    nightPhase: NIGHT_PHASE.FIRST_NIGHT_ONLY,
    nightOrder: 1,
    desc: '首夜在化妆间偷听到八卦',
    skill: '仅首夜被唤醒，获知所有恶方角色的标签池中随机抽取的2个标签。',
    mechanic: 'passive_first_night',
    flavorText: '你在化妆间听到了一些不该听的八卦……',
  },

  cu_kou: {
    id: 'cu_kou',
    name: '粗口1s',
    emoji: '🤬',
    faction: FACTION.PURE,
    tags: [TAGS.ATTACK, TAGS.SOCIAL],
    nightPhase: NIGHT_PHASE.DAYTIME,
    nightOrder: -1,
    desc: '当众骂人逼对方自爆',
    skill: '白天每局限用1次"开撕"：强制指定1名玩家立即公开其1个行为标签。',
    mechanic: 'daytime_once',
    flavorText: '你当众骂了他一顿，逼得他不得不自爆了一些信息。',
  },

  gang_tie_zhi_nan: {
    id: 'gang_tie_zhi_nan',
    name: '钢铁直男',
    emoji: '🏋️',
    faction: FACTION.PURE,
    tags: [TAGS.PROTECT, TAGS.SOCIAL],
    nightPhase: NIGHT_PHASE.ACTIVE,
    nightOrder: 10,
    desc: '都不想约反而产生了化学反应',
    skill: '约会规则反转：双方都选"不约"时配对成功。获取标签且零感染风险。',
    mechanic: 'passive_dating_override',
    flavorText: '你俩都说不约，结果产生了奇妙的化学反应。',
  },

  xiao_san: {
    id: 'xiao_san',
    name: '小三',
    emoji: '💔',
    faction: FACTION.PURE,
    tags: [TAGS.SOCIAL, TAGS.SPY],
    nightPhase: NIGHT_PHASE.ACTIVE,
    nightOrder: 11,
    desc: '偷看别人聊天记录',
    skill: '每夜选1人，得知其当夜与谁配对成功（若有）。',
    mechanic: 'select_one',
    flavorText: '你偷看了他的聊天记录，发现他今晚另有安排……',
  },

  bao_zha_ling: {
    id: 'bao_zha_ling',
    name: '爆炸0',
    emoji: '🔥',
    faction: FACTION.PURE,
    tags: [TAGS.ATTACK, TAGS.SOCIAL],
    nightPhase: NIGHT_PHASE.PASSIVE,
    nightOrder: 16,
    desc: '感染了就爆炸，波及配对者',
    skill: '被动结算：若本夜处于感染状态，爆炸0死亡，且当夜与其配对成功的玩家也死亡。',
    mechanic: 'passive_explode',
    flavorText: '他今晚状态不对，跟他有关系的人全遭殃了。',
  },

  // -------- 恋爱脑 (好人累赘) --------
  side: {
    id: 'side',
    name: 'Side',
    emoji: '🔄',
    faction: FACTION.SIMP,
    tags: [TAGS.SOCIAL, TAGS.STEALTH],
    nightPhase: NIGHT_PHASE.ALWAYS_PASSIVE,
    nightOrder: -1,
    desc: '暗中勾搭，约会永不失败',
    skill: '约会单向成功：即使对方没选你，你也算配对成功并获取对方标签。但对方不知情。若你被感染，单向配对也会感染对方（超级传播者）。',
    mechanic: 'passive_dating_override',
    flavorText: '有人在不知情的情况下被感染了……',
  },

  gai_zhuang_che: {
    id: 'gai_zhuang_che',
    name: '改装车',
    emoji: '🚗',
    faction: FACTION.SIMP,
    tags: [TAGS.ATTACK, TAGS.STEALTH],
    nightPhase: NIGHT_PHASE.ALWAYS_PASSIVE,
    nightOrder: -1,
    desc: '资料全是P的，标签全假',
    skill: '被查验或配对时，行为标签显示为随机虚假标签。自己获取的信息正常。',
    mechanic: 'passive_fake_tags',
    flavorText: '他的资料全是P的，见面完全不是那回事。',
  },

  gou_zi: {
    id: 'gou_zi',
    name: '狗子',
    emoji: '🐕',
    faction: FACTION.SIMP,
    tags: [TAGS.SOCIAL, TAGS.PROTECT],
    nightPhase: NIGHT_PHASE.ALWAYS_PASSIVE,
    nightOrder: -1,
    desc: '配对一次就永远粘着你',
    skill: '首次配对成功后永久绑定该玩家。此后每夜自动约会绑定对象（单方面忠诚算成功）。绑定对象死亡→下一夜狗子也死。绑定对象存活时狗子免疫感染。',
    mechanic: 'passive_bind',
    flavorText: '他跟你约了一次之后天天粘着你，你的消息列表被他占满了。',
  },

  ji_nv: {
    id: 'ji_nv',
    name: '妓女',
    emoji: '💃',
    faction: FACTION.SIMP,
    tags: [TAGS.SOCIAL, TAGS.INFECT],
    nightPhase: NIGHT_PHASE.ALWAYS_PASSIVE,
    nightOrder: -1,
    desc: '用身体挡住渣王的伤害',
    skill: '若与HIV携带者配对成功，渣王当夜杀人技能失效。但妓女自己被感染。',
    mechanic: 'passive_block_scum',
    flavorText: '你用自己的身体挡住了渣王今晚的伤害，但代价是……',
  },

  // -------- 茶艺师 (恶方辅助) --------
  zao_yao_jing: {
    id: 'zao_yao_jing',
    name: '造谣精',
    emoji: '📰',
    faction: FACTION.TEAIST,
    tags: [TAGS.SOCIAL, TAGS.STEALTH],
    nightPhase: NIGHT_PHASE.ACTIVE,
    nightOrder: 3,
    desc: '往群里丢P图，有人信了',
    skill: '每夜选1名玩家。若该玩家是信息角色（鉴婊师/小护士/母拉拉/花房姑娘/猴子/小三），其当夜获得的信息被篡改为错误信息。选中非信息角色则技能浪费。',
    mechanic: 'select_one',
    flavorText: '你往群里丢了一张P过的截图，有人信了。',
  },

  miao_nan: {
    id: 'miao_nan',
    name: '秒男',
    emoji: '⚡',
    faction: FACTION.TEAIST,
    tags: [TAGS.ATTACK, TAGS.INFECT],
    nightPhase: NIGHT_PHASE.ACTIVE,
    nightOrder: 6,
    desc: '碰一下就跑，留下感染',
    skill: '每夜选1名玩家打上感染标记。目标不收到通知，从此刻起处于感染状态。',
    mechanic: 'select_one',
    flavorText: '他碰了你一下就跑了，但你还不知道发生了什么。',
  },

  zuo_jing: {
    id: 'zuo_jing',
    name: '作精',
    emoji: '😭',
    faction: FACTION.TEAIST,
    tags: [TAGS.SOCIAL, TAGS.ATTACK],
    nightPhase: NIGHT_PHASE.DAYTIME,
    nightOrder: -1,
    desc: '大哭大闹取消投票',
    skill: '白天每局限用1次"闹分手"：取消当天的处决投票，直接跳过进入下一个夜晚。',
    mechanic: 'daytime_once',
    flavorText: '他当场大哭大闹，搞得所有人都没心情投票了。',
  },

  // -------- 渣王 (恶方核心) --------
  hiv: {
    id: 'hiv',
    name: 'HIV携带者',
    emoji: '☠️',
    faction: FACTION.SCUM,
    tags: [TAGS.ATTACK, TAGS.INFECT],
    nightPhase: NIGHT_PHASE.ACTIVE,
    nightOrder: 5,
    desc: '每晚杀一人，约会即传播',
    skill: '每夜选1人杀害。自身永久携带感染状态，任何与其配对成功的人都会被感染。若被妓女配对成功，当夜杀人失效。',
    mechanic: 'select_one_kill',
    isInfected: true,
    flavorText: '他看起来人畜无害，但每个跟他有过关系的人都出了问题。',
  },

  fu_sheng_shi: {
    id: 'fu_sheng_shi',
    name: '缚绳师',
    emoji: '⛓️',
    faction: FACTION.SCUM,
    tags: [TAGS.ATTACK, TAGS.STEALTH],
    nightPhase: NIGHT_PHASE.ACTIVE,
    nightOrder: 5,
    desc: '第二杀手，HIV死后升级',
    skill: '每隔一夜可选择杀害1人（冷却1夜）。HIV携带者死后升级为核心杀手（无冷却，但不获得感染传播能力）。',
    mechanic: 'select_one_kill_cooldown',
    flavorText: '他的爱好比较特殊，被他选中的人第二天就消失了。',
  },
};

// ============ 信息角色列表（可被造谣精干扰） ============
export const INFO_ROLES = [
  'jian_biao_shi', 'xiao_hu_shi', 'mu_la_la',
  'hua_fang_gu_niang', 'hou_zi', 'xiao_san',
];

// ============ 人数配置表 ============
// 经平衡性模拟调参后的最终配置
export const PLAYER_CONFIG = {
  5:  { [FACTION.PURE]: 3, [FACTION.SIMP]: 0, [FACTION.TEAIST]: 1, [FACTION.SCUM]: 1 },
  6:  { [FACTION.PURE]: 3, [FACTION.SIMP]: 1, [FACTION.TEAIST]: 1, [FACTION.SCUM]: 1 },
  7:  { [FACTION.PURE]: 4, [FACTION.SIMP]: 1, [FACTION.TEAIST]: 1, [FACTION.SCUM]: 1 },
  8:  { [FACTION.PURE]: 5, [FACTION.SIMP]: 1, [FACTION.TEAIST]: 1, [FACTION.SCUM]: 1 },
  9:  { [FACTION.PURE]: 5, [FACTION.SIMP]: 1, [FACTION.TEAIST]: 2, [FACTION.SCUM]: 1 },
  10: { [FACTION.PURE]: 5, [FACTION.SIMP]: 2, [FACTION.TEAIST]: 1, [FACTION.SCUM]: 2 },
  11: { [FACTION.PURE]: 6, [FACTION.SIMP]: 2, [FACTION.TEAIST]: 1, [FACTION.SCUM]: 2 },
  12: { [FACTION.PURE]: 6, [FACTION.SIMP]: 2, [FACTION.TEAIST]: 2, [FACTION.SCUM]: 2 },
  13: { [FACTION.PURE]: 7, [FACTION.SIMP]: 2, [FACTION.TEAIST]: 2, [FACTION.SCUM]: 2 },
  14: { [FACTION.PURE]: 7, [FACTION.SIMP]: 3, [FACTION.TEAIST]: 2, [FACTION.SCUM]: 2 },
  15: { [FACTION.PURE]: 8, [FACTION.SIMP]: 3, [FACTION.TEAIST]: 2, [FACTION.SCUM]: 2 },
};

// ============ 角色优先级池（按阵营分组，优先级越高越早被选入） ============
export const ROLE_POOL = {
  [FACTION.SCUM]: ['hiv', 'fu_sheng_shi'],
  [FACTION.TEAIST]: ['zao_yao_jing', 'miao_nan', 'zuo_jing'],
  [FACTION.SIMP]: ['ji_nv', 'gai_zhuang_che', 'gou_zi', 'side'],
  [FACTION.PURE]: [
    // 核心信息角色优先
    'jian_biao_shi', 'xiao_hu_shi', 'ji_rou_meng',
    // 范围信息
    'mu_la_la', 'hou_zi', 'hua_fang_gu_niang',
    // 首夜/白天/特殊
    'cai_zhuang_mu', 'cu_kou', 'gang_tie_zhi_nan', 'xiao_san', 'bao_zha_ling',
  ],
};

// ============ 夜晚行动顺序（nightOrder排序） ============
export const NIGHT_ORDER = Object.values(ROLES)
  .filter(r => r.nightOrder > 0)
  .sort((a, b) => a.nightOrder - b.nightOrder)
  .map(r => r.id);

// ============ 工具函数 ============

/** 根据人数分配角色 */
export function assignRoles(playerCount) {
  const config = PLAYER_CONFIG[playerCount];
  if (!config) throw new Error(`不支持 ${playerCount} 人游戏`);

  const selected = [];

  for (const faction of [FACTION.SCUM, FACTION.TEAIST, FACTION.SIMP, FACTION.PURE]) {
    const needed = config[faction];
    const pool = [...ROLE_POOL[faction]];
    // HIV携带者必须存在
    if (faction === FACTION.SCUM) {
      selected.push('hiv');
      pool.splice(pool.indexOf('hiv'), 1);
      for (let i = 1; i < needed; i++) {
        selected.push(pool.shift());
      }
    } else {
      for (let i = 0; i < needed && pool.length > 0; i++) {
        selected.push(pool.shift());
      }
    }
  }

  // Fisher-Yates 洗牌
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }

  return selected;
}

/** 获取角色的阵营阵营 */
export function getSide(roleId) {
  const role = ROLES[roleId];
  return FACTION_INFO[role.faction].side;
}

/** 获取随机假标签（用于改装车） */
export function getFakeTags() {
  const allTags = Object.values(TAGS);
  const shuffled = allTags.sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}
