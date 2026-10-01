<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue';
import { assetRequestUrl } from '../catalog';
import AssetSelectorContent from './AssetSelectorContent.vue';
import { calculationSuitOptions, rarityLabel, shikigamiRarities, YUHUN_CATEGORIES } from '../calculation-options';
import type { AssetSelectorItem } from '../asset-selector-types';
import type { HitMetricPools } from '../calculation-types';
import type { Asset, Catalog } from '../types';

type PoolKind = 'shikigami' | 'yuhun';
const props = withDefaults(defineProps<{
  modelValue: HitMetricPools;
  catalog: Catalog | null;
  catalogError?: string;
}>(), { catalogError: '' });
const emit = defineEmits<{ 'update:modelValue': [pools: HitMetricPools]; retryCatalog: [] }>();
const titleId = useId();
const dialog = ref<HTMLDialogElement | null>(null);
const mode = ref<PoolKind | null>(null);
const query = ref('');
const activeFilter = ref('全部');
const draftIds = ref<string[]>([]);
let returnFocus: HTMLElement | null = null;

const entries = [
  { kind: 'shikigami', title: '命中式神池', empty: '尚未选择式神' },
  { kind: 'yuhun', title: '命中御魂池', empty: '尚未选择御魂' },
] as const;
const field = (kind: PoolKind) => kind === 'shikigami' ? 'shikigamiIds' : 'yuhunIds';
const title = computed(() => entries.find((entry) => entry.kind === mode.value)?.title ?? '命中池');
function realItems(kind: PoolKind): Asset[] {
  const items = kind === 'shikigami' ? props.catalog?.shikigami ?? [] : props.catalog?.yuhun ?? [];
  const real = kind === 'yuhun'
    ? items.filter((item) => item.id !== '300000' && item.name !== '散件' && !item.id.startsWith('two-piece-effect:'))
    : items;
  return [...new Map(real.map((item) => [item.id, item])).values()];
}
const catalogItems = computed(() => mode.value ? realItems(mode.value) : []);
const byId = computed(() => new Map(catalogItems.value.map((item) => [item.id, item])));
const selectedItems = computed(() => draftIds.value.map((id) => byId.value.get(id) ?? { id, name: `目录中找不到 #${id}`, avatar: '' }));
const suitCategories = computed(() => new Map(calculationSuitOptions(props.catalog)
  .filter((item) => item.kind === 'suit').map((item) => [item.id, item.category])));
const filters = computed(() => mode.value === 'shikigami'
  ? shikigamiRarities(props.catalog).map((name) => ({ name, label: rarityLabel(name) }))
  : YUHUN_CATEGORIES.map((name) => ({ name, label: name })));
const availableItems = computed(() => {
  const text = query.value.trim().toLocaleLowerCase();
  return catalogItems.value.filter((item) => {
    const group = mode.value === 'shikigami' ? item.rarity ?? '' : suitCategories.value.get(item.id) ?? '其他';
    return (activeFilter.value === '全部' || activeFilter.value === group)
      && (text === '' || `${item.name} ${item.id} ${group} ${rarityLabel(group)}`.toLocaleLowerCase().includes(text));
  });
});
const pickerItems = computed<AssetSelectorItem[]>(() => availableItems.value.map((item) => ({
  id: item.id, name: item.name, avatar: imageUrl(item),
  subtitle: mode.value === 'shikigami' ? rarityLabel(item.rarity ?? '') : suitCategories.value.get(item.id) ?? '其他',
})));

