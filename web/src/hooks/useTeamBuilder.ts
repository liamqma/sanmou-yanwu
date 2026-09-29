import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { recommendationData } from '../data';
import { allocateTeams, evaluateLayout, fillTeams } from '../services/teamAllocation';
import type { TeamFormationWorkerResponse } from '../services/teamFormationWorkerProtocol';
import {
  applyMove,
  emptyLayout,
  layoutPoolKey,
  normalizeLayout,
  parseStoredTeamBuilder,
  placedItems,
  TEAM_BUILDER_STORAGE_VERSION,
  type MoveSource,
  type MoveTarget,
  type TeamBuilderMode,
  type TeamLayout,
} from '../services/teamLayout';
import { storage } from '../utils/storage';

const defaultSkill = recommendationData.catalog.default_skill;
const autoLayouts = new Map<string, TeamLayout>();

interface State {
  mode: TeamBuilderMode;
  /** Pool the layout belongs to; differs from the current pool while auto mode re-allocates. */
  poolKey: string;
  layout: TeamLayout;
}

function initialState(heroes: string[], skills: string[], poolKey: string): State {
  const stored = parseStoredTeamBuilder(storage.loadTeamBuilder());
  if (!stored) return { mode: 'auto', poolKey: '', layout: emptyLayout() };
  const layout = normalizeLayout(stored.layout, heroes, skills, defaultSkill);
  const current = stored.mode === 'manual' || stored.poolKey === poolKey;
  return { mode: stored.mode, poolKey: current ? poolKey : '', layout };
}

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('../workers/teamFormation.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
}

/** Three-team layout for the pool: auto-allocated until the user moves something. */
export function useTeamBuilder(heroes: string[], skills: string[]) {
  const poolKey = layoutPoolKey(heroes, skills);
  const [state, setState] = useState<State>(() => initialState(heroes, skills, poolKey));
  const [allocating, setAllocating] = useState(false);
  // The layout a fill could not add anything to.
  const [unfillable, setUnfillable] = useState<TeamLayout | null>(null);
  const workerRef = useRef<Worker | null | undefined>(undefined);
  const requestRef = useRef(0);

  useEffect(() => () => workerRef.current?.terminate(), []);

  /** Allocate from scratch, or fill `start`, in the worker. Only the latest request finishes. */
  const run = useCallback(
    (start: TeamLayout | undefined, done: (layout: TeamLayout) => void) => {
      const requestId = ++requestRef.current;
      let timer: number | undefined;
      const finish = (layout: TeamLayout) => {
        if (requestId !== requestRef.current) return;
        setAllocating(false);
        done(layout);
      };
      const runHere = () => {
        timer = window.setTimeout(
          () =>
            finish(
              start
                ? fillTeams(start, heroes, skills, recommendationData)
                : allocateTeams(heroes, skills, recommendationData)
            ),
          0
        );
      };

      setAllocating(true);
      if (workerRef.current === undefined) workerRef.current = createWorker();
      const worker = workerRef.current;
      if (!worker) {
        runHere();
      } else {
        worker.onmessage = ({ data }: MessageEvent<TeamFormationWorkerResponse>) => {
          if (data.requestId !== requestId) return;
          if ('layout' in data) finish(data.layout);
          else runHere();
        };
        worker.onerror = () => {
          worker.terminate();
          workerRef.current = null;
          runHere();
        };
        worker.postMessage({ requestId, heroes, skills, layout: start });
      }
      return () => window.clearTimeout(timer);
    },
    [heroes, skills]
  );

  useEffect(() => {
    if (state.poolKey === poolKey) return;
    if (state.mode === 'manual') {
      setState((current) => ({
        ...current,
        poolKey,
        layout: normalizeLayout(current.layout, heroes, skills, defaultSkill),
      }));
      return;
    }
    const cached = autoLayouts.get(poolKey);
    if (cached) {
      setState({ mode: 'auto', poolKey, layout: cached });
      return;
    }
    return run(undefined, (layout) => {
      autoLayouts.set(poolKey, layout);
      setState((current) => (current.mode === 'auto' ? { mode: 'auto', poolKey, layout } : current));
    });
  }, [poolKey, state.mode, state.poolKey]);

  useEffect(() => {
    storage.saveTeamBuilder({
      version: TEAM_BUILDER_STORAGE_VERSION,
      mode: state.mode,
      poolKey: state.poolKey,
      layout: state.layout,
    });
  }, [state]);

  const move = useCallback(
    (source: MoveSource, target: MoveTarget) => {
      const layout = applyMove(state.layout, source, target, defaultSkill);
      if (layout === state.layout) return;
      requestRef.current++;
      setAllocating(false);
      setState({ mode: 'manual', poolKey: state.poolKey, layout });
    },
    [state]
  );

  const restoreAuto = useCallback(() => {
    setState((current) => ({ ...current, mode: 'auto', poolKey: '' }));
  }, []);

  const fillRemaining = useCallback(() => {
    const start = state.layout;
    const before = placedItems(start);
    run(start, (layout) => {
      const after = placedItems(layout);
      if (after.heroes.size + after.skills.size === before.heroes.size + before.skills.size) {
        setUnfillable(start);
        return;
      }
      setState((current) => (current.layout === start ? { ...current, layout } : current));
    });
  }, [run, state.layout]);

  const evaluation = useMemo(() => evaluateLayout(state.layout, recommendationData), [state.layout]);
  const placed = useMemo(() => placedItems(state.layout), [state.layout]);

  return {
    layout: state.layout,
    mode: state.mode,
    allocating,
    evaluation,
    placed,
    move,
    restoreAuto,
    fillRemaining,
    nothingToFill: unfillable === state.layout,
  };
}
