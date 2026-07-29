import type { FormationRecommendation } from './recommendationEngine';

export type TeamFormationStage = 'matching' | 'optimizing';

export interface TeamFormationWorkerRequest {
  requestId: string;
  heroes: string[];
  skills: string[];
}

export type TeamFormationWorkerResponse =
  | {
      type: 'progress';
      requestId: string;
      stage: TeamFormationStage;
    }
  | {
      type: 'result';
      requestId: string;
      recommendation: FormationRecommendation;
    }
  | {
      type: 'error';
      requestId: string;
      message: string;
    };
