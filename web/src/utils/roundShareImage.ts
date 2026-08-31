import { getGameAsset, type GameAssetKind, type GameAssetQuality } from '../gameAssets';
import type { HeroMeta, RoundType, SkillMeta } from '../types/game';
import { formatHeroRanking, formatSkillRanking } from './itemMetadata';

const IMAGE_WIDTH = 1200;
const OUTER_PADDING = 40;
const CONTENT_WIDTH = IMAGE_WIDTH - OUTER_PADDING * 2;
const GROUP_GAP = 16;
const GROUP_CARD_GAP = 8;
const GROUP_PADDING = 14;
const GROUP_TITLE_HEIGHT = 42;
const GROUP_CARD_WIDTH =
  (CONTENT_WIDTH - GROUP_GAP * 2) / 3;
const CANDIDATE_CARD_WIDTH =
  (GROUP_CARD_WIDTH - GROUP_PADDING * 2 - GROUP_CARD_GAP * 2) / 3;
const CANDIDATE_ART_HEIGHT = CANDIDATE_CARD_WIDTH * (248 / 160);
const CANDIDATE_META_HEIGHT = 27;
const CANDIDATE_GROUP_HEIGHT =
  GROUP_TITLE_HEIGHT + CANDIDATE_ART_HEIGHT + CANDIDATE_META_HEIGHT + 24;

const POOL_COLUMNS = 10;
const POOL_GAP = 10;
const POOL_CARD_WIDTH =
  (CONTENT_WIDTH - POOL_GAP * (POOL_COLUMNS - 1)) / POOL_COLUMNS;
const POOL_ART_HEIGHT = POOL_CARD_WIDTH * (248 / 160);
const POOL_META_HEIGHT = 28;
const POOL_CARD_HEIGHT = POOL_ART_HEIGHT + POOL_META_HEIGHT;

const COLORS = {
  background: '#f4efe4',
  paper: '#fffdf7',
  primary: '#315b50',
  secondary: '#886b35',
  text: '#222720',
  muted: '#6f756c',
  divider: '#d6cdbb',
  support: '#a8392f',
  orange: '#9a7228',
  purple: '#7956a6',
};

const UI_FONT = '"PingFang SC", "Microsoft YaHei", sans-serif';
const TITLE_FONT = '"Songti SC", STSong, serif';

export interface RoundShareImageInput {
  roundNumber: number;
  roundType: RoundType;
  season: number | null;
  sets: [string[], string[], string[]];
  heroes: string[];
  skills: string[];
  supportHero?: string | null;
  supportSkills?: string[];
  rosterScore: number;
  heroMetadata?: Record<string, HeroMeta> | null;
  skillMetadata?: Record<string, SkillMeta> | null;
}

interface ShareCard {
  name: string;
  kind: GameAssetKind;
  ranking: string;
  support: boolean;
  quality: GameAssetQuality | null;
  assetPath: string | null;
}

interface RoundShareLayout {
  height: number;
  heroRows: number;
  skillRows: number;
}

const uniqueItems = (items: string[]): string[] => [...new Set(items)];

const poolRows = (count: number): number => Math.max(1, Math.ceil(count / POOL_COLUMNS));

/** Exported for deterministic layout tests without requiring a browser canvas. */
export const getRoundShareImageLayout = (
  input: Pick<RoundShareImageInput, 'heroes' | 'skills' | 'supportHero' | 'supportSkills'>
): RoundShareLayout => {
  const heroCount = uniqueItems([
    ...(input.supportHero ? [input.supportHero] : []),
    ...input.heroes,
  ]).length;
  const skillCount = uniqueItems([
    ...(input.supportSkills ?? []),
    ...input.skills,
  ]).length;
  const heroRows = poolRows(heroCount);
  const skillRows = poolRows(skillCount);
  const height = Math.ceil(
    40 + // top padding
      78 + // title and badges
      46 + // candidate section title
      CANDIDATE_GROUP_HEIGHT +
      42 + // gap before roster
      50 + // roster title
      38 + // hero title
      heroRows * POOL_CARD_HEIGHT +
      (heroRows - 1) * POOL_GAP +
      30 + // hero/skill gap
      38 + // skill title
      skillRows * POOL_CARD_HEIGHT +
      (skillRows - 1) * POOL_GAP +
      44 // bottom padding
  );
  return { height, heroRows, skillRows };
};

const makeShareCard = (
  name: string,
  kind: GameAssetKind,
  ranking: string,
  support: boolean
): ShareCard => {
  const asset = getGameAsset(name, kind);
  return {
    name,
    kind,
    ranking,
    support,
    quality: asset?.quality ?? null,
    assetPath: asset?.path ?? null,
  };
};

const roundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - safeRadius,
    y + height
  );
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
};

