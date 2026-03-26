<template>
  <view class="page">
    <!-- Loading -->
    <view v-if="dataLoading" class="loading">
      <wd-loading />
      <text class="loading-text">正在加载数据...</text>
    </view>

    <!-- Setup Phase -->
    <view v-else-if="phase === 'setup'">
      <wd-card title="🎮 对局设置">
        <!-- Error -->
        <wd-notice-bar
          v-if="error"
          type="danger"
          :text="error"
          closable
          @close="error = ''"
        />

        <!-- Hero Picker -->
        <wd-gap />
        <ItemPicker
          v-if="allHeroes.length > 0"
          v-model="heroValues"
          :items="allHeroes"
          :max="4"
          label="初始武将"
          placeholder="请选择 4 个武将"
          title="选择武将 (最多4个)"
          tag-type="primary"
        />

        <!-- Skill Picker -->
        <wd-gap />
        <ItemPicker
          v-if="allSkills.length > 0"
          v-model="skillValues"
          :items="allSkills"
          :max="8"
          label="初始战法"
          placeholder="请选择 8 个战法"
          title="选择战法 (最多8个)"
          tag-type="success"
        />

        <!-- Start Button -->
        <wd-gap />
        <wd-button
          type="primary"
          block
          :disabled="!canStart"
          @click="handleStart"
        >开始对局</wd-button>

        <text v-if="!canStart" class="hint">请选择恰好 4 个武将和 8 个战法以开始</text>
        <wd-gap />
      </wd-card>
    </view>

    <!-- Editing Phase (between round 6 and 7) -->
    <view v-else-if="phase === 'editing'">
      <wd-card title="⚔️ 调整队伍">
        <wd-gap />
        <text class="section-label">📢 若有重随武将或战法、支援等变动，请在此更新队伍阵容，再进入下一轮。祝好运！</text>
        <wd-gap />

        <text class="section-label">当前武将</text>
        <ItemPicker
          v-model="editHeroes"
          :items="allHeroes"
          label="修改武将"
          placeholder="选择武将"
          title="修改武将"
          tag-type="primary"
        />

        <text class="section-label">当前战法</text>
        <ItemPicker
          v-model="editSkills"
          :items="allSkills"
          label="修改战法"
          placeholder="选择战法"
          title="修改战法"
          tag-type="success"
        />

        <wd-gap />
        <wd-button
          block
          :disabled="promptCopying"
          :loading="promptCopying"
          @click="handleCopyTeamPrompt"
        >📋 复制 AI 组队提示词</wd-button>

        <wd-gap />
        <wd-button type="primary" block @click="handleContinueFromEdit">
          进入下一轮 👍
        </wd-button>
        <wd-gap />
      </wd-card>
    </view>

    <!-- Playing Phase -->
    <view v-else-if="phase === 'playing'" style="position: relative;">
      <view class="reset-btn" @click="handleReset">🔄 重置</view>
      <!-- Game Complete -->
      <view v-if="gameComplete">
        <wd-card title="🎉 对局完成">
          <wd-gap />
          <text class="section-label">最终武将</text>
          <view class="tag-area">
            <wd-tag v-for="h in currentHeroes" :key="h" type="primary">{{ h }}</wd-tag>
          </view>
          <text class="section-label">最终战法</text>
          <view class="tag-area">
            <wd-tag v-for="s in currentSkills" :key="s" type="success">{{ s }}</wd-tag>
          </view>
          <wd-gap />
          <wd-button type="primary" block @click="handleReset">开始新对局</wd-button>
          <wd-gap />
        </wd-card>
      </view>

      <!-- Active Round -->
      <view v-else>
        <!-- Round Progress -->
        <!-- Round indicator in card title -->

        <!-- Round Info Card -->
        <wd-card :title="roundInfo.title">
          <wd-notice-bar
            v-if="error"
            type="danger"
            :text="error"
            closable
            @close="error = ''"
          />

          <!-- Current Team -->
          <wd-gap />
          <wd-cell title="当前武将" :value="currentHeroes.join('、')" />
          <wd-cell title="当前战法" :value="currentSkills.join('、')" />

          <!-- Round Description -->
          <wd-gap />
          <wd-notice-bar
            type="info"
            :text="roundInfo.description"
          />

          <!-- 3 Option Sets -->
          <wd-gap />
          <text class="section-label">🎯 填写三组选项</text>
          <text class="section-hint">每组需恰好 {{ itemsPerSet }} 个{{ roundType === 'hero' ? '武将' : '战法' }}，将从中选定一组。</text>

          <!-- Set 1 -->
          <wd-gap />
          <ItemPicker
            v-model="currentRoundInputs.set1"
            :items="availableItems"
            :max="itemsPerSet"
            label="第 1 组"
            :placeholder="`已选 ${currentRoundInputs.set1.length}/${itemsPerSet}`"
            :title="`第 1 组 (选 ${itemsPerSet} 个)`"
            :tag-type="roundType === 'hero' ? 'primary' : 'success'"
            :search-placeholder="roundType === 'hero' ? '搜索武将...' : '搜索战法...'"
          />

          <!-- Set 2 -->
          <wd-gap />
          <ItemPicker
            v-model="currentRoundInputs.set2"
            :items="availableItems"
            :max="itemsPerSet"
            label="第 2 组"
            :placeholder="`已选 ${currentRoundInputs.set2.length}/${itemsPerSet}`"
            :title="`第 2 组 (选 ${itemsPerSet} 个)`"
            :tag-type="roundType === 'hero' ? 'primary' : 'success'"
            :search-placeholder="roundType === 'hero' ? '搜索武将...' : '搜索战法...'"
          />

          <!-- Set 3 -->
          <wd-gap />
          <ItemPicker
            v-model="currentRoundInputs.set3"
            :items="availableItems"
            :max="itemsPerSet"
            label="第 3 组"
            :placeholder="`已选 ${currentRoundInputs.set3.length}/${itemsPerSet}`"
            :title="`第 3 组 (选 ${itemsPerSet} 个)`"
            :tag-type="roundType === 'hero' ? 'primary' : 'success'"
            :search-placeholder="roundType === 'hero' ? '搜索武将...' : '搜索战法...'"
          />

          <!-- Action Buttons -->
          <wd-gap />
          <wd-button
            type="info"
            block
            :disabled="!allSetsComplete || recommendLoading"
            :loading="recommendLoading"
            @click="handleRecommend"
          >{{ recommendLoading ? '分析中...' : '获取推荐' }}</wd-button>

          <wd-gap />
          <wd-button
            block
            :disabled="!allSetsComplete || promptCopying"
            :loading="promptCopying"
            @click="handleCopyRoundPrompt"
          >📋 复制 AI 分析提示词</wd-button>

          <!-- Recommendation Result -->
          <wd-gap />
          <view v-if="recommendation" class="recommendation-section">
            <view class="recommendation-result">
              <text class="recommendation-text">🏆 AI 推荐：第 {{ recommendation.recommended_set + 1 }} 组</text>
            </view>

            <!-- Per-set analysis -->
            <view v-for="(setAnalysis, idx) in recommendation.analysis" :key="idx" class="set-analysis" :class="{ 'set-recommended': idx === recommendation.recommended_set }">
              <view class="set-analysis-header">
                <text class="set-analysis-title">第 {{ idx + 1 }} 组</text>
                <view class="set-analysis-score-box">
                  <text class="set-analysis-score">{{ setAnalysis.final_score.toFixed(1) }}</text>
                  <text class="set-analysis-score-label">综合评分</text>
                </view>
              </view>

              <!-- Per-hero/skill scores -->
              <view class="analysis-detail">
                <text class="detail-label">{{ roundType === 'hero' ? '武将评分' : '战法评分' }}：</text>
                <view v-for="item in getSetItems(idx)" :key="item" class="hero-score-row">
                  <wd-tag size="small" type="primary">{{ item }}</wd-tag>
                  <text v-if="getHeroDetail(setAnalysis, item)" class="hero-score">{{ getHeroDetail(setAnalysis, item).score.toFixed(1) }}</text>
                  <text v-else class="hero-score no-data">—</text>
                  <text v-if="getHeroDetail(setAnalysis, item)?.conditionalAdjusted && formatReason(getHeroDetail(setAnalysis, item)?.conditionalReason)" class="synergy-tag">{{ formatReason(getHeroDetail(setAnalysis, item).conditionalReason) }}</text>
                </view>
              </view>

              <!-- Score breakdown with weights (hero rounds) -->
              <view v-if="roundType === 'hero'" class="analysis-breakdown">
                <text class="detail-label">评分详情：</text>
                <text v-if="setAnalysis.individual_scores?.score !== undefined" class="breakdown-row">
                  本组武将平均个人评分: {{ setAnalysis.individual_scores.score.toFixed(1) }} (权重 {{ heroWeightPct('weightSetCombination') }}%)
                </text>
                <text v-if="setAnalysis.score_full_team_combination?.score !== undefined" class="breakdown-row">
                  与已选武将组成队伍的评分: {{ setAnalysis.score_full_team_combination.score.toFixed(1) }} (权重 {{ heroWeightPct('weightFullTeamCombination') }}%)
                </text>
                <text v-if="setAnalysis.score_pair_stats?.score !== undefined" class="breakdown-row">
                  与已选武将配对的评分: {{ setAnalysis.score_pair_stats.score.toFixed(1) }} (权重 {{ heroWeightPct('weightPairStats') }}%)
                </text>
                <text v-if="setAnalysis.score_skill_hero_pairs?.score !== undefined" class="breakdown-row">
                  与已选战法的组合评分: {{ setAnalysis.score_skill_hero_pairs.score.toFixed(1) }} (权重 {{ heroWeightPct('weightSkillHeroPairs') }}%)
                </text>
              </view>

              <!-- Score breakdown with weights (skill rounds) -->
              <view v-if="roundType === 'skill'" class="analysis-breakdown">
                <text class="detail-label">评分详情：</text>
                <text v-if="setAnalysis.individual_scores?.score !== undefined" class="breakdown-row">
                  本组战法平均个人评分: {{ setAnalysis.individual_scores.score.toFixed(1) }} (权重 {{ skillWeightPct('weightIndividualSkills') }}%)
                </text>
                <text v-if="setAnalysis.score_skill_hero_pairs?.score !== undefined" class="breakdown-row">
                  与已选武将/战法的组合评分: {{ setAnalysis.score_skill_hero_pairs.score.toFixed(1) }} (权重 {{ skillWeightPct('weightSkillHeroPairs') }}%)
                </text>
              </view>

              <!-- Top team combinations -->
              <view v-if="setAnalysis.score_full_team_combination?.details?.length" class="analysis-detail">
                <text class="detail-label">最佳三人组合：</text>
                <view v-for="(combo, ci) in setAnalysis.score_full_team_combination.details" :key="ci" class="combo-row">
                  <view class="combo-heroes">
                    <wd-tag v-for="h in combo.heroes" :key="h" size="small" type="primary">{{ h }}</wd-tag>
                  </view>
                  <text class="combo-stats">{{ combo.total > 0 ? `${Math.round((combo.wins / combo.total) * 100)}% 胜率 (${combo.wins}胜/${combo.total}场)` : '—' }}</text>
                </view>
              </view>

              <!-- Top pair stats -->
              <view v-if="setAnalysis.score_pair_stats?.details?.length" class="analysis-detail">
                <text class="detail-label">最佳武将配对：</text>
                <view v-for="(pair, pi) in setAnalysis.score_pair_stats.details" :key="pi" class="combo-row">
                  <view class="combo-heroes">
                    <wd-tag size="small" type="primary">{{ pair.hero1 }}</wd-tag>
                    <wd-tag size="small" type="primary">{{ pair.hero2 }}</wd-tag>
                  </view>
                  <text class="combo-stats">{{ pair.total > 0 ? `${Math.round((pair.wins / pair.total) * 100)}% 胜率 (${pair.wins}胜/${pair.total}场)` : '—' }}</text>
                </view>
              </view>

              <!-- Top skill-hero pairs -->
              <view v-if="setAnalysis.score_skill_hero_pairs?.details?.length" class="analysis-detail">
                <text class="detail-label">最佳武将-战法组合：</text>
                <view v-for="(pair, si) in setAnalysis.score_skill_hero_pairs.details" :key="si" class="combo-row">
                  <view class="combo-heroes">
                    <wd-tag size="small" type="primary">{{ pair.hero }}</wd-tag>
                    <wd-tag size="small" type="success">{{ pair.skill }}</wd-tag>
                  </view>
                  <text class="combo-stats">{{ pair.total > 0 ? `${Math.round((pair.wins / pair.total) * 100)}% 胜率 (${pair.wins}胜/${pair.total}场)` : '—' }}</text>
                </view>
              </view>

              <!-- Confirm button for this set -->
              <wd-gap />
              <wd-button
                v-if="allSetsComplete"
                type="primary"
                size="small"
                block
                @click="handleConfirm(idx)"
              >选第 {{ idx + 1 }} 组</wd-button>
            </view>
          </view>

          <!-- Reset Button -->
          <wd-gap />
          <!-- Reset button moved to top-right -->

          <wd-gap />
        </wd-card>
      </view>
    </view>

    <!-- Debug Panel (all phases) -->
    <view v-if="isDev && !dataLoading" class="debug-panel">
      <text class="debug-label">⚙️ 跳转到轮次：</text>
      <view class="debug-buttons">
        <wd-button
          v-for="r in 8"
          :key="r"
          :type="phase === 'playing' && r === roundNumber ? 'primary' : 'default'"
          size="small"
          :disabled="phase === 'playing' && r === roundNumber"
          @click="jumpToRound(r)"
        >{{ r }}</wd-button>
      </view>
    </view>

    <wd-toast />
  </view>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useToast } from 'wot-design-uni';
