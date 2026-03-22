<template>
  <view class="page">
    <!-- Loading -->
    <view v-if="loading" class="loading">
      <wd-loading />
      <text class="loading-text">正在加载数据...</text>
    </view>

    <!-- Setup Form -->
    <view v-else>
      <wd-card title="🎮 对局设置" sub-title="输入初始 4 个武将和 8 个战法以开始对局。">
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
        <wd-select-picker
          v-if="heroColumns.length > 0"
          ref="heroPickerRef"
          v-model="heroValues"
          :columns="heroColumns"
          type="checkbox"
          filterable
          :max="4"
          title="选择武将 (最多4个)"
          filter-placeholder="输入中文或拼音搜索..."
          label-key="label"
          value-key="value"
          label="初始武将"
          :placeholder="`已选 ${heroValues.length}/4`"
          @confirm="onHeroConfirm"
        />
        <view v-if="heroValues.length > 0" class="tag-area">
          <wd-tag
            v-for="hero in heroValues"
            :key="hero"
            type="primary"
            closable
            @close="removeHero(hero)"
          >{{ hero }}</wd-tag>
        </view>

        <!-- Skill Picker -->
        <wd-gap />
        <wd-select-picker
          v-if="skillColumns.length > 0"
          ref="skillPickerRef"
          v-model="skillValues"
          :columns="skillColumns"
          type="checkbox"
          filterable
          :max="8"
          title="选择战法 (最多8个)"
          filter-placeholder="输入中文或拼音搜索..."
          label-key="label"
          value-key="value"
          label="初始战法"
          :placeholder="`已选 ${skillValues.length}/8`"
          @confirm="onSkillConfirm"
        />
        <view v-if="skillValues.length > 0" class="tag-area">
          <wd-tag
            v-for="skill in skillValues"
            :key="skill"
            type="success"
            closable
            @close="removeSkill(skill)"
          >{{ skill }}</wd-tag>
        </view>

        <!-- Start Button -->
        <wd-gap />
        <wd-button
          type="primary"
          block
          :disabled="!canStart"
          @click="handleStart"
        >开始对局</wd-button>

        <text v-if="!canStart" class="hint">请选择恰好 4 个武将和 8 个战法以开始</text>
      </wd-card>
    </view>

    <wd-toast />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useToast } from 'wot-design-uni';
import { getDatabaseItems } from '../../services/dataStore';
import { usePinyin } from '../../composables/usePinyin';

const toast = useToast();
const { toPinyin } = usePinyin();

// Data
const loading = ref(true);
const error = ref('');
const heroColumns = ref([]);
const skillColumns = ref([]);

// Selection
const heroValues = ref([]);
const skillValues = ref([]);

// Computed
const canStart = computed(() => heroValues.value.length === 4 && skillValues.value.length === 8);

// Format items with pinyin in label for built-in filter matching
// Include both lowercase and capitalized pinyin so mobile keyboard
// auto-capitalize (first letter uppercase) still matches
function formatColumns(items) {
  return items.map(name => {
    const py = toPinyin(name);
    const pyCapitalized = py.charAt(0).toUpperCase() + py.slice(1);
    return {
      value: name,
      label: `${name} ${pyCapitalized}`,
      // Hidden search field with both cases for filtering
      searchText: `${name} ${py} ${pyCapitalized}`,
    };
  });
}

// Methods
function removeHero(hero) {
  heroValues.value = heroValues.value.filter(h => h !== hero);
}

function removeSkill(skill) {
  skillValues.value = skillValues.value.filter(s => s !== skill);
}

function onHeroConfirm({ value }) {
  heroValues.value = value;
}

function onSkillConfirm({ value }) {
  skillValues.value = value;
}

function handleStart() {
  if (!canStart.value) return;
  toast.show('对局开始！');
  // TODO: navigate to game board
}

// Load data
getDatabaseItems()
  .then(({ heroes, skills }) => {
    heroColumns.value = formatColumns(heroes);
    skillColumns.value = formatColumns(skills);
    loading.value = false;
  })
  .catch((err) => {
    error.value = '加载数据失败：' + (err.errMsg || err.message || '未知错误');
    loading.value = false;
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
</style>
