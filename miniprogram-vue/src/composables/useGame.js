import { ref, computed, reactive, watch } from 'vue';
import { createInitialGameState, updateGameState, getRoundType, getItemsPerSet, getRoundInfo } from '../services/gameLogic';
import { recommendHeroSet, recommendSkillSet } from '../services/recommendationEngine';
import { getDatabaseItems, getDatabase, getDatabase2 } from '../services/dataStore';

const STORAGE_KEY = 'gameSession';
const setupSelections = reactive({ heroes: [], skills: [] });

function saveSession() {
  try {
    const data = {
      phase: phase.value,
      gameState: gameState.value,
      roundInputs: {
        set1: currentRoundInputs.set1,
        set2: currentRoundInputs.set2,
        set3: currentRoundInputs.set3,
      },
      setupSelections: {
        heroes: setupSelections.heroes,
        skills: setupSelections.skills,
      },
    };
    uni.setStorageSync(STORAGE_KEY, data);
  } catch (e) {
    console.warn('Failed to save session:', e);
  }
}

function restoreSession() {
  try {
    const data = uni.getStorageSync(STORAGE_KEY);
    if (data) {
      if (data.setupSelections) {
        setupSelections.heroes = data.setupSelections.heroes || [];
        setupSelections.skills = data.setupSelections.skills || [];
      }
      if (data.phase && data.gameState) {
        phase.value = data.phase;
        gameState.value = data.gameState;
        if (data.roundInputs) {
          currentRoundInputs.set1 = data.roundInputs.set1 || [];
          currentRoundInputs.set2 = data.roundInputs.set2 || [];
          currentRoundInputs.set3 = data.roundInputs.set3 || [];
        }
        return true;
      }
    }
  } catch (e) {
    console.warn('Failed to restore session:', e);
  }
  return false;
}