import { useGame } from '../../composables/useGame';
import ItemPicker from '../../components/ItemPicker.vue';
import { validateGameInput } from '../../services/gameLogic';
import { generateLLMPrompt, generateTeamBuilderPrompt } from '../../services/promptGenerator';
import { HERO_RECOMMEND_OPTIONS, SKILL_RECOMMEND_OPTIONS } from '../../services/recommendationEngine';

const toast = useToast();
const {
  phase,
  gameState,
  currentRoundInputs,
  recommendation,
  loading: recommendLoading,
  error,
  allHeroes,
  orangeHeroes,
  allSkills,
  roundNumber,
  roundType,
  itemsPerSet,
  roundInfo,
  currentHeroes,
  currentSkills,
  availableItems,
  allSetsComplete,
  gameComplete,
  loadData,
  startGame,
  getRecommendation,
  confirmSet,
  resetGame,
  restoreSession,
  updateSetupSelections,
  setupSelections,
  jumpToRound,
  updateTeam,
  continueFromEdit,
} = useGame();

const isDev = import.meta.env.DEV;

// Setup phase data
const dataLoading = ref(true);
const heroValues = ref([]);
const skillValues = ref([]);

// Editing phase data
const editHeroes = ref([]);
const editSkills = ref([]);


// Prompt generation
const promptCopying = ref(false);

