/**
 * Central typed boundary for the bundled JSON data.
 *
 * The raw JSON is imported once and cast to the hand-written domain types. We
 * cast (rather than rely on `resolveJsonModule` inference) because inference on
 * the ~1.2 MB battle_stats.json produces an enormous literal-keyed type that
 * breaks the dynamic string-keyed access the app does everywhere.
 */
import databaseRaw from './database.json';
import battleStatsRaw from './battle_stats.json';
import type { Database } from './types/domain';
import type { BattleStats } from './types/battleStats';

export const database = databaseRaw as unknown as Database;
export const battleStats = battleStatsRaw as unknown as BattleStats;
