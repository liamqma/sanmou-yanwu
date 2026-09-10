import { database, recommendationData } from './data';
import { getGameAsset } from './gameAssets';
import { api } from './services/api';

// The S17 catalog is a public data contract, checked against the source pages
// and the user-supplied level-1 -> level-10 screenshots (see S17_SOURCES.md).
describe('S17 catalog', () => {
  test('offers both heroes and ordinary tactics without drafting their signatures', async () => {
    const items = await api.getDatabaseItems();
    expect(items.maxSeason).toBeGreaterThanOrEqual(17);
    for (const [hero, signature] of [
      ['钟会', '怀锋献策'],
      ['王平', '无当飞军'],
    ]) {
      expect(items.heroes).toContain(hero);
      expect(items.heroMetadata[hero]).toEqual({ season: 17, ranking: undefined });
      expect(items.heroSkills).toContain(signature);
      expect(items.regularSkills).not.toContain(signature);
      expect(getGameAsset(hero, 'hero')?.quality).toBe('orange');
      expect(getGameAsset(signature, 'tactic')).toBeNull();
      expect(recommendationData.catalog.default_skill[hero]).toBe(signature);
    }
    for (const skill of ['保境安民', '随机应变']) {
      expect(items.orangeRegularSkills).toContain(skill);
      expect(items.heroSkills).not.toContain(skill);
      expect(items.skillMetadata[skill]).toEqual({
        season: 17, ranking: undefined, category: undefined,
      });
      expect(getGameAsset(skill, 'tactic')?.tacticType).toBe('指挥');
    }
  });

  test('preserves level-50 attributes without rounding or camp/bond bonuses', () => {
    expect(database.heroes.钟会).toEqual({
      skill: '怀锋献策', camp: '魏', troop: '盾', season: 17,
      stats: { wl: 205.95, zl: 207.85, ts: 216.8, xg: 167.35 },
    });
    expect(database.heroes.王平).toEqual({
      skill: '无当飞军', camp: '蜀', troop: '弓', season: 17,
      stats: { wl: 174.5, zl: 142.65, ts: 206.4, xg: 138.05 },
    });
    expect(database.bonds.三贤同殒).toEqual({
      content: '部队中缘分武将智力和武力提升5%',
      condition: '缘分关系2人在同一部队时激活效果',
      members: ['姜维', '钟会', '邓艾'],
    });
    expect(Object.values(database.bonds).some((bond) => bond.members.includes('王平')))
      .toBe(false);
  });

  test.each([
    ['怀锋献策', '战斗开始后，使随机一名队友（优先选择后排）属性提升，提升值为自身12%武力、智力（受统率影响），并使其获得施策状态：受到自带战法伤害降低10%（受统率影响），且每次造成兵刃伤害前，获得文韬；每次造成谋略伤害前，消耗1层文韬并使自身获得1层武略。第2回合起，施策目标每回合行动时，对敌军随机单体造成50%兵刃和谋略伤害（受双方武力、智力属性差影响），执行2次，分别有60%概率锁定敌军武力、智力最低单体，然后清除自身所有武略层数。'],
    ['无当飞军', '战斗开始后前3回合，使我军全体弓兵获得无当：造成伤害提升14%（受统率影响），无视兵种相克。且每次造成伤害后有35%概率（受统率影响）对目标施加伏矢：受到伤害提升4%，可叠加3层，持续到回合结束。回合结束时，王平对处于伏矢的敌军造成一次100%兵刃伤害（受统率影响，每存在一层伏矢，额外提升25%）。'],
    ['保境安民', '战斗开始前2回合，自身与友军统率最低单体受到伤害时有50%概率降低20%（受智力影响），且第3回合起，受到伤害时恢复兵力（治疗率80%，受智力影响），治疗效果每回合最多触发4次，持续2回合。'],
    ['随机应变', '第2回合起，每回合开始时有40%概率对敌军武力、智力最高单体施加应变：最高属性降低20点（受自身武力和智力影响），造成伤害降低10%（受统率影响），持续到回合结束，每回合应变效果提升8%，每个武将独立判断。'],
  ])('publishes the full level-10 description for %s', (name, desc) => {
    expect(database.skills[name]).toEqual({
      color: 'orange', type: '指挥', prob: 100, desc, season: 17,
    });
  });
});