// Computed
const canStart = computed(() => heroValues.value.length === 4 && skillValues.value.length === 8);

function handleStart() {
  if (!canStart.value) return;
  const validation = validateGameInput(heroValues.value, skillValues.value);
  if (!validation.valid) {
    error.value = validation.error;
    return;
  }
  startGame([...heroValues.value], [...skillValues.value]);
  toast.show('对局开始！');
}

async function handleRecommend() {
  await getRecommendation();
}

function handleConfirm(setIndex) {
  const setItems = getSetItems(setIndex).join('、');
  uni.showModal({
    title: `确认选择第 ${setIndex + 1} 组？`,
    content: setItems,
    confirmText: '确认',
    cancelText: '取消',
    success: (res) => {
      if (res.confirm) {
        confirmSet(setIndex);
        toast.show(`已选定第 ${setIndex + 1} 组，进入下一轮`);
      }
    },
  });
}

function getSetItems(idx) {
  const sets = ['set1', 'set2', 'set3'];
  return currentRoundInputs[sets[idx]] || [];
}

function getHeroDetail(setAnalysis, itemName) {
  // hero_details is inside individual_scores.details
  const heroDetails = setAnalysis?.individual_scores?.details?.hero_details;
  const skillDetails = setAnalysis?.individual_scores?.details?.skill_details;
  if (heroDetails) {
    const found = heroDetails.find(h => h.hero === itemName);
    if (found) return found;
  }
  if (skillDetails) {
    const found = skillDetails.find(s => s.skill === itemName);
    if (found) return found;
  }
  return null;
}

