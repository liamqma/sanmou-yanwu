/** Strict public battle-report upload contract. */
export interface UploadedHero {
  name: string;
  /** Signature skill first, followed by the two equipped skills. */
  skills: [string, string, string];
}

export type UploadedTeam = [UploadedHero, UploadedHero, UploadedHero];

export interface UploadedBattle {
  '1': UploadedTeam;
  '2': UploadedTeam;
  winner: '1' | '2';
}

/** Editable confirmation form; empty strings represent incomplete fields. */
export interface BattleConfirmation {
  '1': UploadedTeam;
  '2': UploadedTeam;
  winner: '' | '1' | '2';
}

export interface BattleUploadRequest {
  submission_id: string;
  /** Always sent, including the explicit empty string. */
  uploader_name: string;
  season: number;
  battle: UploadedBattle;
}

export interface BattleUploadSuccess {
  ok: true;
  accepted?: number;
  duplicates?: number;
}

export interface UploadLeaderboardContributor {
  name: string;
  accepted_reports: number;
}

export interface UploadLeaderboardData {
  schema_version: 1;
  /** Date of the highest processed source row, never the browser's current date. */
  updated_date: string | null;
  updated_through_id: number;
  summary: {
    processed_reports: number;
    accepted_reports: number;
    rejected_reports: number;
  };
  contributors: UploadLeaderboardContributor[];
}
