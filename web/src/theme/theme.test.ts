import { describe, expect, test } from 'vitest';
import { theme, uiColors } from './theme';

const relativeLuminance = (hex: string): number => {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    );

  if (!channels || channels.length !== 3) {
    throw new Error(`Expected a six-digit hex color, received ${hex}`);
  }

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
};

describe('website theme accessibility', () => {
  test('keeps informative text and primary actions above AA contrast', () => {
    const surfaces = [theme.palette.background.default, theme.palette.background.paper];

    for (const surface of surfaces) {
      expect(contrastRatio(theme.palette.text.primary, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.palette.text.secondary, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.palette.error.main, surface)).toBeGreaterThanOrEqual(4.5);
    }

    expect(
      contrastRatio(theme.palette.primary.contrastText, theme.palette.primary.main)
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(theme.palette.secondary.contrastText, theme.palette.secondary.main)
    ).toBeGreaterThanOrEqual(4.5);
  });

  test('keeps input boundaries and focus indicators visually distinct', () => {
    expect(contrastRatio(uiColors.neutral[500], uiColors.neutral[0])).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(theme.palette.primary.main, uiColors.neutral[0])).toBeGreaterThanOrEqual(3);
  });

  test('uses the complete Material UI shadow scale with only functional tiers', () => {
    expect(theme.shadows).toHaveLength(25);
    expect(new Set(theme.shadows).size).toBeLessThanOrEqual(4);
  });
});