const fitText = (
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string => {
  if (context.measureText(text).width <= maxWidth) return text;
  let fitted = text;
  while (fitted.length > 1 && context.measureText(`${fitted}…`).width > maxWidth) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted}…`;
};

const drawBadge = (
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  fill: string,
  color = '#fff'
): number => {
  context.save();
  context.font = `700 20px ${UI_FONT}`;
  const width = Math.ceil(context.measureText(label).width + 28);
  roundedRect(context, x, y, width, 38, 19);
  context.fillStyle = fill;
  context.fill();
  context.fillStyle = color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, x + width / 2, y + 19);
  context.restore();
  return width;
};

const loadImage = (path: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = path;
  });

const loadCardImages = async (
  cards: ShareCard[]
): Promise<Map<string, HTMLImageElement | null>> => {
  const paths = uniqueItems(
    cards.flatMap((card) => (card.assetPath ? [card.assetPath] : []))
  );
  const entries = await Promise.all(
    paths.map(async (path) => [path, await loadImage(path)] as const)
  );
  return new Map(entries);
};

const drawCoverImage = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
) => {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height
  );
};

const drawShareCard = (
  context: CanvasRenderingContext2D,
  card: ShareCard,
  image: HTMLImageElement | null,
  x: number,
  y: number,
  width: number,
  artHeight: number,
  metaHeight: number,
  nameFontSize: number
) => {
  context.save();
  roundedRect(context, x, y, width, artHeight, 7);
  context.clip();

  if (image) {
    drawCoverImage(context, image, x, y, width, artHeight);
  } else {
    const missingGradient = context.createLinearGradient(x, y, x, y + artHeight);
    missingGradient.addColorStop(0, '#ede1c7');
    missingGradient.addColorStop(1, '#bba67d');
    context.fillStyle = missingGradient;
    context.fillRect(x, y, width, artHeight);
  }

  const nameGradient = context.createLinearGradient(x, y + artHeight * 0.48, x, y + artHeight);
  nameGradient.addColorStop(0, 'rgba(8, 13, 12, 0)');
  nameGradient.addColorStop(1, 'rgba(7, 11, 10, 0.96)');
  context.fillStyle = nameGradient;
  context.fillRect(x, y + artHeight * 0.45, width, artHeight * 0.55);

  context.fillStyle = '#fff8e8';
  context.font = `900 ${nameFontSize}px ${TITLE_FONT}`;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.shadowColor = '#000';
  context.shadowBlur = 3;
  context.fillText(
    fitText(context, card.name, width - 10),
    x + width / 2,
    y + artHeight - 10
  );
  context.shadowBlur = 0;

  if (card.support) {
    context.font = `800 ${Math.max(14, nameFontSize - 2)}px ${UI_FONT}`;
    const label = '★ 支援';
    const badgeWidth = context.measureText(label).width + 18;
    context.fillStyle = COLORS.support;
    context.fillRect(x + 5, y + 5, badgeWidth, 27);
    context.fillStyle = '#fff';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(label, x + 14, y + 18.5);
  }
  context.restore();

  context.save();
  roundedRect(context, x, y, width, artHeight, 7);
  context.strokeStyle =
    card.quality === 'purple' ? COLORS.purple : COLORS.orange;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = COLORS.muted;
  context.font = `600 ${Math.max(14, nameFontSize - 3)}px ${UI_FONT}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(
    fitText(context, card.ranking || (card.kind === 'hero' ? '武将' : '战法'), width),
    x + width / 2,
    y + artHeight + metaHeight / 2
  );
  context.restore();
};

const drawPoolGrid = (
  context: CanvasRenderingContext2D,
  cards: ShareCard[],
  images: Map<string, HTMLImageElement | null>,
  y: number
) => {
  cards.forEach((card, index) => {
    const row = Math.floor(index / POOL_COLUMNS);
    const column = index % POOL_COLUMNS;
    drawShareCard(
      context,
      card,
      card.assetPath ? (images.get(card.assetPath) ?? null) : null,
      OUTER_PADDING + column * (POOL_CARD_WIDTH + POOL_GAP),
      y + row * (POOL_CARD_HEIGHT + POOL_GAP),
      POOL_CARD_WIDTH,
      POOL_ART_HEIGHT,
      POOL_META_HEIGHT,
      18
    );
  });
};

const canvasToPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('浏览器无法生成分享图片'));
    }, 'image/png');
  });

/**
 * Render a stable, controls-free PNG containing all candidate sets and the
 * complete current pool, independent of the responsive disclosure state.
 */