function clearSession() {
  try {
    uni.removeStorageSync(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear session:', e);
  }
}

// Singleton game state (shared across components on the same page)
const phase = ref('setup'); // 'setup' | 'playing' | 'editing'
const gameState = ref(null);
const currentRoundInputs = reactive({
  set1: [],
  set2: [],
  set3: [],
});
const recommendation = ref(null);
const loading = ref(false);
const error = ref('');

// Database items
const allHeroes = ref([]);
const allSkills = ref([]);
const orangeHeroes = ref([]);
const orangeSkills = ref([]);

export function useGame() {
  // Computed
  const roundNumber = computed(() => gameState.value?.round_number || 1);
  const roundType = computed(() => getRoundType(roundNumber.value));
  const itemsPerSet = computed(() => getItemsPerSet(roundNumber.value));
  const roundInfo = computed(() => getRoundInfo(roundNumber.value));

  const currentHeroes = computed(() => gameState.value?.current_heroes || []);
  const currentSkills = computed(() => gameState.value?.current_skills || []);

  // Available items for current round (exclude already selected in other sets)
  const allSelectedInSets = computed(() => [
    ...currentRoundInputs.set1,
    ...currentRoundInputs.set2,
    ...currentRoundInputs.set3,
  ]);

  const availableItems = computed(() => {
    const items = roundType.value === 'hero' ? allHeroes.value : orangeSkills.value;
    // Exclude items already on the team
    const teamItems = roundType.value === 'hero' ? currentHeroes.value : currentSkills.value;
    return items.filter(item => !teamItems.includes(item));
  });

  const allSetsComplete = computed(() => {
    const n = itemsPerSet.value;
    return (
      currentRoundInputs.set1.length === n &&
      currentRoundInputs.set2.length === n &&
      currentRoundInputs.set3.length === n
    );
  });

  const gameComplete = computed(() => gameState.value && gameState.value.round_number > 8);

  // Actions
  async function loadData() {
    try {
      const [items, db, db2] = await Promise.all([getDatabaseItems(), getDatabase(), getDatabase2()]);
      allHeroes.value = items.heroes;
      allSkills.value = items.skills;

      // Filter to orange-only heroes from database2
      if (db2 && db2.wj) {
        const orangeNames = Object.values(db2.wj)
          .filter(hero => hero.color === 'orange')
          .map(hero => hero.name);
        orangeHeroes.value = allHeroes.value.filter(h => orangeNames.includes(h));
      } else {
        orangeHeroes.value = allHeroes.value;
      }

      // Filter to non-hero, orange-only skills for playing phase
      // Non-hero skills = skills NOT in skill_hero_map (those are hero-exclusive skills)
      // Orange skills = skills with color "orange" in database2.zf
      const heroSkillSet = new Set(Object.keys(db?.skill_hero_map || {}));
      if (db2 && db2.zf) {
        const orangeSkillNames = new Set(
          Object.entries(db2.zf)
            .filter(([, data]) => data.color === 'orange')
            .map(([name]) => name)
        );
        orangeSkills.value = allSkills.value.filter(
          s => !heroSkillSet.has(s) && orangeSkillNames.has(s)
        );
      } else {
        orangeSkills.value = allSkills.value.filter(s => !heroSkillSet.has(s));
      }
    } catch (e) {
      error.value = '加载数据失败: ' + e.message;
    }
  }

  function startGame(heroes, skills) {
    gameState.value = createInitialGameState(heroes, skills);
    resetRoundInputs();
    recommendation.value = null;
    phase.value = 'playing';
    saveSession();
  }

  function resetRoundInputs() {
    currentRoundInputs.set1 = [];
    currentRoundInputs.set2 = [];
    currentRoundInputs.set3 = [];
    recommendation.value = null;
  }

  function updateSet(setName, items) {
    currentRoundInputs[setName] = items;
    saveSession();
  }

  async function getRecommendation() {
    if (!allSetsComplete.value) {
      error.value = '请先完成三组选项';
      return;
    }

    loading.value = true;
    error.value = '';
    try {
      const sets = [
        currentRoundInputs.set1,
        currentRoundInputs.set2,
        currentRoundInputs.set3,
      ];

      let result;
      if (roundType.value === 'hero') {
        result = await recommendHeroSet(
          sets,
          currentHeroes.value,
          undefined,
          currentSkills.value,
        );
      } else {
        result = await recommendSkillSet(
          sets,
          currentHeroes.value,
          currentSkills.value,
          undefined,
        );
      }

      recommendation.value = result;
    } catch (e) {
      error.value = '获取推荐失败: ' + e.message;
    } finally {
      loading.value = false;
    }
  }

  function confirmSet(setIndex) {
    const setName = `set${setIndex + 1}`;
    const chosenSet = currentRoundInputs[setName];

    const result = updateGameState(
      gameState.value,
      roundType.value,
      chosenSet,
      setIndex,
    );

    gameState.value = result.gameState;
    resetRoundInputs();

    // After round 6, enter editing phase for team adjustments
    if (result.gameState.round_number === 7) {
      phase.value = 'editing';
    }

    saveSession();
  }

  function updateTeam(heroes, skills) {
    if (!gameState.value) return;
    gameState.value = {
      ...gameState.value,
      current_heroes: [...heroes],
      current_skills: [...skills],
    };
    saveSession();
  }

  function continueFromEdit() {
    phase.value = 'playing';
    saveSession();
  }

  function updateSetupSelections(heroes, skills) {
    setupSelections.heroes = heroes;
    setupSelections.skills = skills;
    saveSession();
  }

  function jumpToRound(targetRound) {
    if (!gameState.value || targetRound < 1 || targetRound > 8) return;
    const newState = {
      current_heroes: [...gameState.value.current_heroes.slice(0, 4)], // keep initial 4
      current_skills: [...gameState.value.current_skills.slice(0, 8)], // keep initial 8
      round_number: targetRound,
      round_history: [],
    };
    // Simulate previous rounds by adding placeholder items
    for (let r = 1; r < targetRound; r++) {
      const type = getRoundType(r);
      const count = getItemsPerSet(r);
      const placeholders = Array.from({ length: count }, (_, i) => `[R${r}-${type[0].toUpperCase()}${i + 1}]`);
      if (type === 'hero') {
        newState.current_heroes.push(...placeholders);
      } else {
        newState.current_skills.push(...placeholders);
      }
      newState.round_history.push({
        round_number: r,
        round_type: type,
        chosen_set: placeholders,
        set_index: 0,
      });
    }
    gameState.value = newState;
    resetRoundInputs();
    phase.value = 'playing';
    saveSession();
  }

  function resetGame() {
    phase.value = 'setup';
    gameState.value = null;
    resetRoundInputs();
    setupSelections.heroes = [];
    setupSelections.skills = [];
    error.value = '';
    clearSession();
  }

  return {
    // State
    phase,
    gameState,
    currentRoundInputs,
    recommendation,
    loading,
    error,
    allHeroes,
    allSkills,
    orangeHeroes,
    orangeSkills,

    // Computed
    roundNumber,
    roundType,
    itemsPerSet,
    roundInfo,
    currentHeroes,
    currentSkills,
    allSelectedInSets,
    availableItems,
    allSetsComplete,
    gameComplete,

    // Actions
    loadData,
    startGame,
    updateSet,
    getRecommendation,
    confirmSet,
    resetGame,
    resetRoundInputs,
    restoreSession,
    updateSetupSelections,
    setupSelections,
    jumpToRound,
    updateTeam,
    continueFromEdit,
  };
}
