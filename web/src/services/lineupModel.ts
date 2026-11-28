/**
 * Forward pass and team scoring of the neural lineup model. Mirrors
 * `TeamNet`, `NeuralScorer` and `Guide.tables` in `data/lineup_net.py`.
 */

export interface LineupModelMeta {
  version: string;
  width: number;
  layers: number;
  heads: number;
  prior_weight: number;
  strength_weight: number;
  /** Vocabularies; index 0 is the unknown card, index 1 the masked or empty slot. */
  heroes: string[];
  skills: string[];
  hero_prior: number[];
  skill_prior: number[];
  /** The opponents a team's strength is measured against: 3 hero ids, then 6 skill ids. */
  references: number[][];
  /** Tensor name -> [offset in floats, ...shape]. */
  tensors: Record<string, number[]>;
}

export const MASK = 1;
const TOKENS = 10;
const TEAM_CARDS = 9;
const MEMO_ROWS = 30_000;
const TABLE_TEAMS = 300;
const SKILL_INPUTS = 20_000;

/** out[oo + j] = bias[row + j] + W[row + j] · x, for `rows` rows of `k` inputs. */
function affine(
  W: Float32Array,
  bias: Float32Array | null,
  row: number,
  rows: number,
  k: number,
  x: Float32Array,
  xo: number,
  out: Float32Array,
  oo: number
): void {
  let j = 0;
  for (; j + 4 <= rows; j += 4) {
    const w0 = (row + j) * k;
    const w1 = w0 + k;
    const w2 = w1 + k;
    const w3 = w2 + k;
    let a0 = 0, a1 = 0, b0 = 0, b1 = 0, c0 = 0, c1 = 0, d0 = 0, d1 = 0;
    for (let i = 0; i < k; i += 2) {
      const x0 = x[xo + i];
      const x1 = x[xo + i + 1];
      a0 += x0 * W[w0 + i];
      a1 += x1 * W[w0 + i + 1];
      b0 += x0 * W[w1 + i];
      b1 += x1 * W[w1 + i + 1];
      c0 += x0 * W[w2 + i];
      c1 += x1 * W[w2 + i + 1];
      d0 += x0 * W[w3 + i];
      d1 += x1 * W[w3 + i + 1];
    }
    if (bias) {
      out[oo + j] = a0 + a1 + bias[row + j];
      out[oo + j + 1] = b0 + b1 + bias[row + j + 1];
      out[oo + j + 2] = c0 + c1 + bias[row + j + 2];
      out[oo + j + 3] = d0 + d1 + bias[row + j + 3];
    } else {
      out[oo + j] = a0 + a1;
      out[oo + j + 1] = b0 + b1;
      out[oo + j + 2] = c0 + c1;
      out[oo + j + 3] = d0 + d1;
    }
  }
  for (; j < rows; j++) {
    const w0 = (row + j) * k;
    let a0 = 0, a1 = 0;
    for (let i = 0; i < k; i += 2) {
      a0 += x[xo + i] * W[w0 + i];
      a1 += x[xo + i + 1] * W[w0 + i + 1];
    }
    out[oo + j] = a0 + a1 + (bias ? bias[row + j] : 0);
  }
}

function layerNorm(
  x: Float32Array,
  xo: number,
  weight: Float32Array,
  bias: Float32Array,
  out: Float32Array,
  oo: number
): void {
  const w = weight.length;
  let mean = 0;
  for (let d = 0; d < w; d++) mean += x[xo + d];
  mean /= w;
  let variance = 0;
  for (let d = 0; d < w; d++) {
    const centered = x[xo + d] - mean;
    variance += centered * centered;
  }
  const scale = 1 / Math.sqrt(variance / w + 1e-5);
  for (let d = 0; d < w; d++) out[oo + d] = (x[xo + d] - mean) * scale * weight[d] + bias[d];
}

const GELU_RANGE = 8;
const GELU_STEPS = 1024;
const GELU = (() => {
  const erf = (u: number): number => {
    // erf(u) = 2/√π · e^(−u²) · Σ 2ⁿ u^(2n+1) / (2n+1)!!, every term positive.
    const a = Math.abs(u);
    let term = a;
    let sum = a;
    for (let n = 1; term > sum * 1e-17; n++) {
      term *= (2 * a * a) / (2 * n + 1);
      sum += term;
    }
    return (Math.sign(u) * 2 * Math.exp(-a * a) * sum) / Math.sqrt(Math.PI);
  };
  const table = new Float64Array(2 * GELU_RANGE * GELU_STEPS + 2);
  for (let i = 0; i < table.length; i++) {
    const x = i / GELU_STEPS - GELU_RANGE;
    table[i] = 0.5 * x * (1 + erf(x / Math.SQRT2));
  }
  return table;
})();

