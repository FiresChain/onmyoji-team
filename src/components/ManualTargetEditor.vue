<script setup lang="ts">
import ModalTransition from "./ModalTransition.vue";
import AssetSelectorContent from "./AssetSelectorContent.vue";
import { computed, ref, watch } from "vue";
import { ChevronDown, Plus, Trash2, UserRoundPlus, X } from "@lucide/vue";
import { assetRequestUrl } from "../catalog";
import { CALCULATION_METRICS, createEmptyCalculationMember } from "../calculation-config";
import { effectiveCalculationMetricId, matchHitMetricPool } from "../calculation-metric-pools";
import {
  MAIN_STAT_OPTIONS, MAIN_STAT_LABELS, metricMainStatPreset,
  calculationSuitOptions, YUHUN_CATEGORIES, shikigamiRarities, rarityLabel, type SuitOption,
} from "../calculation-options";
import { STATS, type Asset, type Catalog, type Member, type Stat } from "../types";
import type { AssetSelectorItem } from "../asset-selector-types";
import type {
  CalculationConfig, CalculationDraft, CalculationIssue, CalculationMemberDraft, CalculationMetricId, CalculationPrecheckDiagnostic, MainStat, MainStatSlot,
} from "../calculation-types";

const props = withDefaults(defineProps<{
  modelValue: CalculationDraft;
  members: Member[];
  catalog: Catalog | null;
  issues: CalculationIssue[];
  prechecks?: CalculationPrecheckDiagnostic[];
  effectiveTargets?: CalculationConfig['targets'];
  busy?: boolean;
  initialSlot?: number;
  readOnly?: boolean;
}>(), { busy: false, initialSlot: 1, readOnly: false, prechecks: () => [], effectiveTargets: () => [] });
const emit = defineEmits<{ "update:modelValue": [draft: CalculationDraft] }>();
const readOnly = computed(() => props.readOnly || props.busy);
const cloneDraft = (value: CalculationDraft): CalculationDraft => JSON.parse(JSON.stringify(value)) as CalculationDraft;
const draft = ref(cloneDraft(props.modelValue));
const targets = computed(() => draft.value.members);
const activeSlot = ref(Math.min(5, Math.max(1, props.initialSlot)));
const editorRoot = ref<HTMLElement | null>(null);
const activeTarget = computed(() => targets.value.find((target) => target.slot === activeSlot.value) ?? null);
const activePoolMatch = computed(() => activeTarget.value ? matchHitMetricPool(activeTarget.value, draft.value.hitMetricPools) : null);
const activePoolOverride = computed(() => !!(activePoolMatch.value?.shikigami || activePoolMatch.value?.yuhunIds.length));
const activeMetricId = computed<CalculationMetricId>({
  get: () => activeTarget.value ? effectiveCalculationMetricId(activeTarget.value, draft.value.hitMetricPools) : 2,
  set: (value) => { if (activeTarget.value && !activePoolOverride.value && !readOnly.value) activeTarget.value.metricId = value; },
});
const activeDiagnostic = computed(() => props.prechecks.find((diagnostic) => diagnostic.slot === activeSlot.value));
const activeConflict = computed(() => activeTarget.value?.enabled && activeDiagnostic.value?.status === 'conflict');
const activeRelaxed = computed(() => activeTarget.value?.enabled && activeDiagnostic.value?.status === 'relaxed'
  && props.effectiveTargets.some((target) => target.slot === activeSlot.value && target.yuhunConfigEnabled));
const activeManualAdjustment = computed(() => activeTarget.value?.enabled && activeDiagnostic.value?.status === 'manual-adjustment'
  && props.effectiveTargets.some((target) => target.slot === activeSlot.value && target.yuhunConfigEnabled));
const activeManualAdjustmentDetail = computed(() => {
  if (!activeManualAdjustment.value) return '';
  const adjustments = activeDiagnostic.value?.manualAdjustments ?? [];
  const values = adjustments.map(({ position, stat, originalMax, calculationMax }) =>
    `${position}号位（${statLabel(stat)}，原上限 ${formatPanelValue(originalMax)} → 导出上限 ${formatPanelValue(calculationMax)}）`).join('、');
  return `导出保留仅六星、仅满级，并临时扩大上限。计算完成后需卸下${values}；原目标仍保留在输入中。卸装后须复核下限、副属性、套装和队伍次序，不保证达到原目标。`;
});
const activeRelaxationDetail = computed(() => {
  const target = activeTarget.value;
  if (!target || !activeRelaxed.value) return '';
  const effective = effectiveStarLevel(target);
  return effective.sixStarOnly
    ? '六星满级组合超限，导出保留仅六星、取消仅满级；主属性按六星+0下界筛选，仍需实际库存计算。'
    : '六星+0下界也无可行组合，导出不限星级与等级；低星主属性未据此排除，仍需实际库存计算。';
});
const activeCombinationScope = computed(() => {
  const target = activeTarget.value;
  const effective = target ? projectedMainStats(target) : null;
  if (!target || !effective) return null;
  const count = (stats: CalculationMemberDraft['mainStats']) => ([2, 4, 6] as const)
    .reduce((total, slot) => total * (stats[slot].length || MAIN_STAT_OPTIONS[slot].length), 1);
  return { original: count(target.mainStats), effective: count(effective.mainStats) };
});
const shikigamiPickerOpen = ref(false);
const shikigamiSearch = ref("");
const shikigamiRarityFilter = ref("全部");
const yuhunPickerOpen = ref(false);
const activeSuitIndex = ref<number | null>(null);
const activeSuitCount = ref<2 | 4>(4);
const yuhunSearch = ref("");
const activeYuhunCategory = ref<string>("全部");
const LIMIT_STAT_OPTIONS: readonly Stat[] = ["attack", "crit", "critDamage", "speed", "defense", "hp", "effectResist"];
const HIGHEST_STAT_OPTIONS: readonly Stat[] = [...LIMIT_STAT_OPTIONS, "effectHit"];
const YUHUN_CATEGORY_OPTIONS = YUHUN_CATEGORIES;
const SHIKIGAMI_RARITY_OPTIONS = computed(() => shikigamiRarities(props.catalog).map((name) => ({ name, label: rarityLabel(name) })));
const suitOptions = computed(() => calculationSuitOptions(props.catalog));
const scatteredOption: SuitOption = { id: "scattered", name: "散件", avatar: "", category: "其他", kind: "suit", twoPieceOnly: false };
const visibleShikigami = computed(() => {
  const query = shikigamiSearch.value.trim().toLocaleLowerCase();
  return (props.catalog?.shikigami ?? []).filter((item) =>
    (shikigamiRarityFilter.value === "全部" || item.rarity === shikigamiRarityFilter.value)
    && (query === "" || `${item.name} ${item.id} ${item.rarity ?? ""} ${rarityLabel(item.rarity ?? '')}`.toLocaleLowerCase().includes(query))
  ).map((item) => ({ ...item, avatar: item.avatar ? assetRequestUrl(item.avatar) : "" }));
});
const visibleYuhun = computed(() => {
  const query = yuhunSearch.value.trim().toLocaleLowerCase();
  const options = [...suitOptions.value, scatteredOption].filter((item) =>
    (activeYuhunCategory.value === "全部" || item.category === activeYuhunCategory.value)
    && (activeSuitCount.value === 2 || !item.twoPieceOnly)
    && (query === "" || `${item.name} ${item.id} ${item.category}`.toLocaleLowerCase().includes(query))
  );
  return activeSuitCount.value === 2 ? options.sort((a, b) => twoPieceOptionOrder(a) - twoPieceOptionOrder(b)) : options;
});
const shikigamiPickerItems = computed<AssetSelectorItem[]>(() => visibleShikigami.value.map((item) => ({
  ...item, subtitle: rarityLabel(item.rarity ?? ''),
})));
const yuhunPickerItems = computed<AssetSelectorItem[]>(() => visibleYuhun.value.map((item) => ({
  id: item.id, name: item.name, avatar: yuhunImage(item.name) ?? '',
  subtitle: yuhunCategory(item.name), disabled: isUnavailableYuhun(item),
})));
const yuhunFilters = YUHUN_CATEGORY_OPTIONS.map((name) => ({ name, label: name }));
const selectedYuhunIds = computed(() => activeSuitIndex.value === null ? [] : visibleYuhun.value
  .filter((item) => activeTarget.value?.suitRequirements[activeSuitIndex.value!]?.name === item.name).map((item) => item.id));
