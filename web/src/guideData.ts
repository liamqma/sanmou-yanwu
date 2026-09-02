/**
 * Lazy route boundary for the 但丁与你 editorial guide payload.
 *
 * The canonical source remains public/game-data/database.json. Vite extracts
 * only `yanwuGuide` into this virtual module so the matchup matrix and analysis
 * prose are downloaded only when the full guide route is visited. The approved
 * author account images are separate static assets on that route.
 */
import guideRaw from 'virtual:yanwu-guide';
import type { YanwuGuide } from './types/domain';

export const yanwuGuide = guideRaw as unknown as YanwuGuide;
