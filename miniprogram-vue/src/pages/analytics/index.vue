<template>
  <view class="analytics-page">
    <!-- Loading -->
    <view v-if="loading" class="loading-container">
      <wd-loading />
      <text class="loading-text">加载数据中...</text>
    </view>

    <!-- Error -->
    <view v-else-if="error" class="error-container">
      <text class="error-text">{{ error }}</text>
      <wd-button type="primary" size="small" @click="loadData">重试</wd-button>
    </view>

    <!-- Content -->
    <view v-else-if="data">
      <!-- Summary Cards -->
      <view class="summary-cards">
        <view class="summary-card">
          <text class="summary-value">{{ data.summary.total_battles }}</text>
          <text class="summary-label">总对局数</text>
        </view>
        <view class="summary-card">
          <text class="summary-value">{{ data.summary.total_heroes }}</text>
          <text class="summary-label">武将种类</text>
        </view>
        <view class="summary-card">
          <text class="summary-value">{{ data.summary.total_skills }}</text>
          <text class="summary-label">战法种类</text>
        </view>
      </view>

      <!-- Tab selector -->
      <wd-tabs v-model="activeTab" sticky>
        <wd-tab title="武将胜率" name="heroWinRate" />
        <wd-tab title="战法胜率" name="skillWinRate" />
        <wd-tab title="使用排行" name="usage" />
        <wd-tab title="三人组合" name="combos" />
        <wd-tab title="羁绊分析" name="synergy" />
      </wd-tabs>

      <!-- Hero Win Rate Table -->
      <view v-if="activeTab === 'heroWinRate'" class="table-section">
        <wd-search v-model="heroSearch" placeholder="搜索武将" cancel-txt="" />
        <view class="filter-row">
          <text class="filter-label">最少场次：</text>
          <wd-button size="small" :type="heroMinGames === 1 ? 'primary' : 'default'" @click="heroMinGames = 1">1</wd-button>
          <wd-button size="small" :type="heroMinGames === 3 ? 'primary' : 'default'" @click="heroMinGames = 3">3</wd-button>
          <wd-button size="small" :type="heroMinGames === 5 ? 'primary' : 'default'" @click="heroMinGames = 5">5</wd-button>
          <wd-button size="small" :type="heroMinGames === 10 ? 'primary' : 'default'" @click="heroMinGames = 10">10</wd-button>
        </view>
        <view class="table-container">
          <view class="table-header">
            <text class="col-rank">#</text>
            <text class="col-name">武将</text>
            <text class="col-rate">胜率</text>
            <text class="col-games">场次</text>
          </view>
          <view
            v-for="(row, idx) in filteredHeroes"
            :key="row[0]"
            class="table-row"
            :class="{ 'row-even': idx % 2 === 0 }"
          >
            <text class="col-rank">{{ idx + 1 }}</text>
            <text class="col-name">{{ row[0] }}</text>
            <text class="col-rate">{{ row[1] }}</text>
            <text class="col-games">{{ row[2] }}</text>
          </view>
          <view v-if="filteredHeroes.length === 0" class="empty-row">
            <text>无匹配数据</text>
          </view>
        </view>
      </view>

      <!-- Skill Win Rate Table -->
      <view v-if="activeTab === 'skillWinRate'" class="table-section">
        <wd-search v-model="skillSearch" placeholder="搜索战法" cancel-txt="" />
        <view class="filter-row">
          <text class="filter-label">最少场次：</text>
          <wd-button size="small" :type="skillMinGames === 1 ? 'primary' : 'default'" @click="skillMinGames = 1">1</wd-button>
          <wd-button size="small" :type="skillMinGames === 3 ? 'primary' : 'default'" @click="skillMinGames = 3">3</wd-button>
          <wd-button size="small" :type="skillMinGames === 5 ? 'primary' : 'default'" @click="skillMinGames = 5">5</wd-button>
          <wd-button size="small" :type="skillMinGames === 10 ? 'primary' : 'default'" @click="skillMinGames = 10">10</wd-button>
        </view>
        <view class="table-container">
          <view class="table-header">
            <text class="col-rank">#</text>
            <text class="col-name">战法</text>
            <text class="col-rate">胜率</text>
            <text class="col-games">场次</text>
          </view>
          <view
            v-for="(row, idx) in filteredSkills"
            :key="row[0]"
            class="table-row"
            :class="{ 'row-even': idx % 2 === 0 }"
          >
            <text class="col-rank">{{ idx + 1 }}</text>
            <text class="col-name">{{ row[0] }}</text>
            <text class="col-rate">{{ row[1] }}</text>
            <text class="col-games">{{ row[2] }}</text>
          </view>
          <view v-if="filteredSkills.length === 0" class="empty-row">
            <text>无匹配数据</text>
          </view>
        </view>
      </view>

      <!-- Usage Rankings -->
      <view v-if="activeTab === 'usage'" class="table-section">
        <wd-search v-model="usageSearch" placeholder="搜索武将或战法" cancel-txt="" />

        <text class="section-title">武将使用排行</text>
        <view class="table-container">
          <view class="table-header">
            <text class="col-rank">#</text>
            <text class="col-name">武将</text>
            <text class="col-count">使用次数</text>
          </view>
          <view
            v-for="(row, idx) in filteredHeroUsage"
            :key="row[0]"
            class="table-row"
            :class="{ 'row-even': idx % 2 === 0 }"
          >
            <text class="col-rank">{{ idx + 1 }}</text>
            <text class="col-name">{{ row[0] }}</text>
            <text class="col-count">{{ row[1] }}</text>
          </view>
        </view>

        <text class="section-title">战法使用排行</text>
        <view class="table-container">
          <view class="table-header">
            <text class="col-rank">#</text>
            <text class="col-name">战法</text>
            <text class="col-count">使用次数</text>
          </view>
          <view
            v-for="(row, idx) in filteredSkillUsage"
            :key="row[0]"
            class="table-row"
            :class="{ 'row-even': idx % 2 === 0 }"
          >
            <text class="col-rank">{{ idx + 1 }}</text>
            <text class="col-name">{{ row[0] }}</text>
            <text class="col-count">{{ row[1] }}</text>
          </view>
        </view>
      </view>

      <!-- Winning Combos -->
      <view v-if="activeTab === 'combos'" class="table-section">
        <wd-search v-model="comboSearch" placeholder="搜索武将" cancel-txt="" />
        <view class="filter-row">
          <text class="filter-label">最少场次：</text>
          <wd-button size="small" :type="comboMinGames === 1 ? 'primary' : 'default'" @click="comboMinGames = 1">1</wd-button>
          <wd-button size="small" :type="comboMinGames === 2 ? 'primary' : 'default'" @click="comboMinGames = 2">2</wd-button>
          <wd-button size="small" :type="comboMinGames === 3 ? 'primary' : 'default'" @click="comboMinGames = 3">3</wd-button>
          <wd-button size="small" :type="comboMinGames === 5 ? 'primary' : 'default'" @click="comboMinGames = 5">5</wd-button>
        </view>
        <view class="table-container">
          <view class="table-header">
            <text class="col-rank">#</text>
            <text class="col-combo">武将组合</text>
            <text class="col-record">胜/负</text>
            <text class="col-rate">胜率</text>
          </view>
          <view
            v-for="(combo, idx) in filteredCombos"
            :key="idx"
            class="table-row"
            :class="{ 'row-even': idx % 2 === 0 }"
          >
            <text class="col-rank">{{ idx + 1 }}</text>
            <text class="col-combo">{{ combo.heroes.join('、') }}</text>
            <text class="col-record">{{ combo.wins }}/{{ combo.losses }}</text>
            <text class="col-rate">{{ (combo.win_rate * 100).toFixed(1) }}%</text>
          </view>
          <view v-if="filteredCombos.length === 0" class="empty-row">
            <text>无匹配数据</text>
          </view>
        </view>
      </view>

      <!-- Synergy Analysis -->
      <view v-if="activeTab === 'synergy'" class="table-section">
        <text class="section-title">🤝 武将羁绊依赖分析</text>
        <text class="section-desc">部分武将的胜率高度依赖特定搭档。"增幅"表示有搭档 vs 无搭档的胜率差值。</text>
        <view class="table-container">
          <view class="table-header synergy-header">
            <text class="col-rank">#</text>
            <text class="col-name">武将</text>
            <text class="col-partner">搭档</text>
            <text class="col-boost">增幅</text>
          </view>
          <template v-for="(s, sIdx) in (data.hero_synergy || [])" :key="s.hero">
            <view
              v-for="(p, pIdx) in s.partners"
              :key="`${s.hero}-${p.partner}`"
              class="table-row"
              :class="{ 'row-even': sIdx % 2 === 0 }"
            >
              <text class="col-rank">{{ pIdx === 0 ? sIdx + 1 : '' }}</text>
              <text class="col-name">{{ pIdx === 0 ? s.hero : '' }}</text>
              <text class="col-partner">{{ p.partner }}</text>
              <text class="col-boost" :class="boostClass(p.synergy_boost)">
                +{{ (p.synergy_boost * 100).toFixed(1) }}%
              </text>
            </view>
          </template>
        </view>

        <wd-gap />

        <text class="section-title">⚔️ 战法羁绊依赖分析</text>
        <text class="section-desc">部分战法的胜率高度依赖特定武将。</text>
        <view class="table-container">
          <view class="table-header synergy-header">
            <text class="col-rank">#</text>
            <text class="col-name">战法</text>
            <text class="col-partner">武将</text>
            <text class="col-boost">增幅</text>
          </view>
          <template v-for="(s, sIdx) in (data.skill_synergy || [])" :key="s.skill">
            <view
              v-for="(h, hIdx) in s.heroes"
              :key="`${s.skill}-${h.hero}`"
              class="table-row"
              :class="{ 'row-even': sIdx % 2 === 0 }"
            >
              <text class="col-rank">{{ hIdx === 0 ? sIdx + 1 : '' }}</text>
              <text class="col-name">{{ hIdx === 0 ? s.skill : '' }}</text>
              <text class="col-partner">{{ h.hero }}</text>
              <text class="col-boost" :class="boostClass(h.synergy_boost)">
                +{{ (h.synergy_boost * 100).toFixed(1) }}%
              </text>
            </view>
          </template>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { getBattleStats, getDatabase } from '../../services/dataStore';
