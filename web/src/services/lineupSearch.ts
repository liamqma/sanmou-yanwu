/**
 * Lineup search on top of the neural team scorer. Mirrors the fast search
 * (`Guide`, `search`, `fill`, `pick`, `deepen`, `support`) in
 * `data/lineup_net.py`; keep the two in step.
 */
import { LineupScorer, MASK, type TeamTables, type TeamValue } from './lineupModel';

export type CardKind = 'hero' | 'skill';

const EMPTY = 0;
const HERO_SLOTS = 9;
const SKILL_SLOTS = 18;
/** Moves scored exactly per round, and how many estimated-best moves to try before stopping. */
const TOP = 8;
const PATIENCE = 32;
const START_GROUPS = 150;
/** Above this many heroes the start enumeration is skipped; real pools stay far below it. */
const START_HEROES = 30;
const TEAM_CACHE = 200_000;
const WISH_CACHE = 500;

/** Code-point order, the order Python sorts names in. */
export const compareNames = (a: string, b: string): number => {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) {
      const xAstral = x >= 0xd800 && x <= 0xdfff;
      const yAstral = y >= 0xd800 && y <= 0xdfff;
      return xAstral === yAstral ? x - y : xAstral ? 1 : -1;
    }
  }
  return a.length - b.length;
};

/** Card ids of one kind: 0 is the empty slot, then the model's cards, then cards it has never seen. */
class Names {
  readonly names = [''];
  readonly vocab = [MASK];
  rank = [0];
  private readonly ids = new Map<string, number>([['', EMPTY]]);

  constructor(vocabulary: string[]) {
    vocabulary.forEach((name, index) => {
      if (index <= MASK) return;
      this.ids.set(name, this.names.length);
      this.names.push(name);
      this.vocab.push(index);
    });
    this.sort();
  }

  private sort(): void {
    const order = this.names.map((_, id) => id).sort((a, b) => compareNames(this.names[a], this.names[b]));
    order.forEach((id, position) => {
      this.rank[id] = position;
    });
  }

  id(name: string): number {
    let id = this.ids.get(name);
    if (id === undefined) {
      id = this.names.length;
      this.ids.set(name, id);
      this.names.push(name);
      this.vocab.push(0);
      this.sort();
    }
    return id;
  }

  known(name: string): boolean {
    const id = this.ids.get(name);
    return id !== undefined && id !== EMPTY && this.vocab[id] !== 0;
  }
}

type State = [heroes: number[], skills: number[]];

interface Move {
  hero: boolean;
  p: number;
  q: number;
  /** A hero move that takes the hero's two skills along. */
  block: boolean;
}

interface Fixed {
  heroes: boolean[];
  skills: boolean[];
}

/** A searched placement: 9 hero slots and 18 skill slots (three per team), then the bench. */
export interface Lineup {
  score: number;
  heroes: number[];
  skills: number[];
}

export interface TeamView {
  /** Three names, '' for an empty slot. */
  heroes: string[];
  /** Two names per hero, '' for an empty slot. */
  skills: string[];
  /** Mean predicted win rate against common teams; null for a team without cards. */
  strength: number | null;
}

export interface LineupView {
  score: number;
  teams: TeamView[];
}

export interface RankedCards {
  cards: string[];
  lineup: LineupView;
}

export interface SupportResult {
  /** Score of the pool before any support card. */
  base: number;
  single: RankedCards[];
  /** Best pairs, when two cards were asked for. */
  pairs: RankedCards[];
}

export interface SupportOptions {
  restarts?: number;
  shortlist?: number;
  deep?: number;
}

function moves(h: number[], s: number[], fixed?: Fixed): Move[] {
  const out: Move[] = [];
  for (let p = 0; p < HERO_SLOTS; p++) {
    for (let q = p + 1; q < h.length; q++) {
      if ((q < HERO_SLOTS && ((p / 3) | 0) === ((q / 3) | 0)) || h[p] === h[q]) continue;
      if (fixed && (fixed.heroes[p] || fixed.heroes[q])) continue;
      out.push({ hero: true, p, q, block: false });
      if (
        q < HERO_SLOTS &&
        !(fixed && [2 * p, 2 * p + 1, 2 * q, 2 * q + 1].some((slot) => fixed.skills[slot]))
      ) {
        out.push({ hero: true, p, q, block: true });
      }
    }
  }
  for (let p = 0; p < SKILL_SLOTS; p++) {
    for (let q = p + 1; q < s.length; q++) {
      if ((q < SKILL_SLOTS && p >> 1 === q >> 1) || s[p] === s[q]) continue;
      if (fixed && (fixed.skills[p] || fixed.skills[q])) continue;
      out.push({ hero: false, p, q, block: false });
    }
  }
  return out;
}

