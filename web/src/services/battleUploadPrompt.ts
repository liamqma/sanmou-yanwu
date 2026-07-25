import type { Database } from '../types/domain';

/**
 * Build the copyable OCR prompt from the same catalog the client validates.
 * Including the full catalog prevents a model from silently inventing or
 * normalizing a near-match that the upload endpoint cannot accept. Portrait
 * ratios are derived from the 1080×2340 fixture and the production OCR crops in
 * image_extraction/extraction_config.json. Landscape ratios are measured from
 * the separate high-resolution 2532×1170 reference screenshot supplied for
 * this flow.
 */
export function buildDeepSeekBattlePrompt(database: Database): string {
  const heroSignatures = Object.fromEntries(
    Object.entries(database.heroes).map(([name, hero]) => [name, hero.skill])
  );
  const skillNames = Object.keys(database.skills);

  return `你是一名严格的《三国：谋定天下》战报 OCR 助手。请读取我随后上传的一张战报截图，并只输出一份 JSON。

识图与方向：
1. 截图可能是原生竖屏、原生横屏、被手机旋转或留有黑边。先根据界面文字和 UI 标签把画面校正为文字正立的方向，再识别实际游戏画面的边界并排除纯黑边、系统栏或其他留白；若没有边框，游戏画面就是整张截图。下面的位置全部是相对这个“校正后的游戏画面区域”的粗略比例，可有约 5%～10% 偏差，不能当成固定像素裁剪，也不能按原始位图的旋转方向颠倒槽位顺序。
2. 阵容 1 始终是玩家/己方、与“胜 / 败”战果关联的一方；阵容 2 始终是对手/敌方。不要因为图片旋转或横竖布局改变而交换阵容。
3. 竖屏参考样本为 1080×2340：阵容 1 大约位于画面高度 15%～43%，阵容 2 大约位于 58%～82%，中间 44%～54% 是“胜 / 败 / 平”与战果区域。两队的 3 张武将卡都从左到右排列，卡片中心横坐标约为 19%、50%、81%。战法名称的 OCR 起始横坐标约为 6%、37%、68%，每个名称区域宽约 13%；阵容 1 的三行战法纵坐标约为 27%、31%、35%，阵容 2 约为 71%、75%、79%。胜负字粗略位于横坐标 10%～20%、纵坐标 45%～50%。
4. 横屏参考样本为 2532×1170：阵容 1 大约位于横坐标 11%～44%，阵容 2 大约位于 59%～92%，双方武将卡与战法主体都在画面高度约 22%～88%；“胜 / 败 / 平”位于顶部中央横坐标约 48%～54%、纵坐标约 8%～22%，中央战果详情约位于横坐标 44%～58%、纵坐标 22%～88%。6 张武将卡中心横坐标从左到右约为 17%、28%、39%、64%、75%、86%，武将名大约位于画面高度 52%；各列战法名称的起始横坐标约为 12%、23%、34%、59%、70%、81%，每列第 1、2、3 行战法大约位于画面高度 65%、74%、83%。如果其他横屏布局不同，就按两个完整面板的标签与战果关联判断，不要强套坐标。
5. 精确保留每个面板显示的 3 个武将槽位：横向排列时从左到右映射为 [0]、[1]、[2]；纵向排列时从上到下映射为 [0]、[1]、[2]。不能按存活、伤害或 OCR 识别顺序重排。
6. 每个武将卡片内有 3 个战法槽位：纵向成列时从上到下、横向成行时从左到右映射为 skills[0]、skills[1]、skills[2]。必须独立检查双方 2×3 个武将位置和每格 3 个战法，共 6 名武将、18 个战法。
7. 读取与己方关联的战果：显示“胜”时 winner 为 "1"，显示“败”时 winner 为 "2"。若是“平”、无法确定胜负，或开战前任一武将兵力已经减少/并非满编，或缺少武将槽位，停止并告诉我无法处理，不要编造 JSON。战报里显示本场战斗结束后的“溃灭”、0 兵力或伤亡是正常结果，不属于这里的开战前减员，仍应读取完整的 6 个槽位。

识别顺序、名称与校验：
1. 不要先依赖难以辨认的武将名。对每张卡先 OCR 第 1 个战法槽 skills[0]，再在下方“武将 → 自带战法”目录中反查唯一对应的武将名；画面上的武将名只用于二次确认。若 skills[0] 无法可靠识别或不能映射到目录武将，停止并告诉我无法处理，不要猜测。
2. 确定武将后，再 OCR skills[1]、skills[2]。武将名、战法名必须逐字选自目录；不要自行造词，不要做简繁转换，不要添加空格，也不要用相近名称替代。
3. 用“武将 → 自带战法”目录再次交叉核对，确保 skills[0] 与该武将自己的自带战法完全一致。skills[1] 和 skills[2] 可以是战法目录中的任意名称，包括其他武将的自带战法；不要因此改名、纠正或拒绝。
4. 同一阵容内武将名不得重复，每个阵容的 9 个战法名不得重复；两个对立阵容之间允许出现相同武将或战法。

输出要求：
- 只输出 JSON 对象，不要 Markdown 代码围栏、说明、注释或其他文字。
- 最外层只能有 "1"、"2"、"winner" 三个字段。
- 每个阵容必须是按画面位置排列的 3 个对象；每个对象只能有 "name" 和 "skills"；skills 必须恰好有 3 项。
- winner 只能是字符串 "1" 或 "2"。

严格输出模板：
{"1":[{"name":"武将名","skills":["自带战法","携带战法1","携带战法2"]},{"name":"武将名","skills":["自带战法","携带战法1","携带战法2"]},{"name":"武将名","skills":["自带战法","携带战法1","携带战法2"]}],"2":[{"name":"武将名","skills":["自带战法","携带战法1","携带战法2"]},{"name":"武将名","skills":["自带战法","携带战法1","携带战法2"]},{"name":"武将名","skills":["自带战法","携带战法1","携带战法2"]}],"winner":"1"}

合法武将及其自带战法（JSON）：
${JSON.stringify(heroSignatures)}

合法战法名（JSON）：
${JSON.stringify(skillNames)}`;
}
