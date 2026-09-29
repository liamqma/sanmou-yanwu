import { recommendationData } from '../data';
import { allocateTeams, fillTeams } from '../services/teamAllocation';
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

workerScope.addEventListener('message', ({ data: { requestId, heroes, skills, layout } }) => {
  try {
    workerScope.postMessage({
      requestId,
      layout: layout
        ? fillTeams(layout, heroes, skills, recommendationData)
        : allocateTeams(heroes, skills, recommendationData),
    });
  } catch (error) {
    workerScope.postMessage({
      requestId,
      error: error instanceof Error ? error.message : 'Team allocation failed',
    });
  }
});