const gelu = (x: number): number => {
  if (x >= GELU_RANGE) return x;
  if (x <= -GELU_RANGE) return 0;
  const position = (x + GELU_RANGE) * GELU_STEPS;
  const index = position | 0;
  return GELU[index] + (position - index) * (GELU[index + 1] - GELU[index]);
};

interface Layer {
  inW: Float32Array;
  inB: Float32Array;
  outW: Float32Array;
  outB: Float32Array;
  l1W: Float32Array;
  l1B: Float32Array;
  l2W: Float32Array;
  l2B: Float32Array;
  n1W: Float32Array;
  n1B: Float32Array;
  n2W: Float32Array;
  n2B: Float32Array;
}

type Tensor = (name: string) => Float32Array;

/** One `TeamNet`: ten tokens (CLS, 3 heroes, 6 skills) through a pre-norm transformer. */
class Net {
  readonly w: number;
  readonly hero: Float32Array;
  readonly skill: Float32Array;
  readonly heroCount: number;
  private readonly heads: number;
  private readonly slot: Float32Array;
  private readonly cls: Float32Array;
  /** carrier · hero embedding, per hero. */
  private readonly carried: Float32Array;
  private readonly layers: Layer[];
  private readonly normW: Float32Array;
  private readonly normB: Float32Array;
  private readonly x: Float32Array;
  private readonly qkv: Float32Array;
  private readonly normed: Float32Array;
  private readonly context: Float32Array;
  private readonly hidden: Float32Array;
  private readonly update: Float32Array;
  private readonly attention = new Float64Array(TOKENS);
  private readonly wanted = new Uint8Array(TOKENS);
  // The first layer's attention inputs depend on one token only, so they are kept per token.
  private readonly clsInput: Float32Array;
  private readonly heroInput: Float32Array;
  private skillInput: Float32Array;
  private readonly skillInputRow = new Map<number, number>();

  constructor(tensor: Tensor, meta: LineupModelMeta) {
    const w = (this.w = meta.width);
    this.heads = meta.heads;
    this.hero = tensor('hero.weight');
    this.skill = tensor('skill.weight');
    this.heroCount = meta.heroes.length;
    this.slot = tensor('slot.weight');
    this.cls = tensor('cls');
    this.layers = Array.from({ length: meta.layers }, (_, l) => {
      const at = (name: string) => tensor(`encoder.layers.${l}.${name}`);
      return {
        inW: at('self_attn.in_proj_weight'),
        inB: at('self_attn.in_proj_bias'),
        outW: at('self_attn.out_proj.weight'),
        outB: at('self_attn.out_proj.bias'),
        l1W: at('linear1.weight'),
        l1B: at('linear1.bias'),
        l2W: at('linear2.weight'),
        l2B: at('linear2.bias'),
        n1W: at('norm1.weight'),
        n1B: at('norm1.bias'),
        n2W: at('norm2.weight'),
        n2B: at('norm2.bias'),
      };
    });
    this.normW = tensor('norm.weight');
    this.normB = tensor('norm.bias');
    this.x = new Float32Array(TOKENS * w);
    this.qkv = new Float32Array(TOKENS * 3 * w);
    this.normed = new Float32Array(w);
    this.context = new Float32Array(w);
    this.hidden = new Float32Array(2 * w);
    this.update = new Float32Array(w);

    const carrier = tensor('carrier.weight');
    this.carried = new Float32Array(this.heroCount * w);
    for (let h = 0; h < this.heroCount; h++) {
      affine(carrier, null, 0, w, w, this.hero, h * w, this.carried, h * w);
    }
    this.clsInput = new Float32Array(3 * w);
    this.firstInput(this.cls, 0, this.clsInput, 0);
    this.heroInput = new Float32Array(this.heroCount * 3 * 3 * w);
    const token = new Float32Array(w);
    for (let h = 0; h < this.heroCount; h++) {
      for (let i = 0; i < 3; i++) {
        for (let d = 0; d < w; d++) token[d] = this.hero[h * w + d] + this.slot[i * w + d];
        this.firstInput(token, 0, this.heroInput, (h * 3 + i) * 3 * w);
      }
    }
    this.skillInput = new Float32Array(1024 * 3 * w);
  }

