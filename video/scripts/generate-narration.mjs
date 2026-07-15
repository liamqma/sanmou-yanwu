import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Prepare per-scene audio timing for a render.
 *
 * The DEFAULT backend is `manual`: you record one MP3 per scene yourself and
 * drop it at `public/audio/<scene-id>.mp3`. This script only validates and
 * measures those files, then writes `src/generated/audio-timing.json`.
 *
 * Optional TTS backends (opt in explicitly, they never run by default):
 *   - `clone` — synthesize every scene in your cloned voice via clone-voice.py.
 *   - `say`   — macOS `say` offline voice.
 *
 * Neither optional backend is ever used as a silent fallback. If you ask for a
 * backend and it fails, the pipeline aborts.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const contentPath = join(projectDir, 'content', 'video.json');
const audioDir = join(projectDir, 'public', 'audio');
const timingPath = join(projectDir, 'src', 'generated', 'audio-timing.json');
const content = JSON.parse(readFileSync(contentPath, 'utf8'));
const fps = content.meta.fps;
const paddingSeconds = Number(process.env.SCENE_PADDING ?? '1.1');

// Default backend is manual human recording. Opt in to TTS explicitly.
const backend = (process.env.NARRATION_BACKEND ?? 'manual').toLowerCase();

mkdirSync(audioDir, {recursive: true});
mkdirSync(dirname(timingPath), {recursive: true});

const sceneIds = content.scenes.map((scene) => scene.id);

function probeDurationSeconds(mp3Path) {
  const duration = Number(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mp3Path],
      {encoding: 'utf8'},
    ).trim(),
  );
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not determine narration duration for ${mp3Path}`);
  }
  return duration;
}

// Remove stale generated audio before TTS. In manual mode, preserve every human
// recording even if the active script no longer references it.
function pruneStaleAudio() {
  if (!existsSync(audioDir)) return;
  const keep = new Set(sceneIds.map((id) => `${id}.mp3`));
  for (const name of readdirSync(audioDir)) {
    if (!name.endsWith('.mp3') && !name.endsWith('.aiff')) continue;
    const base = name.replace(/\.aiff$/, '.mp3');
    if (!keep.has(base)) rmSync(join(audioDir, name));
  }
}

function generateWithSay() {
  const voice = process.env.VOICE ?? 'Tingting';
  const rate = process.env.VOICE_RATE ?? '250';

  for (const scene of content.scenes) {
    if (!scene.narration) {
      throw new Error(`Scene ${scene.id} has no narration text for the "say" backend.`);
    }
    const aiffPath = join(audioDir, `${scene.id}.aiff`);
    const mp3Path = join(audioDir, `${scene.id}.mp3`);

    execFileSync('say', ['-v', voice, '-r', rate, '-o', aiffPath, scene.narration], {
      stdio: 'inherit',
    });
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        aiffPath,
        '-af',
        'highpass=f=80,lowpass=f=12000,loudnorm=I=-16:TP=-1.5:LRA=8',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '160k',
        mp3Path,
      ],
      {stdio: 'inherit'},
    );
    if (existsSync(aiffPath)) rmSync(aiffPath);
  }
  return `macOS say voice ${voice} at rate ${rate}`;
}

function generateWithClone() {
  const python = process.env.CLONE_PYTHON ?? join(projectDir, '.venv', 'bin', 'python');
  const clonePy = join(scriptDir, 'clone-voice.py');
  const refAudio = process.env.CLONE_REF_AUDIO ?? join(projectDir, 'voice-clone', 'voice.m4a');
  const refText = process.env.CLONE_REF_TEXT ?? join(projectDir, 'voice-clone', 'ref.txt');

  // One process: load the Base BF16 model + reference once, emit one MP3 per
  // scene. execFileSync throws on non-zero exit, so a clone failure aborts the
  // pipeline rather than silently degrading to a different voice.
  execFileSync(
    python,
    [
      clonePy,
      '--ref-audio',
      refAudio,
      '--ref-text-file',
      refText,
      '--content-file',
      contentPath,
      '--output-dir',
      audioDir,
      '--mp3-only',
    ],
    {
      stdio: 'inherit',
      env: {...process.env, HF_HUB_OFFLINE: '1'},
    },
  );
  return `cloned voice via ${python}`;
}

let backendLabel;
if (backend === 'manual') {
  backendLabel = 'manual human recordings';
} else if (backend === 'say') {
  backendLabel = generateWithSay();
} else if (backend === 'clone') {
  backendLabel = generateWithClone();
} else {
  throw new Error(
    `Unknown NARRATION_BACKEND "${backend}" (expected "manual", "clone", or "say").`,
  );
}

if (backend !== 'manual') pruneStaleAudio();

// Validate + measure every scene's MP3, then write timing keyed by scene id.
const timing = {};
const missing = [];
for (const scene of content.scenes) {
  const mp3Path = join(audioDir, `${scene.id}.mp3`);
  if (!existsSync(mp3Path)) {
    missing.push(scene.id);
    continue;
  }
  const duration = probeDurationSeconds(mp3Path);
  timing[scene.id] = Math.ceil((duration + paddingSeconds) * fps);
}

if (missing.length > 0) {
  if (backend === 'manual') {
    throw new Error(
      `Missing narration clips for scene(s): ${missing.join(', ')}.\n` +
        `Record one MP3 per scene at public/audio/<scene-id>.mp3, then re-run.\n` +
        `For a quick silent preview instead, use "npm run render:silent" (no audio).`,
    );
  }
  throw new Error(`Missing narration clip(s) after ${backendLabel}: ${missing.join(', ')}.`);
}

writeFileSync(timingPath, `${JSON.stringify(timing, null, 2)}\n`);
console.log(`Measured ${content.scenes.length} narration clips (${backendLabel}).`);