function poolItems(kind: PoolKind): Asset[] {
  const known = new Map(realItems(kind).map((item) => [item.id, item]));
  return props.modelValue[field(kind)].map((id) => known.get(id) ?? { id, name: `#${id}`, avatar: '' });
}
function imageUrl(asset: Asset): string {
  if (!asset.avatar) return '';
  return typeof window === 'undefined' ? asset.avatar : assetRequestUrl(asset.avatar);
}
async function open(kind: PoolKind, event: MouseEvent): Promise<void> {
  returnFocus = event.currentTarget as HTMLElement;
  mode.value = kind;
  draftIds.value = [...props.modelValue[field(kind)]];
  query.value = '';
  activeFilter.value = '全部';
  await nextTick();
  dialog.value?.showModal();
  dialog.value?.querySelector<HTMLInputElement>('input[aria-label^="搜索"]')?.focus({ preventScroll: true });
}
function toggle(id: string, checked: boolean): void {
  draftIds.value = checked
    ? draftIds.value.includes(id) ? draftIds.value : [...draftIds.value, id]
    : draftIds.value.filter((selected) => selected !== id);
}
function close(): void { dialog.value?.close(); }
function cancel(event: Event): void { event.preventDefault(); close(); }
function onClose(): void {
  mode.value = null;
  draftIds.value = [];
  query.value = '';
  const target = returnFocus;
  returnFocus = null;
  if (target?.isConnected && !target.matches(':disabled')) target.focus({ preventScroll: true });
}
function save(): void {
  if (!mode.value) return;
  emit('update:modelValue', { ...props.modelValue, [field(mode.value)]: [...draftIds.value] });
  close();
}
onBeforeUnmount(() => { if (dialog.value?.open) dialog.value.close(); });
</script>

<template>
  <section class="hit-metric-pools" aria-label="命中池设置">
    <div class="pool-entries">
      <button v-for="entry in entries" :key="entry.kind" type="button" class="pool-entry" @click="open(entry.kind, $event)">
        <span class="pool-entry-heading"><strong>{{ entry.title }}</strong><span>{{ modelValue[field(entry.kind)].length }} 已选</span></span>
        <span v-if="poolItems(entry.kind).length" class="pool-overview">
          <span v-for="item in poolItems(entry.kind).slice(0, 3)" :key="item.id" class="pool-overview-item">
            <img v-if="imageUrl(item)" :src="imageUrl(item)" alt="" /><span v-else class="pool-avatar-fallback">{{ item.name.slice(0, 1) }}</span>{{ item.name }}
          </span>
          <span v-if="poolItems(entry.kind).length > 3">等 {{ poolItems(entry.kind).length }} 项</span>
        </span>
        <span v-else class="pool-empty">{{ entry.empty }} · 点击编辑</span>
      </button>
    </div>
    <p class="pool-explanation">式神在池内，或搭配池内御魂时，计算指标自动改为暴击率；移出后恢复原指标。</p>

    <dialog ref="dialog" class="pool-dialog" :aria-labelledby="titleId" @cancel="cancel" @close="onClose">
      <template v-if="mode">
        <header class="pool-dialog-heading"><div><span>命中池设置</span><h2 :id="titleId">编辑{{ title }}</h2></div><button type="button" aria-label="取消并关闭" @click="close">×</button></header>
        <div class="pool-dialog-body">
          <section class="pool-list-section" aria-label="已选列表"><h3>已选 · {{ draftIds.length }}</h3>
            <p v-if="!selectedItems.length" class="pool-list-note">尚未选择，可从下方目录添加。</p>
            <div v-else class="pool-list"><label v-for="item in selectedItems" :key="item.id" class="pool-option"><input type="checkbox" checked @change="toggle(item.id, false)" /><img v-if="imageUrl(item)" :src="imageUrl(item)" alt="" /><span v-else class="pool-avatar-fallback">{{ item.name.slice(0, 1) }}</span><span>{{ item.name }}</span></label></div>
          </section>
          <section class="pool-list-section" aria-label="目录可选列表"><h3>{{ mode === 'shikigami' ? '式神目录' : '御魂目录' }}</h3>
            <div v-if="catalogError" class="pool-catalog-note" role="status">{{ catalogError }} <button type="button" @click="emit('retryCatalog')">重新加载</button></div>
            <p v-else-if="!catalog" class="pool-list-note">目录加载中…</p>
            <p v-else-if="!catalogItems.length" class="pool-list-note">目录暂无可选项目。</p>
            <AssetSelectorContent v-else :kind="mode" :items="pickerItems" :filters="filters" v-model:search="query" v-model:active-filter="activeFilter" :selected-ids="draftIds" :empty-message="mode === 'shikigami' ? '没有匹配的式神' : '没有匹配的御魂'" @select="toggle($event, !draftIds.includes($event))" />
          </section>
        </div>
        <footer class="pool-dialog-actions"><button type="button" @click="close">取消</button><button type="button" class="pool-save" @click="save">保存 {{ draftIds.length }} 项</button></footer>
      </template>
    </dialog>
  </section>