import { getAnalytics } from '../../services/recommendationEngine';

const loading = ref(true);
const error = ref(null);
const data = ref(null);

// Tab state
const activeTab = ref('heroWinRate');

// Filters
const heroSearch = ref('');
const skillSearch = ref('');
const usageSearch = ref('');
const comboSearch = ref('');
const heroMinGames = ref(1);
const skillMinGames = ref(1);
const comboMinGames = ref(2);

// Filtered data computeds
const filteredHeroes = computed(() => {
  if (!data.value) return [];
  let heroes = data.value.all_heroes || [];
  // Filter by min games
  heroes = heroes.filter(row => row[2] >= heroMinGames.value);
  // Filter by search
  if (heroSearch.value) {
    const q = heroSearch.value.toLowerCase();
    heroes = heroes.filter(row => row[0].toLowerCase().includes(q));
  }
  // Sort by win rate descending (row[1] is like "55.0%")
  heroes = [...heroes].sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
  return heroes;
});

const filteredSkills = computed(() => {
  if (!data.value) return [];
  let skills = data.value.all_skills || [];
  skills = skills.filter(row => row[2] >= skillMinGames.value);
  if (skillSearch.value) {
    const q = skillSearch.value.toLowerCase();
    skills = skills.filter(row => row[0].toLowerCase().includes(q));
  }
  skills = [...skills].sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
  return skills;
});

