const GITEE_BASE = 'https://gitee.com/liamqma/sanmou/raw/master/web/src';

// Cache TTL in milliseconds (2 days)
const CACHE_TTL_MS = 2 * 24 * 60 * 60 * 1000;

function getBaseUrl() {
  // H5 dev mode: use proxy to avoid CORS
  // #ifdef H5
  return '/data';
  // #endif
  // #ifndef H5
  return GITEE_BASE;
  // #endif
}

/**
 * Read from local storage cache if available and not expired.
 * Returns null if cache miss or expired.
 */
function readCache(key) {
  try {
    const cached = uni.getStorageSync(`cache_${key}`);
    if (cached && cached.data && cached.cachedAt) {
      const age = Date.now() - cached.cachedAt;
      if (age < CACHE_TTL_MS) {
        return cached.data;
      }
    }
  } catch {
    // Storage read failed, ignore
  }
  return null;
}

/**
 * Write data to local storage cache with timestamp.
 */
function writeCache(key, data) {
  try {
    uni.setStorageSync(`cache_${key}`, {
      data,
      cachedAt: Date.now(),
    });
  } catch {
    // Storage write failed (e.g. quota exceeded), ignore
  }
}

export function fetchJson(fileName) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${getBaseUrl()}/${fileName}`,
      method: 'GET',
      header: { 'Accept': 'application/json' },
      success: (res) => {
        let data = res.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (e) { reject(e); return; }
        }
        resolve(data);
      },
      fail: (err) => reject(err),
    });
  });
}

/**
 * Fetch JSON with local storage caching.
 * Returns cached data if fresh (< CACHE_TTL_MS), otherwise fetches from network.
 */
async function fetchJsonCached(fileName) {
  // Try local storage cache first
  const cached = readCache(fileName);
  if (cached) return cached;

  // Fetch from network
  const data = await fetchJson(fileName);

  // Write to local storage cache
  writeCache(fileName, data);

  return data;
}

let _database = null;

export async function getDatabase() {
  if (!_database) {
    _database = await fetchJsonCached('database.json');
  }
  return _database;
}

export async function getDatabaseItems() {
  const database = await getDatabase();
  if (!database || !database.skill_hero_map) {
    throw new Error('Invalid database format');
  }
  const allHeroes = [...new Set(Object.values(database.skill_hero_map))].sort();
  const allSkills = [...new Set([
    ...(database.skill || []),
    ...Object.keys(database.skill_hero_map || {}),
  ])].sort();
  return { heroes: allHeroes, skills: allSkills };
}

let _database2 = null;

export async function getDatabase2() {
  if (!_database2) {
    _database2 = await fetchJsonCached('database2.json');
  }
  return _database2;
}

let _battleStats = null;

export async function getBattleStats() {
  if (!_battleStats) {
    _battleStats = await fetchJsonCached('battle_stats.json');
  }
  return _battleStats;
}
