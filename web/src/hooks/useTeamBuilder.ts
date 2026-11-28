import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultSkill } from '../data';
import { LineupSuperseded, runLineup } from '../services/lineupClient';
import type { LayoutEvaluation } from '../services/lineupProtocol';
import {
  applyMove,
  emptyLayout,
  layoutCards,
  layoutFromTeams,
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

const autoLayouts = new Map<string, TeamLayout>();
const NOT_EVALUATED: LayoutEvaluation = {
  strengths: [null, null, null],
  unknown: { heroes: [], skills: [] },
};

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

/** Three-team layout for the pool: allocated by the lineup model until the user moves something. */
export function useTeamBuilder(heroes: string[], skills: string[]) {
  const poolKey = layoutPoolKey(heroes, skills);
  const [state, setState] = useState<State>(() => initialState(heroes, skills, poolKey));
  const [allocating, setAllocating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [evaluated, setEvaluated] = useState<{ layout: TeamLayout; value: LayoutEvaluation } | null>(null);
  const requestRef = useRef(0);

  useEffect(
    () => () => {
      requestRef.current++;
    },
    []
  );

  // While auto mode waits for the new pool's teams, show the old ones without cards that left.
  const layout = useMemo(
    () =>
      state.poolKey === poolKey
        ? state.layout
        : normalizeLayout(state.layout, heroes, skills, defaultSkill),
    [state.layout, state.poolKey, poolKey]
  );

  /** Allocate from scratch, or fill `start`, in the worker. Only the latest request finishes. */
  const run = useCallback(
    (start: TeamLayout | undefined, done: (layout: TeamLayout) => void) => {
      const requestId = ++requestRef.current;
      setAllocating(true);
      setProgress(0);
      setError(null);
      (start
        ? runLineup('fill', { ...layoutCards(start), heroes, skills })
        : runLineup('lineup', { heroes, skills }, (done) => {
            if (requestId === requestRef.current) setProgress(done);
          })
      ).then(
        ({ teams }) => {
          if (requestId !== requestRef.current) return;
          setAllocating(false);
          done(layoutFromTeams(teams, !start));
        },
        (failure: Error) => {
          if (requestId !== requestRef.current || failure instanceof LineupSuperseded) return;
          setAllocating(false);
          setError(failure.message);
        }
      );
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
    run(undefined, (allocated) => {
      autoLayouts.set(poolKey, allocated);
      setState((current) =>
        current.mode === 'auto' ? { mode: 'auto', poolKey, layout: allocated } : current
      );
    });
  }, [poolKey, state.mode, state.poolKey, attempt]);

  useEffect(() => {
    storage.saveTeamBuilder({
      version: TEAM_BUILDER_STORAGE_VERSION,
      mode: state.mode,
      poolKey: state.poolKey,
      layout: state.layout,
    });
  }, [state]);

  useEffect(() => {
    let current = true;
    runLineup('evaluate', layoutCards(layout)).then(
      (value) => {
        if (current) setEvaluated({ layout, value });
      },
      () => {
        // Superseded by a newer layout, or the model is unavailable: allocation reports that.
      }
    );
    return () => {
      current = false;
    };
  }, [layout]);

  const move = useCallback(
    (source: MoveSource, target: MoveTarget) => {
      const moved = applyMove(layout, source, target, defaultSkill);
      if (moved === layout) return;
      requestRef.current++;
      setAllocating(false);
      setState({ mode: 'manual', poolKey, layout: moved });
    },
    [layout, poolKey]
  );

  const restoreAuto = useCallback(() => {
    setState((current) => ({ ...current, mode: 'auto', poolKey: '' }));
  }, []);

  const fillRemaining = useCallback(() => {
    const start = layout;
    run(start, (filled) => {
      setState((current) => (current.layout === start ? { ...current, layout: filled } : current));
    });
  }, [run, layout]);

  const placed = useMemo(() => placedItems(layout), [layout]);

  return {
    layout,
    mode: state.mode,
    allocating,
    progress,
    error,
    retry: useCallback(() => setAttempt((count) => count + 1), []),
    evaluation: evaluated?.layout === layout ? evaluated.value : NOT_EVALUATED,
    placed,
    move,
    restoreAuto,
    fillRemaining,
  };
}