function pickShikigami(id: string): void {
  const item = props.catalog?.shikigami.find((asset) => asset.id === id);
  if (item) selectShikigami(item);
}
function pickYuhun(id: string): void {
  const item = visibleYuhun.value.find((option) => option.id === id);
  if (item) selectYuhun(item);
}

// Host transactions own the saved draft. Every update is a fresh independent copy.
watch(() => props.modelValue, (value) => {
  if (JSON.stringify(value) !== JSON.stringify(draft.value)) draft.value = cloneDraft(value);
}, { deep: true });
watch(draft, (value) => {
  if (JSON.stringify(value) !== JSON.stringify(props.modelValue)) emit("update:modelValue", cloneDraft(value));
}, { deep: true });
watch(() => props.initialSlot, (slot) => { activeSlot.value = Math.min(5, Math.max(1, slot)); });
watch(readOnly, (value) => { if (value) closeTopPicker(); });

function statLabel(stat: Stat): string { return STATS.find(([key]) => key === stat)?.[1] ?? stat; }
function constraintEnabled(stat: Stat): boolean { return draft.value.reproduction.constraintStats.some((selected) => selected === stat); }
function formatPanelValue(value: number): string { return String(Number(value.toFixed(4))); }
function metricName(id: CalculationMetricId): string { return id === 8 ? '暴击率' : CALCULATION_METRICS.find((metric) => metric.id === id)?.name ?? "伤害输出"; }
function precheckConflict(target: CalculationMemberDraft): boolean {
  return target.enabled && props.prechecks.some((diagnostic) => diagnostic.slot === target.slot && diagnostic.status === 'conflict');
}
function targetStatus(target: CalculationMemberDraft): string {
  if (!target.enabled) return '无需配置御魂';
  const diagnostic = props.prechecks.find((diagnostic) => diagnostic.slot === target.slot);
  return diagnostic?.status === 'conflict' ? '导出不配御魂' : diagnostic?.status === 'unchecked' ? '未预检'
    : diagnostic?.status === 'relaxed' ? relaxedStatus(effectiveStarLevel(target))
      : diagnostic?.status === 'manual-adjustment' ? '计算后需卸装'
      : diagnostic?.status === 'optimized' ? '主属性已收紧' : metricName(effectiveCalculationMetricId(target, draft.value.hitMetricPools));
}
function relaxedStatus(effective: { sixStarOnly: boolean; maxLevelOnly: boolean }): string {
  return effective.sixStarOnly && !effective.maxLevelOnly ? '已放宽满级' : '已放宽星级/满级';
}
function shikigamiAsset(target: CalculationMemberDraft): Asset | undefined {
  return props.catalog?.shikigami.find((asset) => asset.id === target.shikigami?.catalogId);
}
function shikigamiName(target: CalculationMemberDraft): string {
  return shikigamiAsset(target)?.name || target.shikigami?.name || (target.shikigami?.catalogId ? `式神 #${target.shikigami.catalogId}` : "未知式神");
}
function shikigamiImage(target: CalculationMemberDraft): string { const avatar = shikigamiAsset(target)?.avatar; return avatar ? assetRequestUrl(avatar) : ""; }
function shikigamiRarity(target: CalculationMemberDraft): string { return shikigamiAsset(target)?.rarity ?? ""; }
function yuhunImage(name: string): string | undefined { const avatar = suitOptions.value.find((item) => item.name === name)?.avatar; return avatar ? assetRequestUrl(avatar) : undefined; }
function yuhunCategory(name: string): string { return name === "散件" ? "剩余位置使用散件" : suitOptions.value.find((item) => item.name === name)?.category ?? "其他"; }
function yuhunPlaceholder(name: string): string { return name.slice(0, 1); }
function activateSlot(target: CalculationMemberDraft): void {
  if (props.busy || (readOnly.value && target.shikigami === null)) return;
  if (target.shikigami) activeSlot.value = target.slot;
  else openShikigamiPicker(target.slot);
}
function openShikigamiPicker(slot: number): void {
  if (readOnly.value) return;
  activeSlot.value = slot;
  shikigamiSearch.value = "";
  shikigamiRarityFilter.value = "全部";
  shikigamiPickerOpen.value = true;
}
function selectShikigami(shikigami: Asset): void {
  const target = activeTarget.value;
  if (target === null || readOnly.value) return;
  if (target.shikigami === null) target.enabled = true;
  target.shikigami = { catalogId: shikigami.id, name: shikigami.name };
  shikigamiPickerOpen.value = false;
}
function clearActiveTarget(): void {
  if (readOnly.value) return;
  const index = targets.value.findIndex((target) => target.slot === activeSlot.value);
  if (index >= 0) targets.value[index] = createEmptyCalculationMember(activeSlot.value);
}
function selectedSuitCapacity(target: CalculationMemberDraft, excludingIndex: number | null = null): number {
  return target.suitRequirements.reduce((total, requirement, index) => index === excludingIndex ? total : total + requirement.count, 0);
}
function canSelectSuitCount(count: 2 | 4): boolean {
  return activeTarget.value !== null && selectedSuitCapacity(activeTarget.value, activeSuitIndex.value) + count <= 6;
}
function addSuit(): void {
  if (activeTarget.value === null || activeTarget.value.suitSelectionComplete || selectedSuitCapacity(activeTarget.value) > 4) return;
  openYuhunPicker(null);
}
function openYuhunPicker(index: number | null): void {
  const target = activeTarget.value;
  if (target === null || readOnly.value || !target.enabled) return;
  activeSuitIndex.value = index;
  const remaining = 6 - selectedSuitCapacity(target, index);
  activeSuitCount.value = index === null ? remaining === 2 ? 2 : 4 : target.suitRequirements[index]!.count;
  yuhunSearch.value = "";
  activeYuhunCategory.value = "全部";
  yuhunPickerOpen.value = true;
}
function selectSuitCount(count: 2 | 4): void {
  if (readOnly.value || !canSelectSuitCount(count)) return;
  activeSuitCount.value = count;
  activeYuhunCategory.value = "全部";
}
function selectYuhun(item: SuitOption): void {
  const target = activeTarget.value;
  if (target === null || readOnly.value || isUnavailableYuhun(item)) return;
  if (item.name === "散件") {
    if (activeSuitIndex.value !== null) target.suitRequirements.splice(activeSuitIndex.value, 1);
    target.suitSelectionComplete = true;
    yuhunPickerOpen.value = false;
    return;
  }
  const requirement = { catalogId: item.id, name: item.name, count: activeSuitCount.value, kind: item.kind };
  if (activeSuitIndex.value === null) target.suitRequirements.push(requirement);
  else target.suitRequirements.splice(activeSuitIndex.value, 1, requirement);
  target.suitSelectionComplete = false;
  yuhunPickerOpen.value = false;
}
function isUnavailableYuhun(item: SuitOption): boolean {
  const target = activeTarget.value;
  if (target === null) return true;
  if (item.name === "散件") return false;
  return !canSelectSuitCount(activeSuitCount.value) || (activeSuitCount.value === 4 && item.twoPieceOnly)
    || target.suitRequirements.some((requirement, index) => index !== activeSuitIndex.value && requirement.kind === item.kind && requirement.name === item.name);
}
function removeYuhun(index: number): void {
  const target = activeTarget.value;
  if (target === null || readOnly.value) return;
  target.suitRequirements.splice(index, 1);
  target.suitSelectionComplete = false;
  if (activeSuitIndex.value === index) yuhunPickerOpen.value = false;
}
function clearScatteredSelection(): void { if (activeTarget.value && !readOnly.value) activeTarget.value.suitSelectionComplete = false; }
function twoPieceOptionOrder(item: SuitOption): number { return item.kind === "two-piece-effect" ? 0 : item.category === "首领御魂" ? 1 : 2; }
function applyMetricPreset(): void { if (activeTarget.value && !readOnly.value) activeTarget.value.mainStats = metricMainStatPreset(activeTarget.value.metricId); }
function projectedMainStats(target: CalculationMemberDraft): CalculationConfig['targets'][number] | null {
  if (!target.enabled) return null;
  const diagnostic = props.prechecks.find((item) => item.slot === target.slot);
  if (diagnostic?.status !== 'optimized' && diagnostic?.status !== 'compatible' && diagnostic?.status !== 'relaxed' && diagnostic?.status !== 'manual-adjustment') return null;
  const effective = props.effectiveTargets.find((item) => item.slot === target.slot);
  return effective?.yuhunConfigEnabled ? effective : null;
}
function selectedMainStats(target: CalculationMemberDraft, slot: MainStatSlot): MainStat[] {
  const effective = projectedMainStats(target);
  if (!effective) return target.mainStats[slot];
  const selected = effective.mainStats[slot];
  // The complete legal set is the same visible choice as "任意".
  return selected.length === MAIN_STAT_OPTIONS[slot].length
    && MAIN_STAT_OPTIONS[slot].every((stat) => selected.includes(stat)) ? [] : selected;
}
function automaticallyExcluded(target: CalculationMemberDraft, slot: MainStatSlot, stat: MainStat): boolean {
  const diagnostic = props.prechecks.find((item) => item.slot === target.slot);
  return (diagnostic?.status === 'optimized' || diagnostic?.status === 'compatible' || diagnostic?.status === 'relaxed' || diagnostic?.status === 'manual-adjustment')
    && projectedMainStats(target) !== null && diagnostic.removedMainStats[slot].includes(stat);
}
function mainStatDetail(target: CalculationMemberDraft, slot: MainStatSlot): string {
  if (!target.enabled) return '无需配置御魂';
  const diagnostic = props.prechecks.find((item) => item.slot === target.slot);
  if (diagnostic?.status === 'conflict') return '预检冲突，导出不配御魂；调整约束后可继续编辑';
  if (diagnostic?.status === 'unchecked') return `未预检：${diagnostic.reason}；显示手动选择`;
  if (!projectedMainStats(target)) return '暂无法计算有效主属性；显示手动选择';
  const selected = selectedMainStats(target, slot);
  const value = selected.length ? selected.map((stat) => MAIN_STAT_LABELS[stat]).join(' / ') : '任意';
  const removed = diagnostic?.removedMainStats[slot] ?? [];
  const visibleTier = effectiveStarLevel(target);
  const stage = visibleTier.sixStarOnly && !visibleTier.maxLevelOnly ? '六星+0下界后导出允许'
    : diagnostic?.status === 'relaxed' ? '导出允许（低星未剪枝）' : '导出允许';
  return `${removed.length ? `自动排除${removed.map((stat) => MAIN_STAT_LABELS[stat]).join('、')}；` : ''}${stage}：${value}${removed.length ? '；点任意恢复自动筛选' : ''}`;
}
function effectiveStarLevel(target: CalculationMemberDraft): { sixStarOnly: boolean; maxLevelOnly: boolean } {
  const diagnostic = props.prechecks.find((item) => item.slot === target.slot);
  const effective = props.effectiveTargets.find((item) => item.slot === target.slot);
  return target.enabled && diagnostic?.status === 'relaxed' && effective?.yuhunConfigEnabled
    ? { sixStarOnly: effective.sixStarOnly, maxLevelOnly: effective.maxLevelOnly }
    : { sixStarOnly: target.sixStarOnly, maxLevelOnly: target.maxLevelOnly };
}
function changeStarLevel(field: 'sixStarOnly' | 'maxLevelOnly', checked: boolean): void {
  const target = activeTarget.value;
  if (!target || readOnly.value) return;
  // A user click starts from the two flags shown on screen, never the hidden raw TT.
  const visible = effectiveStarLevel(target);
  target.sixStarOnly = visible.sixStarOnly;
  target.maxLevelOnly = visible.maxLevelOnly;
  target[field] = checked;
}
function toggleMainStat(slot: MainStatSlot, stat: MainStat | "任意"): void {
  const target = activeTarget.value;
  if (target === null || readOnly.value) return;
  if (stat !== '任意' && automaticallyExcluded(target, slot, stat)) return;
  const current = selectedMainStats(target, slot);
  target.mainStats[slot] = stat === "任意" ? [] : current.includes(stat) ? current.filter((item) => item !== stat) : [...current, stat];
}
let nextLimitId = Math.max(0, ...targets.value.flatMap((target) => target.limits.map((limit) => limit.id))) + 1;
function addLimit(): void {
  if (!activeTarget.value || readOnly.value) return;
  nextLimitId = Math.max(nextLimitId, ...targets.value.flatMap((target) => target.limits.map((limit) => limit.id + 1)));
  const stat = LIMIT_STAT_OPTIONS.find((candidate) => !activeTarget.value!.limits.some((limit) => limit.stat === candidate)) ?? "speed";
  activeTarget.value.limits.push({ id: nextLimitId++, stat, min: "", max: "" });
}
function removeLimit(id: number): void { if (activeTarget.value && !readOnly.value) activeTarget.value.limits = activeTarget.value.limits.filter((limit) => limit.id !== id); }
function pickerFocusFallback(): HTMLElement | null { return editorRoot.value?.querySelector<HTMLButtonElement>(".manual-team-strip > button.active:not(:disabled)") ?? null; }
function focusPicker(element: Element): void { element.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }); }
function closeTopPicker(): boolean {
  if (yuhunPickerOpen.value) { yuhunPickerOpen.value = false; return true; }
  if (shikigamiPickerOpen.value) { shikigamiPickerOpen.value = false; return true; }
  return false;
}
function onEditorKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && closeTopPicker()) { event.preventDefault(); event.stopPropagation(); }
}
defineExpose({ closeTopPicker });
</script>

