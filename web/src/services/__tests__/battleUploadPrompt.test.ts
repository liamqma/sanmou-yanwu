import { database } from '../../data';
import { buildDeepSeekBattlePrompt } from '../battleUploadPrompt';

describe('buildDeepSeekBattlePrompt', () => {
  test('describes orientation-safe positions, grid ownership and partial JSON output', () => {
    const prompt = buildDeepSeekBattlePrompt(database);

    expect(prompt).toContain('原生竖屏');
    expect(prompt).toContain('原生横屏');
    expect(prompt).toContain('2×3 个武将位置');
    expect(prompt).toContain('阵容 1 在左侧、阵容 2 在右侧');
    expect(prompt).toContain('阵容 1 在上方、阵容 2 在下方');
    expect(prompt).toContain('竖屏参考样本为 1080×2340');
    expect(prompt).toContain('三张武将卡中心横坐标约为 19%、50%、81%');
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
    expect(prompt).toContain('对每张卡先读取 skills[0]');
    expect(prompt).toContain('“武将 → 自带战法”目录反查唯一对应的武将名');
    expect(prompt).toContain('画面上的武将名只用于二次确认');
    expect(prompt).toContain('显示“胜”时 winner 为 "1"');
    expect(prompt).toContain('显示“败”时 winner 为 "2"');
    expect(prompt).toContain('只输出一份 JSON');
    expect(prompt).toContain('不要输出思考过程、说明文字或 Markdown 代码围栏');
    expect(prompt).toContain(
      '包括本武将或同一阵容内其他武将的自带战法'
    );
    expect(prompt).toContain('同一阵容内已经确定的非空武将不能重名');
    expect(prompt).toContain('非空携带战法（skills[1] 和 skills[2]）不能重名');
    expect(prompt).toContain('自带战法 skills[0] 不占用携带战法名额');
    expect(prompt).toContain('开战前任一武将兵力已经减少/并非满编');
    expect(prompt).toContain('战斗结束后显示的“溃灭”、0 兵力或伤亡是正常战果');
    expect(prompt).toContain(
      '{"error":"无法处理：平局、开战前减员或武将槽位不完整"}'
    );
  });

  test('reconstructs flattened skill rows by column and preserves uncertain slots', () => {
    const prompt = buildDeepSeekBattlePrompt(database);

    expect(prompt).toContain('它不是没有归属的全场战法汇总');
    expect(prompt).toContain(
      '每张武将卡正下方、处于相同横坐标范围内的一列固定属于该武将'
    );
    expect(prompt).toContain('前 6 个是六名武将的 skills[0]');
    expect(prompt).toContain('中间 6 个是 skills[1]');
    expect(prompt).toContain('最后 6 个是 skills[2]');
    expect(prompt).toContain('第 1 张武将卡使用第 1、7、13 个战法');
    expect(prompt).toContain('第 6 张使用第 6、12、18 个');
    expect(prompt).toContain('第 1 张武将卡使用第 1、4、7 个战法');
    expect(prompt).toContain('不能把最先出现的六个自带战法看成一组');
    expect(prompt).toContain('红色交叉武器图标旁的伤害数字');
    expect(prompt).toContain('绿色水滴图标旁的治疗数字');
    expect(prompt).toContain('不能删除该项并导致后面的战法整体错位');
    expect(prompt).toContain('“茶藤心计”可能实际是目录中的“荼蘼心计”');
    expect(prompt).toContain('“运筹惟”可能实际是“运筹帷幄”');
    expect(prompt).toContain('供玩家手动修正');
    expect(prompt).toContain('对应位置使用空字符串 ""');
    expect(prompt).toContain(
      '{"1":[{"name":"","skills":["","",""]},{"name":"","skills":["","",""]},{"name":"","skills":["","",""]}],"2":[{"name":"","skills":["","",""]},{"name":"","skills":["","",""]},{"name":"","skills":["","",""]}],"winner":""}'
    );
    expect(prompt).not.toContain('停止并告诉我无法处理');
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
