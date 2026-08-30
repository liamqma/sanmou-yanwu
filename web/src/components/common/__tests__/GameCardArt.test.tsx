import { fireEvent, render, screen } from '@testing-library/react';
import GameCardArt from '../GameCardArt';
import { gameAssetManifest, getGameAsset } from '../../../gameAssets';

const remoteUrl = /^https?:\/\//;

describe('local game card assets', () => {
  test('covers the complete playable manifest with local paths', () => {
    expect(Object.keys(gameAssetManifest.heroes)).toHaveLength(100);
    expect(Object.keys(gameAssetManifest.tactics)).toHaveLength(129);

    for (const entry of [
      ...Object.values(gameAssetManifest.heroes),
      ...Object.values(gameAssetManifest.tactics),
    ]) {
      expect(entry.path).toMatch(/^\/game-assets\/(heroes|tactics)\/.+\.png$/);
      expect(entry.path).not.toMatch(remoteUrl);
      expect(['orange', 'purple']).toContain(entry.quality);
    }
  });

  test('resolves the local 祝融 alias explicitly instead of deriving pinyin', () => {
    expect(getGameAsset('祝融', 'hero')).toMatchObject({
      path: '/game-assets/heroes/zhu_rong_fu_ren.png',
      quality: 'orange',
      type: 'hero',
      sourceName: '祝融夫人',
    });
    expect(gameAssetManifest.heroes).not.toHaveProperty('祝融夫人');
  });

  test('keeps stable dimensions, lazy loading, alt text, and an image-error fallback', () => {
    render(<GameCardArt name="刘备" kind="hero" />);
    const image = screen.getByRole('img', { name: '刘备武将卡面' });
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('width', '160');
    expect(image).toHaveAttribute('height', '248');
    expect(image).toHaveAttribute('src', getGameAsset('刘备', 'hero')?.path);

    fireEvent.error(image);
    expect(screen.getByRole('img', { name: '刘备武将卡面（暂缺）' }))
      .toHaveAttribute('src', '/game-assets/card-fallback.svg');
    expect(screen.getByTestId('game-card-hero-刘备'))
      .toHaveAttribute('data-card-fallback', 'true');
    expect(screen.getByText('刘备')).toBeVisible();
    expect(screen.getByText('本地卡面暂缺')).toBeVisible();
  });

  test('recovers a reused card slot when the resolved asset changes', () => {
    const { rerender } = render(<GameCardArt name="刘备" kind="hero" />);
    const image = screen.getByRole('img', { name: '刘备武将卡面' });

    fireEvent.error(image);
    expect(image).toHaveAttribute('src', '/game-assets/card-fallback.svg');

    rerender(<GameCardArt name="曹操" kind="hero" />);
    const replacement = screen.getByRole('img', { name: '曹操武将卡面' });
    expect(replacement).toBe(image);
    expect(replacement).toHaveAttribute('src', getGameAsset('曹操', 'hero')?.path);
    expect(screen.getByTestId('game-card-hero-曹操'))
      .toHaveAttribute('data-card-fallback', 'false');
  });

  test('falls back without attempting to infer an unknown filename', () => {
    render(<GameCardArt name="未收录武将" kind="hero" />);
    expect(screen.getByRole('img', { name: '未收录武将武将卡面（暂缺）' }))
      .toHaveAttribute('src', '/game-assets/card-fallback.svg');
  });
});