<template>
  <section ref="editorRoot" class="manual-target-editor" @keydown="onEditorKeydown" :class="{ 'read-only': readOnly }" data-testid="manual-target-editor">
    <nav class="manual-team-strip" aria-label="阵容式神槽位">
      <button type="button" v-for="target in targets" :key="target.slot" :disabled="readOnly && (busy || target.shikigami === null)" :class="{ active: activeSlot === target.slot, configured: target.shikigami !== null, 'calculation-disabled': target.shikigami !== null && !target.enabled, 'precheck-conflict': target.shikigami !== null && precheckConflict(target) }" :aria-label="target.shikigami ? `${readOnly ? '查看' : '编辑'}${shikigamiName(target)}，${targetStatus(target)}` : `选择槽位${target.slot}式神`" @click="activateSlot(target)">
        <span class="manual-slot-number">{{ target.slot }}</span>
        <template v-if="target.shikigami"><span v-if="precheckConflict(target)" class="manual-precheck-mark" title="预检冲突" aria-label="预检冲突">!</span><img v-if="shikigamiImage(target)" :src="shikigamiImage(target)" :alt="shikigamiName(target)" /><span v-else class="avatar-fallback">{{ shikigamiName(target).slice(0, 1) }}</span><strong>{{ shikigamiName(target) }}</strong><small>{{ targetStatus(target) }}</small></template>
        <template v-else><span class="manual-slot-plus"><Plus :size="20" /></span><strong>添加式神</strong><small>未配置</small></template>
      </button>
    </nav>

    <fieldset class="manual-editor-main" :disabled="readOnly">
      <section v-if="activeTarget?.shikigami" class="manual-config" aria-label="御魂搭配设置">
        <header class="manual-config-title">
          <div class="selected-shikigami">
            <img v-if="shikigamiImage(activeTarget)" :src="shikigamiImage(activeTarget)" :alt="shikigamiName(activeTarget)" />
            <span v-else class="avatar-fallback">{{ shikigamiName(activeTarget).slice(0, 1) }}</span>
            <div><span>槽位 {{ activeTarget.slot }} · {{ shikigamiRarity(activeTarget) }}</span><h3>{{ shikigamiName(activeTarget) }}</h3></div>
          </div>
          <div class="selected-shikigami-actions">
            <label class="yuhun-config-toggle"><input v-model="activeTarget.enabled" type="checkbox" :true-value="false" :false-value="true" />无需配置御魂</label>
            <button type="button" @click="openShikigamiPicker(activeTarget.slot)"><UserRoundPlus :size="15" />更换式神</button>
            <button type="button" class="danger" title="移除此式神" @click="clearActiveTarget"><Trash2 :size="15" /></button>
          </div>
        </header>

        <div v-if="activeTarget.enabled && activeDiagnostic && activeDiagnostic.status !== 'compatible'" class="manual-precheck-note" :class="activeDiagnostic.status" role="status">
          <strong>{{ activeConflict ? '预检冲突' : activeDiagnostic.status === 'unchecked' ? '未预检' : activeDiagnostic.status === 'relaxed' && activeTarget ? relaxedStatus(effectiveStarLevel(activeTarget)) : activeDiagnostic.status === 'manual-adjustment' ? '计算后需卸装' : '主属性已收紧' }}</strong>
          <p>{{ activeDiagnostic.reason }}</p>
          <p v-if="activeConflict">导出时不配置御魂；保留此槽位和全部设置，调整约束消除冲突后自动恢复。</p>
          <p v-else-if="activeDiagnostic.status === 'optimized'">下方主属性已显示导出允许选项；点选后保存为手动选择，仍需实际配装计算。</p>
          <p v-else-if="activeDiagnostic.status === 'relaxed'">{{ activeRelaxationDetail }}</p>
          <p v-else-if="activeDiagnostic.status === 'manual-adjustment'">{{ activeManualAdjustmentDetail }}</p>
        </div>

        <fieldset class="manual-config-columns" :disabled="!activeTarget.enabled">
          <section class="manual-config-panel">
            <header><span>YUHUN TARGET</span><h4>御魂指定</h4></header>
            <div class="manual-field-grid">
              <div class="wide-field suit-field"><span class="field-label">御魂套装</span><div class="suit-trigger-grid">
                <div v-for="(requirement, index) in activeTarget.suitRequirements" :key="`${requirement.name}-${index}`" class="suit-selection">
                  <button type="button" class="suit-trigger" :data-suit-count="requirement.count" @click="openYuhunPicker(index)">
                    <img v-if="yuhunImage(requirement.name)" :src="yuhunImage(requirement.name)!" alt="" />
                    <span v-else class="suit-mark">{{ yuhunPlaceholder(requirement.name) }}</span>
                    <span><small>{{ requirement.count }}件套</small><strong>{{ requirement.name }}</strong></span>
                    <ChevronDown :size="15" />
                  </button>
                  <button type="button" class="suit-remove" :title="`移除${requirement.name}`" :aria-label="`移除${requirement.name}`" @click="removeYuhun(index)"><X :size="13" /></button>
                </div>
                <div v-if="activeTarget.suitSelectionComplete" class="suit-selection">
                  <button type="button" class="suit-trigger scattered-suit-trigger" data-suit-count="0" @click="openYuhunPicker(null)">
                    <span class="suit-mark">散</span>
                    <span><small>散件</small><strong>散件</strong></span>
                    <ChevronDown :size="15" />
                  </button>
                  <button type="button" class="suit-remove" title="取消散件选择" aria-label="取消散件选择" @click="clearScatteredSelection"><X :size="13" /></button>
                </div>
                <button type="button" v-if="!activeTarget.suitSelectionComplete && selectedSuitCapacity(activeTarget) <= 4" class="suit-add" title="添加御魂套装" aria-label="添加御魂套装" @click="addSuit"><Plus :size="21" /></button>
              </div></div>
              <label><span>效果指标</span><select v-model="activeMetricId" :disabled="activePoolOverride" data-testid="metric-select" @change="applyMetricPreset"><option v-for="metric in CALCULATION_METRICS" :key="metric.id" :value="metric.id">{{ metricName(metric.id) }}</option></select><small v-if="activePoolOverride" class="pool-metric-note">由命中{{ activePoolMatch?.shikigami ? '式神' : '御魂' }}池自动设为暴击率；移出池后恢复原指标。</small></label>
              <label><span>目标评分</span><input v-model="activeTarget.targetScore" inputmode="decimal" placeholder="可选" /></label>
              <div class="wide-field main-stat-field">
                <div class="main-stat-heading"><span class="field-label">2 / 4 / 6 号位主属性</span><small>绿色为当前选项；切换指标自动推荐，可继续多选</small></div>
                <small v-if="activeCombinationScope && (activeDiagnostic?.status === 'optimized' || activeDiagnostic?.status === 'relaxed' || activeDiagnostic?.status === 'manual-adjustment')" class="main-stat-scope">主属性导出允许 {{ activeCombinationScope.original }} → {{ activeCombinationScope.effective }} 种组合（各槽允许项相乘，仍需实际配装计算）</small>
                <div class="main-stat-slots">
                  <div v-for="slot in ([2, 4, 6] as const)" :key="slot" class="main-stat-slot" :data-slot="slot">
                    <strong>{{ slot }} 号位</strong>
                    <div role="group" :aria-label="`${slot}号位主属性`">
                      <button type="button" :class="{ selected: selectedMainStats(activeTarget, slot).length === 0 }" :aria-pressed="selectedMainStats(activeTarget, slot).length === 0" @click="toggleMainStat(slot, '任意')">任意</button>
                      <button type="button" v-for="stat in MAIN_STAT_OPTIONS[slot]" :key="stat" :class="{ selected: selectedMainStats(activeTarget, slot).includes(stat), 'auto-excluded': automaticallyExcluded(activeTarget, slot, stat) }" :aria-pressed="selectedMainStats(activeTarget, slot).includes(stat)" :disabled="automaticallyExcluded(activeTarget, slot, stat)" :title="automaticallyExcluded(activeTarget, slot, stat) ? '当前上限下已自动排除；调整属性限制后可选' : undefined" @click="toggleMainStat(slot, stat)">{{ MAIN_STAT_LABELS[stat] }}</button>
                    </div>
                    <small class="main-stat-detail">{{ mainStatDetail(activeTarget, slot) }}</small>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="manual-config-panel advanced-config-panel">
            <header><span>ADVANCED</span><h4>高级定制</h4></header>
            <div class="advanced-config-body">
              <label class="highest-stat-field"><span>最高属性</span><select v-model="activeTarget.highestStat"><option :value="null">不限制</option><option v-for="stat in HIGHEST_STAT_OPTIONS" :key="stat" :value="stat">{{ statLabel(stat) }}</option></select></label>
              <div class="extra-attribute-fields">
                <strong>额外属性</strong>
                <div>
                  <label><span>攻击加成 (%)</span><input v-model="activeTarget.extraAttributes.attackPercent" data-testid="extra-attack-percent" inputmode="decimal" placeholder="0" /></label>
                  <label><span>固定攻击</span><input v-model="activeTarget.extraAttributes.attack" data-testid="extra-attack" inputmode="decimal" placeholder="0" /></label>
                  <label><span>暴击 (%)</span><input v-model="activeTarget.extraAttributes.crit" data-testid="extra-crit" inputmode="decimal" placeholder="0" /></label>
                  <label><span>暴击伤害 (%)</span><input v-model="activeTarget.extraAttributes.critDamage" data-testid="extra-crit-damage" inputmode="decimal" placeholder="0" /></label>
                </div>
              </div>
              <div class="attribute-limit-head"><div><strong>属性限制</strong><span>{{ activeTarget.limits.length }} 项</span></div><button type="button" title="添加属性限制" @click="addLimit"><Plus :size="15" />添加</button></div>
              <div v-if="activeTarget.limits.length === 0" class="attribute-limit-empty">暂未设置属性区间</div>
              <div v-else class="attribute-limit-list">
                <div v-for="limit in activeTarget.limits" :key="limit.id" class="attribute-limit-row">
                  <select v-model="limit.stat"><option v-for="stat in LIMIT_STAT_OPTIONS" :key="stat" :value="stat">{{ statLabel(stat) }}</option></select>
                  <input v-model="limit.min" inputmode="decimal" placeholder="最低" />
                  <span>至</span>
                  <input v-model="limit.max" inputmode="decimal" placeholder="最高" />
                  <button type="button" title="删除属性限制" @click="removeLimit(limit.id)"><X :size="14" /></button>
                  <small v-if="!constraintEnabled(limit.stat)" class="inactive-limit-note">全局未启用，导出不包含</small>
                </div>
              </div>
              <small v-if="activeManualAdjustment" class="auto-relaxed-detail">输入中仍是原目标；实际导出上限已临时扩大。{{ activeManualAdjustmentDetail }}</small>
              <div class="advanced-checks">
                <label><input v-model="activeTarget.excludeOccupied" type="checkbox" />排除其他已启用阵容占用的御魂</label>
                <fieldset><legend>御魂选择范围</legend><label><input v-model="activeTarget.scope" value="all" type="radio" />全部</label><label><input v-model="activeTarget.scope" value="unequipped" type="radio" />未装备</label></fieldset>
                <fieldset><legend>星级等级限制</legend><label><input :checked="effectiveStarLevel(activeTarget).sixStarOnly" type="checkbox" @change="changeStarLevel('sixStarOnly', ($event.target as HTMLInputElement).checked)" />仅六星</label><label><input :checked="effectiveStarLevel(activeTarget).maxLevelOnly" type="checkbox" @change="changeStarLevel('maxLevelOnly', ($event.target as HTMLInputElement).checked)" />仅满级</label></fieldset>
                <small v-if="activeRelaxed" class="auto-relaxed-detail">{{ activeRelaxationDetail }}</small>
              </div>
            </div>
          </section>
        </fieldset>
      </section>

      <button type="button" v-else class="manual-config-empty" @click="openShikigamiPicker(activeSlot)">
        <UserRoundPlus :size="30" />
        <strong>选择槽位 {{ activeSlot }} 的式神</strong>
        <span>选中式神后设置御魂套装、指标、主属性和高级限制</span>
      </button>

      <ModalTransition :fallback-focus="pickerFocusFallback" @after-enter="focusPicker">
      <div v-if="shikigamiPickerOpen" class="selector-layer" @click.self="shikigamiPickerOpen = false">
        <section class="asset-selector shikigami-picker" role="dialog" aria-modal="true" aria-label="选择式神">
          <header><div><span>槽位 {{ activeSlot }}</span><h3>选择式神</h3></div><button type="button" title="关闭式神选择" @click="shikigamiPickerOpen = false"><X :size="18" /></button></header>
          <AssetSelectorContent kind="shikigami" :items="shikigamiPickerItems" :filters="SHIKIGAMI_RARITY_OPTIONS" v-model:search="shikigamiSearch" v-model:active-filter="shikigamiRarityFilter" :selected-ids="activeTarget?.shikigami?.catalogId ? [activeTarget.shikigami.catalogId] : []" empty-message="没有匹配的式神" @select="pickShikigami" />
        </section>
      </div>
      </ModalTransition>

      <ModalTransition :fallback-focus="pickerFocusFallback" @after-enter="focusPicker">
      <div v-if="yuhunPickerOpen" class="selector-layer" @click.self="yuhunPickerOpen = false">
        <section class="asset-selector yuhun-picker" role="dialog" aria-modal="true" aria-label="选择御魂套装">
          <header><div><span>{{ activeSuitIndex === null ? "添加御魂套装" : "修改御魂套装" }}</span><h3>选择御魂套装</h3></div><button type="button" title="关闭御魂选择" @click="yuhunPickerOpen = false"><X :size="18" /></button></header>
          <nav class="suit-count-tabs" aria-label="御魂套装件数">
            <span :title="canSelectSuitCount(4) ? '' : `当前已选择${activeTarget ? selectedSuitCapacity(activeTarget, activeSuitIndex) : 0}个御魂，无法再添加四件套`"><button type="button" :class="{ active: activeSuitCount === 4 }" :disabled="!canSelectSuitCount(4)" data-testid="suit-count-four" @click="selectSuitCount(4)">四件套</button></span>
            <span :title="canSelectSuitCount(2) ? '' : `当前已选择${activeTarget ? selectedSuitCapacity(activeTarget, activeSuitIndex) : 0}个御魂，无法再添加两件套`"><button type="button" :class="{ active: activeSuitCount === 2 }" :disabled="!canSelectSuitCount(2)" data-testid="suit-count-two" @click="selectSuitCount(2)">两件套</button></span>
          </nav>
          <AssetSelectorContent kind="yuhun" :items="yuhunPickerItems" :filters="yuhunFilters" v-model:search="yuhunSearch" v-model:active-filter="activeYuhunCategory" :selected-ids="selectedYuhunIds" empty-message="没有匹配的御魂套装" @select="pickYuhun" />
        </section>
      </div>
      </ModalTransition>
    </fieldset>

  </section>