function heroWeightPct(key) {
  const w = HERO_RECOMMEND_OPTIONS;
  const sum = w.weightSetCombination + w.weightFullTeamCombination + w.weightPairStats + w.weightSkillHeroPairs;
  return sum > 0 ? Math.round((w[key] / sum) * 100) : 0;
}

function skillWeightPct(key) {
  const w = SKILL_RECOMMEND_OPTIONS;
  const sum = w.weightIndividualSkills + w.weightSkillHeroPairs;
  return sum > 0 ? Math.round((w[key] / sum) * 100) : 0;
}

function formatReason(reason) {
  if (!reason) return '';
  if (reason.startsWith('synergy_boost_from_')) return `↑ 与${reason.replace('synergy_boost_from_', '')}协同`;
  if (reason.startsWith('synergy_deflate_without_')) return `↓ 缺${reason.replace('synergy_deflate_without_', '')}`;
  if (reason.startsWith('missing_key_partners_')) {
    const partners = reason.replace('missing_key_partners_', '').split(',');
    return `↓ 缺搭档${partners.join('、')}`;
  }
  if (reason.startsWith('missing_key_heroes_')) {
    const heroes = reason.replace('missing_key_heroes_', '').split(',');
    return `↓ 缺武将${heroes.join('、')}`;
  }
  if (reason === 'no_synergy_dependency') return '';
  if (reason === 'no_data') return '无数据';
  if (reason === 'no_games') return '场次不足';
  return reason;
}