function apply({ hero, p, q, block }: Move, h: number[], s: number[]): State {
  const heroes = h.slice();
  const skills = s.slice();
  if (!hero) {
    [skills[p], skills[q]] = [skills[q], skills[p]];
  } else {
    [heroes[p], heroes[q]] = [heroes[q], heroes[p]];
    if (block) {
      for (let k = 0; k < 2; k++) {
        [skills[2 * p + k], skills[2 * q + k]] = [skills[2 * q + k], skills[2 * p + k]];
      }
    }
  }
  return [heroes, skills];
}

/** Would the move leave a skill in a slot that has no hero? */
function orphans({ hero, p, q, block }: Move, h: number[], s: number[]): boolean {
  if (!hero) {
    return (
      (h[p >> 1] === EMPTY && s[q] !== EMPTY) ||
      (q < SKILL_SLOTS && h[q >> 1] === EMPTY && s[p] !== EMPTY)
    );
  }
  if (block || q >= HERO_SLOTS) return false;
  return [[p, q], [q, p]].some(
    ([a, b]) => h[b] === EMPTY && (s[2 * a] !== EMPTY || s[2 * a + 1] !== EMPTY)
  );
}

/** Skills in slots without a hero go to the bench. */
function carriedOnly(h: number[], s: number[]): State {
  const skills = s.slice();
  for (let p = 0; p < SKILL_SLOTS; p++) {
    if (h[p >> 1] === EMPTY && skills[p] !== EMPTY) {
      skills.push(skills[p]);
      skills[p] = EMPTY;
    }
  }
  return [h.slice(), skills];
}

/**
 * New cards fill empty slots first and go to the bench otherwise. With
 * `carried`, a skill only fills a slot whose hero is present.
 */
function addCards(h: number[], s: number[], cards: number[], kind: CardKind, carried = false): State {
  const heroes = h.slice();
  const skills = s.slice();
  const [items, slots] = kind === 'hero' ? [heroes, HERO_SLOTS] : [skills, SKILL_SLOTS];
  for (const card of cards) {
    let free = -1;
    for (let p = 0; p < slots && free < 0; p++) {
      if (items[p] === EMPTY && !(carried && heroes[p >> 1] === EMPTY)) free = p;
    }
    if (free >= 0) items[free] = card;
    else items.push(card);
  }
  return [heroes, skills];
}

function* combinations<T>(items: T[], size: number): Generator<T[]> {
  const picked: T[] = [];
  function* extend(from: number): Generator<T[]> {
    if (picked.length === size) {
      yield picked.slice();
      return;
    }
    for (let i = from; i <= items.length - (size - picked.length); i++) {
      picked.push(items[i]);
      yield* extend(i + 1);
      picked.pop();
    }
  }
  yield* extend(0);
}

const padded = (cards: number[], slots: number): number[] =>
  cards.length >= slots ? cards.slice() : [...cards, ...new Array<number>(slots - cards.length).fill(EMPTY)];

export class LineupEngine {
  private readonly heroes: Names;
  private readonly skills: Names;
  private teamCache = new Map<string, TeamValue>();
  private wishCache = new Map<string, Float32Array[]>();

  constructor(private readonly scorer: LineupScorer) {
    this.heroes = new Names(scorer.meta.heroes);
    this.skills = new Names(scorer.meta.skills);
  }

  get version(): string {
    return this.scorer.meta.version;
  }

  /** Names the model has never seen; they are scored as one generic unknown card. */
  unknown(heroes: string[], skills: string[]): { heroes: string[]; skills: string[] } {
    return {
      heroes: heroes.filter((name) => name !== '' && !this.heroes.known(name)),
      skills: skills.filter((name) => name !== '' && !this.skills.known(name)),
    };
  }

  private heroIds(names: string[]): number[] {
    return [...new Set(names.map((name) => this.heroes.id(name)))].filter((id) => id !== EMPTY);
  }