  private firstInput(x: Float32Array, xo: number, out: Float32Array, oo: number): void {
    const { inW, inB, n1W, n1B } = this.layers[0];
    layerNorm(x, xo, n1W, n1B, this.normed, 0);
    affine(inW, inB, 0, 3 * this.w, this.w, this.normed, 0, out, oo);
  }

  private skillInputAt(skill: number, hero: number, slot: number, xo: number): number {
    const key = (skill * this.heroCount + hero) * 3 + slot;
    let row = this.skillInputRow.get(key);
    if (row === undefined) {
      if (this.skillInputRow.size >= SKILL_INPUTS) this.skillInputRow.clear();
      row = this.skillInputRow.size * 3 * this.w;
      if (row + 3 * this.w > this.skillInput.length) {
        const grown = new Float32Array(this.skillInput.length * 2);
        grown.set(this.skillInput);
        this.skillInput = grown;
      }
      this.firstInput(this.x, xo, this.skillInput, row);
      this.skillInputRow.set(key, row);
    }
    return row;
  }

  /**
   * Final hidden states of `queries` (token positions: 0 is CLS, 1-3 heroes,
   * 4-9 skills) for a team of 3 hero ids followed by 6 skill ids.
   */
  states(cards: ArrayLike<number>, queries: readonly number[], out: Float32Array, oo: number): void {
    const { w, x, qkv, hero, skill, slot, carried, heads, wanted } = this;
    const span = 3 * w;
    const headWidth = w / heads;
    const scale = 1 / Math.sqrt(headWidth);

    x.set(this.cls, 0);
    qkv.set(this.clsInput, 0);
    for (let i = 0; i < 3; i++) {
      const h = cards[i];
      for (let d = 0; d < w; d++) x[(1 + i) * w + d] = hero[h * w + d] + slot[i * w + d];
      qkv.set(this.heroInput.subarray((h * 3 + i) * span, (h * 3 + i + 1) * span), (1 + i) * span);
      for (let a = 0; a < 2; a++) {
        const t = 4 + 2 * i + a;
        const s = cards[3 + 2 * i + a];
        for (let d = 0; d < w; d++) {
          x[t * w + d] = skill[s * w + d] + carried[h * w + d] + slot[i * w + d];
        }
        const row = this.skillInputAt(s, h, i, t * w);
        qkv.set(this.skillInput.subarray(row, row + span), t * span);
      }
    }

    wanted.fill(0);
    for (const t of queries) wanted[t] = 1;
    for (let l = 0; l < this.layers.length; l++) {
      const layer = this.layers[l];
      const last = l === this.layers.length - 1;
      if (l > 0) {
        for (let t = 0; t < TOKENS; t++) {
          layerNorm(x, t * w, layer.n1W, layer.n1B, this.normed, 0);
          // Tokens nobody reads from only serve as keys and values in the last layer.
          if (last && !wanted[t]) affine(layer.inW, layer.inB, w, 2 * w, w, this.normed, 0, qkv, t * span + w);
          else affine(layer.inW, layer.inB, 0, span, w, this.normed, 0, qkv, t * span);
        }
      }
      for (let t = 0; t < TOKENS; t++) {
        if (last && !wanted[t]) continue;
        for (let head = 0; head < heads; head++) {
          const q = t * span + head * headWidth;
          let top = -Infinity;
          for (let j = 0; j < TOKENS; j++) {
            const k = j * span + w + head * headWidth;
            let dot = 0;
            for (let d = 0; d < headWidth; d++) dot += qkv[q + d] * qkv[k + d];
            dot *= scale;
            this.attention[j] = dot;
            if (dot > top) top = dot;
          }
          let total = 0;
          for (let j = 0; j < TOKENS; j++) {
            this.attention[j] = Math.exp(this.attention[j] - top);
            total += this.attention[j];
          }
          const c = head * headWidth;
          for (let d = 0; d < headWidth; d++) {
            let sum = 0;
            for (let j = 0; j < TOKENS; j++) {
              sum += this.attention[j] * qkv[j * span + 2 * w + c + d];
            }
            this.context[c + d] = sum / total;
          }
        }
        affine(layer.outW, layer.outB, 0, w, w, this.context, 0, this.update, 0);
        for (let d = 0; d < w; d++) x[t * w + d] += this.update[d];
        layerNorm(x, t * w, layer.n2W, layer.n2B, this.normed, 0);
        affine(layer.l1W, layer.l1B, 0, 2 * w, w, this.normed, 0, this.hidden, 0);
        for (let d = 0; d < 2 * w; d++) if (this.hidden[d] < 0) this.hidden[d] = 0;
        affine(layer.l2W, layer.l2B, 0, w, 2 * w, this.hidden, 0, this.update, 0);
        for (let d = 0; d < w; d++) x[t * w + d] += this.update[d];
      }
    }
    for (let n = 0; n < queries.length; n++) {
      layerNorm(x, queries[n] * w, this.normW, this.normB, out, oo + n * w);
    }
  }
}

