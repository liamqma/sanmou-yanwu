<template>
  <view class="item-picker">
    <!-- Trigger -->
    <view class="picker-trigger" @click="open">
      <text class="picker-label">{{ label }}</text>
      <text class="picker-value">{{ displayValue }}</text>
      <text class="picker-arrow">›</text>
    </view>

    <!-- Selected Tags -->
    <view v-if="modelValue.length > 0" class="tag-area">
      <wd-tag
        v-for="item in modelValue"
        :key="item"
        :type="tagType"
        :closable="closable"
        @close="removeItem(item)"
      >{{ item }}</wd-tag>
    </view>

    <!-- Popup -->
    <view v-if="visible" class="picker-overlay">
      <view class="picker-popup">
      <!-- Header -->
      <view class="popup-header">
        <text class="popup-cancel" @click="close">取消</text>
        <text class="popup-title">{{ title }}</text>
        <text class="popup-confirm" @click="close">完成</text>
      </view>

      <!-- Search -->
      <view class="popup-search">
        <input
          ref="searchInput"
          class="search-input"
          v-model="searchText"
          :placeholder="searchPlaceholder"
          :focus="searchFocused"
        />
        <text v-if="searchText" class="search-clear" @click="clearSearch">✕</text>
      </view>

      <!-- Count -->
      <view class="popup-count">
        <text class="count-text">
          已选 {{ modelValue.length }}{{ max > 0 ? `/${max}` : '' }}
          <text v-if="searchText" class="filter-count">（匹配 {{ filteredItems.length }} 项）</text>
        </text>
      </view>

      <!-- Item List -->
      <scroll-view class="popup-list" scroll-y>
        <view
          v-for="item in filteredItems"
          :key="item"
          class="popup-item"
          :class="{ 'item-selected': isSelected(item), 'item-disabled': isDisabled(item) }"
          @click="toggleItem(item)"
        >
          <view class="item-checkbox" :class="{ 'checkbox-checked': isSelected(item) }">
            <text v-if="isSelected(item)">✓</text>
          </view>
          <text class="item-name">{{ item }}</text>
          <text class="item-pinyin">{{ getPinyinLabel(item) }}</text>
        </view>
        <view v-if="filteredItems.length === 0" class="empty-list">
          <text>无匹配结果</text>
        </view>
      </scroll-view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue';
import { usePinyin } from '../composables/usePinyin';

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => [],
  },
  items: {
    type: Array,
    default: () => [],
  },
  label: {
    type: String,
    default: '选择',
  },
  placeholder: {
    type: String,
    default: '请选择',
  },
  title: {
    type: String,
    default: '选择项目',
  },
  max: {
    type: Number,
    default: 0,
  },
  tagType: {
    type: String,
    default: 'primary',
  },
  searchPlaceholder: {
    type: String,
    default: '输入中文或拼音搜索...',
  },
  closable: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['update:modelValue']);

const { toPinyin } = usePinyin();

const visible = ref(false);
const searchText = ref('');
const searchFocused = ref(false);

// Precompute pinyin for all items
const pinyinMap = computed(() => {
  const map = {};
  for (const item of props.items) {
    map[item] = toPinyin(item);
  }
  return map;
});

const displayValue = computed(() => {
  if (props.modelValue.length === 0) return props.placeholder;
  if (props.max > 0) return `已选 ${props.modelValue.length}/${props.max}`;
  return `已选 ${props.modelValue.length} 项`;
});

const filteredItems = computed(() => {
  if (!searchText.value) return props.items;
  const q = searchText.value.toLowerCase().trim();
  return props.items.filter(item => {
    const name = item.toLowerCase();
    const py = pinyinMap.value[item] || '';
    return name.includes(q) || py.includes(q);
  });
});

function getPinyinLabel(item) {
  const py = pinyinMap.value[item] || '';
  return py.charAt(0).toUpperCase() + py.slice(1);
}

function isSelected(item) {
  return props.modelValue.includes(item);
}

function isDisabled(item) {
  return props.max > 0 && props.modelValue.length >= props.max && !isSelected(item);
}

function toggleItem(item) {
  if (isDisabled(item)) return;

  let newValue;
  if (isSelected(item)) {
    newValue = props.modelValue.filter(v => v !== item);
  } else {
    newValue = [...props.modelValue, item];
  }
  emit('update:modelValue', newValue);

  // Clear search text after each selection so the user can immediately
  // start typing the next query. The popup stays open until the user
  // explicitly taps 取消 or 完成.
  searchText.value = '';
}

function removeItem(item) {
  const newValue = props.modelValue.filter(v => v !== item);
  emit('update:modelValue', newValue);
}

function clearSearch() {
  searchText.value = '';
}

function open() {
  searchText.value = '';
  visible.value = true;
  searchFocused.value = true;
}

function close() {
  visible.value = false;
  searchFocused.value = false;
}
</script>

<style scoped>
.item-picker {
  width: 100%;
}

.picker-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.picker-popup {
  background: white;
  border-radius: 16px 16px 0 0;
  height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.picker-trigger {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: #16213e;
  border-radius: 8px;
  cursor: pointer;
}

.picker-label {
  font-size: 14px;
  color: #e0e0e0;
  flex-shrink: 0;
}

.picker-value {
  flex: 1;
  text-align: right;
  font-size: 14px;
  color: #999;
  margin: 0 8px;
}

.picker-arrow {
  color: #666;
  font-size: 18px;
}

.tag-area :deep(.wd-tag__text) {
  font-size: 14px !important;
}

.tag-area {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 0;
}

/* Popup */
.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
}

.popup-title {
  font-size: 16px;
  font-weight: bold;
  color: #333;
}

.popup-cancel {
  font-size: 14px;
  color: #999;
}

.popup-confirm {
  font-size: 14px;
  color: #4fc3f7;
  font-weight: bold;
}

.popup-search {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid #f0f0f0;
  position: relative;
}

.search-input {
  flex: 1;
  height: 36px;
  padding: 0 30px 0 12px;
  border: 1px solid #ddd;
  border-radius: 18px;
  font-size: 14px;
  background: #f8f8f8;
}

.search-clear {
  position: absolute;
  right: 24px;
  font-size: 14px;
  color: #999;
  padding: 4px;
}

.popup-count {
  padding: 6px 16px;
  border-bottom: 1px solid #f0f0f0;
}

.count-text {
  font-size: 12px;
  color: #999;
}

.filter-count {
  color: #4fc3f7;
}

.popup-list {
  flex: 1;
  overflow-y: auto;
}

.popup-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f5f5f5;
}

.popup-item:active {
  background: #f0f0f0;
}

.item-selected {
  background: #e3f2fd;
}

.item-disabled {
  opacity: 0.4;
}

.item-checkbox {
  width: 22px;
  height: 22px;
  border: 2px solid #ccc;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  flex-shrink: 0;
}

.checkbox-checked {
  background: #4fc3f7;
  border-color: #4fc3f7;
  color: white;
  font-size: 14px;
}

.item-name {
  font-size: 15px;
  color: #333;
  flex: 1;
}

.item-pinyin {
  font-size: 12px;
  color: #bbb;
}

.empty-list {
  padding: 40px;
  text-align: center;
  color: #999;
}
</style>