</template>

<style scoped>
.hit-metric-pools { color: #4d6043; }.pool-entries { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }.pool-entry { min-width: 0; min-height: 70px; display: grid; align-content: start; gap: 8px; padding: 11px 13px; text-align: left; color: inherit; background: #f9fbf6; border: 1px solid #dce4d2; border-radius: 7px; }.pool-entry:hover { border-color: #8fac82; background: #f1f6eb; }.pool-entry-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }.pool-entry-heading strong { font-size: 12px; }.pool-entry-heading > span { color: #6b875e; font-size: 10px; white-space: nowrap; }.pool-overview { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 10px; color: #6c7867; }.pool-overview-item { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }.pool-overview-item img,.pool-avatar-fallback { width: 20px; height: 20px; flex: none; object-fit: contain; border-radius: 4px; }.pool-avatar-fallback { display: inline-grid; place-items: center; color: #58724d; background: #e8f0df; font-size: 11px; }.pool-empty { color: #9aa592; font-size: 10px; }.pool-explanation { margin: 8px 0 0; color: #7e8e73; font-size: 10px; line-height: 1.5; }
.pool-dialog { width: min(720px,calc(100vw - 28px)); max-height: min(82dvh,780px); padding: 0; color: #42563e; background: #fff; border: 1px solid #b5c5aa; border-radius: 9px; box-shadow: 0 18px 58px rgb(0 0 0 / 25%); }.pool-dialog[open] { display: flex; flex-direction: column; }.pool-dialog::backdrop { background: rgb(23 35 27 / 50%); }.pool-dialog-heading { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px 12px; border-bottom: 1px solid #e4eadf; }.pool-dialog-heading span { color: #8a9a80; font-size: 10px; }.pool-dialog-heading h2 { margin: 2px 0 0; font-size: 16px; }.pool-dialog-heading button { width: 28px; height: 28px; color: #62755c; background: transparent; font-size: 24px; line-height: 1; }.pool-dialog-body { min-height: 0; overflow: auto; padding: 16px 18px; }.pool-search { display: grid; gap: 6px; font-size: 11px; }.pool-search input { width: 100%; padding: 9px 10px; color: #42563e; background: #fbfcf9; border: 1px solid #ccd9c4; border-radius: 5px; font: inherit; }.pool-list-section { margin-top: 18px; }.pool-list-section h3 { margin: 0 0 8px; font-size: 12px; }.pool-list { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 6px; max-height: 255px; overflow: auto; }.pool-option { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 5px 7px; border: 1px solid #e2e9dc; border-radius: 5px; cursor: pointer; font-size: 11px; }.pool-option:hover { background: #f2f7ed; }.pool-option input { margin: 0 2px 0 0; accent-color: #527145; }.pool-option > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.pool-list-note,.pool-catalog-note { margin: 0; padding: 9px 10px; color: #84917d; background: #f8faf5; border-radius: 5px; font-size: 11px; }.pool-catalog-note button { margin-left: 7px; color: #4d7444; background: transparent; text-decoration: underline; }.pool-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid #e4eadf; }.pool-dialog-actions button { padding: 8px 13px; color: #5d7156; background: #f3f6ef; border-radius: 5px; font-size: 11px; }.pool-dialog-actions button.pool-save { color: #fff; background: #355b42; }
.hit-metric-pools { margin-bottom: 22px; }
.pool-option img { width: 28px; height: 28px; flex: none; object-fit: contain; border-radius: 4px; }
@media (max-width: 640px) { .pool-entries { grid-template-columns: 1fr; }.pool-list { grid-template-columns: repeat(2,minmax(0,1fr)); }.pool-dialog-body { padding: 12px; }.pool-dialog-heading,.pool-dialog-actions { padding-right: 12px; padding-left: 12px; } }
</style>
