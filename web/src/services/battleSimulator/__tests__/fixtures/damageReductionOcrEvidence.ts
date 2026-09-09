export type RawRateEvidence = { provenance: string } & (
  | {
      status: 'observed-unstacked' | 'observed-total' | 'cross-target-calibrated';
      line: number;
    }
  | {
      status: 'catalog-described';
      value: number;
      source_path: string;
      source_key: string;
      text: string;
    }
  | {
      status: 'inferred-compatibility-witness';
      value: number;
      lines: number[];
    }
);

export interface OcrBattleReportEvidence {
  battle_id: string;
  source_path: string;
  full_source_sha256: string;
  excerpts: { line: number; text: string }[];
  raw_rates: Record<string, RawRateEvidence>;
  observations: {
    description: string;
    effects: string[];
    observed_line: number;
  }[];
}

/**
 * Exact OCR excerpts and full-log hashes supplied by the user for the four
 * local reports available when this primitive was introduced. Line numbers
 * refer to the original battle_log.txt, not this fixture. Full logs and images
 * remain ignored; the supplied full-source hashes cannot be recomputed from
 * these partial excerpts. OCR text is preserved verbatim, including context
 * and expiry lines; neither transcription nor raw-rate identity is inferred
 * merely from a hash. Expiry is context, not simulated removal behavior.
 *
 * The tests parse this intentional OCR-evidence contract for display values.
 * Raw-rate provenance below distinguishes observations, catalog descriptions,
 * cross-target calibration, and compatibility witnesses. It does not claim
 * that every raw effect rate is independently identified by the reports.
 */
