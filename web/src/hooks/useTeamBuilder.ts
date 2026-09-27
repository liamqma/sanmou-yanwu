import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { recommendationData } from '../data';
import { allocateTeams, evaluateLayout } from '../services/teamAllocation';
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
  const workerRef = useRef<Worker | null | undefined>(undefined);
  const requestRef = useRef(0);

  useEffect(() => () => workerRef.current?.terminate(), []);

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

    const requestId = ++requestRef.current;
    let timer: number | undefined;
    const finish = (layout: TeamLayout) => {
      if (requestId !== requestRef.current) return;
      autoLayouts.set(poolKey, layout);
      setAllocating(false);
      setState((current) => (current.mode === 'auto' ? { mode: 'auto', poolKey, layout } : current));
    };
    const runHere = () => {
      timer = window.setTimeout(() => finish(allocateTeams(heroes, skills, recommendationData)), 0);
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
      worker.postMessage({ requestId, heroes, skills });
    }
    return () => window.clearTimeout(timer);
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
  };
}
