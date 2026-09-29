import type { TeamLayout } from './teamLayout';

export interface TeamFormationWorkerRequest {
  requestId: number;
  heroes: string[];
  skills: string[];
  /** Fill this layout's empty slots instead of allocating from scratch. */
  layout?: TeamLayout;
}

export type TeamFormationWorkerResponse =
  | { requestId: number; layout: TeamLayout }
  | { requestId: number; error: string };
