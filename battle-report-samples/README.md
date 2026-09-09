# 战报文本样本库

这里保存已收集战报的**完整 OCR 文本**，并提交到 Git。后续研究减伤、基础伤害、
增伤、治疗等公式时，共用这一份语料；CI 和 no-mistakes 的独立 checkout 不需要
访问手机、ignored 文件或其他工作区。

这不是已经人工校对的游戏真值，也不是推荐模型的训练输入。原始截图和 OCR 缓存
仍在本地 `study-battle-report/battles/<id>/`，不随此目录提交。

## 文件结构与边界

```text
battle-report-samples/
  manifest.json                       # 文本清单、哈希、行数和采集来源
  reports/<battle-id>.txt              # 完整 OCR 输出，逐字节保留
  observations/damage-reduction.json   # 减伤观察点和人工审核分类，不复制日志文本
```

- `reports/` 中的 `.txt` 是稳定的研究快照，不是每次 OCR 自动覆盖的输出。
  收录清单与逐份行数以 [manifest.json](manifest.json) 为准。保留残缺数字、换行、
  OCR 错字、镜像武将和推断阵营等问题；**不能为了让公式通过测试而改原文**。
- `manifest.json` 的 `schemaVersion` 为 1。每份报告记录 `id`、
  `path`（固定为 `reports/<id>.txt`）、文件原始字节的 `sha256`、`lineCount`、
  `imageCount`、原本地 `sourcePath` 和 `notes`。
  行号从 1 开始；末尾换行符不额外算空行，文件内部空行仍算一行。
  图片数量和原路径是采集来源记录，不代表 CI 能核验未提交的截图。
  `.gitattributes` 禁止 Git 自动转换这些文本的换行字节，保证不同 checkout 的哈希一致。
  SHA-256 用来发现文本意外变动，不能证明 OCR 识别正确。
- `observations/` 只存行号、解释、原始效果来源和分类。数值期望从 `.txt`
  指定行解析，不能再手抄一份预期减伤数字或 OCR 摘录。
  其他公式以后可增加独立观察文件及相应执行测试，共用完整文本。

## 减伤观察合同（v1）

`observations/damage-reduction.json` 的 `reports` 必须与 manifest 的报告 ID
一一对应。每份记录必须有 `battleId`、`status`、非空 `reason`、`rawRates` 和
`observations`。分类有三种：

| status | 含义 |
| --- | --- |
| `comparison` | 可将选定显示值与公式预测比较，来源和跨武将假设逐项说明；不等同于独立受控实验已经识别公式 |
| `compatibility-only` | 使用同一显示反推的原始值等假设，只检验兼容性，不声称独立验证 |
| `insufficient-evidence` | 没有足够证据，必须说明原因，并保持 `rawRates: {}` 和 `observations: []` |

每个观察点包含 `description`、按应用顺序排列的 `effects`（引用 `rawRates`
的键）和 `observedLine`（实际新增减伤显示行）。原始率以比例表示，例如 6% 是
`0.06`，不能把已经稀释的显示增量再次当作原始率。

`rawRates` 的每项必须有非空 `provenance`，并属于以下一种：

- `observed-unstacked`：从 `line` 读取单独效果的增量，要求增量与累计值一致。
- `observed-total`：从 `line` 读取已有累计减伤，作为一个聚合基线，而不是新识别的组件。
- `cross-target-calibrated`：只从另一个目标的 `line` 校准原始率，预测不同的
  `observedLine`；必须说明两目标效果相同的假设。
- `catalog-described`：保留 `value`、`sourcePath`、`sourceKey` 和当时的完整
  图鉴描述 `text`。这是有来源的描述快照，不自动追随未来图鉴变更，也不是从战报
  独立测得的数值。
- `inferred-compatibility-witness`：保留推断 `value` 和 `lines`，只能用于
  `compatibility-only` 报告。不能把用结果反推的参数当成独立证据。

选定观察点、逐份审核结论及各原始率的来源以
[减伤观察文件](observations/damage-reduction.json) 为准。
**覆盖每份报告不等于验证其每一行或整场最终伤害**。缺失上下文、异常数字、
镜像武将阵营、伤害取整、效果到期等仍需要单独研究，不能由解析器静默修复。

## 测试与新增报告

从仓库根目录运行：

```bash
cd web
pnpm exec vitest run src/services/battleSimulator
```

语料及其 Node 加载器仅由测试读取，不由生产入口导入，不增加浏览器 bundle 或静态
公开页面负载。测试检查：文件与 manifest 一一对应、哈希和行数一致、每份报告有明确审核、
原始率来源合法、行号和效果引用存在；然后调用真实的 `simulateDamageReduction`
接口，将有效增量和累计值与日志比较；显示精度容差及其解释见
[行为测试](../web/src/services/battleSimulator/__tests__/damageReduction.test.ts)。
`insufficient-evidence` 会以带原因的跳过项呈现，不当作数值验证通过。
PR 的检查选择见 [开发流程的路径规则](../DEVELOPMENT.md#pull-request-checks)。

新增报告的流程：

1. 将手机战报拉取到独立的本地 battle 目录，运行现有 OCR 脚本，检查首尾和完整性。
   此过程不自动修改本语料库或推荐数据。
2. 检查没有个人/敏感信息后，把完整 `battle_log.txt` 逐字节复制到新的
   `reports/<id>.txt`。保留稳定 ID；不要覆盖已有快照或把重录的同一战报当独立实验。
3. 在 manifest 新增元数据，计算 SHA-256 和行数。例如：
   `shasum -a 256 battle-report-samples/reports/<id>.txt`。
4. 在减伤观察文件中为新 ID 添加审核记录：有可靠观察点则引用原始行号；仅能反推
   参数则标为 `compatibility-only`；没有证据则明确记为 `insufficient-evidence`
   并解释原因。**遗漏审核会使测试失败，新增报告不能被静默忽略。**
5. 运行上述测试，让新旧战报一起比较，再按 [开发流程](../DEVELOPMENT.md)
   完成验证、commit 和 PR。未来每个公式应有自己的观察文件和全报告覆盖检查。

如果以后重新 OCR 或人工纠错，保留原快照，另存有明确来源关联的新版本，重新审核
行号与观察点。修订文本、哈希和观察点必须一起 review；不要仅刷新哈希掩盖不一致。
