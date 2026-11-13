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
