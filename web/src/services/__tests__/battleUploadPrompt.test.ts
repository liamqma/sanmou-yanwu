import { database } from '../../data';
import { buildDeepSeekBattlePrompt } from '../battleUploadPrompt';

describe('buildDeepSeekBattlePrompt', () => {
  test('describes orientation-safe exact positions, winner mapping and JSON-only output', () => {
    const prompt = buildDeepSeekBattlePrompt(database);

    expect(prompt).toContain('原生竖屏');
    expect(prompt).toContain('原生横屏');
    expect(prompt).toContain('2×3 个武将位置');
    expect(prompt).toContain('横向排列时从左到右');
    expect(prompt).toContain('纵向排列时从上到下');
    expect(prompt).toContain('竖屏参考样本为 1080×2340');
    expect(prompt).toContain('卡片中心横坐标约为 19%、50%、81%');
    expect(prompt).toContain('阵容 1 的三行战法纵坐标约为 27%、31%、35%');
    expect(prompt).toContain('阵容 2 约为 71%、75%、79%');
    expect(prompt).toContain('横屏参考样本为 2532×1170');
    expect(prompt).toContain('阵容 1 大约位于横坐标 11%～44%');
    expect(prompt).toContain('阵容 2 大约位于 59%～92%');
    expect(prompt).toContain('17%、28%、39%、64%、75%、86%');
    expect(prompt).toContain('起始横坐标约为 12%、23%、34%、59%、70%、81%');
    expect(prompt).toContain('画面高度 65%、74%、83%');
    expect(prompt).toContain('不能当成固定像素裁剪');
    expect(prompt).toContain('校正为文字正立的方向');
    expect(prompt).toContain('排除纯黑边、系统栏或其他留白');
    expect(prompt).toContain('校正后的游戏画面区域');
    expect(prompt).toContain('不能按原始位图的旋转方向颠倒槽位顺序');
    expect(prompt).toContain('先 OCR 第 1 个战法槽 skills[0]');
    expect(prompt).toContain('“武将 → 自带战法”目录中反查唯一对应的武将名');
    expect(prompt).toContain('画面上的武将名只用于二次确认');
    expect(prompt).toContain('显示“胜”时 winner 为 "1"');
    expect(prompt).toContain('显示“败”时 winner 为 "2"');
    expect(prompt).toContain('只输出 JSON 对象');
    expect(prompt).toContain('不要 Markdown 代码围栏');
    expect(prompt).toContain(
      'skills[1] 和 skills[2] 可以是战法目录中的任意名称，包括其他武将的自带战法'
    );
    expect(prompt).toContain('每个阵容的 9 个战法名不得重复');
    expect(prompt).toContain('开战前任一武将兵力已经减少/并非满编');
    expect(prompt).toContain('本场战斗结束后的“溃灭”、0 兵力或伤亡是正常结果');
  });

  test('embeds every exact catalog name and hero signature pairing', () => {
    const prompt = buildDeepSeekBattlePrompt(database);

    for (const [heroName, hero] of Object.entries(database.heroes)) {
      expect(prompt).toContain(
        JSON.stringify({ [heroName]: hero.skill }).slice(1, -1)
      );
    }
    for (const skillName of Object.keys(database.skills)) {
      expect(prompt).toContain(JSON.stringify(skillName));
    }
  });
});