const filteredHeroUsage = computed(() => {
  if (!data.value) return [];
  let usage = data.value.all_hero_usage || [];
  if (usageSearch.value) {
    const q = usageSearch.value.toLowerCase();
    usage = usage.filter(row => row[0].toLowerCase().includes(q));
  }
  return usage;
});

const filteredSkillUsage = computed(() => {
  if (!data.value) return [];
  let usage = data.value.all_skill_usage || [];
  if (usageSearch.value) {
    const q = usageSearch.value.toLowerCase();
    usage = usage.filter(row => row[0].toLowerCase().includes(q));
  }
  return usage;
});

const filteredCombos = computed(() => {
  if (!data.value) return [];
  let combos = data.value.all_winning_combos || [];
  combos = combos.filter(c => c.total_games >= comboMinGames.value);
  if (comboSearch.value) {
    const q = comboSearch.value.toLowerCase();
    combos = combos.filter(c => c.heroes.some(h => h.toLowerCase().includes(q)));
  }
  // Sort by win rate descending
  combos = [...combos].sort((a, b) => b.win_rate - a.win_rate);
  return combos;
});

function boostClass(boost) {
  if (boost > 0.3) return 'boost-high';
  if (boost > 0.15) return 'boost-medium';
  return 'boost-low';
}

