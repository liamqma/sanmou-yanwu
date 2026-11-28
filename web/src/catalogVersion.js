import { createHash } from 'node:crypto';

const byCodePoint = (a, b) => {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i].codePointAt(0) - y[i].codePointAt(0);
  }
  return x.length - y.length;
};

/**
 * Hash of the catalog fields that change draft availability. Build-time only;
 * `data/catalog.py` and the telemetry builder compute the same value.
 */
export const catalogVersion = ({ heroes, skills }) => {
  const names = (items) => Object.keys(items).sort(byCodePoint);
  // Keys are written in sorted order, as Python's `sort_keys` does.
  const payload = JSON.stringify({
    heroes: names(heroes).map((name) => ({
      default_skill: heroes[name].skill ?? null,
      name,
      season: heroes[name].season ?? null,
    })),
    skills: names(skills).map((name) => ({
      color: skills[name].color ?? null,
      name,
      season: skills[name].season ?? null,
      shadow: skills[name].shadow ?? false,
    })),
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
};
