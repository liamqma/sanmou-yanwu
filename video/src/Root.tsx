import {Composition} from 'remotion';
import rawContent from '../content/video.json';
import rawTiming from './generated/audio-timing.json';
import {SocialVideo} from './SocialVideo';
import type {AudioTiming, VideoContent} from './types';

export const content = rawContent as VideoContent;

/**
 * Measured per-scene durations (in frames), keyed by scene id. Written by
 * `scripts/generate-narration.mjs` after measuring each scene's MP3. May be an
 * empty object — in that case every scene uses its `fallbackSeconds`, so silent
 * preview/render works without any audio.
 */
export const timing = rawTiming as AudioTiming;

/** True only when measured audio timing exists for this scene id. */
export const hasAudio = (sceneId: string): boolean =>
  Object.prototype.hasOwnProperty.call(timing, sceneId);

export const getSceneDuration = (sceneId: string): number => {
  const scene = content.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`Unknown scene: ${sceneId}`);
  return timing[sceneId] ?? Math.ceil(scene.fallbackSeconds * content.meta.fps);
};

export const totalDurationInFrames = content.scenes.reduce(
  (total, scene) => total + getSceneDuration(scene.id),
  0,
);

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="SocialVideo"
      component={SocialVideo}
      durationInFrames={totalDurationInFrames}
      fps={content.meta.fps}
      width={content.meta.width}
      height={content.meta.height}
    />
  );
};