async function copyToClipboard(text) {
  // #ifdef H5
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return;
  }
  // #endif
  // #ifndef H5
  uni.setClipboardData({ data: text });
  // #endif
}

async function handleCopyRoundPrompt() {
  promptCopying.value = true;
  try {
    const prompt = await generateLLMPrompt({
      gameState: gameState.value,
      currentRoundInputs,
      recommendation: recommendation.value,
      roundType: roundType.value,
    });
    await copyToClipboard(prompt);
    toast.show('✅ 提示词已复制到剪贴板');
  } catch (e) {
    toast.show('复制失败: ' + e.message);
  } finally {
    promptCopying.value = false;
  }
}

async function handleCopyTeamPrompt() {
  promptCopying.value = true;
  try {
    const prompt = await generateTeamBuilderPrompt(
      editHeroes.value,
      editSkills.value,
    );
    await copyToClipboard(prompt);
    toast.show('✅ 提示词已复制到剪贴板');
  } catch (e) {
    toast.show('复制失败: ' + e.message);
  } finally {
    promptCopying.value = false;
  }
}

function handleContinueFromEdit() {
  updateTeam(editHeroes.value, editSkills.value);
  continueFromEdit();
}

// Initialize editing phase data when entering editing phase
watch(phase, (newPhase) => {
  if (newPhase === 'editing') {
    editHeroes.value = [...currentHeroes.value];
    editSkills.value = [...currentSkills.value];
  }
});

function handleReset() {
  uni.showModal({
    title: '确定重置对局？',
    content: '所有进度将丢失。',
    confirmText: '确认重置',
    cancelText: '取消',
    success: (res) => {
      if (res.confirm) {
        resetGame();
        heroValues.value = [];
        skillValues.value = [];
        currentRoundInputs.set1 = [];
        currentRoundInputs.set2 = [];
        currentRoundInputs.set3 = [];
      }
    },
  });
}

// Restore saved session
restoreSession();
// Restore setup picker values
if (setupSelections.heroes.length > 0) heroValues.value = [...setupSelections.heroes];
if (setupSelections.skills.length > 0) skillValues.value = [...setupSelections.skills];

