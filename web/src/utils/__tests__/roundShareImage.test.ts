import { getRoundShareImageLayout } from '../roundShareImage';

describe('getRoundShareImageLayout', () => {
  test('keeps an early-round pool to one row per item type', () => {
    const layout = getRoundShareImageLayout({
      heroes: ['刘备', '关羽', '张飞', '赵云'],
      skills: Array.from({ length: 8 }, (_, index) => `战法${index}`),
      supportHero: null,
      supportSkills: [],
    });

    expect(layout.heroRows).toBe(1);
    expect(layout.skillRows).toBe(1);
    expect(layout.height).toBeGreaterThan(900);
  });

  test('grows for a complete late-round pool and de-duplicates support entries', () => {
    const early = getRoundShareImageLayout({
      heroes: Array.from({ length: 4 }, (_, index) => `武将${index}`),
      skills: Array.from({ length: 8 }, (_, index) => `战法${index}`),
    });
    const late = getRoundShareImageLayout({
      heroes: Array.from({ length: 15 }, (_, index) => `武将${index}`),
      skills: Array.from({ length: 28 }, (_, index) => `战法${index}`),
      supportHero: '武将0',
      supportSkills: ['战法0', '战法1'],
    });

    expect(late.heroRows).toBe(2);
    expect(late.skillRows).toBe(3);
    expect(late.height).toBeGreaterThan(early.height);
  });
});
