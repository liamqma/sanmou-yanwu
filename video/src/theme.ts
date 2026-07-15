/**
 * Visual tokens for the SocialVideo template.
 *
 * These mirror the web app's Material theme
 * (`web/src/theme/theme.ts`) so rendered videos match the site. Keep this file
 * in sync with that theme whenever the web palette or typography changes — it is
 * the single visual source of truth for the video.
 *
 * Design language: light paper background with a faint texture, thin rules,
 * restrained shadows, small-radius cards, Songti serif headings, system/PingFang
 * body text, seal-red for primary emphasis and jade/gold as accents.
 */

// --- Core palette (mirrors web/src/theme/theme.ts) -------------------------
export const colors = {
  ink: '#1d2421',
  paper: '#f3efe3',
  paperLight: '#fbf8ef',
  paperDeep: '#e7dfcc',
  jade: '#456c5f',
  jadeDark: '#304f45',
  seal: '#a8392f',
  sealDark: '#8d3028',
  gold: '#a38147',
  goldDeep: '#765d31',
  rule: '#c9c2b1',
  textPrimary: '#1d2421',
  textSecondary: '#59635d',
  textDisabled: '#858b83',
} as const;

/** Named accent roles a scene may reference via `accent` in content JSON. */
export type AccentRole = 'seal' | 'jade' | 'gold' | 'ink';

export const accentColor: Record<AccentRole, string> = {
  seal: colors.seal,
  jade: colors.jade,
  gold: colors.goldDeep, // accessible gold for text-on-paper
  ink: colors.ink,
};

/** Resolve an optional accent role to a concrete color, defaulting to seal. */
export const resolveAccent = (role?: AccentRole): string =>
  accentColor[role ?? 'seal'];

// --- Typography -----------------------------------------------------------
export const fonts = {
  heading: '"Songti SC", STSong, Georgia, serif',
  body: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
} as const;

// --- Shape / elevation ----------------------------------------------------
export const shape = {
  /** Small-radius cards, matching the web theme's borderRadius: 2. */
  radius: 8,
  radiusSmall: 4,
  border: `1px solid ${colors.rule}`,
  cardShadow: '0 10px 30px rgba(44, 41, 30, 0.06)',
  softShadow: '0 8px 24px rgba(44, 41, 30, 0.07)',
} as const;

/** rgba() helper so we can layer thin, restrained texture/rules. */
export const withAlpha = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  );
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** Faint horizontal paper texture matching the web body background. */
export const paperTexture = `repeating-linear-gradient(0deg, ${withAlpha(
  colors.ink,
  0.018,
)} 0, ${withAlpha(colors.ink, 0.018)} 1px, transparent 1px, transparent 4px)`;