// Watch picker changes to persist setup selections
watch([heroValues, skillValues], ([heroes, skills]) => {
  updateSetupSelections(heroes, skills);
});

// Load data
loadData()
  .then(() => {
    dataLoading.value = false;
  })
  .catch((err) => {
    error.value = '加载数据失败：' + (err.errMsg || err.message || '未知错误');
    dataLoading.value = false;
  });
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 16px;
  background: #f5f5f5;
}

.loading {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 60vh;
}

.recommendation-result {
  background: #f0faf0;
  border: 1px solid #67c23a;
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  margin: 8px 0;
}

.recommendation-text {
  font-size: 18px;
  font-weight: bold;
  color: #67c23a;
}

.set-analysis {
  background: #fafafa;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 12px;
  margin-top: 8px;
}

.set-recommended {
  background: #f0faf0;
  border-color: #67c23a;
}

.set-analysis-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.set-analysis-title {
  font-size: 15px;
  font-weight: bold;
  color: #333;
}

.set-analysis-score {
  font-size: 16px;
  font-weight: bold;
  color: #4080ff;
}

.analysis-detail {
  margin-top: 6px;
}

.detail-label {
  font-size: 12px;
  color: #888;
}

.hero-score-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}

.hero-name {
  font-size: 13px;
  color: #333;
  min-width: 60px;
}

.hero-score {
  font-size: 13px;
  color: #4080ff;
  font-weight: 500;
}

.hero-score.no-data {
  color: #ccc;
}

.synergy-tag {
  font-size: 11px;
  color: #67c23a;
  background: #f0faf0;
  padding: 1px 6px;
  border-radius: 4px;
}

.set-analysis-score-box {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.set-analysis-score-label {
  font-size: 11px;
  color: #999;
}

.analysis-breakdown {
  background: #f5f5f5;
  border-radius: 6px;
  padding: 8px;
  margin-top: 8px;
}

.breakdown-row {
  display: block;
  font-size: 12px;
  color: #666;
  line-height: 1.8;
}

.combo-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.combo-heroes {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.combo-stats {
  font-size: 12px;
  color: #666;
  white-space: nowrap;
  margin-left: 8px;
}

.reset-btn {
  position: absolute;
  top: 0;
  right: 16px;
  z-index: 100;
  font-size: 13px;
  color: #ff6b6b;
  padding: 8px 12px;
  border-radius: 16px;
}

.loading-text {
  margin-top: 16px;
  font-size: 16px;
  color: #999;
}

.tag-area {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
}

.hint {
  display: block;
  text-align: center;
  font-size: 12px;
  color: #999;
  margin-top: 8px;
}

.section-label {
  display: block;
  font-size: 16px;
  font-weight: bold;
  padding: 0 16px;
  color: #333;
}

.section-hint {
  display: block;
  font-size: 12px;
  color: #999;
  padding: 4px 16px 0;
}

.confirm-buttons {
  display: flex;
  gap: 8px;
  padding: 0 8px;
}

.confirm-buttons .wd-button {
  flex: 1;
}

.debug-panel {
  margin-top: 8px;
  padding: 8px;
  border: 1px dashed #ccc;
  border-radius: 8px;
  background: #fafafa;
}

.debug-label {
  font-size: 12px;
  color: #999;
  display: block;
  margin-bottom: 6px;
}

.debug-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
</style>

<style>
/* Wot Design overrides — unscoped so they pierce component boundaries */

/* Card content padding */
.wd-card__content {
  padding: 0 8px;
}

/* Select picker cell: push value to the right */
.wd-select-picker .wd-cell__value {
  flex: 1;
  text-align: right;
}

/* Button horizontal margin inside card */
.wd-card .wd-button {
  margin: 0 8px;
  width: calc(100% - 16px);
}

/* Confirm buttons override — no extra margin */
.confirm-buttons .wd-button {
  margin: 0;
  width: auto;
}

/* Debug buttons override — no extra margin */
.debug-buttons .wd-button {
  margin: 0;
  width: auto;
}
</style>