  private skillIds(names: string[]): number[] {
    return [...new Set(names.map((name) => this.skills.id(name)))].filter((id) => id !== EMPTY);
  }

  /** The team's cards in canonical order: heroes by name, each with its two skills by name. */
  private teamKey(h: number[], s: number[], team: number): string {
    const heroRank = this.heroes.rank;
    const skillRank = this.skills.rank;
    const members = [0, 1, 2].map((i) => {
      const a = s[6 * team + 2 * i];
      const b = s[6 * team + 2 * i + 1];
      return skillRank[a] <= skillRank[b] ? [h[3 * team + i], a, b] : [h[3 * team + i], b, a];
    });
    members.sort(
      (x, y) => heroRank[x[0]] - heroRank[y[0]] || skillRank[x[1]] - skillRank[y[1]] || skillRank[x[2]] - skillRank[y[2]]
    );
    return String.fromCharCode(
      members[0][0], members[1][0], members[2][0],
      members[0][1], members[0][2], members[1][1], members[1][2], members[2][1], members[2][2]
    );
  }

  private teamValue(key: string): TeamValue {
    let value = this.teamCache.get(key);
    if (!value) {
      if (this.teamCache.size >= TEAM_CACHE) this.teamCache = new Map();
      const cards: number[] = [];
      for (let i = 0; i < 9; i++) {
        cards.push((i < 3 ? this.heroes : this.skills).vocab[key.charCodeAt(i)]);
      }
      value = this.scorer.score(cards);
      this.teamCache.set(key, value);
    }
    return value;
  }

  private value(h: number[], s: number[]): number {
    return (
      this.teamValue(this.teamKey(h, s, 0)).score +
      this.teamValue(this.teamKey(h, s, 1)).score +
      this.teamValue(this.teamKey(h, s, 2)).score
    );
  }

  /** Estimated gain of each move from the model's own conditional distributions. */
  private gains(h: number[], s: number[], options: Move[]): Float64Array {
    const heroVocab = this.heroes.vocab;
    const skillVocab = this.skills.vocab;
    const { heroPrior, skillPrior } = this.scorer;
    const tables: TeamTables[] = [0, 1, 2].map((team) =>
      this.scorer.tables([
        ...h.slice(3 * team, 3 * team + 3).map((id) => heroVocab[id]),
        ...s.slice(6 * team, 6 * team + 6).map((id) => skillVocab[id]),
      ])
    );
    // Swap the cards at two slots of different teams, each read from that slot's table.
    const swap = (
      kind: 'one' | 'block',
      tx: number, sx: number, cx: number,
      ty: number, sy: number, cy: number
    ): number =>
      tables[tx][kind][sx][cy] - tables[tx][kind][sx][cx] + tables[ty][kind][sy][cx] - tables[ty][kind][sy][cy];

    const out = new Float64Array(options.length);
    options.forEach(({ hero, p, q, block }, n) => {
      if (!hero) {
        const cx = skillVocab[s[p]];
        const cy = skillVocab[s[q]];
        const tx = (p / 6) | 0;
        const sx = 3 + (p % 6);
        const ty = (q / 6) | 0;
        const sy = 3 + (q % 6);
        if (q >= SKILL_SLOTS) {
          const one = tables[tx].one[sx];
          out[n] = one[cy] - one[cx] - skillPrior[cy] + skillPrior[cx];
        } else if (tx === ty) {
          const { two } = tables[tx];
          out[n] = two[sx][sy][cy] - two[sx][sy][cx] + two[sy][sx][cx] - two[sy][sx][cy];
        } else {
          out[n] = swap('one', tx, sx, cx, ty, sy, cy);
        }
        return;
      }
      const cx = heroVocab[h[p]];
      const cy = heroVocab[h[q]];
      const tx = (p / 3) | 0;
      const sx = p % 3;
      if (q >= HERO_SLOTS) {
        const one = tables[tx].one[sx];
        out[n] = one[cy] - one[cx] - heroPrior[cy] + heroPrior[cx];
        return;
      }
      const ty = (q / 3) | 0;
      const sy = q % 3;
      if (!block) {
        out[n] = swap('one', tx, sx, cx, ty, sy, cy);
        return;
      }
      let gain = 0;
      for (let k = 0; k < 2; k++) {
        gain += swap(
          'block',
          tx, 3 + 2 * sx + k, skillVocab[s[2 * p + k]],
          ty, 3 + 2 * sy + k, skillVocab[s[2 * q + k]]
        );
      }
      out[n] = swap('block', tx, sx, cx, ty, sy, cy) + gain;
    });
    return out;
  }

