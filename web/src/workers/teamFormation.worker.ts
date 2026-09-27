import { recommendationData } from '../data';
import { allocateTeams } from '../services/teamAllocation';
import type {
  TeamFormationWorkerRequest,
  TeamFormationWorkerResponse,
} from '../services/teamFormationWorkerProtocol';

const workerScope = self as unknown as {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<TeamFormationWorkerRequest>) => void
  ) => void;
  postMessage: (message: TeamFormationWorkerResponse) => void;
};

workerScope.addEventListener('message', ({ data: { requestId, heroes, skills } }) => {
  try {
    workerScope.postMessage({
      requestId,
      layout: allocateTeams(heroes, skills, recommendationData),
    });
  } catch (error) {
    workerScope.postMessage({
      requestId,
      error: error instanceof Error ? error.message : 'Team allocation failed',
    });
  }
});