</template>

<style scoped>

/* The original editor also relies on these global control rules. Keep them local. */
.manual-target-editor { color: var(--ink, #202426); font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; font-size: 16px; line-height: normal; --gold-soft: #f5f0df; --green-soft: #e5efed; --danger: var(--red); }
:where(.manual-target-editor) :where(button,input,select) { font: inherit; letter-spacing: 0; }
:where(.manual-target-editor) button { cursor: pointer; color: revert; background: revert; border: revert; border-radius: revert; }
:where(.manual-target-editor) button:disabled { cursor: not-allowed; opacity: .43; }
:where(.manual-target-editor) :where(input:not([type="checkbox"]):not([type="radio"]),select) { color: var(--ink); background: #fff; border: 1px solid #cdd2d4; border-radius: 3px; outline: none; height: 34px; padding: 6px 9px; font-size: 11px; }
:where(.manual-target-editor) :where(input:not([type="checkbox"]):not([type="radio"]),select):focus { border-color: #688f8c; box-shadow: 0 0 0 2px #dce9e7; }
:where(.manual-target-editor) h3 { margin: 0; font-size: 13px; }

/* Original styles.css editor cascade, isolated to this component. */

:where(.manual-target-editor){ background: #e9eced; border-bottom: 1px solid var(--line); }
:where(.manual-target-editor) .manual-editor-main{ position: relative; min-height: 395px; padding: 12px 14px; }
:where(.manual-target-editor) .manual-config{ min-height: 371px; }
:where(.manual-target-editor) .manual-config-title{ min-height: 55px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 10px; color: #fff; background: #343a3c; }
:where(.manual-target-editor) .selected-shikigami{ min-width: 0; display: flex; align-items: center; gap: 9px; }
:where(.manual-target-editor) .selected-shikigami img{ width: 39px; height: 39px; object-fit: cover; background: #fff; border: 2px solid #aa9354; border-radius: 3px; }
:where(.manual-target-editor) .selected-shikigami div{ min-width: 0; }
:where(.manual-target-editor) .selected-shikigami span{ display: block; color: #c4cbcd; font-size: 8px; }
:where(.manual-target-editor) .selected-shikigami h3{ margin-top: 2px; font-size: 14px; }
:where(.manual-target-editor) .selected-shikigami-actions{ display: flex; gap: 4px; }
:where(.manual-target-editor) .selected-shikigami-actions button{ min-height: 31px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 5px 8px; color: #e2e6e7; background: transparent; border: 1px solid #626a6d; border-radius: 3px; font-size: 9px; }
:where(.manual-target-editor) .selected-shikigami-actions button.danger{ width: 32px; padding: 0; color: #efc8c5; }
:where(.manual-target-editor) .manual-config-columns{ display: grid; grid-template-columns: minmax(0,.95fr) minmax(0,1.05fr); gap: 10px; margin-top: 10px; }
:where(.manual-target-editor) .manual-config-panel{ min-width: 0; min-height: 306px; background: #fff; border: 1px solid #cfd4d6; border-top: 3px solid var(--red); }
:where(.manual-target-editor) .advanced-config-panel{ border-top-color: var(--gold); }
:where(.manual-target-editor) .manual-config-panel > header{ min-height: 48px; display: grid; align-content: center; padding: 7px 10px; background: #f4f5f5; border-bottom: 1px solid var(--line); }
:where(.manual-target-editor) .manual-config-panel > header span{ color: var(--red); font-size: 8px; font-weight: 800; }
:where(.manual-target-editor) .advanced-config-panel > header span{ color: var(--gold); }
:where(.manual-target-editor) .manual-config-panel > header h4{ margin: 2px 0 0; font-size: 12px; }
:where(.manual-target-editor) .manual-field-grid{ display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 9px 10px; padding: 11px; }
:where(.manual-target-editor) .manual-field-grid label{ min-width: 0; display: grid; gap: 5px; }
:where(.manual-target-editor) .manual-field-grid label > span,:where(.manual-target-editor) .highest-stat-field > span{ color: #596368; font-size: 9px; font-weight: 700; }
:where(.manual-target-editor) .manual-field-grid input,:where(.manual-target-editor) .manual-field-grid select,:where(.manual-target-editor) .highest-stat-field select{ width: 100%; }
:where(.manual-target-editor) .manual-field-grid .wide-field{ grid-column: 1/-1; }
:where(.manual-target-editor) .dual-select{ display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 6px; }
:where(.manual-target-editor) .advanced-config-body{ display: grid; gap: 9px; padding: 11px; }
:where(.manual-target-editor) .highest-stat-field{ display: grid; grid-template-columns: 82px minmax(0,1fr); align-items: center; gap: 8px; }
:where(.manual-target-editor) .attribute-limit-head{ display: flex; align-items: center; justify-content: space-between; min-height: 31px; padding-top: 7px; border-top: 1px solid #e4e7e8; }
:where(.manual-target-editor) .attribute-limit-head > div{ display: flex; align-items: center; gap: 7px; }
:where(.manual-target-editor) .attribute-limit-head strong{ font-size: 10px; }
:where(.manual-target-editor) .attribute-limit-head span{ color: var(--muted); font-size: 8px; }
:where(.manual-target-editor) .attribute-limit-head button{ min-height: 28px; display: inline-flex; align-items: center; gap: 4px; padding: 4px 7px; color: #604f23; background: var(--gold-soft); border: 1px solid #d6c78f; border-radius: 3px; font-size: 9px; }
:where(.manual-target-editor) .attribute-limit-empty{ min-height: 42px; display: grid; place-items: center; color: #92999c; background: #f5f6f6; border: 1px dashed #d3d7d8; font-size: 9px; }
:where(.manual-target-editor) .attribute-limit-list{ max-height: 76px; display: grid; gap: 5px; overflow: auto; }
:where(.manual-target-editor) .attribute-limit-row{ display: grid; grid-template-columns: minmax(82px,.85fr) minmax(55px,1fr) 18px minmax(55px,1fr) 28px; align-items: center; gap: 4px; }
:where(.manual-target-editor) .attribute-limit-row input,:where(.manual-target-editor) .attribute-limit-row select{ min-width: 0; width: 100%; height: 29px; padding: 4px 6px; font-size: 9px; }
:where(.manual-target-editor) .attribute-limit-row > span{ color: var(--muted); text-align: center; font-size: 9px; }
:where(.manual-target-editor) .attribute-limit-row button{ width: 28px; height: 28px; display: grid; place-items: center; padding: 0; color: var(--red); background: #fff; border: 1px solid #d9c0bd; border-radius: 3px; }
:where(.manual-target-editor) .advanced-checks{ display: grid; grid-template-columns: 1fr 1fr; gap: 7px 12px; padding-top: 7px; border-top: 1px solid #e4e7e8; }
:where(.manual-target-editor) .advanced-checks > label{ grid-column: 1/-1; }
:where(.manual-target-editor) .advanced-checks label{ display: flex; align-items: center; gap: 5px; color: #4e595d; font-size: 9px; }
:where(.manual-target-editor) .advanced-checks input{ width: 14px; height: 14px; accent-color: var(--green); }
:where(.manual-target-editor) .advanced-checks fieldset{ min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin: 0; padding: 6px 8px 7px; border: 1px solid var(--line); }
:where(.manual-target-editor) .advanced-checks legend{ padding: 0 3px; color: var(--muted); font-size: 8px; }
:where(.manual-target-editor) .manual-config-empty{ width: 100%; min-height: 371px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; color: #5b696d; background: #f9fafa; border: 1px dashed #adb7ba; }
:where(.manual-target-editor) .manual-config-empty:hover{ color: var(--green); background: #f1f6f5; border-color: var(--green); }
:where(.manual-target-editor) .manual-config-empty strong{ font-size: 13px; }
:where(.manual-target-editor) .manual-config-empty span{ color: var(--muted); font-size: 9px; }
:where(.manual-target-editor) .manual-team-strip{ height: 105px; display: grid; grid-template-columns: repeat(6,minmax(0,1fr)); gap: 1px; padding: 1px 14px 14px; background: #cdd2d4; border-top: 1px solid #c4cacc; }
:where(.manual-target-editor) .manual-team-strip > button{ position: relative; min-width: 0; display: grid; grid-template-columns: 50px minmax(0,1fr); grid-template-rows: 1fr auto; align-items: center; gap: 2px 8px; padding: 8px; color: #616b70; background: #f5f6f6; border: 0; border-top: 3px solid transparent; text-align: left; }
:where(.manual-target-editor) .manual-team-strip > button.active{ color: #284d4e; background: #fff; border-top-color: var(--green); }
:where(.manual-target-editor) .manual-team-strip > button.configured:not(.active){ border-top-color: #a8b8b7; }
:where(.manual-target-editor) .manual-team-strip img,:where(.manual-target-editor) .manual-slot-plus{ width: 48px; height: 48px; grid-row: 1/-1; object-fit: cover; background: #e4e7e8; border: 1px solid #c2c9cb; border-radius: 3px; }
:where(.manual-target-editor) .manual-slot-plus{ display: grid; place-items: center; }
:where(.manual-target-editor) .manual-team-strip strong,:where(.manual-target-editor) .manual-team-strip small{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:where(.manual-target-editor) .manual-team-strip strong{ align-self: end; font-size: 10px; }
:where(.manual-target-editor) .manual-team-strip small{ align-self: start; color: var(--muted); font-size: 8px; }
:where(.manual-target-editor) .manual-slot-number{ position: absolute; z-index: 1; top: 4px; left: 4px; width: 16px; height: 16px; display: grid; place-items: center; color: #fff; background: #4e595c; border-radius: 2px; font-size: 8px; }
:where(.manual-target-editor) .shikigami-picker-layer{ position: absolute; z-index: 5; inset: 12px 14px; display: grid; place-items: center; padding: 16px; background: rgb(30 35 37 / 52%); }
:where(.manual-target-editor) .shikigami-picker{ width: min(760px,100%); max-height: 355px; overflow: auto; background: #fff; border: 1px solid #9da7aa; box-shadow: 0 18px 50px rgb(0 0 0 / 30%); }
:where(.manual-target-editor) .shikigami-picker > header{ min-height: 53px; display: flex; align-items: center; justify-content: space-between; padding: 8px 11px; color: #fff; background: #343a3c; }
:where(.manual-target-editor) .shikigami-picker header span{ color: #c1c8ca; font-size: 8px; }
:where(.manual-target-editor) .shikigami-picker header h3{ margin-top: 2px; }
:where(.manual-target-editor) .shikigami-picker header button{ width: 30px; height: 30px; display: grid; place-items: center; padding: 0; color: #fff; background: transparent; border: 1px solid #626a6d; border-radius: 3px; }
:where(.manual-target-editor) .shikigami-search{ height: 46px; display: grid; grid-template-columns: 20px 1fr; align-items: center; gap: 5px; padding: 6px 11px; color: #788286; border-bottom: 1px solid var(--line); }
:where(.manual-target-editor) .shikigami-search input{ width: 100%; border: 0; box-shadow: none; }
:where(.manual-target-editor) .shikigami-grid{ display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: 1px; padding: 1px; background: #d9dddf; }
:where(.manual-target-editor) .shikigami-grid button{ position: relative; min-width: 0; min-height: 94px; display: grid; grid-template-columns: 54px minmax(0,1fr); grid-template-rows: 1fr auto; align-items: center; gap: 2px 8px; padding: 8px; color: #394245; background: #f8f9f9; border: 0; text-align: left; }
:where(.manual-target-editor) .shikigami-grid button:hover,:where(.manual-target-editor) .shikigami-grid button.selected{ background: var(--green-soft); }
:where(.manual-target-editor) .shikigami-grid img{ width: 54px; height: 70px; grid-row: 1/-1; object-fit: cover; border: 1px solid #bcc4c6; }
:where(.manual-target-editor) .shikigami-grid span{ align-self: end; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; font-weight: 700; }
:where(.manual-target-editor) .shikigami-grid small{ align-self: start; color: var(--gold); font-size: 8px; font-weight: 800; }
:where(.manual-target-editor) .shikigami-grid svg{ position: absolute; top: 5px; right: 5px; color: #fff; background: var(--green); border-radius: 2px; }
:where(.manual-target-editor) .shikigami-no-result{ min-height: 120px; display: grid; place-items: center; color: var(--muted); font-size: 10px; }


.manual-target-editor { min-width: 0; }
.manual-editor-main { min-width: 0; min-height: 410px; margin: 12px 0 0; padding: 12px 14px; border: 0; }
.manual-target-editor.read-only .manual-editor-main { background: #fafafa; }
.manual-config { min-width: 0; }
.manual-config-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.selected-shikigami,.selected-shikigami-actions,.suit-trigger,.selector-search,.asset-grid button,.main-stat-heading { display: flex; align-items: center; }
.selected-shikigami { gap: 10px; }
.selected-shikigami > img,.selected-shikigami > .avatar-fallback { width: 44px; height: 44px; border-radius: 4px; object-fit: cover; }
.selected-shikigami div > span,.manual-config-panel > header span { color: var(--muted); font-size: 9px; }
.selected-shikigami h3,.manual-config-panel h4,.asset-selector h3 { margin: 2px 0 0; letter-spacing: 0; }
.selected-shikigami-actions { gap: 6px; }
.yuhun-config-toggle { min-height: 31px; display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; color: #e2e6e7; border: 1px solid #626a6d; border-radius: 3px; font-size: 9px; cursor: pointer; }.yuhun-config-toggle input { accent-color: var(--gold); }
.selected-shikigami-actions button,.attribute-limit-head button,.asset-selector > header button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.manual-config-columns { display: grid; grid-template-columns: minmax(0,1.45fr) minmax(280px,.75fr); margin: 0; padding: 0; border: 1px solid var(--line); }.manual-config-columns:disabled { opacity: .55; }
.manual-team-strip > button.calculation-disabled { opacity: .55; filter: grayscale(.8); }.manual-team-strip > button.calculation-disabled small { color: var(--red); }
.manual-team-strip > button.precheck-conflict { background: #fff3ec; }.manual-team-strip > button.precheck-conflict small { color: #a14b34; }.manual-precheck-mark { position: absolute; z-index: 1; right: 5px; top: 5px; display: grid; place-items: center; width: 15px; height: 15px; border-radius: 50%; background: #a14b34; color: #fff; font-size: 10px; font-weight: 700; }
.manual-precheck-note { margin-top: 8px; padding: 8px 10px; border: 1px solid #d2e0da; border-radius: 3px; background: #edf5f1; color: #43665a; font-size: 10px; line-height: 1.5; }.manual-precheck-note strong { font-size: 10px; }.manual-precheck-note p { margin: 3px 0 0; }.manual-precheck-note.conflict { border-color: #e5c7ba; background: #fff1ea; color: #9d4b35; }.manual-precheck-note.unchecked { border-color: #e4dac1; background: #faf5e7; color: #846d36; }
.manual-precheck-note.relaxed { border-color: #d7dfbf; background: #f4f7e9; color: #526b42; }
.manual-precheck-note.manual-adjustment { border-color: #e1d2af; background: #faf5e8; color: #81642e; }
.inactive-limit-note { grid-column: 1 / -1; color: #8c734d; font-size: 9px; }
.pool-metric-note { color: #647957; font-size: 10px; line-height: 1.5; }
.manual-config-panel { min-width: 0; padding: 16px; }
.manual-config-panel + .manual-config-panel { border-left: 1px solid var(--line); }
.manual-config-panel > header { margin-bottom: 12px; }
.manual-field-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.manual-field-grid label,.highest-stat-field { display: grid; gap: 5px; }
.manual-field-grid label > span,.field-label,.highest-stat-field > span { color: var(--muted); font-size: 10px; }
.manual-field-grid select,.manual-field-grid input,.highest-stat-field select,.attribute-limit-row select,.attribute-limit-row input { width: 100%; min-width: 0; }
.extra-attribute-fields { display: grid; gap: 7px; }.extra-attribute-fields > strong { font-size: 10px; }.extra-attribute-fields > div { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 7px; }.extra-attribute-fields label { display: grid; gap: 4px; }.extra-attribute-fields label span { color: var(--muted); font-size: 9px; }.extra-attribute-fields input { width: 100%; min-width: 0; }
.wide-field { grid-column: 1/-1; }
.suit-trigger-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(156px,1fr)); gap: 8px; margin-top: 5px; }
.suit-selection { position: relative; min-width: 0; }
.suit-trigger { position: relative; min-height: 58px; justify-content: flex-start; gap: 9px; padding: 7px 10px; text-align: left; }
.suit-selection .suit-trigger { width: 100%; padding-right: 31px; }
.suit-remove { position: absolute; top: 5px; right: 5px; display: inline-grid; width: 20px; height: 20px; padding: 0; place-items: center; color: var(--muted); border: 0; background: transparent; }
.suit-remove:hover { color: var(--danger); background: rgba(186,65,48,.08); }
.suit-add { min-height: 58px; display: grid; min-width: 0; place-items: center; color: var(--muted); border: 1px dashed var(--line); background: transparent; }
.suit-add:hover { color: var(--green); border-color: var(--green); background: transparent; }
.suit-trigger > img,.suit-trigger > .suit-mark { flex: 0 0 40px; width: 40px; height: 40px; }
.suit-trigger > span:nth-last-child(2) { display: grid; min-width: 0; gap: 2px; flex: 1; }
.suit-trigger small { color: var(--muted); font-size: 8px; }
.suit-trigger strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.main-stat-heading { justify-content: space-between; gap: 10px; margin-bottom: 7px; }
.main-stat-heading small { color: var(--muted); font-size: 9px; }
.main-stat-scope { display: block; margin: -1px 0 7px; color: var(--muted); font-size: 9px; line-height: 1.4; }
.main-stat-slots { display: grid; gap: 7px; }
.main-stat-slot { display: grid; grid-template-columns: 48px minmax(0,1fr); gap: 8px; align-items: start; }
.main-stat-slot > strong { padding-top: 7px; font-size: 10px; }
.main-stat-slot > div { display: flex; flex-wrap: wrap; gap: 5px; }
.main-stat-slot button { min-height: 28px; padding: 4px 8px; font-size: 9px; }
.main-stat-slot button.selected { color: #fff; background: var(--green); border-color: var(--green); }
.main-stat-slot button.auto-excluded { color: var(--muted); opacity: .55; cursor: not-allowed; text-decoration: line-through; }
.main-stat-detail { grid-column: 2; color: var(--muted); font-size: 9px; line-height: 1.4; }
.advanced-config-body { display: grid; gap: 13px; }
.attribute-limit-head { display: flex; justify-content: space-between; align-items: center; }
.attribute-limit-head > div { display: grid; gap: 2px; }
.attribute-limit-head span,.attribute-limit-empty { color: var(--muted); font-size: 9px; }
.attribute-limit-empty { padding: 16px 8px; text-align: center; border: 1px dashed var(--line); }
.attribute-limit-list { display: grid; gap: 6px; }
.attribute-limit-row { display: grid; grid-template-columns: minmax(72px,1fr) minmax(48px,.65fr) auto minmax(48px,.65fr) 28px; gap: 4px; align-items: center; }
.attribute-limit-row > span { color: var(--muted); font-size: 9px; }
.advanced-checks { display: grid; gap: 10px; font-size: 10px; }
.advanced-checks label { display: inline-flex; align-items: center; gap: 6px; }
.advanced-checks fieldset { display: flex; flex-wrap: wrap; gap: 12px; margin: 0; padding: 8px 10px; border: 1px solid var(--line); }
.advanced-checks legend { padding: 0 4px; color: var(--muted); font-size: 9px; }
.auto-relaxed-detail { color: #526b42; font-size: 9px; line-height: 1.4; }
.manual-config-empty { width: 100%; min-height: 390px; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--muted); background: transparent; border: 1px dashed var(--line); }
.manual-config-empty strong { color: var(--ink); }
.manual-config-empty span { font-size: 10px; }
.manual-team-strip { display: grid; grid-template-columns: repeat(6,minmax(0,1fr)); border: 1px solid var(--line); }
.manual-team-strip > button { position: relative; min-width: 0; min-height: 76px; display: grid; justify-items: center; align-content: center; gap: 3px; padding: 7px; border: 0; border-right: 1px solid var(--line); border-radius: 0; }
.manual-team-strip > button:last-child { border-right: 0; }
.manual-team-strip > button.active { box-shadow: inset 0 -3px var(--green); }
.manual-team-strip img,.manual-team-strip .avatar-fallback,.manual-slot-plus { width: 30px; height: 30px; border-radius: 3px; object-fit: cover; }
.manual-team-strip strong,.manual-team-strip small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.manual-team-strip strong { font-size: 9px; }.manual-team-strip small { color: var(--muted); font-size: 8px; }
.manual-slot-number { position: absolute; top: 4px; left: 6px; color: var(--muted); font-size: 8px; }
.manual-slot-plus { display: grid; place-items: center; }
.avatar-fallback,.suit-mark { display: grid; place-items: center; color: #fff; background: #596a65; font-weight: 700; }
.suit-mark { border-radius: 4px; background: #7a5c38; }
.selector-layer { position: fixed; z-index: 80; inset: 0; display: grid; place-items: center; padding: 18px; background: rgba(26,31,29,.58); }
.asset-selector { width: min(900px,calc(100vw - 36px)); max-height: min(720px,calc(100vh - 36px)); display: flex; flex-direction: column; overflow: hidden; background: var(--paper); border: 1px solid var(--line); box-shadow: 0 18px 50px rgba(0,0,0,.26); }
.asset-selector > header { display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto; padding: 13px 16px; border-bottom: 1px solid var(--line); }
.asset-selector > header span { color: var(--muted); font-size: 9px; }
.asset-selector > header button { width: 34px; height: 34px; padding: 0; }
.suit-count-tabs { display: flex; gap: 4px; flex: 0 0 auto; padding: 10px 16px 0; }
.suit-count-tabs > span { display: inline-flex; }
.suit-count-tabs button { min-width: 76px; min-height: 30px; padding: 5px 10px; font-size: 10px; }
.suit-count-tabs button.active { color: #fff; background: var(--green); border-color: var(--green); }
.suit-count-tabs button:disabled { color: var(--muted); cursor: not-allowed; opacity: .55; }
.selector-toolbar { flex: 0 0 auto; padding: 12px 16px 0; }
.selector-search { min-height: 38px; gap: 8px; padding: 0 11px; background: #fff; border: 1px solid var(--line); }
.selector-search input { min-width: 0; flex: 1; padding: 0; background: transparent; border: 0; outline: none; }
.selector-toolbar nav { display: flex; gap: 4px; margin-top: 10px; border-bottom: 1px solid var(--line); }
.selector-toolbar nav button { min-width: 58px; flex: 0 0 auto; padding: 8px 10px; white-space: nowrap; border: 0; border-bottom: 2px solid transparent; border-radius: 0; }
.selector-toolbar nav button.active { color: var(--green); border-bottom-color: var(--green); }
.asset-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 7px; overflow-y: auto; padding: 14px 16px 18px; }
.asset-grid button { position: relative; min-width: 0; min-height: 72px; justify-content: flex-start; gap: 10px; padding: 7px; text-align: left; }
.asset-grid button.selected { border-color: var(--green); box-shadow: inset 0 0 0 1px var(--green); }
.asset-grid button.unavailable { opacity: .42; }
.asset-image,.asset-image img,.asset-image .avatar-fallback,.asset-image .suit-mark { flex: 0 0 54px; width: 54px; height: 54px; }
.asset-image { display: block; }.asset-image img { object-fit: contain; }
.asset-copy { display: grid; min-width: 0; gap: 4px; }
.asset-copy strong,.asset-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-copy strong { font-size: 11px; }.asset-copy small { color: var(--muted); font-size: 8px; }
.asset-grid button > svg { position: absolute; top: 6px; right: 6px; color: var(--green); }
.selector-no-result { padding: 42px 16px; color: var(--muted); text-align: center; font-size: 10px; }
.yuhun-selector-body { min-height: 0; display: grid; grid-template-columns: 150px minmax(0,1fr); flex: 1; }
.yuhun-categories { overflow-y: auto; padding: 8px; border-right: 1px solid var(--line); }
.yuhun-categories button { width: 100%; min-height: 34px; padding: 7px 10px; text-align: left; border: 0; border-radius: 0; }
.yuhun-categories button.active { color: #fff; background: var(--green); }
.yuhun-results { position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; padding-top: 12px; }
.yuhun-results > .selector-search { margin: 0 16px; }
.yuhun-grid { grid-template-columns: repeat(3,minmax(0,1fr)); padding-top: 10px; }

@media (max-width: 800px) {
  .manual-config-columns { grid-template-columns: 1fr; }
  .manual-config-panel + .manual-config-panel { border-left: 0; border-top: 1px solid var(--line); }
  .asset-grid { grid-template-columns: repeat(3,minmax(0,1fr)); }
  .yuhun-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
}

@media (max-width: 560px) {
  .manual-config-title { align-items: flex-start; }
  .selected-shikigami-actions button:first-child { width: 34px; height: 34px; padding: 0; font-size: 0; }
  .manual-field-grid,.suit-trigger-grid { grid-template-columns: 1fr; }
  .manual-team-strip { grid-template-columns: repeat(3,1fr); }
  .manual-team-strip > button:nth-child(3) { border-right: 0; }
  .manual-team-strip > button:nth-child(-n+3) { border-bottom: 1px solid var(--line); }
  .selector-layer { padding: 0; }
  .asset-selector { width: 100vw; max-height: 100dvh; height: 100dvh; border: 0; }
  .selector-toolbar nav { overflow-x: auto; }
  .asset-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .yuhun-selector-body { grid-template-columns: 104px minmax(0,1fr); }
  .yuhun-categories { padding: 6px; }
  .yuhun-categories button { padding: 7px 6px; font-size: 9px; }
  .yuhun-grid { grid-template-columns: 1fr; }
  .asset-grid button { min-height: 64px; }
  .asset-image,.asset-image img,.asset-image .avatar-fallback,.asset-image .suit-mark { flex-basis: 46px; width: 46px; height: 46px; }
  .main-stat-heading { align-items: flex-start; flex-direction: column; }
  .main-stat-slot { grid-template-columns: 42px minmax(0,1fr); }
}


/* The screenshot team has five fixed members; all other geometry follows source CSS. */
.manual-team-strip { grid-template-columns: repeat(5,minmax(0,1fr)); }
@media (max-width: 560px) {
  .manual-team-strip { grid-template-columns: repeat(3,1fr); }
}
</style>