/** Per-slot log-probabilities of every card, used to rank moves without scoring them. */
export interface TeamTables {
  /** Only this slot masked. */
  one: Float32Array[];
  /** The slot's hero and both of that hero's skills masked. */
  block: Float32Array[];
  /** `two[p][q]`: slot p's distribution with skill slots p and q both masked. */
  two: Float32Array[][];
}

export interface TeamValue {
  score: number;
  /** Mean predicted win rate against the reference teams. */
  strength: number;
}

const SKILL_PAIRS: [number, number][] = [];
for (let p = 3; p < TEAM_CARDS; p++) {
  for (let q = p + 1; q < TEAM_CARDS; q++) {
    if ((p - 3) >> 1 !== (q - 3) >> 1) SKILL_PAIRS.push([p, q]);
  }
}

export class LineupScorer {
  readonly meta: LineupModelMeta;
  /** Appearance priors, already multiplied by the prior weight. */
  readonly heroPrior: Float64Array;
  readonly skillPrior: Float64Array;
  private readonly model: Net;
  private readonly judge: Net;
  private readonly heroBias: Float32Array;
  private readonly skillBias: Float32Array;
  private readonly w: number;
  // Likelihood states by revealed prefix: hidden vector, then the log normaliser.
  private memo = new Map<string, number>();
  private memoTable: Float32Array;
  private memoUsed = 0;
  private readonly tableCache = new Map<string, TeamTables>();
  private readonly logits: Float32Array;
  private readonly state: Float32Array;
  private readonly row = new Int32Array(TEAM_CARDS);
  // Strength head.
  private readonly references: number;
  private readonly refZ: Float32Array;
  private readonly refAsX: Float32Array;
  private readonly refAsY: Float32Array;
  private readonly refBase: Float64Array;
  private readonly wx: Float32Array;
  private readonly wy: Float32Array;
  private readonly wxy: Float32Array;
  private readonly matchOut: Float32Array;
  private readonly strengthW: Float32Array;
  private readonly strengthB: Float32Array;
  private readonly strengthOut: Float32Array;
  private readonly strengthBias: number;
  private readonly za: Float32Array;
  private readonly ax: Float32Array;
  private readonly ay: Float32Array;
  private readonly product: Float32Array;
  private readonly cross: Float32Array;

