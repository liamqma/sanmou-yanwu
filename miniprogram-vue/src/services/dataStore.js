const GITEE_BASE = 'https://gitee.com/liamqma/sanmou/raw/master/web/src';

function getBaseUrl() {
  // H5 dev mode: use proxy to avoid CORS
  // #ifdef H5
  return '/data';
  // #endif
  // #ifndef H5
  return GITEE_BASE;
  // #endif
}

let _database = null;

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

export async function getDatabase() {
  if (!_database) {
    _database = await fetchJson('database.json');
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