async function loadData() {
  loading.value = true;
  error.value = null;
  try {
    const [battleStats, database] = await Promise.all([getBattleStats(), getDatabase()]);
    data.value = await getAnalytics(battleStats, database);
  } catch (e) {
    error.value = '加载数据失败: ' + e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);
</script>

<style scoped>
.analytics-page {
  padding: 12px;
  background: #1a1a2e;
  min-height: 100vh;
  color: #e0e0e0;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}

.loading-text {
  margin-top: 12px;
  color: #999;
}

.error-container {
  padding: 20px;
  text-align: center;
}

.error-text {
  color: #ff6b6b;
  display: block;
  margin-bottom: 12px;
}

/* Summary Cards */
.summary-cards {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.summary-card {
  flex: 1;
  background: #16213e;
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}

.summary-value {
  font-size: 24px;
  font-weight: bold;
  color: #4fc3f7;
  display: block;
}

.summary-label {
  font-size: 12px;
  color: #999;
  display: block;
  margin-top: 4px;
}

/* Table section */
.table-section {
  margin-top: 12px;
}

.section-title {
  font-size: 16px;
  font-weight: bold;
  color: #e0e0e0;
  display: block;
  margin: 16px 0 8px;
}

.section-desc {
  font-size: 12px;
  color: #999;
  display: block;
  margin-bottom: 8px;
}

/* Filter row */
.filter-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0;
  flex-wrap: wrap;
}

.filter-label {
  font-size: 13px;
  color: #999;
}

.filter-row .wd-button {
  margin: 0;
  width: auto;
}

/* Table */
.table-container {
  background: #16213e;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 12px;
}

.table-header {
  display: flex;
  padding: 10px 8px;
  background: #0f3460;
  font-size: 13px;
  font-weight: bold;
  color: #4fc3f7;
}

.table-row {
  display: flex;
  padding: 8px;
  align-items: center;
  border-bottom: 1px solid #1a1a3e;
}

.row-even {
  background: #1a2744;
}

.col-rank {
  width: 32px;
  text-align: center;
  font-size: 12px;
  color: #999;
}

.col-name {
  flex: 1;
  font-size: 14px;
  color: #e0e0e0;
}

.col-rate {
  width: 60px;
  text-align: right;
  font-size: 13px;
  font-weight: bold;
  color: #4fc3f7;
}

.col-games {
  width: 50px;
  text-align: right;
  font-size: 12px;
  color: #999;
}

.col-count {
  width: 70px;
  text-align: right;
  font-size: 13px;
  color: #4fc3f7;
}

.col-combo {
  flex: 1;
  font-size: 14px;
  color: #e0e0e0;
}

.col-record {
  width: 50px;
  text-align: right;
  font-size: 12px;
  color: #999;
}

.col-partner {
  flex: 1;
  font-size: 14px;
  color: #e0e0e0;
}

.col-boost {
  width: 60px;
  text-align: right;
  font-size: 13px;
  font-weight: bold;
}

.boost-high {
  color: #ff6b6b;
}

.boost-medium {
  color: #ffa726;
}

.boost-low {
  color: #66bb6a;
}

.empty-row {
  padding: 20px;
  text-align: center;
  color: #999;
}

.synergy-header {
  font-size: 12px;
}
</style>
