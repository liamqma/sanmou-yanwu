import { database, recommendationData } from '../data';
import {
  recommendHybridTeams,
  type HeroMeta,
} from '../services/recommendationEngine';
import type {
  TeamFormationWorkerRequest,
  TeamFormationWorkerResponse,
} from '../services/teamFormationWorkerProtocol';

const heroMeta: HeroMeta = Object.fromEntries(
  Object.entries(database.heroes || {}).map(([name, hero]) => [
    name,
    { camp: hero.camp },
  ])
);

const workerScope = self as unknown as {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<TeamFormationWorkerRequest>) => void
  ) => void;
  postMessage: (message: TeamFormationWorkerResponse) => void;
};

workerScope.addEventListener('message', ({ data }) => {
  const { requestId, heroes, skills } = data;
  workerScope.postMessage({
    type: 'progress',
    requestId,
    stage: 'matching',
  });

  // Yield once inside the worker so the progress message reaches the page
  // before the synchronous bounded optimiser starts.
  setTimeout(() => {
    workerScope.postMessage({
      type: 'progress',
      requestId,
      stage: 'optimizing',
    });
    try {
      const recommendation = recommendHybridTeams(
        heroes,
        skills,
        recommendationData,
        recommendationData.catalog,
        heroMeta,
        database.team || []
      );
      workerScope.postMessage({
        type: 'result',
        requestId,
        recommendation,
      });
    } catch (error) {
      workerScope.postMessage({
        type: 'error',
        requestId,
        message:
          error instanceof Error
            ? error.message
            : 'Unknown formation worker error',
      });
    }
  }, 0);
});
