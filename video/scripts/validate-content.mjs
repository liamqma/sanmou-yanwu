import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Dependency-free validator for content/video.json.
 *
 * Checks the parts the render relies on: valid meta, unique filesystem-safe
 * scene ids, known scene kinds, and required per-scene fields. Kept intentionally
 * simple (no JSON Schema runtime) — content/video.schema.json is the richer,
 * documented contract for authors.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const contentPath = join(projectDir, 'content', 'video.json');

const SCENE_ID_RE = /^[A-Za-z0-9_-]+$/;
const SCENE_KINDS = new Set(['intro', 'content', 'comparison', 'summary', 'outro']);
const ACCENTS = new Set(['seal', 'jade', 'gold', 'ink']);

const errors = [];

let content;
try {
  content = JSON.parse(readFileSync(contentPath, 'utf8'));
} catch (err) {
  console.error(`✖ Cannot read/parse ${contentPath}: ${err.message}`);
  process.exit(1);
}

const meta = content.meta;
if (!meta || typeof meta !== 'object') {
  errors.push('meta is missing or not an object.');
} else {
  if (!meta.series) errors.push('meta.series is required.');
  if (!meta.title) errors.push('meta.title is required.');
  if (meta.fps !== 30) errors.push('meta.fps must be 30.');
  if (meta.width !== 1080) errors.push('meta.width must be 1080.');
  if (meta.height !== 1920) errors.push('meta.height must be 1920.');
}

if (!Array.isArray(content.scenes) || content.scenes.length === 0) {
  errors.push('scenes must be a non-empty array.');
} else {
  const seen = new Set();
  content.scenes.forEach((scene, i) => {
    const at = `scenes[${i}]`;
    if (!scene || typeof scene !== 'object') {
      errors.push(`${at} is not an object.`);
      return;
    }
    if (typeof scene.id !== 'string' || !SCENE_ID_RE.test(scene.id)) {
      errors.push(`${at}.id must match ^[A-Za-z0-9_-]+$ (got ${JSON.stringify(scene.id)}).`);
    } else if (seen.has(scene.id)) {
      errors.push(`${at}.id "${scene.id}" is duplicated; ids must be unique.`);
    } else {
      seen.add(scene.id);
    }
    if (!SCENE_KINDS.has(scene.kind)) {
      errors.push(`${at}.kind must be one of ${[...SCENE_KINDS].join(', ')} (got ${JSON.stringify(scene.kind)}).`);
    }
    if (typeof scene.fallbackSeconds !== 'number' || !(scene.fallbackSeconds > 0)) {
      errors.push(`${at}.fallbackSeconds must be a positive number.`);
    }
    if (scene.accent !== undefined && !ACCENTS.has(scene.accent)) {
      errors.push(`${at}.accent must be one of ${[...ACCENTS].join(', ')} if present.`);
    }
    if (scene.rows !== undefined) {
      if (!Array.isArray(scene.rows)) errors.push(`${at}.rows must be an array if present.`);
      else
        scene.rows.forEach((row, r) => {
          if (!row || typeof row.name !== 'string' || typeof row.before !== 'string' || typeof row.after !== 'string') {
            errors.push(`${at}.rows[${r}] requires string name/before/after.`);
          }
          if (row && row.accent !== undefined && !ACCENTS.has(row.accent)) {
            errors.push(`${at}.rows[${r}].accent must be a valid accent if present.`);
          }
        });
    }
    if (scene.stats !== undefined) {
      if (!Array.isArray(scene.stats)) errors.push(`${at}.stats must be an array if present.`);
      else
        scene.stats.forEach((stat, s) => {
          if (!stat || typeof stat.label !== 'string' || typeof stat.value !== 'string') {
            errors.push(`${at}.stats[${s}] requires string label/value.`);
          }
        });
    }
  });
}

if (errors.length > 0) {
  console.error(`✖ content/video.json has ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`✔ content/video.json is valid (${content.scenes.length} scenes).`);
