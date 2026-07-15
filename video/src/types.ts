import type {AccentRole} from './theme';

/**
 * Content contract for the SocialVideo template.
 *
 * Everything visible in the render is data-driven from `content/video.json`.
 * The JSON Schema in `content/video.schema.json` mirrors these types and is the
 * authoring reference for humans and AI agents. Keep the two in sync.
 */

/** Generic scene kinds the composition can render (`summary` aliases `comparison`). */
export type SceneKind = 'intro' | 'content' | 'comparison' | 'summary' | 'outro';

/** A labelled numeric/text stat, e.g. {label: '样本', value: '203 场'}. */
export type Stat = {
  label: string;
  value: string;
};

/** A before/after metric rendered as a transition (old → new). */
export type BeforeAfter = {
  label?: string;
  before: string;
  after: string;
  /** Optional short delta note, e.g. '↑ 2 档' or '维持'. */
  delta?: string;
};

/** A row in a comparison/summary scene (left → right transition). */
export type ComparisonRow = {
  name: string;
  before: string;
  after: string;
  delta?: string;
  /** Optional per-row accent override. */
  accent?: AccentRole;
};

export type VideoScene = {
  /** Unique, filesystem-safe id (matches ^[A-Za-z0-9_-]+$). Used for audio + timing. */
  id: string;
  kind: SceneKind;

  // --- Optional, data-driven text fields (render only when present) --------
  /** Small label above the title. */
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  /** Bottom highlighted line. */
  caption?: string;

  /** Short pill tags (e.g. topics), rendered in intro/content scenes. */
  tags?: string[];
  /** Bullet list for content scenes. */
  bullets?: string[];
  /** Labelled stats chips. */
  stats?: Stat[];
  /** A single before → after metric highlight. */
  beforeAfter?: BeforeAfter;
  /** Rows for comparison/summary scenes. */
  rows?: ComparisonRow[];

  /** Accent role from the theme; defaults to 'seal'. */
  accent?: AccentRole;

  /** Spoken narration text (for TTS backends; ignored by manual recording). */
  narration?: string;

  /** Seconds this scene lasts when no measured audio timing exists. */
  fallbackSeconds: number;
};

export type VideoMeta = {
  /** Series / channel label shown in the chrome. */
  series: string;
  title: string;
  subtitle?: string;
  fps: number;
  width: number;
  height: number;
};

export type VideoContent = {
  meta: VideoMeta;
  scenes: VideoScene[];
};

/** Measured per-scene durations in frames, keyed by scene id. May be empty. */
export type AudioTiming = Record<string, number>;
