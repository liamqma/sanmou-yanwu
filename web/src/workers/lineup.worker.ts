import { LineupScorer, type LineupModelMeta } from '../services/lineupModel';
import { LineupEngine } from '../services/lineupSearch';
import type {
  LineupRequest,
  LineupResponse,
  LineupTask,
  LineupTasks,
} from '../services/lineupProtocol';

const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<LineupRequest>) => void) => void;
  postMessage: (message: LineupResponse) => void;
};

const MODEL_URL = '/game-data/lineup_model';
const LINEUP_STARTS = 18;

let engine: Promise<LineupEngine> | null = null;

const loadEngine = (): Promise<LineupEngine> => {
  engine ??= (async () => {
    const meta = (await (await fetch(`${MODEL_URL}.json`, { cache: 'no-cache' })).json()) as LineupModelMeta;
    const weights = await fetch(`${MODEL_URL}.bin?v=${encodeURIComponent(meta.version)}`);
    if (!weights.ok) throw new Error(`lineup model weights: HTTP ${weights.status}`);
    return new LineupEngine(new LineupScorer(meta, await weights.arrayBuffer()));
  })();
  engine.catch(() => {
    engine = null;
  });
  return engine;
};

type Run = {
  [Task in LineupTask]: (
    engine: LineupEngine,
    input: LineupTasks[Task]['input'],
    progress: (done: number, total: number) => void
  ) => LineupTasks[Task]['output'];
};

const run: Run = {
  lineup: (lineup, { heroes, skills }, progress) => {
    let starts = 0;
    return lineup.lineup(heroes, skills, LINEUP_STARTS, () => progress(++starts, LINEUP_STARTS));
  },
  fill: (lineup, { layoutHeroes, layoutSkills, heroes, skills }) =>
    lineup.fill(layoutHeroes, layoutSkills, heroes, skills),
  evaluate: (lineup, { layoutHeroes, layoutSkills }) => ({
    strengths: lineup.evaluate(layoutHeroes, layoutSkills),
    unknown: lineup.unknown(layoutHeroes, layoutSkills),
  }),
  pick: (lineup, { heroes, skills, options, kind }, progress) => {
    let done = 0;
    const total = 2 * options.length;
    const { deepened } = lineup.pick(heroes, skills, options, kind, undefined, undefined, () =>
      progress(++done, total)
    );
    const offered = options.flat();
    return {
      version: lineup.version,
      recommended: deepened.reduce((best, found, index) => (found.score > deepened[best].score ? index : best), 0),
      options: deepened,
      unknown: lineup.unknown(
        kind === 'hero' ? [...heroes, ...offered] : heroes,
        kind === 'skill' ? [...skills, ...offered] : skills
      ),
    };
  },
  support: (lineup, { heroes, skills, kind, count, candidates }, progress) => {
    const known = lineup.unknown(kind === 'hero' ? candidates : [], kind === 'skill' ? candidates : []);
    const unseen = new Set(kind === 'hero' ? known.heroes : known.skills);
    const found = lineup.support(
      heroes,
      skills,
      kind,
      count,
      candidates.filter((name) => !unseen.has(name)),
      undefined,
      progress
    );
    return { ...found, recommended: (found.pairs[0] ?? found.single[0])?.cards ?? [] };
  },
};

const queue: LineupRequest[] = [];
let draining = false;

const drain = async (): Promise<void> => {
  const request = queue.shift();
  if (!request) {
    draining = false;
    return;
  }
  const { id, task } = request;
  if (queue.some((later) => later.task === task)) {
    scope.postMessage({ id, superseded: true });
  } else {
    try {
      const handler = run[task] as (
        engine: LineupEngine,
        input: unknown,
        progress: (done: number, total: number) => void
      ) => unknown;
      const output = handler(await loadEngine(), request.input, (done, total) =>
        scope.postMessage({ id, progress: Math.min(done / total, 1) })
      );
      scope.postMessage({ id, output });
    } catch (error) {
      scope.postMessage({ id, error: error instanceof Error ? error.message : 'Lineup model failed' });
    }
  }
  // A timer lets requests that arrived meanwhile join the queue first.
  setTimeout(drain, 0);
};

scope.addEventListener('message', ({ data }) => {
  queue.push(data);
  if (!draining) {
    draining = true;
    setTimeout(drain, 0);
  }
});