export async function renderRoundShareImage(
  input: RoundShareImageInput
): Promise<Blob> {
  const supportSkills = new Set(input.supportSkills ?? []);
  const candidateCards = input.sets.flatMap((set) =>
    set.map((name) =>
      makeShareCard(
        name,
        input.roundType === 'hero' ? 'hero' : 'tactic',
        input.roundType === 'hero'
          ? formatHeroRanking(input.heroMetadata?.[name])
          : formatSkillRanking(input.skillMetadata?.[name]),
        false
      )
    )
  );
  const heroCards = uniqueItems([
    ...(input.supportHero ? [input.supportHero] : []),
    ...input.heroes,
  ]).map((name) =>
    makeShareCard(
      name,
      'hero',
      formatHeroRanking(input.heroMetadata?.[name]),
      name === input.supportHero
    )
  );
  const skillCards = uniqueItems([
    ...(input.supportSkills ?? []),
    ...input.skills,
  ]).map((name) =>
    makeShareCard(
      name,
      'tactic',
      formatSkillRanking(input.skillMetadata?.[name]),
      supportSkills.has(name)
    )
  );
  const allCards = [...candidateCards, ...heroCards, ...skillCards];
  const [images] = await Promise.all([
    loadCardImages(allCards),
    typeof document !== 'undefined' && document.fonts
      ? document.fonts.ready
      : Promise.resolve(),
  ]);

  const layout = getRoundShareImageLayout(input);
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_WIDTH;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持图片生成');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(125, 105, 68, 0.055)';
  context.lineWidth = 1;
  for (let lineY = 10; lineY < canvas.height; lineY += 8) {
    context.beginPath();
    context.moveTo(0, lineY);
    context.lineTo(canvas.width, lineY);
    context.stroke();
  }

  let y = 40;
  context.fillStyle = COLORS.text;
  context.font = `800 42px ${TITLE_FONT}`;
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillText('三谋演武 · 本轮选择', OUTER_PADDING, y);
  const typeLabel = input.roundType === 'hero' ? '武将候选' : '战法候选';
  const roundBadgeWidth = drawBadge(
    context,
    `第 ${input.roundNumber} 轮 · ${typeLabel}`,
    OUTER_PADDING,
    y + 52,
    COLORS.primary
  );
  if (input.season !== null) {
    drawBadge(
      context,
      `S${input.season}`,
      OUTER_PADDING + roundBadgeWidth + 10,
      y + 52,
      COLORS.secondary
    );
  }

  y += 118;
  context.fillStyle = COLORS.text;
  context.font = `800 27px ${UI_FONT}`;
  context.textBaseline = 'top';
  context.fillText('候选组', OUTER_PADDING, y);
  y += 46;

  input.sets.forEach((set, groupIndex) => {
    const groupX = OUTER_PADDING + groupIndex * (GROUP_CARD_WIDTH + GROUP_GAP);
    const candidateOffset = input.sets
      .slice(0, groupIndex)
      .reduce((total, group) => total + group.length, 0);
    const groupItemsWidth =
      set.length * CANDIDATE_CARD_WIDTH +
      Math.max(0, set.length - 1) * GROUP_CARD_GAP;
    const groupItemsX = groupX + (GROUP_CARD_WIDTH - groupItemsWidth) / 2;
    context.save();
    roundedRect(context, groupX, y, GROUP_CARD_WIDTH, CANDIDATE_GROUP_HEIGHT, 10);
    context.fillStyle = COLORS.paper;
    context.fill();
    context.strokeStyle = COLORS.divider;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = COLORS.text;
    context.font = `800 23px ${TITLE_FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(
      `第 ${groupIndex + 1} 组  (${set.length}/${set.length})`,
      groupX + GROUP_CARD_WIDTH / 2,
      y + GROUP_TITLE_HEIGHT / 2 + 3
    );
    context.restore();

    set.forEach((name, itemIndex) => {
      const card = candidateCards[candidateOffset + itemIndex];
      drawShareCard(
        context,
        card,
        card.assetPath ? (images.get(card.assetPath) ?? null) : null,
        groupItemsX + itemIndex * (CANDIDATE_CARD_WIDTH + GROUP_CARD_GAP),
        y + GROUP_TITLE_HEIGHT,
        CANDIDATE_CARD_WIDTH,
        CANDIDATE_ART_HEIGHT,
        CANDIDATE_META_HEIGHT,
        18
      );
    });
  });

  y += CANDIDATE_GROUP_HEIGHT + 42;
  context.fillStyle = COLORS.text;
  context.font = `800 30px ${UI_FONT}`;
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillText('当前阵容', OUTER_PADDING, y);
  context.fillStyle = COLORS.primary;
  context.font = `800 24px ${UI_FONT}`;
  context.fillText(`评分 ${input.rosterScore.toFixed(1)}`, OUTER_PADDING + 150, y + 3);
  y += 50;

  context.fillStyle = COLORS.text;
  context.font = `800 22px ${UI_FONT}`;
  context.fillText(`武将 (${heroCards.length})`, OUTER_PADDING, y);
  y += 38;
  drawPoolGrid(context, heroCards, images, y);
  y +=
    layout.heroRows * POOL_CARD_HEIGHT +
    (layout.heroRows - 1) * POOL_GAP +
    30;

  context.fillStyle = COLORS.text;
  context.font = `800 22px ${UI_FONT}`;
  context.fillText(`战法 (${skillCards.length})`, OUTER_PADDING, y);
  y += 38;
  drawPoolGrid(context, skillCards, images, y);

  return canvasToPng(canvas);
}
