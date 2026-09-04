export const DAILY_YANWU_DRAW_SIZE = 3;
export const DAILY_YANWU_FIXTURE_QUERY = 'dailyYanwuFixture';
const DAILY_YANWU_REFERENCE_FIXTURE = [
  '黄盖',
  '张宝',
  '李儒',
] as const;

export type DailyYanwuRng = () => number;

interface DailyYanwuDrawOptions {
  heroes: readonly string[];
  excludedHero: string;
  rng?: DailyYanwuRng;
}

/**
 * Draw three unique locally-backed heroes while excluding the shared starter.
 * A caller can inject an RNG for deterministic tests without changing normal
 * production randomness.
 */
export const drawDailyYanwuHeroes = ({
  heroes,
  excludedHero,
  rng = Math.random,
}: DailyYanwuDrawOptions): [string, string, string] => {
  const candidates = [...new Set(heroes)].filter(
    (hero) => hero !== excludedHero
  );
  if (candidates.length < DAILY_YANWU_DRAW_SIZE) {
    throw new RangeError('每天演武至少需要三名可抽取武将');
  }

  for (let index = 0; index < DAILY_YANWU_DRAW_SIZE; index += 1) {
    const randomValue = rng();
    if (
      !Number.isFinite(randomValue) ||
      randomValue < 0 ||
      randomValue >= 1
    ) {
      throw new RangeError('每天演武 RNG 必须返回 [0, 1) 范围内的数值');
    }
    const chosenIndex =
      index + Math.floor(randomValue * (candidates.length - index));
    [candidates[index], candidates[chosenIndex]] = [
      candidates[chosenIndex],
      candidates[index],
    ];
  }

  return [candidates[0], candidates[1], candidates[2]];
};

/** URL-only fixture used by Playwright and visual review. */
export const dailyYanwuFixtureFromSearch = (
  search: string
): [string, string, string] | null => {
  const fixture = new URLSearchParams(search).get(
    DAILY_YANWU_FIXTURE_QUERY
  );
  return fixture === 'reference'
    ? [...DAILY_YANWU_REFERENCE_FIXTURE]
    : null;
};
