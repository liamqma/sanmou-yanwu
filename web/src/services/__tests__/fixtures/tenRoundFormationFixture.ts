/**
 * Representative completed round-10 pool: 14 normal heroes plus the optional
 * support hero, and 26 normal skills plus the two optional support skills.
 *
 * These are real catalog names so the benchmark exercises the generated model,
 * signature-skill exclusions, and soft camp/role metadata used in production.
 */
export const TEN_ROUND_HERO_POOL = [
  '刘备',
  '关羽',
  '张飞',
  '诸葛亮',
  '赵云',
  '马超',
  '曹操',
  '司马懿',
  '夏侯惇',
  '孙权',
  '周瑜',
  '陆逊',
  '吕布',
  '张辽',
  '貂蝉',
] as const;

export const TEN_ROUND_SKILL_POOL = [
  '乐不思蜀',
  '暗渡阴平',
  '恩威并行',
  '未雨绸缪',
  '诱敌深入',
  '风助火势',
  '瞋目横矛',
  '掠阵破军',
  '及锋而试',
  '调和阴阳',
  '蹈锋饮血',
  '践墨随敌',
  '机变无穷',
  '潜龙在渊',
  '御敌临前',
  '虎步连环',
  '神略制变',
  '惩前毖后',
  '万军辟易',
  '谋而后动',
  '黄天惑心',
  '断戈夺锋',
  '空城计',
  '步步为营',
  '智破千军',
  '挫锐折锋',
  '运智铺谋',
  '十面埋伏',
] as const;
