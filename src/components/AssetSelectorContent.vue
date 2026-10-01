<script setup lang="ts">
import { Check, Search } from '@lucide/vue';
import type { AssetSelectorFilter, AssetSelectorItem } from '../asset-selector-types';

withDefaults(defineProps<{
  kind: 'shikigami' | 'yuhun';
  items: AssetSelectorItem[];
  filters: AssetSelectorFilter[];
  activeFilter: string;
  search: string;
  selectedIds?: string[];
  emptyMessage?: string;
}>(), { selectedIds: () => [], emptyMessage: '没有匹配的项目' });
const emit = defineEmits<{
  'update:search': [value: string];
  'update:activeFilter': [value: string];
  select: [id: string];
}>();
</script>

<template>
  <div class="asset-browser" :class="kind">
    <div v-if="kind === 'shikigami'" class="browser-toolbar">
      <label class="browser-search"><Search :size="16" /><input :value="search" aria-label="搜索式神" placeholder="搜索式神" @input="emit('update:search', ($event.target as HTMLInputElement).value)" /></label>
      <nav class="browser-filters" aria-label="式神稀有度">
        <button v-for="filter in filters" :key="filter.name" type="button" :class="{ active: activeFilter === filter.name }" :aria-pressed="activeFilter === filter.name" @click="emit('update:activeFilter', filter.name)">{{ filter.label }}</button>
      </nav>
    </div>
    <div class="browser-body">
      <nav v-if="kind === 'yuhun'" class="browser-filters category-filters" aria-label="御魂分类">
        <button v-for="filter in filters" :key="filter.name" type="button" :class="{ active: activeFilter === filter.name }" :aria-pressed="activeFilter === filter.name" @click="emit('update:activeFilter', filter.name)">{{ filter.label }}</button>
      </nav>
      <div class="browser-results">
        <label v-if="kind === 'yuhun'" class="browser-search"><Search :size="16" /><input :value="search" aria-label="搜索御魂" placeholder="输入搜索的御魂名字…" @input="emit('update:search', ($event.target as HTMLInputElement).value)" /></label>
        <div class="browser-grid">
          <button v-for="item in items" :key="item.id" type="button" class="browser-card" :class="{ selected: selectedIds.includes(item.id) }" :disabled="item.disabled" :aria-pressed="selectedIds.includes(item.id)" :title="item.name" @click="emit('select', item.id)">
            <span class="browser-image"><img v-if="item.avatar" :src="item.avatar" alt="" /><span v-else>{{ item.name.slice(0, 1) }}</span></span>
            <span class="browser-copy"><strong>{{ item.name }}</strong><small>{{ item.subtitle }}</small></span>
            <Check v-if="selectedIds.includes(item.id)" class="browser-check" :size="15" />
          </button>
        </div>
        <p v-if="!items.length" class="browser-empty">{{ emptyMessage }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.asset-browser { --picker-line: #d6dcde; --picker-active: #315f64; --picker-soft: #eaf1ef; color: #394245; min-width: 0; min-height: 0; overflow: auto; font-size: 11px; }
.browser-toolbar { padding: 12px; border-bottom: 1px solid var(--picker-line); }
.browser-search { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 10px; background: #fff; color: #788286; border: 1px solid #c5cdcf; border-radius: 3px; }
.browser-search input { min-width: 0; width: 100%; padding: 0; border: 0; box-shadow: none; background: transparent; color: #394245; font: inherit; line-height: 1.5; }
.browser-filters { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
.browser-filters button { padding: 5px 10px; color: #5e696d; background: #f5f7f7; border: 1px solid #d6dcde; border-radius: 3px; font: inherit; cursor: pointer; }
.browser-filters button.active { color: #fff; border-color: var(--picker-active); background: var(--picker-active); }
.browser-body,.browser-results { min-width: 0; }
.yuhun .browser-body { display: grid; grid-template-columns: 100px minmax(0,1fr); }
.category-filters { display: flex; flex-direction: column; flex-wrap: nowrap; margin: 0; gap: 3px; padding: 12px 8px; background: #f2f5f4; border-right: 1px solid var(--picker-line); }
.category-filters button { text-align: left; }
.yuhun .browser-results { padding: 12px; }
.browser-grid { display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: 7px; padding: 12px; max-height: min(48dvh,440px); overflow: auto; }
.yuhun .browser-grid { grid-template-columns: repeat(3,minmax(0,1fr)); padding: 12px 0 0; }
.browser-card { position: relative; display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 76px; padding: 9px; text-align: left; color: #394245; background: #fff; border: 1px solid #d4dcde; border-radius: 4px; font: inherit; cursor: pointer; }
.browser-card:hover:not(:disabled),.browser-card.selected { background: var(--picker-soft); border-color: #6d9796; }
.browser-card:disabled { opacity: .4; cursor: not-allowed; }
.browser-image { display: grid; place-items: center; flex: none; width: 42px; height: 52px; color: #687d70; background: #eef2ee; border-radius: 3px; overflow: hidden; }
.browser-image img { width: 100%; height: 100%; object-fit: contain; }
.yuhun .browser-image { width: 42px; height: 42px; }
.browser-copy { display: grid; gap: 4px; min-width: 0; }
.browser-copy strong { font-size: 10px; font-weight: 650; overflow-wrap: anywhere; }
.browser-copy small { font-size: 9px; color: #8a7d54; }
.browser-check { position: absolute; top: 3px; right: 3px; color: #fff; background: var(--picker-active); border-radius: 2px; }
.browser-empty { margin: 0; padding: 32px 12px; color: #889398; text-align: center; font-size: 11px; }
@media(max-width:900px) { .browser-grid { grid-template-columns: repeat(4,minmax(0,1fr)); } }
@media(max-width:640px) { .browser-grid { grid-template-columns: repeat(3,minmax(0,1fr)); }.yuhun .browser-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.yuhun .browser-body { grid-template-columns: 82px minmax(0,1fr); }.browser-card { gap: 5px; padding: 6px; }.browser-image { width: 34px; height: 44px; }.yuhun .browser-image { width: 32px; height: 32px; }.category-filters { padding: 10px 5px; }.category-filters button { padding: 5px; } }
@media(max-width:420px) { .browser-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.yuhun .browser-grid { grid-template-columns: 1fr; } }
</style>