  constructor(meta: LineupModelMeta, weights: ArrayBuffer) {
    this.meta = meta;
    const floats = new Float32Array(weights);
    const tensor = (net: string): Tensor => (name) => {
      const [offset, ...shape] = meta.tensors[`${net}.${name}`];
      return floats.subarray(offset, offset + shape.reduce((size, n) => size * n, 1));
    };
    const w = (this.w = meta.width);
    this.model = new Net(tensor('model'), meta);
    this.judge = new Net(tensor('judge'), meta);
    this.heroBias = tensor('model')('hero_bias');
    this.skillBias = tensor('model')('skill_bias');
    this.heroPrior = Float64Array.from(meta.hero_prior, (x) => x * meta.prior_weight);
    this.skillPrior = Float64Array.from(meta.skill_prior, (x) => x * meta.prior_weight);
    this.memoTable = new Float32Array(4096 * (w + 1));
    this.logits = new Float32Array(Math.max(meta.heroes.length, meta.skills.length));
    this.state = new Float32Array(3 * w);

    const judge = tensor('judge');
    const first = judge('matchup.0.weight');
    const firstBias = judge('matchup.0.bias');
    this.wx = new Float32Array(w * w);
    this.wy = new Float32Array(w * w);
    this.wxy = new Float32Array(w * w);
    for (let u = 0; u < w; u++) {
      this.wx.set(first.subarray(u * 3 * w, u * 3 * w + w), u * w);
      this.wy.set(first.subarray(u * 3 * w + w, u * 3 * w + 2 * w), u * w);
      this.wxy.set(first.subarray(u * 3 * w + 2 * w, (u + 1) * 3 * w), u * w);
    }
    this.matchOut = judge('matchup.2.weight');
    this.strengthW = judge('strength.0.weight');
    this.strengthB = judge('strength.0.bias');
    this.strengthOut = judge('strength.2.weight');
    this.strengthBias = judge('strength.2.bias')[0];
    this.za = new Float32Array(w);
    this.ax = new Float32Array(w);
    this.ay = new Float32Array(w);
    this.product = new Float32Array(w);
    this.cross = new Float32Array(w);

    const count = (this.references = meta.references.length);
    this.refZ = new Float32Array(count * w);
    this.refAsX = new Float32Array(count * w);
    this.refAsY = new Float32Array(count * w);
    this.refBase = new Float64Array(count);
    meta.references.forEach((cards, r) => {
      this.judge.states(cards, [0], this.refZ, r * w);
      affine(this.wx, firstBias, 0, w, w, this.refZ, r * w, this.refAsX, r * w);
      affine(this.wy, firstBias, 0, w, w, this.refZ, r * w, this.refAsY, r * w);
      this.refBase[r] = this.strengthOf(this.refZ, r * w);
    });
  }

  private strengthOf(z: Float32Array, zo: number): number {
    const { w } = this;
    affine(this.strengthW, this.strengthB, 0, w, w, z, zo, this.cross, 0);
    let sum = this.strengthBias;
    for (let u = 0; u < w; u++) sum += this.strengthOut[u] * gelu(this.cross[u]);
    return sum;
  }

  /** Mean predicted win rate of the team against the reference teams. */
  private strength(cards: ArrayLike<number>): number {
    const { w, za, ax, ay, product, cross } = this;
    this.judge.states(cards, [0], za, 0);
    affine(this.wx, null, 0, w, w, za, 0, ax, 0);
    affine(this.wy, null, 0, w, w, za, 0, ay, 0);
    const own = this.strengthOf(za, 0);
    let total = 0;
    for (let r = 0; r < this.references; r++) {
      const ro = r * w;
      for (let d = 0; d < w; d++) product[d] = za[d] * this.refZ[ro + d];
      affine(this.wxy, null, 0, w, w, product, 0, cross, 0);
      let ab = 0;
      let ba = 0;
      for (let u = 0; u < w; u++) {
        ab += this.matchOut[u] * gelu(ax[u] + this.refAsY[ro + u] + cross[u]);
        ba += this.matchOut[u] * gelu(this.refAsX[ro + u] + ay[u] + cross[u]);
      }
      total += 1 / (1 + Math.exp(-(own - this.refBase[r] + (ab - ba) / 2)));
    }
    return total / this.references;
  }

  /** logits[0..n) over every hero (token positions 1-3) or skill, and their log-sum-exp. */
  private distribution(hidden: Float32Array, ho: number, heroes: boolean): number {
    const size = heroes ? this.meta.heroes.length : this.meta.skills.length;
    affine(
      heroes ? this.model.hero : this.model.skill,
      heroes ? this.heroBias : this.skillBias,
      0,
      size,
      this.w,
      hidden,
      ho,
      this.logits,
      0
    );
    let top = -Infinity;
    for (let i = 0; i < size; i++) if (this.logits[i] > top) top = this.logits[i];
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Math.exp(this.logits[i] - top);
    return top + Math.log(sum);
  }

