const database = require('../src/database.json');

// ── Game-state seeding ───────────────────────────────────────────────────────
// The app restores a saved game from the `gameProgress` cookie on mount
// (see web/src/context/GameContext.js → RESTORE_PROGRESS, and storage.js which
// stores it via js-cookie). Seeding that cookie lets acceptance tests jump
// straight into a specific round instead of clicking through the 4-hero/8-skill
// setup, so they stay focused on the UI under test.
async function seedGame(page, gameState, currentRoundInputs) {
  const value = encodeURIComponent(JSON.stringify({ gameState, currentRoundInputs }));
  await page.context().clearCookies();
  // Runs before the app's scripts on the next navigation, so RESTORE_PROGRESS sees it.
  await page.addInitScript((v) => {
    document.cookie = `gameProgress=${v}; path=/`;
  }, value);
  await page.goto('/');
}

// Minimal valid game state for a given round. Skills list just needs to exist;
// its contents don't affect the assertions here.
function makeGameState({ roundNumber, heroes, skills }) {
  return {
    current_heroes: heroes,
    current_skills: skills,
    support_hero: null,
    support_skills: [],
    round_number: roundNumber,
    round_history: [],
  };
}

// ── Data-driven expectations (read straight from the merged database) ─────────
const heroesWithMeta = Object.entries(database.heroes)
  .filter(([, h]) => h.label && Number.isInteger(h.rank))
  .map(([name]) => name);

const skillsWithTier = Object.entries(database.skills)
  .filter(([, s]) => s.tier)
  .map(([name]) => name);

// Display strings produced by web/src/components/game/AnalysisGrid.js → itemChipLabel.
const heroChipLabel = (name) => {
  const h = database.heroes[name];
  return `${name} · ${h.label}#${h.rank}`;
};
const skillChipLabel = (name) => {
  const s = database.skills[name];
  return `${name} · ${s.tier}`;
};

const anySkills = (n) => Object.keys(database.skills).slice(0, n);

module.exports = {
  database,
  seedGame,
  makeGameState,
  heroesWithMeta,
  skillsWithTier,
  heroChipLabel,
  skillChipLabel,
  anySkills,
};
