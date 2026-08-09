import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  gameDatabaseSchema,
  recommendationDataSchema,
  type GameDatabase,
  type RecommendationData,
} from './schemas.js';

export interface GameKnowledge {
  database: GameDatabase;
  recommendation: RecommendationData;
}

export interface GameDataPaths {
  database: string;
  recommendation: string;
}

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function defaultGameDataPaths(): GameDataPaths {
  return {
    database: resolve(agentRoot, '../web/public/game-data/database.json'),
    recommendation: resolve(agentRoot, '../web/src/recommendation_data.json'),
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

export async function loadGameKnowledge(
  paths: GameDataPaths = defaultGameDataPaths()
): Promise<GameKnowledge> {
  const [database, recommendation] = await Promise.all([
    readJson(paths.database),
    readJson(paths.recommendation),
  ]);
  return {
    database: gameDatabaseSchema.parse(database),
    recommendation: recommendationDataSchema.parse(recommendation),
  };
}