  /**
   * log P(team): cards are revealed in order and each one is scored given only
   * the cards before it. Empty slots stay masked and are not scored.
   */
  private logLikelihood(cards: ArrayLike<number>): number {
    const { w, row } = this;
    const stride = w + 1;
    let total = 0;
    let key = '';
    row.fill(MASK);
    for (let step = 0; step < TEAM_CARDS; step++) {
      const target = cards[step];
      if (target !== MASK) {
        let at = this.memo.get(key);
        if (at === undefined) {
          if ((this.memoUsed + 1) * stride > this.memoTable.length) {
            const grown = new Float32Array(this.memoTable.length * 2);
            grown.set(this.memoTable);
            this.memoTable = grown;
          }
          at = this.memoUsed * stride;
          this.model.states(row, [1 + step], this.memoTable, at);
          this.memoTable[at + w] = this.distribution(this.memoTable, at, step < 3);
          // A full prefix is as specific as the team itself, which is cached by the caller.
          if (step < TEAM_CARDS - 1) {
            this.memo.set(key, at);
            this.memoUsed++;
          }
        }
        const weights = step < 3 ? this.model.hero : this.model.skill;
        let dot = (step < 3 ? this.heroBias : this.skillBias)[target] - this.memoTable[at + w];
        for (let d = 0; d < w; d++) dot += this.memoTable[at + d] * weights[target * w + d];
        total += dot;
      }
      row[step] = target;
      key += String.fromCharCode(target);
    }
    return total;
  }

  /** Score of a team in canonical order: 3 hero ids, then each hero's 2 skill ids. */
  score(cards: ArrayLike<number>): TeamValue {
    if (this.memoUsed > MEMO_ROWS) {
      this.memo = new Map();
      this.memoUsed = 0;
    }
    let prior = 0;
    for (let i = 0; i < 3; i++) prior += this.heroPrior[cards[i]];
    for (let i = 3; i < TEAM_CARDS; i++) prior += this.skillPrior[cards[i]];
    const strength = this.strength(cards);
    const chance = Math.min(Math.max(strength, 1e-4), 1 - 1e-4);
    return {
      score:
        this.logLikelihood(cards) -
        prior +
        this.meta.strength_weight * Math.log(chance / (1 - chance)),
      strength,
    };
  }

  private logProbabilities(ho: number, heroes: boolean): Float32Array {
    const norm = this.distribution(this.state, ho, heroes);
    const out = new Float32Array(heroes ? this.meta.heroes.length : this.meta.skills.length);
    for (let i = 0; i < out.length; i++) out[i] = this.logits[i] - norm;
    out[MASK] = 0;
    return out;
  }

  /** Move-ranking tables for a team in slot order (not canonical order). */
  tables(cards: ArrayLike<number>): TeamTables {
    let key = '';
    for (let i = 0; i < TEAM_CARDS; i++) key += String.fromCharCode(cards[i]);
    let tables = this.tableCache.get(key);
    if (tables) return tables;
    if (this.tableCache.size >= TABLE_TEAMS) this.tableCache.clear();

    const { w, row, state } = this;
    const masked = (slots: number[]): void => {
      for (let i = 0; i < TEAM_CARDS; i++) row[i] = cards[i];
      for (const slot of slots) row[slot] = MASK;
      this.model.states(row, slots.map((slot) => 1 + slot), state, 0);
    };
    tables = { one: [], block: [], two: Array.from({ length: TEAM_CARDS }, () => []) };
    for (let slot = 0; slot < TEAM_CARDS; slot++) {
      masked([slot]);
      tables.one.push(this.logProbabilities(0, slot < 3));
    }
    for (const [p, q] of SKILL_PAIRS) {
      masked([p, q]);
      tables.two[p][q] = this.logProbabilities(0, false);
      tables.two[q][p] = this.logProbabilities(w, false);
    }
    for (let hero = 0; hero < 3; hero++) {
      masked([hero, 3 + 2 * hero, 4 + 2 * hero]);
      tables.block[hero] = this.logProbabilities(0, true);
      tables.block[3 + 2 * hero] = this.logProbabilities(w, false);
      tables.block[4 + 2 * hero] = this.logProbabilities(2 * w, false);
    }
    this.tableCache.set(key, tables);
    return tables;
  }

  /**
   * Log-probability of every skill at each of the 6 skill slots when only the
   * three heroes are known.
   */
  skillWishes(heroes: ArrayLike<number>): Float32Array[] {
    const { row, w } = this;
    const hidden = new Float32Array(6 * w);
    row.fill(MASK);
    for (let i = 0; i < 3; i++) row[i] = heroes[i];
    this.model.states(row, [4, 5, 6, 7, 8, 9], hidden, 0);
    return Array.from({ length: 6 }, (_, slot) => {
      const norm = this.distribution(hidden, slot * w, false);
      const out = new Float32Array(this.meta.skills.length);
      for (let i = 0; i < out.length; i++) out[i] = this.logits[i] - norm;
      return out;
    });
  }
}
