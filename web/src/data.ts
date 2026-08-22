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
import databaseRaw from 'virtual:game-database';
import recommendationRaw from './recommendation_data.json';
import type { GameplayDatabase } from './types/domain';
import type { RecommendationData } from './types/recommendation';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Fail closed at the single typed boundary; runtime code never parses descriptions. */
export function validateRecommendationData(value: unknown): RecommendationData {
  if (!object(value) || !object(value.schema) || !object(value.catalog) || !object(value.model)) {
    throw new Error('recommendation artifact has an invalid top-level contract');
  }
  const { schema, catalog, model } = value;
  if (schema.version !== 6 || typeof catalog.mechanics_version !== 'string' || !catalog.mechanics_version) {
    throw new Error('recommendation artifact has missing or stale mechanics metadata');
  }
  if (!object(catalog.default_skill) || !object(catalog.hero_camp) || !Array.isArray(catalog.bonds) || !object(catalog.skill_mechanics)) {
    throw new Error('recommendation artifact has an invalid team-context catalog');
  }
  for (const [hero, signature] of Object.entries(catalog.default_skill)) {
    if (typeof signature !== 'string' || typeof catalog.hero_camp[hero] !== 'string') {
      throw new Error(`recommendation artifact has invalid hero context for ${hero}`);
    }
  }
  for (const rawBond of catalog.bonds) {
    if (!object(rawBond) || typeof rawBond.name !== 'string' ||
        (rawBond.required_members !== 2 && rawBond.required_members !== 3) ||
        !stringArray(rawBond.members) || rawBond.members.length < rawBond.required_members) {
      throw new Error('recommendation artifact has an invalid bond contract');
    }
  }
  for (const [skill, rawMechanics] of Object.entries(catalog.skill_mechanics)) {
    if (!object(rawMechanics) || !stringArray(rawMechanics.provides) || !stringArray(rawMechanics.benefitsFrom)) {
      throw new Error(`recommendation artifact has invalid reviewed mechanics for ${skill}`);
    }
  }
  if (!stringArray(model.enabled_families) || typeof model.min_support_context !== 'number' ||
      typeof model.min_support_high_order !== 'number') {
    throw new Error('recommendation artifact has invalid family support metadata');
  }
  return value as unknown as RecommendationData;
}

export const database = databaseRaw as unknown as GameplayDatabase;
export const recommendationData = validateRecommendationData(recommendationRaw);