export const battleReportEvidence: OcrBattleReportEvidence[] = [
  {
    battle_id: '1782469166479',
    source_path: 'study-battle-report/battles/1782469166479/battle_log.txt',
    full_source_sha256: '90346b47737c100e4b768352fd5af146963f18a36fcfc3014a6768081267368d',
    excerpts: [
      { line: 9, text: '[敌方:周泰]队获得【阵型——箕形阵】强化效果' },
      { line: 10, text: '[敌方:周泰]的【受到伤害】降低6.00%(-6.00%)' },
      { line: 42, text: '[敌方:周泰]队获得兵种强化效果' },
      { line: 43, text: '[敌方:周泰]的【受到伤害】降低3.29%(-9.29%)' },
      { line: 44, text: '[敌方:周泰]的「兵种加成-盾兵」效果已施加' },
      { line: 45, text: '[敌方:张宝]的【受到伤害】降低3.50%(-3.50%)' },
      { line: 46, text: '[我方:张昭]发动战法【折冲御侮】' },
      { line: 47, text: '[我方:张宁]的【受到伤害】降低33.04%(-33.04%)' },
      { line: 48, text: '[我方:张宝]发动战法【如有神助】' },
      { line: 49, text: '[我方:张宝]的【主动战法发动率】提升8.00%(8.00%)' },
      { line: 50, text: '[敌方:张宝]的【主动战法伤害】提升15.00%(15.00%)' },
      { line: 51, text: '[敌方:周泰]发动战法【避其锐气】' },
      { line: 52, text: '[敌方:周泰]的【受到伤害】降低23.58%(-32.87%)' },
      { line: 53, text: '[敌方:陆逊]的【受到伤害】降低25.09%(-28.59%)' },
    ],
    raw_rates: {
      箕形阵: {
        status: 'observed-unstacked',
        line: 10,
        provenance: 'The first reduction on 周泰 is displayed as 6.00%; line 9 names the formation.',
      },
      '兵种加成-盾兵': {
        status: 'observed-unstacked',
        line: 45,
        provenance: 'Same-report unstacked 3.50% observed on 张宝. Applying this shared value to 周泰 (lines 42–44) and the 陆逊 baseline is a cross-unit assumption, not a separately observed raw rate for each unit.',
      },
      避其锐气: {
        status: 'catalog-described',
        value: 0.26,
        source_path: 'web/public/game-data/database.json',
        source_key: 'skills.避其锐气.desc',
        text: '战斗开始前4回合，自身及随机友军单体受到伤害减少26%',
        provenance: 'The tracked catalog describes 26%; line 51 identifies the skill, but the report does not independently expose its raw rate.',
      },
    },
    observations: [
      {
        description: '周泰已有6%时获得同场可见的3.5%兵种减伤',
        effects: ['箕形阵', '兵种加成-盾兵'],
        observed_line: 43,
      },
      {
        description: '周泰叠加兵种减伤后获得图鉴描述的26%避其锐气',
        effects: ['箕形阵', '兵种加成-盾兵', '避其锐气'],
        observed_line: 52,
      },
      {
        description: '陆逊以同场3.5%为基础获得图鉴描述的26%避其锐气',
        effects: ['兵种加成-盾兵', '避其锐气'],
        observed_line: 53,
      },
    ],
  },
  {
    battle_id: '1788649256069',
    source_path: 'study-battle-report/battles/1788649256069/battle_log.txt',
    full_source_sha256: '8a06f1152068645a32c30d55a66a36881330d8e6004ae759aa5b92235005cb56',
    excerpts: [
      { line: 28, text: '[我方:乐进]的【先攻】提升30.00(289.87)' },
      { line: 29, text: '[我方:乐进]的【造成伤害】提升21.09%(35.09%)' },
      { line: 30, text: '[我方:乐进]的【受到伤害】降低21.09%(-21.09%)' },
      { line: 31, text: '[我方:乐进]的【先攻】提升9.00(298.87)' },
      { line: 32, text: '[我方:乐进]的【造成伤害】提升6.54%(41.64%)' },
      { line: 33, text: '[我方:乐进]的【受到伤害】降低5.16%(-26.26%)' },
      { line: 34, text: '[我方:夏侯渊]执行来自【每战先登】的「每战先登」效果' },
      { line: 35, text: '[我方:夏侯渊]的【先攻】提升30.00(261.52)' },
      { line: 36, text: '[我方:夏侯渊]的【造成伤害】提升22.04%(36.04%)' },
      { line: 37, text: '[我方:夏侯渊]的【受到伤害】降低22.04%(-22.04%)' },
      { line: 38, text: '[我方:夏侯渊]的【先攻】提升9.00(270.52)' },
      { line: 39, text: '[我方:夏侯渊]的【造成伤害】提升6.61%(42.65%)' },
      { line: 40, text: '[我方:夏侯渊]的【受到伤害】降低5.15%(-27.19%)' },
      { line: 41, text: '[敌方:乐进]的【先攻】提升30.00(277.50)' },
      { line: 42, text: '[敌方:乐进]的【造成伤害】提升20.78%(34.78%)' },
      { line: 43, text: '[敌方:乐进]的【受到伤害】降低20.78%(-20.78%)' },
      { line: 44, text: '[敌方:乐进]的【受到伤害】降低5.11%(-25.90%)' },
      { line: 45, text: '[敌方:祝融]的【先攻】提升30.00(216.00)' },
      { line: 46, text: '[敌方:祝融]的【造成伤害】提升21.74%(35.74%)' },
      { line: 47, text: '[敌方:祝融]的【受到伤害】降低21.74%(-21.74%)' },
      { line: 48, text: '[敌方:祝融]的【先攻】提升9.00(225.00)' },
      { line: 49, text: '[敌方:祝融]的【造成伤害】提升6.52%(42.27%)' },
      { line: 50, text: '[敌方:祝融]的【受到伤害】降低5.10%(-26.85%)' },
      { line: 51, text: '[我方:糜夫人]发动战法【折冲御侮】' },
      { line: 52, text: '[糜夫人]的【受到伤害】降低27.65%(-32.65%)' },
      { line: 53, text: '[我方:夏侯渊]的【受到伤害】降低21.19%(-48.39%)' },
    ],
    raw_rates: {
      已有减伤: {
        status: 'observed-total',
        line: 40,
        provenance: '夏侯渊 cumulative display 27.19% seeds the existing slot; it is an aggregate, not a newly identified individual raw effect.',
      },
      折冲御侮: {
        status: 'cross-target-calibrated',
        line: 52,
        provenance: 'Calibrate from the first simultaneous target 糜夫人 only: prior = 32.65% - 27.65% = 5%; raw = 27.65% / (1 - 5%). Assume a shared raw rate to predict the second target at line 53, which is not used for calibration.',
      },
    },
    observations: [
      {
        description: '折冲御侮从糜夫人校准后预测同次施放的夏侯渊',
        effects: ['已有减伤', '折冲御侮'],
        observed_line: 53,
      },
    ],
  },
  {
    battle_id: '1788672758108',
    source_path: 'study-battle-report/battles/1788672758108/battle_log.txt',
    full_source_sha256: '30a8737d9affd537b7332825bde8725e0cfe6e262710f3175cf5e0d1f7282234',
    excerpts: [
      { line: 57, text: '[我方:周泰]的【受到兵刃伤害】降低11.45%(-11.45%)' },
      { line: 58, text: '[敌方:皇甫嵩]发动战法【兵动若神】' },
      { line: 59, text: '[敌方:皇甫嵩]的【受到伤害】降低26.01%(-31.01%)' },
      { line: 133, text: '[敌方:皇甫嵩]执行来自【洗筋伐髓】的「洗筋伐髓」效果' },
      { line: 134, text: '[敌方:皇甫嵩]恢复了兵力213（9961）' },
      { line: 135, text: '[敌方:皇甫嵩]的【受到伤害】降低13.79%(-44.81%)' },
    ],
    raw_rates: {
      已有减伤: {
        status: 'observed-total',
        line: 59,
        provenance: '皇甫嵩 cumulative generic reduction 31.01% seeds the slot. The separate 受到兵刃伤害 slot at line 57 is not composed with it.',
      },
      洗筋伐髓: {
        status: 'catalog-described',
        value: 0.2,
        source_path: 'web/public/game-data/database.json',
        source_key: 'skills.洗筋伐髓.desc',
        text: '回合开始时，使自身造成伤害提升10%，可叠加3次，持续到战斗结束。\n回合行动时，有55%概率使自身获得以下效果：恢复自身兵力（治疗率200%，受最高属性影响）：受到伤害降低20%，持续1回合，每个效果独立判断',
        provenance: 'Use the tracked catalog description of 20%, not a raw rate independently observed in this report. Line 133 names the applied effect.',
      },
    },
    observations: [
      {
        description: '皇甫嵩在已有减伤上获得图鉴描述的20%洗筋伐髓',
        effects: ['已有减伤', '洗筋伐髓'],
        observed_line: 135,
      },
    ],
  },
  {
    battle_id: '1788761976188',
    source_path: 'study-battle-report/battles/1788761976188/battle_log.txt',
    full_source_sha256: 'e10e8be68dfcdd46ffcd0076f461aacacabb53b526ad5cee1b2436ee7755c5a2',
    excerpts: [
      { line: 59, text: '[我方:皇甫嵩]的【统率】提升15.00(269.90)' },
      { line: 60, text: '[我方:皇甫嵩]发动战法【兵动若神】' },
      { line: 61, text: '[我方:皇甫嵩]的【受到伤害】降低20.62%(-33.62%)' },
      { line: 115, text: '行动顺序判断完毕【判断结果】' },
      { line: 116, text: '[我方:皇甫嵩]执行来自「科技-御盾」效果' },
      { line: 117, text: '[我方:皇甫嵩]的【受到伤害】降低4.64%(-38.27%)' },
      { line: 165, text: '[我方:皇甫嵩]的【统率】降低18.33(410.17)' },
      { line: 166, text: '[我方:皇甫嵩]的「科技-御盾」效果已消失' },
      { line: 167, text: '[我方:皇甫嵩]的【受到伤害】提升4.64%(-33.62%)' },
      { line: 246, text: '[我方:邓艾]恢复了兵力0(6590)' },
      { line: 247, text: '[我方:皇甫嵩]开始行动' },
      { line: 248, text: '[我方:皇甫嵩]的【受到伤害】降低14.07%(-47.69%)' },
      { line: 292, text: '[我方:皇甫嵩]开始行动' },
      { line: 293, text: '[我方:皇甫嵩]的「洗筋伐髓」效果已消失' },
      { line: 294, text: '[我方:皇甫嵩]的【受到伤害】提升14.07%(-33.62%)' },
    ],
    raw_rates: {
      已有减伤: {
        status: 'observed-total',
        line: 61,
        provenance: 'Use the cumulative generic reduction display 33.62%, without identifying its underlying raw components.',
      },
      '科技-御盾': {
        status: 'inferred-compatibility-witness',
        value: 0.07,
        lines: [61, 116, 117, 166, 167],
        provenance: '7% is an inferred compatibility witness near 4.64 / (100 - 33.62), NOT independently identified. The named application and expiry supply context, not independent measurement of the raw rate.',
      },
      科技消失后已有减伤: {
        status: 'observed-total',
        line: 167,
        provenance: 'The cumulative display returns to 33.62% after 科技-御盾 expires. Seed a separate application from that observed total; do not simulate expiry or stack the expired technology with 洗筋伐髓.',
      },
      洗筋伐髓: {
        status: 'inferred-compatibility-witness',
        value: 0.212,
        lines: [167, 248, 293, 294],
        provenance: '21.2% is an inferred compatibility witness near 14.07 / (100 - 33.62), NOT independently identified or the catalog 20%. Line 248 does not name the effect; the later named expiry at line 293 supports the attribution but is not independent raw-rate evidence.',
      },
    },
    observations: [
      {
        description: '科技-御盾的约7%推断值仅检验兼容性',
        effects: ['已有减伤', '科技-御盾'],
        observed_line: 117,
      },
      {
        description: '洗筋伐髓的约21.2%推断值仅检验兼容性',
        effects: ['科技消失后已有减伤', '洗筋伐髓'],
        observed_line: 248,
      },
    ],
  },
];
