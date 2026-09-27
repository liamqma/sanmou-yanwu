import type { TeamLayout } from './teamLayout';

export interface TeamFormationWorkerRequest {
  requestId: number;
  heroes: string[];
  skills: string[];
}

export type TeamFormationWorkerResponse =
  | { requestId: number; layout: TeamLayout }
  | { requestId: number; error: string };
