import {existsSync, mkdirSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Remove rendered output and reset audio timing.
 *
 * Deletes:
 *   - out/            (rendered video output)
 *   - src/generated/audio-timing.json is reset to {}
 *
 * Passing --audio also removes working narration files from public/audio/.
 * This is intentionally opt-in because those MP3s may be manual recordings.
 *
 * Never touches source, content, examples, models/.cache, .venv, node_modules,
 * or personal reference recordings under voice-clone/. README / .gitkeep
 * placeholders inside public/audio are preserved.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');

const outDir = join(projectDir, 'out');
const audioDir = join(projectDir, 'public', 'audio');
const timingPath = join(projectDir, 'src', 'generated', 'audio-timing.json');
const removeAudio = process.argv.includes('--audio');

let removed = 0;

// 1. Rendered output.
if (existsSync(outDir)) {
  rmSync(outDir, {recursive: true, force: true});
  removed += 1;
  console.log('removed out/');
}

// 2. Narration clips are removed only when explicitly requested.
if (removeAudio && existsSync(audioDir)) {
  for (const name of readdirSync(audioDir)) {
    if (name.endsWith('.mp3') || name.endsWith('.aiff') || name.endsWith('.wav')) {
      rmSync(join(audioDir, name));
      removed += 1;
      console.log(`removed public/audio/${name}`);
    }
  }
}

// 3. Reset timing so silent preview uses fallbackSeconds. Audio files can stay
// safely in place because the composition only mounts Audio for measured ids.
mkdirSync(dirname(timingPath), {recursive: true});
writeFileSync(timingPath, '{}\n');
console.log('reset src/generated/audio-timing.json to {}');

console.log(`Clean complete. Removed ${removed} generated item(s).`);
