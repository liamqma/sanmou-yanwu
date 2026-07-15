/**
 * Central typed boundary for the bundled JSON data.
 *
 * The raw JSON is imported once and cast to the hand-written domain types. We
 * cast (rather than rely on `resolveJsonModule` inference) because inference on
 * the large generated artifact produces an enormous literal-keyed type that
 * breaks the dynamic string-keyed access the app does everywhere.
 *
 * `recommendation_data.json` is generated offline by
 * `data/build_recommendation_data.py`; never hand-edit it.
 */
import databaseRaw from './database.json';
import recommendationRaw from './recommendation_data.json';
import type { Database } from './types/domain';
import type { RecommendationData } from './types/recommendation';

export const database = databaseRaw as unknown as Database;
export const recommendationData = recommendationRaw as unknown as RecommendationData;
