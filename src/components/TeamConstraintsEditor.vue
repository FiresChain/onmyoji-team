<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue';
import { Save, X } from '@lucide/vue';
import ManualTargetEditor from './ManualTargetEditor.vue';
import { assetRequestUrl } from '../catalog';
import { CALCULATION_METRICS, effectiveOrderStats, serializeCalculationDraft } from '../calculation-config';
import { effectiveCalculationMetricId, matchHitMetricPool } from '../calculation-metric-pools';
import { calculationSuitOptions, EXTRA_ATTRIBUTE_LABELS, MAIN_STAT_LABELS, MAIN_STAT_OPTIONS } from '../calculation-options';
import type { CalculationDraft, CalculationIssue, CalculationMemberDraft, CalculationPrecheckDiagnostic, ExtraAttributeStat, MainStatSlot } from '../calculation-types';
import { STATS, type Catalog, type Member } from '../types';

const props = defineProps<{
  modelValue: CalculationDraft;
  members: Member[];
  issues: CalculationIssue[];
  catalog?: Catalog | null;
  catalogError?: string;
  busy?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [draft: CalculationDraft]; retryCatalog: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const editor = ref<{ closeTopPicker: () => boolean } | null>(null);
const working = ref<CalculationDraft | null>(null);
const initialSlot = ref(1);
const selectedSlot = ref(1);
const instanceId = useId();

function copyDraft(draft: CalculationDraft): CalculationDraft {
  return {
    ...draft,
    hitMetricPools: { shikigamiIds: [...draft.hitMetricPools.shikigamiIds], yuhunIds: [...draft.hitMetricPools.yuhunIds] },
    reproduction: { ...draft.reproduction, constraintStats: [...draft.reproduction.constraintStats], orderStats: [...draft.reproduction.orderStats] },
    members: draft.members.map((member) => ({ ...member,
      shikigami: member.shikigami ? { ...member.shikigami } : null,
      suitRequirements: member.suitRequirements.map((suit) => ({ ...suit })),
      mainStats: { 2: [...member.mainStats[2]], 4: [...member.mainStats[4]], 6: [...member.mainStats[6]] },
      extraAttributes: { ...member.extraAttributes }, limits: member.limits.map((limit) => ({ ...limit })),
    })),
  };
}
function avatar(member: CalculationMemberDraft | undefined) {
  const id = member?.shikigami?.catalogId;
  return props.catalog?.shikigami.find((asset) => asset.id === id)?.avatar ?? '';
}
function name(member: CalculationMemberDraft | undefined, slot: number) {
  return member?.shikigami?.name || (member?.shikigami ? props.members.find((source) => source.slot === slot)?.shikigami.rawText : '') || '添加式神';
}
function relaxedStatus(effective: { sixStarOnly: boolean; maxLevelOnly: boolean } | undefined): string {
  return effective?.sixStarOnly && !effective.maxLevelOnly ? '已放宽满级' : '已放宽星级/满级';
}
const slots = computed(() => Array.from({ length: 5 }, (_, index) => {
  const slot = index + 1, member = props.modelValue.members.find((entry) => entry.slot === slot);
  const diagnostic = savedProjection.value.prechecks.find((entry) => entry.slot === slot);
  const effective = savedProjection.value.value?.targets.find((entry) => entry.slot === slot && entry.yuhunConfigEnabled);
  return { slot, member, diagnostic, name: name(member, slot), avatar: avatar(member),
    metric: !member?.shikigami ? '未配置' : !member.enabled ? '无需配置御魂'
      : diagnostic?.status === 'conflict' ? '导出不配御魂' : diagnostic?.status === 'unchecked' ? '未预检'
        : diagnostic?.status === 'relaxed' ? relaxedStatus(effective)
          : diagnostic?.status === 'manual-adjustment' ? '计算后需卸装'
            : diagnostic?.status === 'optimized' ? '主属性已收紧' : displayMetric(member) };
}));
const selectedMember = computed(() => props.modelValue.members.find((member) => member.slot === selectedSlot.value));
const selectedName = computed(() => name(selectedMember.value, selectedSlot.value));
function displayMetric(member: CalculationMemberDraft | undefined) {
  if (!member) return '未设置';
  const id = effectiveCalculationMetricId(member, props.modelValue.hitMetricPools);
  return id === 8 ? '暴击率' : CALCULATION_METRICS.find((metric) => metric.id === id)?.name ?? '未设置';
}
const selectedMetric = computed(() => displayMetric(selectedMember.value));
const selectedPoolReason = computed(() => {
  if (!selectedMember.value) return '';
  const matched = matchHitMetricPool(selectedMember.value, props.modelValue.hitMetricPools);
  return [matched.shikigami ? '命中式神池' : '', matched.yuhunIds.length ? '命中御魂池' : ''].filter(Boolean).join('、');
});
function displayValue(raw: string, percentage = false) {
  const value = raw.trim();
  return value === '' ? '不限' : `${value}${percentage ? '%' : ''}`;
}
function formatPanelValue(value: number): string { return String(Number(value.toFixed(4))); }
const savedProjection = computed(() => serializeCalculationDraft(props.modelValue, props.members, props.catalog ?? null));
const selectedDiagnostic = computed(() => savedProjection.value.prechecks.find((entry) => entry.slot === selectedSlot.value));
const selectedEffectiveTarget = computed(() => savedProjection.value.value?.targets.find((target) => target.slot === selectedSlot.value));
const selectedConflict = computed(() => selectedMember.value?.enabled && selectedDiagnostic.value?.status === 'conflict');
const selectedRelaxationDetail = computed(() => selectedEffectiveTarget.value?.sixStarOnly
  ? '导出保留仅六星、取消仅满级；主属性按六星+0下界筛选，是否有可用御魂仍需实际计算。'
  : '导出不限星级与等级；低星主属性未据此剪枝，是否有可用御魂仍需实际计算。');
const selectedManualAdjustmentDetail = computed(() => {
  const adjustments = selectedDiagnostic.value?.status === 'manual-adjustment' ? selectedDiagnostic.value.manualAdjustments ?? [] : [];
  const values = adjustments.map(({ position, stat, originalMax, calculationMax }) =>
    `${position}号位（${STATS.find(([key]) => key === stat)?.[1] ?? stat}，原上限 ${formatPanelValue(originalMax)} → 导出上限 ${formatPanelValue(calculationMax)}）`).join('、');
  return `计算后需卸下${values}，并复核下限、副属性、套装和队伍次序；卸装后不保证达到原目标。原目标保留在编辑输入中。`;
});
const activeOrderStats = computed(() => effectiveOrderStats(props.modelValue.reproduction));
const showingEffectiveLimits = computed(() => !!selectedEffectiveTarget.value?.yuhunConfigEnabled && !selectedConflict.value);
const selectedLimits = computed(() => {
  if (showingEffectiveLimits.value) {
    const target = selectedEffectiveTarget.value;
    return target?.ranges.map((range) => ({ id: range.stat, label: STATS.find(([stat]) => stat === range.stat)?.[1] ?? range.stat,
      min: displayValue(range.min === undefined ? '' : String(range.min), range.percentage),
      max: displayValue(range.max === undefined ? '' : String(range.max), range.percentage) })) ?? [];
  }
  return selectedMember.value?.limits.filter((limit) => props.modelValue.reproduction.constraintStats.some((stat) => stat === limit.stat)).map((limit) => {
  const definition = STATS.find(([stat]) => stat === limit.stat);
  return { id: limit.id, label: definition?.[1] ?? limit.stat,
    min: displayValue(limit.min, definition?.[2]), max: displayValue(limit.max, definition?.[2]) };
  }) ?? [];
});
const selectedExtras = computed(() => (Object.keys(EXTRA_ATTRIBUTE_LABELS) as ExtraAttributeStat[]).flatMap((stat) => {
  const raw = selectedMember.value?.extraAttributes[stat] ?? '';
  return raw.trim() === '' ? [] : [{ stat, label: stat === 'attack' ? '固定攻击' : MAIN_STAT_LABELS[stat], value: displayValue(raw, stat !== 'attack') }];
}));
const selectedHighestStat = computed(() => STATS.find(([stat]) => stat === selectedMember.value?.highestStat)?.[1] ?? '不指定');
const mainStatSlots: readonly MainStatSlot[] = [2, 4, 6];
const selectedMainStats = computed(() => mainStatSlots.map((slot) => {
  const original = selectedMember.value?.mainStats[slot] ?? [];
  const effective = selectedEffectiveTarget.value?.yuhunConfigEnabled ? selectedEffectiveTarget.value.mainStats[slot] : original;
  const originalAllowed = original.length ? original : MAIN_STAT_OPTIONS[slot];
  const effectiveAllowed = effective.length ? effective : MAIN_STAT_OPTIONS[slot];
  const changed = effectiveAllowed.length !== originalAllowed.length || effectiveAllowed.some((stat) => !originalAllowed.includes(stat));
  const allLegal = effectiveAllowed.length === MAIN_STAT_OPTIONS[slot].length
    && MAIN_STAT_OPTIONS[slot].every((stat) => effectiveAllowed.includes(stat));
  return { slot, value: allLegal ? '任意' : effectiveAllowed.map((stat) => MAIN_STAT_LABELS[stat]).join(' / '),
    original: changed ? original.map((stat) => MAIN_STAT_LABELS[stat]).join(' / ') || '任意' : null };
}));
const selectedCombinationScope = computed(() => {
  const original = selectedMember.value?.mainStats;
  const effective = selectedEffectiveTarget.value?.yuhunConfigEnabled ? selectedEffectiveTarget.value.mainStats : null;
  if (!original || !effective) return null;
  const count = (stats: typeof original) => mainStatSlots.reduce((total, slot) =>
    total * (stats[slot].length || MAIN_STAT_OPTIONS[slot].length), 1);
  return { original: count(original), effective: count(effective) };
});
const selectedSuits = computed(() => {
  const member = selectedMember.value;
  const requirements = member?.suitRequirements.map((suit) => `${suit.name} ${suit.count}件${suit.kind === 'two-piece-effect' ? '效果' : ''}`) ?? [];
  if (member?.suitSelectionComplete) requirements.push(requirements.length ? '剩余位置散件' : '散件');
  return requirements.join(' · ') || '御魂待指定';
});
const selectedFilters = computed(() => {
  const member = selectedMember.value;
  const effective = selectedEffectiveTarget.value?.yuhunConfigEnabled ? selectedEffectiveTarget.value : null;
  return [member?.scope === 'unequipped' ? '仅未装备御魂' : '全部御魂',
    (effective?.sixStarOnly ?? member?.sixStarOnly) ? '仅六星' : '不限星级',
    (effective?.maxLevelOnly ?? member?.maxLevelOnly) ? '仅满级' : '不限等级',
    member?.excludeOccupied ? '排除已占用' : '不排除已占用'].join(' · ');
});
const selectedSoul = computed(() => sourceSoul(selectedSlot.value));
function sourceSoul(slot: number) {
  const candidate = props.members.find((member) => member.slot === slot)?.yuhun.candidates[0];
  return candidate ? calculationSuitOptions(props.catalog ?? null).find((option) => option.kind === 'suit' && option.id === candidate.catalogId) : undefined;
}
function adoptSoul(slot: number) {
  const option = sourceSoul(slot);
  if (props.busy || !option) return;
  const next = copyDraft(props.modelValue), member = next.members.find((entry) => entry.slot === slot);
  if (!member?.shikigami || !member.enabled || member.suitRequirements.length || member.suitSelectionComplete) return;
  member.suitRequirements = [{ catalogId: option.id, name: option.name, count: option.twoPieceOnly ? 2 : 4, kind: 'suit' }];
  emit('update:modelValue', next);
}
function effectiveEnabledCount(draft: CalculationDraft, diagnostics: CalculationPrecheckDiagnostic[]) {
  return draft.members.filter((member) => member.shikigami && member.enabled
    && !diagnostics.some((diagnostic) => diagnostic.slot === member.slot && diagnostic.status === 'conflict')).length;
}
const enabledCount = computed(() => savedProjection.value.value
  ? savedProjection.value.value.targets.filter((target) => target.yuhunConfigEnabled).length
  : effectiveEnabledCount(props.modelValue, savedProjection.value.prechecks));
const workingConfigured = computed(() => working.value?.members.filter((member) => member.shikigami).length ?? 0);
const projection = computed(() => working.value
  ? serializeCalculationDraft(working.value, props.members, props.catalog ?? null) : { value: null, issues: [], prechecks: [] });
const workingEnabled = computed(() => projection.value.value
  ? projection.value.value.targets.filter((target) => target.yuhunConfigEnabled).length
  : working.value ? effectiveEnabledCount(working.value, projection.value.prechecks) : 0);

async function openEditor(slot = selectedSlot.value) {
  if (props.busy) return;
  initialSlot.value = slot;
  working.value = copyDraft(props.modelValue);
  await nextTick();
  dialog.value?.showModal();
}
function closeEditor() {
  dialog.value?.close();
  working.value = null;
}
function cancelDialog(event: Event) {
  event.preventDefault();
  if (!editor.value?.closeTopPicker()) closeEditor();
}
function saveEditor() {
  if (!working.value || props.busy || !projection.value.value) return;
  emit('update:modelValue', copyDraft(working.value));
  closeEditor();
}
</script>

<template>
  <section class="team-editor-launcher" aria-label="队伍计算配置">
    <div class="launcher-heading"><div><h3>{{ modelValue.name }}</h3><p>{{ enabledCount }} / 5 位参与御魂计算</p></div><button type="button" class="launch-editor" :disabled="busy" @click="openEditor()">编辑阵容 ↗</button></div>
    <div class="team-preview" role="group" aria-label="选择式神查看已保存的配置">
      <button v-for="entry in slots" :key="entry.slot" type="button" :class="{ selected: entry.slot === selectedSlot, excluded: entry.member?.shikigami && !entry.member.enabled, conflict: entry.member?.enabled && entry.diagnostic?.status === 'conflict' }" :aria-label="entry.member?.shikigami ? `查看第 ${entry.slot} 位 ${entry.name}的配置，${entry.metric}` : `查看第 ${entry.slot} 位，未配置`" :aria-pressed="entry.slot === selectedSlot" :aria-controls="`${instanceId}-member-details`" @click="selectedSlot = entry.slot">
        <span class="preview-slot">{{ entry.slot }}</span><span v-if="entry.member?.enabled && entry.diagnostic?.status === 'conflict'" class="preview-conflict" title="预检冲突" aria-label="预检冲突">!</span><img v-if="entry.avatar" :src="assetRequestUrl(entry.avatar)" alt="" /><span v-else class="preview-fallback">{{ entry.member?.shikigami ? entry.name.slice(0, 1) : '+' }}</span><strong :title="entry.name">{{ entry.name }}</strong><small>{{ entry.metric }}</small>
      </button>
    </div>
    <p class="launcher-note">点击式神查看已保存的约束；通过“编辑阵容”修改配置。</p>
    <div v-if="catalogError" class="launcher-catalog" role="status">{{ catalogError }} <button type="button" :disabled="busy" @click="emit('retryCatalog')">重新加载素材</button></div>
    <section :id="`${instanceId}-member-details`" class="member-configuration" :aria-labelledby="`${instanceId}-member-title`">
      <header class="member-configuration-heading"><div><span>槽位 {{ selectedSlot }} · 已保存配置</span><h4 :id="`${instanceId}-member-title`">{{ selectedMember?.shikigami ? selectedName : '未配置式神' }}</h4></div><span v-if="selectedMember?.shikigami" class="member-status" :class="{ inactive: !selectedMember.enabled, conflict: selectedConflict, relaxed: selectedDiagnostic?.status === 'relaxed', 'manual-adjustment': selectedDiagnostic?.status === 'manual-adjustment' }">{{ !selectedMember.enabled ? '不参与计算' : selectedConflict ? '预检冲突' : selectedDiagnostic?.status === 'unchecked' ? '未预检' : selectedDiagnostic?.status === 'relaxed' ? relaxedStatus(selectedEffectiveTarget) : selectedDiagnostic?.status === 'manual-adjustment' ? '计算后需卸装' : '参与计算' }}</span></header>
      <template v-if="selectedMember?.shikigami">
        <p v-if="!selectedMember.enabled" class="member-inactive-note">该成员不参与御魂计算，以下已保存设置仍保留。</p>
        <div v-else-if="selectedDiagnostic && selectedDiagnostic.status !== 'compatible'" class="member-precheck" :class="selectedDiagnostic.status" role="status">
          <p>{{ selectedDiagnostic.reason }}</p>
          <p v-if="selectedConflict">导出时不配置御魂；保留此槽位和全部设置，调整约束消除冲突后自动恢复。</p>
          <p v-else-if="selectedDiagnostic.status === 'optimized'">以下主属性为实际导出结果；编辑阵容会显示相同的有效选项。</p>
          <p v-else-if="selectedDiagnostic.status === 'relaxed'">{{ selectedRelaxationDetail }}</p>
          <p v-else-if="selectedDiagnostic.status === 'manual-adjustment'">{{ selectedManualAdjustmentDetail }}</p>
          <p v-if="selectedCombinationScope && (selectedDiagnostic.status === 'optimized' || selectedDiagnostic.status === 'relaxed' || selectedDiagnostic.status === 'manual-adjustment')">主属性导出允许 {{ selectedCombinationScope.original }} → {{ selectedCombinationScope.effective }} 种组合（各槽允许项相乘，并非库存可配数量）。</p>
        </div>
        <section class="member-detail-section" aria-label="属性限制">
          <h5>属性限制 <span>{{ selectedLimits.length }} 项{{ showingEffectiveLimits ? ' · 实际导出范围' : '' }}</span></h5>
          <p v-if="selectedDiagnostic?.status === 'manual-adjustment' && showingEffectiveLimits" class="member-empty-note">以下是实际导出范围，含临时扩大的上限；编辑阵容仍显示原目标。计算后请按上方提示卸装并复核。</p>
          <p v-else-if="activeOrderStats.length && selectedMember.enabled && !selectedConflict" class="member-empty-note">{{ showingEffectiveLimits ? '以下为实际导出范围；已选属性的截图高低顺序会在导出时应用。编辑阵容仍显示原输入。' : '以下为当前已启用的原始范围；格式问题修正后可查看实际导出范围。' }}</p>
          <table v-if="selectedLimits.length" class="member-limits-table"><thead><tr><th scope="col">属性</th><th scope="col">下限</th><th scope="col">上限</th></tr></thead><tbody><tr v-for="limit in selectedLimits" :key="limit.id"><th scope="row">{{ limit.label }}</th><td>{{ limit.min }}</td><td>{{ limit.max }}</td></tr></tbody></table>
          <p v-else class="member-empty-note">未设置属性限制</p>
        </section>
        <section class="member-detail-section" aria-label="额外属性">
          <h5>额外属性</h5>
          <dl v-if="selectedExtras.length" class="member-extra-values"><div v-for="extra in selectedExtras" :key="extra.stat"><dt>{{ extra.label }}</dt><dd>{{ extra.value }}</dd></div></dl>
          <p v-else class="member-empty-note">未设置额外属性</p>
        </section>
        <dl class="member-setting-values">
          <div><dt>计算指标</dt><dd>{{ selectedMetric }}<small v-if="selectedPoolReason" class="original-main-stats">由{{ selectedPoolReason }}自动设置</small></dd></div>
          <div><dt>最高属性</dt><dd>{{ selectedHighestStat }}</dd></div>
          <div><dt>目标评分</dt><dd>{{ displayValue(selectedMember.targetScore) }}</dd></div>
          <div><dt>御魂套装</dt><dd>{{ selectedSuits }}<button v-if="selectedSoul && selectedMember.enabled && !selectedMember.suitRequirements.length && !selectedMember.suitSelectionComplete" type="button" class="adopt-candidate" :disabled="busy" @click="adoptSoul(selectedSlot)">采用 {{ selectedSoul.name }}</button></dd></div>
          <div v-for="mainStat in selectedMainStats" :key="mainStat.slot"><dt>{{ mainStat.slot }}号位主属性</dt><dd>{{ mainStat.value }}<small v-if="mainStat.original" class="original-main-stats">实际导出 · 原选择：{{ mainStat.original }}</small></dd></div>
          <div><dt>筛选条件</dt><dd>{{ selectedFilters }}</dd></div>
        </dl>
      </template>
      <p v-else class="member-empty-note">此槽位尚未配置。点击“编辑阵容”添加式神并设置约束。</p>
    </section>

    <dialog ref="dialog" class="team-detail-dialog" :aria-labelledby="`${instanceId}-title`" @cancel="cancelDialog" @click.self="closeEditor" @close="working = null">
      <template v-if="working">
        <header class="team-detail-header"><div><span class="team-eyebrow">TEAM TARGET</span><h2 :id="`${instanceId}-title`">编辑阵容</h2></div><div class="team-detail-header-actions"><button type="button" @click="closeEditor">取消编辑</button><button type="button" class="icon-button" aria-label="关闭阵容编辑" @click="closeEditor"><X :size="18" /></button></div></header>
        <div class="team-detail-meta">
          <label><span>阵容名称</span><input v-model="working.name" maxlength="80" /></label>
          <div><span>归属关卡</span><strong>{{ working.scene }}</strong></div>
          <div class="target-detail-difficulty-control"><label><span>计算方式</span><select v-model="working.calculationMode"><option value="difficulty">难度递补</option><option value="force">强制计算</option></select></label><label><span>难度</span><input v-model="working.difficulty" type="text" inputmode="numeric" :disabled="working.calculationMode === 'force'" /></label></div>
        </div>
        <div v-if="catalogError" class="dialog-catalog" role="status">{{ catalogError }} <button type="button" @click="emit('retryCatalog')">重新加载素材</button></div>
        <div v-else-if="!catalog" class="dialog-catalog" role="status">正在加载式神与御魂素材…</div>
        <div v-if="effectiveOrderStats(working.reproduction).length" class="dialog-catalog">顺序约束对已选属性生效：此处编辑原范围，保存后可在成员详情查看实际导出范围。</div>
        <div class="team-detail-scroll"><ManualTargetEditor ref="editor" :model-value="working" :members="members" :catalog="catalog ?? null" :issues="projection.issues" :prechecks="projection.prechecks" :effective-targets="projection.value?.targets" :busy="busy" :initial-slot="initialSlot" @update:model-value="working = $event" /></div>
        <div v-if="projection.issues.length" class="editor-validation" role="status"><p v-for="(issue, index) in projection.issues" :key="index">{{ issue.slot === null ? '' : `第 ${issue.slot} 位：` }}{{ issue.message }}</p></div>
        <footer class="team-detail-footer"><span>已添加 {{ workingConfigured }} / 5 个式神 · {{ workingEnabled }} 个参与御魂计算</span><div class="team-detail-footer-actions"><button type="button" @click="closeEditor">取消编辑</button><button type="button" class="save-button" :disabled="busy || !projection.value" @click="saveEditor"><Save :size="17" />保存修改</button></div></footer>
      </template>
    </dialog>
  </section>
</template>

<style scoped>
.team-editor-launcher { padding: 22px; color: #4d6043; }
.launcher-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.launcher-heading h3 { font-size: 14px; margin: 0; }.launcher-heading p { font-size: 11px; margin-top: 5px; color: #849276; }
.launch-editor { border: 1px solid #476b50; color: #fff; background: #355b42; padding: 8px 12px; border-radius: 5px; font-size: 12px; white-space: nowrap; }
.team-preview { display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: 6px; margin-top: 20px; }
.team-preview button { position: relative; display: grid; justify-items: center; gap: 5px; min-width: 0; padding: 12px 5px 10px; border: 1px solid #dce4d2; border-radius: 6px; color: #647a53; background: #f6f9f0; }
.team-preview button:hover { border-color: #a7bc92; background: #edf4e4; }.team-preview button.selected { border-color: #55794d; background: #e9f1df; box-shadow: inset 0 0 0 1px #55794d; }.team-preview button:focus-visible { outline: 2px solid #55794d; outline-offset: 2px; }.team-preview button.excluded img,.team-preview button.excluded .preview-fallback { filter: grayscale(.8); opacity: .7; }
.team-preview img,.preview-fallback { width: 43px; height: 43px; object-fit: contain; border-radius: 5px; }.preview-fallback { display: grid; place-items: center; background: #e4ebdc; font-size: 22px; }
.team-preview strong { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }.team-preview small { font-size: 9px; color: #92a082; }
.preview-slot { position: absolute; left: 5px; top: 3px; font: 9px ui-monospace,monospace; color: #a1ad94; }
.team-preview button.conflict { border-color: #c18a72; }.team-preview button.conflict small { color: #9c4a32; }.preview-conflict { position: absolute; right: 5px; top: 4px; display: grid; place-items: center; width: 15px; height: 15px; color: #fff; background: #a65137; border-radius: 50%; font-size: 10px; font-weight: 700; }
.adopt-candidate { display: block; margin-top: 4px; padding: 2px 0; color: #537346; background: transparent; font-size: 10px; text-decoration: underline; }
.launcher-note { font-size: 11px; margin-top: 15px; color: #8c9a7e; }.launcher-catalog { padding: 10px; margin-top: 12px; background: #fbf3e4; color: #8c734d; font-size: 11px; }.launcher-catalog button { background: transparent; color: inherit; text-decoration: underline; }
.member-configuration { margin-top: 20px; border-top: 1px solid #dce4d2; font-size: 11px; line-height: 1.5; }
.member-configuration-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 0 8px; }.member-configuration-heading > div { min-width: 0; }.member-configuration-heading h4 { margin: 3px 0 0; font-size: 13px; overflow-wrap: anywhere; }.member-configuration-heading > div > span { font-size: 9px; color: #8c9a7e; }.member-status { flex-shrink: 0; padding: 3px 7px; color: #537346; background: #ecf3e3; border-radius: 3px; font-size: 10px; }.member-status.inactive { color: #8c734d; background: #fbf3e4; }
.member-inactive-note { margin: 4px 0 10px; color: #8c734d; font-size: 10px; }.member-detail-section { margin-top: 12px; }.member-detail-section h5 { margin: 0 0 7px; font-size: 11px; font-weight: 600; }.member-detail-section h5 span { margin-left: 5px; color: #92a082; font-size: 9px; font-weight: 400; }.member-empty-note { margin: 6px 0; color: #8c9a7e; font-size: 11px; }
.member-status.conflict { color: #9c4a32; background: #fbede6; }.member-status.relaxed { color: #536e42; background: #eff4e4; }.member-status.manual-adjustment { color: #81642e; background: #faf1dd; }.member-precheck { margin: 5px 0 10px; padding: 8px 10px; border-radius: 4px; color: #667958; background: #f0f5e9; font-size: 10px; }.member-precheck p { margin: 2px 0; }.member-precheck.conflict { color: #9c4a32; background: #fbede6; }.member-precheck.unchecked { color: #8c734d; background: #fbf3e4; }.member-precheck.relaxed { color: #536e42; background: #f2f6e9; }.member-precheck.manual-adjustment { color: #81642e; background: #faf5e8; }.original-main-stats { display: block; margin-top: 3px; color: #8c9a7e; font-size: 9px; }
.member-limits-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 11px; }.member-limits-table th,.member-limits-table td { padding: 7px 8px; border-bottom: 1px solid #e7ebdf; text-align: right; overflow-wrap: anywhere; }.member-limits-table th:first-child { text-align: left; }.member-limits-table thead th { background: #f0f5e9; color: #849276; font-size: 10px; font-weight: 500; }.member-limits-table tbody th { font-weight: 500; }.member-limits-table td { font-variant-numeric: tabular-nums; }
.member-extra-values,.member-setting-values { margin: 0; }.member-extra-values { padding: 4px 9px; border: 1px solid #dce4d2; border-radius: 4px; background: #f6f9f0; }.member-extra-values > div,.member-setting-values > div { display: grid; grid-template-columns: 80px minmax(0,1fr); gap: 10px; padding: 5px 0; }.member-extra-values dt,.member-setting-values dt { color: #849276; }.member-extra-values dd,.member-setting-values dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }.member-extra-values dd { text-align: right; font-variant-numeric: tabular-nums; }.member-setting-values { margin-top: 15px; padding-top: 7px; border-top: 1px solid #e7ebdf; }.member-setting-values > div { padding: 5px 0; }
.team-detail-dialog { --ink: #202426; --muted: #697278; --line: #d9dddf; --paper: #fff; --work: #f4f5f5; --red: #a43c34; --red-soft: #f7eae8; --danger: #a43c34; --green: #315c60; --green-soft: #e5efed; --gold: #8b7841; --gold-soft: #f5f0df; width: min(1120px,calc(100vw - 36px)); max-width: none; max-height: calc(100dvh - 36px); padding: 0; margin: auto; color: var(--ink); background: #f7f8f8; border: 1px solid #aeb5b8; border-radius: 6px; box-shadow: 0 18px 60px rgb(0 0 0 / 28%); overflow: hidden; font-size: 12px; line-height: 1.5; }
.team-detail-dialog[open] { display: flex; flex-direction: column; }.team-detail-dialog::backdrop { background: rgb(25 29 31 / 58%); }
.team-detail-dialog :deep(*) { box-sizing: border-box; letter-spacing: 0; }
.team-detail-dialog :deep(button),.team-detail-dialog :deep(input),.team-detail-dialog :deep(select) { font-family: inherit; }
.team-detail-meta input,.team-detail-meta select { min-height: 34px; padding: 6px 9px; color: #202426; background: #fff; border: 1px solid #cbd1d3; border-radius: 2px; font-size: 10px; }
.team-detail-meta input:disabled,.team-detail-meta select:disabled { background: #f2f4f4; color: #858e91; }
.team-detail-meta input[type='checkbox'],.team-detail-meta input[type='radio'] { width: 14px; height: 14px; margin: 0; accent-color: var(--green); }
.team-detail-dialog :deep(button:focus-visible),.team-detail-dialog :deep(input:focus-visible),.team-detail-dialog :deep(select:focus-visible) { outline: 2px solid var(--green); outline-offset: 2px; }
.team-detail-header { min-height: 63px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 14px; color: #fff; background: #2c3234; flex: 0 0 auto; }.team-detail-header h2 { margin: 3px 0 0; font-size: 16px; font-weight: 700; }.team-eyebrow { color: #c55349; font-size: 10px; }
.team-detail-header-actions { display: flex; gap: 7px; align-items: center; }.team-detail-header-actions button { min-height: 32px; padding: 5px 10px; color: #eef2f2; background: transparent; border: 1px solid #657074; border-radius: 3px; font-size: 9px; }.team-detail-header-actions .icon-button { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; }
.team-detail-meta { display: grid; grid-template-columns: minmax(0,1fr) minmax(180px,.45fr) minmax(230px,.7fr); align-items: end; gap: 12px; padding: 11px 14px; background: #fff; border-bottom: 1px solid var(--line); flex: 0 0 auto; }.team-detail-meta label,.team-detail-meta > div { min-width: 0; display: grid; gap: 5px; }.team-detail-meta span { color: #596368; font-size: 9px; font-weight: 700; }.team-detail-meta input,.team-detail-meta select { width: 100%; }.team-detail-meta strong { min-height: 34px; display: flex; align-items: center; overflow: hidden; padding: 6px 9px; color: #3f5758; background: #f2f5f5; border: 1px solid #d7dcdd; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }.team-detail-meta .target-detail-difficulty-control { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); align-items: end; gap: 7px; }
.team-detail-scroll { overflow-y: auto; min-height: 0; flex: 1 1 auto; }.team-detail-footer { min-height: 61px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; background: #fff; border-top: 1px solid var(--line); flex: 0 0 auto; }.team-detail-footer > span { color: var(--muted); font-size: 9px; }.team-detail-footer-actions { display: flex; align-items: center; gap: 7px; }.team-detail-footer-actions button { min-height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 11px; color: #4c575a; border: 1px solid #cbd1d3; border-radius: 3px; font-size: 10px; background: #fff; }.team-detail-footer-actions .save-button { color: #fff; background: var(--green); border-color: var(--green); }
.editor-validation { flex: 0 0 auto; padding: 8px 14px; max-height: 100px; overflow: auto; color: #8c433a; background: #fff0eb; font-size: 10px; }.editor-validation p { margin: 2px 0; }.dialog-catalog { flex: 0 0 auto; padding: 8px 14px; background: #f8f2df; color: #7d6a3b; font-size: 10px; }.dialog-catalog button { color: inherit; text-decoration: underline; background: transparent; }
@media(max-width: 800px) { .team-detail-meta { grid-template-columns: minmax(0,1fr) minmax(0,1fr); }.team-detail-meta > label { grid-column: 1/-1; } }
@media(max-width: 560px) { .team-detail-dialog { width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; border: 0; }.team-detail-meta { grid-template-columns: 1fr; gap: 7px; }.team-detail-meta > label { grid-column: auto; }.team-detail-footer { flex-wrap: wrap; gap: 6px; }.team-detail-footer-actions { margin-left: auto; }.team-editor-launcher { padding: 16px 12px; }.team-preview { gap: 4px; }.team-preview img,.preview-fallback { width: 34px; height: 34px; }.team-preview strong { font-size: 9px; }.member-extra-values > div,.member-setting-values > div { grid-template-columns: 74px minmax(0,1fr); gap: 8px; }.member-limits-table th,.member-limits-table td { padding: 7px 5px; } }
</style>