  private wishes(heroes: number[]): Float32Array[] {
    const ids = heroes.map((id) => this.heroes.vocab[id]);
    const key = String.fromCharCode(...ids);
    let wishes = this.wishCache.get(key);
    if (!wishes) {
      if (this.wishCache.size >= WISH_CACHE) this.wishCache = new Map();
      wishes = this.scorer.skillWishes(ids);
      this.wishCache.set(key, wishes);
    }
    return wishes;
  }

  /**
   * Starting placements from the model: the best ways to split the heroes into
   * three teams by a heroes-only score, each with skills dealt greedily.
   */
  private starts(heroes: number[], skills: number[], count: number, carried: boolean): State[] {
    const heroRank = this.heroes.rank;
    const pool = heroes.filter((id) => id !== EMPTY).sort((a, b) => heroRank[a] - heroRank[b]);
    if (pool.length > START_HEROES) return [];
    const cards = skills.filter((id) => id !== EMPTY);
    const none = new Array<number>(6).fill(EMPTY);
    let groups: { heroes: number[]; mask: number; score: number }[] = [];
    for (let size = Math.max(0, Math.min(pool.length, HERO_SLOTS) - 6); size <= 3; size++) {
      for (const group of combinations(pool, size)) {
        const three = padded(group, 3);
        groups.push({
          heroes: three,
          mask: group.reduce((mask, id) => mask | (1 << pool.indexOf(id)), 0),
          score: this.teamValue(this.teamKey(three, none, 0)).score,
        });
      }
    }
    groups = groups
      .map((group, index) => ({ group, index }))
      .sort((a, b) => b.group.score - a.group.score || a.index - b.index)
      .slice(0, START_GROUPS)
      .map(({ group }) => group);

    const everyone = pool.length < HERO_SLOTS ? (1 << pool.length) - 1 : -1;
    const best: { total: number; teams: number[] }[] = [];
    for (let i = 0; i < groups.length && count > 0; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (groups[i].mask & groups[j].mask) continue;
        const both = groups[i].mask | groups[j].mask;
        const partial = groups[i].score + groups[j].score;
        for (let k = j + 1; k < groups.length; k++) {
          if (both & groups[k].mask) continue;
          if (everyone >= 0 && (both | groups[k].mask) !== everyone) continue;
          const total = partial + groups[k].score;
          if (best.length === count && total <= best[count - 1].total) continue;
          let at = best.length;
          while (at > 0 && best[at - 1].total < total) at--;
          best.splice(at, 0, { total, teams: [i, j, k] });
          if (best.length > count) best.pop();
        }
      }
    }

