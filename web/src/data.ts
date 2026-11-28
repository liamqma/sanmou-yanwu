import databaseRaw from 'virtual:game-database';
import catalogVersion from 'virtual:catalog-version';
import lineupModel from 'virtual:lineup-model';
import type { GameplayDatabase } from './types/domain';

// Cast rather than infer: the inferred literal type breaks string-keyed access.
export const database = databaseRaw as unknown as GameplayDatabase;

/** Hash of the catalog fields that change draft availability; telemetry is keyed on it. */
export const CATALOG_VERSION = catalogVersion;

/** Battles the shipped lineup model was trained on. */
export const TRAINING_BATTLES = lineupModel.battles;

/** Hero -> signature skill, which that hero cannot carry as an extra skill. */
export const defaultSkill: Record<string, string> = Object.fromEntries(
  Object.entries(database.heroes).map(([name, hero]) => [name, hero.skill])
);