    const { skillPrior } = this.scorer;
    const cardVocab = cards.map((id) => this.skills.vocab[id]);
    return best.map(({ teams }) => {
      const h = teams.flatMap((team) => groups[team].heroes);
      const wish: number[] = [];
      teams.forEach((team) => {
        for (const slot of this.wishes(groups[team].heroes)) {
          for (const id of cardVocab) wish.push(slot[id] - skillPrior[id]);
        }
      });
      const order = wish.map((_, index) => index).sort((a, b) => wish[b] - wish[a] || a - b);
      const s = new Array<number>(SKILL_SLOTS).fill(EMPTY);
      const used = new Set<number>();
      for (const index of order) {
        const slot = (index / cards.length) | 0;
        const card = index % cards.length;
        if (s[slot] === EMPTY && !used.has(card) && !(carried && h[slot >> 1] === EMPTY)) {
          s[slot] = cards[card];
          used.add(card);
        }
      }
      return [
        [...h, ...pool.filter((id) => !h.includes(id))],
        [...s, ...cards.filter((_, card) => !used.has(card))],
      ] as State;
    });
  }

  /**
   * Hill climbing from model-built starts (or from `starts` only, when `fixed`
   * slots must keep their cards). Each step scores the estimated-best moves
   * exactly. With `carried`, every skill needs a hero: surplus skills stay on
   * the bench instead of waiting in a slot without one.
   */
  private search(
    poolHeroes: number[],
    poolSkills: number[],
    restarts: number,
    { starts = [], fixed, carried = false, onStart }: {
      starts?: State[];
      fixed?: Fixed;
      carried?: boolean;
      onStart?: () => void;
    } = {}
  ): Lineup {
    const heroes = padded(poolHeroes, HERO_SLOTS);
    const skills = padded(poolSkills, SKILL_SLOTS);
    const initial = starts.slice();
    if (!fixed) {
      if (restarts) initial.push(...this.starts(heroes, skills, restarts, carried));
      if (!initial.length) initial.push(carried ? carriedOnly(heroes, skills) : [heroes, skills]);
    }
    let best: Lineup | null = null;
    for (let [h, s] of initial) {
      let value = this.value(h, s);
      for (;;) {
        const options = carried
          ? moves(h, s, fixed).filter((move) => !orphans(move, h, s))
          : moves(h, s, fixed);
        const gains = this.gains(h, s, options);
        const order = options
          .map((_, index) => index)
          .sort((a, b) => gains[b] - gains[a] || a - b)
          .slice(0, PATIENCE);
        let next: State | null = null;
        let nextValue = -Infinity;
        for (let start = 0; start < order.length && !next; start += TOP) {
          let top: State | null = null;
          for (const index of order.slice(start, start + TOP)) {
            const state = apply(options[index], h, s);
            const score = this.value(state[0], state[1]);
            if (score > nextValue) {
              nextValue = score;
              top = state;
            }
          }
          if (nextValue > value + 1e-9) next = top;
          else nextValue = -Infinity;
        }
        if (!next) break;
        [h, s] = next;
        value = nextValue;
      }
      if (!best || value > best.score) best = { score: value, heroes: h, skills: s };
      onStart?.();
    }
    return best as Lineup;
  }

  private view({ score, heroes, skills }: Lineup): LineupView {
    return {
      score,
      teams: [0, 1, 2].map((team) => {
        const h = heroes.slice(3 * team, 3 * team + 3);
        const s = skills.slice(6 * team, 6 * team + 6);
        return {
          heroes: h.map((id) => this.heroes.names[id]),
          skills: s.map((id) => this.skills.names[id]),
          strength: [...h, ...s].some((id) => id !== EMPTY)
            ? this.teamValue(this.teamKey(heroes, skills, team)).strength
            : null,
        };
      }),
    };
  }

  /** Best three teams for a pool; every placed skill is carried by a hero. */
  lineup(heroes: string[], skills: string[], restarts = 18, onProgress?: () => void): LineupView {
    return this.view(
      this.search(this.heroIds(heroes), this.skillIds(skills), restarts, {
        carried: true,
        onStart: onProgress,
      })
    );
  }

  /**
   * Keep every card already placed in the layout (9 hero slots, 18 skill
   * slots, '' for empty) and fill the empty slots from the rest of the pool.
   */
  fill(
    layoutHeroes: string[],
    layoutSkills: string[],
    poolHeroes: string[],
    poolSkills: string[],
    restarts = 4
  ): LineupView {
    const h = layoutHeroes.map((name) => this.heroes.id(name));
    const s = layoutSkills.map((name) => this.skills.id(name));
    const spare = [
      this.heroIds(poolHeroes).filter((id) => !h.includes(id)),
      this.skillIds(poolSkills).filter((id) => !s.includes(id)),
    ];
    const starts = Array.from({ length: restarts }, (_, r): State => {
      const [heroes, skills] = spare.map((cards) =>
        cards.length ? [...cards.slice(r % cards.length), ...cards.slice(0, r % cards.length)] : cards
      );
      return addCards(...addCards(h, s, heroes, 'hero'), skills, 'skill', true);
    });
    return this.view(
      this.search([], [], 0, {
        starts,
        fixed: { heroes: h.map((id) => id !== EMPTY), skills: s.map((id) => id !== EMPTY) },
        carried: true,
      })
    );
  }

  /** Strength of each team of a layout as it stands. */
  evaluate(layoutHeroes: string[], layoutSkills: string[]): (number | null)[] {
    const heroes = layoutHeroes.map((name) => this.heroes.id(name));
    const skills = layoutSkills.map((name) => this.skills.id(name));
    return this.view({ score: 0, heroes, skills }).teams.map((team) => team.strength);
  }

  private pickLineups(
    heroes: number[],
    skills: number[],
    options: number[][],
    kind: CardKind,
    restarts: number,
    deepen: number,
    onProgress?: () => void
  ): { first: Lineup[]; deepened: Lineup[] } {
    const base = this.search(heroes, skills, restarts);
    const first = options.map((option) => {
      const found = this.search([], [], 0, { starts: [addCards(base.heroes, base.skills, option, kind)] });
      onProgress?.();
      return found;
    });
    const deepened = first.map((found, index) => {
      if (!deepen) return found;
      const again =
        kind === 'hero'
          ? this.search([...heroes, ...options[index]], skills, deepen)
          : this.search(heroes, [...skills, ...options[index]], deepen);
      onProgress?.();
      return again.score > found.score ? again : found;
    });
    return { first, deepened };
  }

  /**
   * Three-choice: the best lineup of the pool with each offered set added.
   * `first` starts from the pool's own best lineup; `deepened` also searches
   * each enlarged pool from scratch and keeps the better result.
   */
  pick(
    heroes: string[],
    skills: string[],
    options: string[][],
    kind: CardKind,
    restarts = 6,
    deepen = 2,
    onProgress?: () => void
  ): { first: LineupView[]; deepened: LineupView[] } {
    const names = kind === 'hero' ? this.heroes : this.skills;
    const { first, deepened } = this.pickLineups(
      this.heroIds(heroes),
      this.skillIds(skills),
      options.map((option) => option.map((name) => names.id(name))),
      kind,
      restarts,
      deepen,
      onProgress
    );
    return { first: first.map((found) => this.view(found)), deepened: deepened.map((found) => this.view(found)) };
  }

  /**
   * Support pick: rank every candidate by the best lineup of the pool with it
   * added, then pairs of the leading candidates when two cards are wanted.
   */
  support(
    heroes: string[],
    skills: string[],
    kind: CardKind,
    count: number,
    candidates: string[],
    { restarts = 6, shortlist = 10, deep = 5 }: SupportOptions = {},
    onProgress?: (done: number, total: number) => void
  ): SupportResult {
    const names = kind === 'hero' ? this.heroes : this.skills;
    const h = this.heroIds(heroes);
    const s = this.skillIds(skills);
    const own = new Set(kind === 'hero' ? h : s);
    const singles = [...new Set(candidates)]
      .sort(compareNames)
      .map((name) => names.id(name))
      .filter((id) => id !== EMPTY && !own.has(id));
    const pairCount = count === 1 ? 0 : (Math.min(shortlist, singles.length) * (Math.min(shortlist, singles.length) - 1)) / 2;
    const total = singles.length + pairCount + Math.min(deep, count === 1 ? singles.length : pairCount);
    let done = 0;
    const step = () => onProgress?.(++done, total);

    const base = this.search(h, s, restarts);
    type Row = { cards: number[]; lineup: Lineup };
    const byScore = (rows: Row[]): Row[] =>
      rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => b.row.lineup.score - a.row.lineup.score || a.index - b.index)
        .map(({ row }) => row);
    const rank = (options: number[][]): Row[] =>
      byScore(
        options.map((cards) => {
          const lineup = this.search([], [], 0, { starts: [addCards(base.heroes, base.skills, cards, kind)] });
          step();
          return { cards, lineup };
        })
      );
    const refine = (rows: Row[]): Row[] => {
      for (const row of rows.slice(0, deep)) {
        const again =
          kind === 'hero' ? this.search([...h, ...row.cards], s, 2) : this.search(h, [...s, ...row.cards], 2);
        if (again.score > row.lineup.score) row.lineup = again;
        step();
      }
      return byScore(rows);
    };
    const views = (rows: Row[]): RankedCards[] =>
      rows.map(({ cards, lineup }) => ({ cards: cards.map((id) => names.names[id]), lineup: this.view(lineup) }));

    const single = rank(singles.map((id) => [id]));
    if (count === 1) return { base: base.score, single: views(refine(single)), pairs: [] };
    const leaders = single.slice(0, shortlist).map((row) => row.cards[0]);
    const pairs = rank([...combinations(leaders, 2)]);
    return { base: base.score, single: views(single), pairs: views(refine(pairs)) };
  }
}
