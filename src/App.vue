<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { recognize } from './recognize';
import TeamConstraintsEditor from './components/TeamConstraintsEditor.vue';
import ImagePreviewDialog from './components/ImagePreviewDialog.vue';
import ReproductionControls from './components/ReproductionControls.vue';
import HitMetricPools from './components/HitMetricPools.vue';
import { encodeTeamConfiguration } from './team-code-service';
import { teamCodeQrDataUrl } from './team-code-qr';
import { applyRecognizedSuits, applyReproductionSettings, createCalculationDraft, DEFAULT_ORDER_STATS, REPRODUCTION_STATS, serializeCalculationDraft } from './calculation-config';
import type { CalculationDraft, HitMetricPools as HitMetricPoolsConfig } from './calculation-types';
import { createHitMetricPools } from './calculation-metric-pools';
import { loadCatalog } from './catalog';
import { resetOcr } from './ocr';
import { STATS, type Catalog, type Member, type RecognitionResult } from './types';

const preview = ref('');
const currentImage = ref<Blob | null>(null);
const result = ref<RecognitionResult | null>(null);
const calculationDraft = ref<CalculationDraft | null>(null);
const globalReproduction = ref<CalculationDraft['reproduction']>({ tolerancePercent: '10', constraintStats: [...REPRODUCTION_STATS], orderStats: [...DEFAULT_ORDER_STATS] });
const globalHitMetricPools = ref<HitMetricPoolsConfig>(createHitMetricPools());
const editorCatalog = shallowRef<Catalog | null>(null);
const editorCatalogError = ref('');
let editorCatalogLoading = false;
const editedSoulSlots = new Set<number>();
const busy = ref(false);
const status = ref('等待粘贴截图');
const error = ref('');
const clipboardHint = ref('');
const activeTab = ref<'calculation' | 'team'>('calculation');
const copied = ref(false);
const teamImageUrl = ref('');
const teamImageName = ref('阵容二维码.png');
const TEAM_CODE_TEMPLATE = '#TA#eJxrZ2Rmmjadi8mGYdIkFtZJ3KwHDsw685KJh3EyEyPjdEZGxgmTJnozHJg8kWEiwyRGpgNAMOssIw+LHONkVmZWqAIfDAUurMpABawwBYYYClLYNJAVyGMoqEdVIIuqgO0cw4ynGSzLnm3tfrF+KvMCjuM8WlG7fsy4drcsQ2VHgC/nWXVNABP8TjI=';
const encodeWarnings = ref<string[]>([]);
let encodeController: AbortController | null = null;
const imagePreviewOpen = ref(false);
const generatingImage = ref(false);
const imageExportError = ref('');
let imageExportRequest = 0;
const pasteArea = ref<HTMLElement | null>(null);
let job = 0;
let controller: AbortController | null = null;
let copyTimer: ReturnType<typeof setTimeout> | undefined;

const calculationProjection = computed(() => calculationDraft.value && result.value
  ? serializeCalculationDraft(calculationDraft.value, result.value.draft.members, editorCatalog.value)
  : { value: null, issues: [], prechecks: [] });
const teamDocument = computed(() => result.value ? {
  ...result.value.draft,
  calculation: calculationProjection.value.value,
  calculationPrechecks: calculationProjection.value.prechecks,
  ...(calculationProjection.value.issues.length ? { calculationIssues: calculationProjection.value.issues } : {}),
} : null);
const json = computed(() => result.value ? JSON.stringify(teamDocument.value, null, 2) : '');
const canCopy = computed(() => !!result.value && !calculationProjection.value.issues.length);
const canExportImage = computed(() => !!calculationDraft.value && !!calculationProjection.value.value && !busy.value && !generatingImage.value);
const conflictMembers = computed(() => calculationProjection.value.prechecks.filter((entry) => entry.status === 'conflict'));
const relaxedMembers = computed(() => calculationProjection.value.prechecks.filter((entry) => entry.status === 'relaxed'));
const manualAdjustmentMembers = computed(() => calculationProjection.value.prechecks.filter((entry) => entry.status === 'manual-adjustment'));
const enabledMemberCount = computed(() => calculationProjection.value.value?.targets.filter((target) => target.shikigami && target.yuhunConfigEnabled).length
  ?? calculationDraft.value?.members.filter((member) => member.shikigami && member.enabled && !conflictMembers.value.some((entry) => entry.slot === member.slot)).length ?? 0);
const highlighted = computed(() => [...json.value.matchAll(/"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?|[^"\d\w-]+|\w+|./g)].map((match) => {
  const text = match[0];
  const kind = text.startsWith('"') ? (json.value.slice(match.index + text.length).trimStart().startsWith(':') ? 'key' : 'string') : /^(true|false|null)$/.test(text) ? 'literal' : /^-?\d/.test(text) ? 'number' : '';
  return { text, kind };
}));
const valuesRead = computed(() => result.value?.draft.members.reduce((total, member) => total + Object.values(member.panel).filter((value) => value !== null).length, 0) ?? 0);
const reviewCount = computed(() => result.value?.draft.members.reduce((total, member) => total + member.needsReview.length, 0) ?? 0);

function releasePreview() {
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = '';
}

function setRecognitionResult(output: RecognitionResult) {
  result.value = output;
  if (!calculationDraft.value && output.draft.members.length) {
    calculationDraft.value = { ...applyReproductionSettings(createCalculationDraft(output.draft.members), output.draft.members, globalReproduction.value),
      hitMetricPools: copyHitMetricPools(globalHitMetricPools.value) };
  }
  fillRecognizedSuits();
  if (!editorCatalog.value) void refreshEditorCatalog();
}

function copyHitMetricPools(pools: HitMetricPoolsConfig): HitMetricPoolsConfig {
  return { shikigamiIds: [...pools.shikigamiIds], yuhunIds: [...pools.yuhunIds] };
}

function updateHitMetricPools(pools: HitMetricPoolsConfig) {
  globalHitMetricPools.value = copyHitMetricPools(pools);
  if (calculationDraft.value) calculationDraft.value = { ...calculationDraft.value, hitMetricPools: copyHitMetricPools(pools) };
  copied.value = false;
}

function updateGlobalReproduction(settings: CalculationDraft['reproduction']) {
  globalReproduction.value = { ...settings, constraintStats: [...settings.constraintStats], orderStats: [...settings.orderStats] };
  if (calculationDraft.value && result.value) {
    calculationDraft.value = applyReproductionSettings(calculationDraft.value, result.value.draft.members, globalReproduction.value);
  }
  copied.value = false;
}

function fillRecognizedSuits() {
  if (!calculationDraft.value || !result.value) return;
  calculationDraft.value = applyRecognizedSuits(calculationDraft.value, result.value.draft.members, editorCatalog.value, editedSoulSlots);
}

async function refreshEditorCatalog() {
  if (editorCatalogLoading) return;
  editorCatalogLoading = true;
  editorCatalogError.value = '';
  try { editorCatalog.value = await loadCatalog(); fillRecognizedSuits(); }
  catch (reason) { editorCatalogError.value = reason instanceof Error ? reason.message : '式神与御魂目录加载失败'; }
  finally { editorCatalogLoading = false; }
}

function updateCalculationDraft(draft: CalculationDraft) {
  for (const member of draft.members) {
    const previous = calculationDraft.value?.members.find((item) => item.slot === member.slot);
    if (!previous || previous.shikigami?.catalogId !== member.shikigami?.catalogId
      || previous.enabled !== member.enabled || previous.suitSelectionComplete !== member.suitSelectionComplete
      || JSON.stringify(previous.suitRequirements) !== JSON.stringify(member.suitRequirements)) editedSoulSlots.add(member.slot);
  }
  calculationDraft.value = { ...draft, hitMetricPools: copyHitMetricPools(globalHitMetricPools.value), reproduction: { ...globalReproduction.value,
    constraintStats: [...globalReproduction.value.constraintStats], orderStats: [...globalReproduction.value.orderStats] } };
  copied.value = false;
  clearTimeout(copyTimer);
}

function finishPendingSouls(reason: string) {
  if (!result.value) return;
  const pendingSlots = new Set(result.value.soulDiagnostics.filter((entry) => entry.matchStatus === 'pending').map((entry) => entry.slot));
  result.value.soulDiagnostics = result.value.soulDiagnostics.map((entry) => pendingSlots.has(entry.slot)
    ? { ...entry, matchStatus: 'unavailable', reason } : entry);
  result.value.draft.members = result.value.draft.members.map((member) => pendingSlots.has(member.slot)
    ? { ...member, needsReview: [...member.needsReview.filter((text) => text !== '御魂尚未完成匹配'), `御魂匹配未完成：${reason}`] } : member);
}

function soulSummary(member: Member): string {
  if (result.value?.soulDiagnostics.find((entry) => entry.slot === member.slot)?.matchStatus === 'pending') return '御魂匹配中…';
  if (member.yuhun.status === 'unavailable') return '御魂匹配不可用';
  return member.yuhun.status === 'candidate' && member.yuhun.candidates[0]
    ? `御魂候选：${member.yuhun.candidates[0].name}` : '御魂未识别';
}

async function run() {
  if (!currentImage.value) return;
  controller?.abort();
  const runId = ++job;
  const localController = new AbortController();
  controller = localController;
  result.value = null;
  calculationDraft.value = null;
  editedSoulSlots.clear();
  copied.value = false;
  error.value = '';
  busy.value = true;
  status.value = '正在准备截图…';
  try {
    const output = await recognize(currentImage.value, localController.signal, (message) => {
      if (runId === job) status.value = message;
    }, (partial) => {
      if (runId === job) setRecognitionResult(partial);
    });
    if (runId !== job) return;
    setRecognitionResult(output);
    status.value = output.draft.members.length ? '识别完成，请核对结果' : '已读取文字，阵容表格待核对';
  } catch (reason) {
    if (runId !== job || localController.signal.aborted) return;
    error.value = reason instanceof Error ? reason.message : String(reason);
    finishPendingSouls('本次匹配未完成，请重试。');
    status.value = '识别未完成';
  } finally {
    if (runId === job) { busy.value = false; controller = null; }
  }
}

async function acceptImage(blob: Blob) {
  if (blob.size > 20 * 1024 * 1024) { clipboardHint.value = '截图超过 20 MB，请复制尺寸更小的图片。'; return; }
  if (!blob.type.startsWith('image/') || blob.type === 'image/svg+xml') { clipboardHint.value = '请复制 PNG、JPEG 或 WebP 截图。'; return; }
  controller?.abort();
  releasePreview();
  currentImage.value = blob;
  preview.value = URL.createObjectURL(blob);
  clipboardHint.value = '';
  activeTab.value = 'calculation';
  await run();
}

function onPaste(event: ClipboardEvent) {
  const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.type.startsWith('image/'));
  if (!item) {
    if (pasteArea.value?.contains(document.activeElement)) clipboardHint.value = '剪贴板中没有图片，请复制图片本身后再粘贴。';
    return;
  }
  const blob = item.getAsFile();
  if (blob) { event.preventDefault(); void acceptImage(blob); }
}

async function pasteFromClipboard() {
  clipboardHint.value = '';
  if (!navigator.clipboard?.read) {
    clipboardHint.value = '请在页面按 Ctrl + V 或 ⌘ + V 粘贴截图。';
    pasteArea.value?.focus();
    return;
  }
  try {
    const entries = await navigator.clipboard.read();
    for (const entry of entries) {
      const type = entry.types.find((value) => value.startsWith('image/'));
      if (type) { await acceptImage(await entry.getType(type)); return; }
    }
    clipboardHint.value = '剪贴板中没有图片，请先复制阵容详情截图。';
  } catch {
    clipboardHint.value = '未能读取剪贴板，请直接按 Ctrl + V 或 ⌘ + V。';
    pasteArea.value?.focus();
  }
}

function cancel() {
  job++;
  controller?.abort();
  controller = null;
  resetOcr();
  finishPendingSouls('匹配已停止，可重新识别。');
  busy.value = false;
  status.value = '已停止，可重新识别';
}
function clear() {
  cancel();
  releasePreview();
  currentImage.value = null;
  result.value = null;
  calculationDraft.value = null;
  error.value = '';
  clipboardHint.value = '';
  copied.value = false;
  status.value = '等待粘贴截图';
}
async function copyJson() {
  if (!json.value || !canCopy.value) return;
  try {
    await navigator.clipboard.writeText(json.value);
    copied.value = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copied.value = false; }, 2000);
  } catch { clipboardHint.value = '无法自动复制，请打开阵容 JSON 后手动复制。'; }
}

function clearTeamImage() {
  imageExportRequest++;
  encodeController?.abort();
  encodeController = null;
  imagePreviewOpen.value = false;
  generatingImage.value = false;
  imageExportError.value = '';
  encodeWarnings.value = [];
  teamImageUrl.value = '';
}

async function viewTeamImage() {
  if (!canExportImage.value || !calculationDraft.value) return;
  const request = ++imageExportRequest;
  const config = calculationProjection.value.value;
  if (!config) return;
  const localController = new AbortController();
  encodeController = localController;
  generatingImage.value = true;
  imageExportError.value = '';
  try {
    const encoded = await encodeTeamConfiguration(config, editorCatalog.value, TEAM_CODE_TEMPLATE, { signal: localController.signal });
    if (request !== imageExportRequest) return;
    const image = await teamCodeQrDataUrl(encoded.teamCode);
    if (request !== imageExportRequest) return;
    teamImageUrl.value = image;
    const conflictNotes = conflictMembers.value.map((entry) => {
      const member = config.targets.find((target) => target.slot === entry.slot);
      return `${member?.shikigami?.name || `第 ${entry.slot} 位式神`}存在配置冲突，已在阵容码中设为“不配置御魂”。`;
    });
    const relaxedNotes = relaxedMembers.value.map((entry) => {
      const member = config.targets.find((target) => target.slot === entry.slot);
      const name = member?.shikigami?.name || `第 ${entry.slot} 位式神`;
      return member?.sixStarOnly && !member.maxLevelOnly
        ? `${name}的六星满级主属性组合超出上限；导出保留“仅六星”、取消“仅满级”，主属性按六星+0下界收紧。能否配装仍需库存计算。`
        : `${name}在六星+0下界仍无可行组合；导出不限星级与等级，低星主属性未剪枝。能否配装仍需库存计算。`;
    });
    const manualAdjustmentNotes = manualAdjustmentMembers.value.map((entry) => {
      const member = config.targets.find((target) => target.slot === entry.slot);
      const name = member?.shikigami?.name || `第 ${entry.slot} 位式神`;
      const adjustments = (entry.manualAdjustments ?? []).map(({ position, stat, originalMax, calculationMax }) => {
        const label = STATS.find(([key]) => key === stat)?.[1] ?? stat;
        return `${position}号位（${label}上限 ${Number(originalMax.toFixed(4))} → ${Number(calculationMax.toFixed(4))}）`;
      }).join('、');
      return `${name}的阵容码已临时扩大属性上限、保留仅六星和仅满级；计算后需卸下${adjustments}，复核下限、副属性、套装和队伍次序，卸装后不保证达到原目标。`;
    });
    encodeWarnings.value = [...conflictNotes, ...relaxedNotes, ...manualAdjustmentNotes, ...encoded.warnings];
    const name = config.name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 80);
    teamImageName.value = `${name || '阵容'}-二维码.png`;
    imagePreviewOpen.value = true;
  } catch (reason) {
    if (request === imageExportRequest) imageExportError.value = reason instanceof Error ? reason.message : '阵容二维码生成失败，请重试。';
  } finally {
    if (request === imageExportRequest) { generatingImage.value = false; encodeController = null; }
  }
}

// Images always describe the saved configuration. Invalidate an in-flight render
// if a new screenshot or a saved edit replaces its input.
watch(calculationDraft, clearTeamImage, { deep: true, flush: 'sync' });
watch(editorCatalog, clearTeamImage, { flush: 'sync' });

onMounted(() => {
  document.addEventListener('paste', onPaste);
  void refreshEditorCatalog();
});
onBeforeUnmount(() => {
  document.removeEventListener('paste', onPaste);
  cancel(); releasePreview(); clearTeamImage(); clearTimeout(copyTimer);
});
</script>

<template>
  <div class="app-shell">
    <main>
      <ReproductionControls :model-value="globalReproduction" @update:model-value="updateGlobalReproduction" />
      <HitMetricPools :model-value="globalHitMetricPools" :catalog="editorCatalog" :catalog-error="editorCatalogError" @update:model-value="updateHitMetricPools" @retry-catalog="refreshEditorCatalog" />

      <div class="workspace">
        <section class="panel image-panel">
          <div class="panel-heading">
            <div class="panel-title"><span class="step-number">01</span><h2>粘贴截图</h2></div>
            <button v-if="preview" class="text-button" @click="clear">清空</button>
            <span v-else class="subtle">支持直接粘贴</span>
          </div>
          <div class="image-content">
            <div ref="pasteArea" class="paste-area" :class="{ 'has-image': preview }" tabindex="0" aria-label="截图粘贴区域，按 Ctrl 加 V 或 Command 加 V 粘贴" @click="pasteArea?.focus()">
              <template v-if="!preview">
                <div class="paste-illustration" aria-hidden="true">
                  <svg viewBox="0 0 72 64" fill="none"><rect x="10" y="6" width="49" height="46" rx="7" stroke="currentColor" stroke-width="1.5"/><circle cx="25" cy="21" r="5" stroke="currentColor" stroke-width="1.5"/><path d="m13 45 14-13 10 8 9-12 10 15" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><rect x="43" y="36" width="25" height="25" rx="7" fill="#f4f5ef" stroke="currentColor" stroke-width="1.5"/><path d="M55.5 42v13m-6.5-6.5h13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                </div>
                <h3>把阵容详情截图粘贴到这里</h3>
                <p>复制图片后，在此页面按 <kbd>⌘ / Ctrl</kbd> + <kbd>V</kbd></p>
                <button class="primary-button" @click.stop="pasteFromClipboard">从剪贴板粘贴 <span aria-hidden="true">↗</span></button>
                <span class="paste-note">包含五列式神与完整属性表的截图效果更好</span>
              </template>
              <div v-else class="preview-wrap">
                <img class="screenshot" :src="preview" alt="粘贴的阵容详情截图" />
              </div>
            </div>

            <div v-if="preview" class="image-actions">
              <button v-if="busy" class="secondary-button" @click="cancel">停止识别</button>
              <button v-else class="secondary-button" title="重新识别会按截图重置成员配置，保留上方全局设置" @click="run">重新识别 <span aria-hidden="true">↻</span></button>
            </div>
            <p v-if="clipboardHint" class="inline-notice" role="status">{{ clipboardHint }}</p>
            <div class="status-card" :class="{ working: busy, failed: error }" role="status" aria-live="polite">
              <span v-if="busy" class="spinner" aria-hidden="true"></span>
              <span v-else class="status-dot" :class="{ neutral: !result, danger: error }"></span>
              <div><strong>{{ status }}</strong><p>{{ busy ? '识别在当前设备进行，截图不会上传。' : result ? '请核对识别概览，并在右侧调整阵容。' : '首次加载识别模型可能需要一些时间。' }}</p></div>
            </div>
            <div v-if="error" class="error-card" role="alert"><strong>这次识别没有完成</strong><p>{{ error }}</p><span>请重试或更换清晰截图。</span></div>

            <div v-if="result?.draft.members.length" class="recognition-summary">
              <div class="summary-heading"><h3>识别概览</h3><span>{{ valuesRead }} / 40 项属性</span></div>
              <div class="member-list">
                <div v-for="member in result.draft.members" :key="member.slot" class="member-row">
                  <span class="slot-index">{{ String(member.slot).padStart(2, '0') }}</span>
                  <div class="member-name"><strong>{{ member.shikigami.name || member.shikigami.rawText || '名称未识别' }}</strong><span>{{ soulSummary(member) }}</span></div>
                  <span class="speed-value">{{ member.panel.speed ?? '—' }} <small>速度</small></span>
                </div>
              </div>
              <p class="review-note">{{ reviewCount }} 项待核对。合格御魂首选已填入计算设置，请核对；手动修改的套装会保留。</p>
            </div>
            <div v-if="result?.draft.warnings.length" class="warnings"><p v-for="warning in result.draft.warnings" :key="warning">{{ warning }}</p></div>
          </div>
        </section>

        <section class="panel json-panel">
          <div class="panel-heading">
            <div class="panel-title"><span class="step-number">02</span><h2>阵容详情</h2></div>
            <div class="result-actions">
              <button type="button" class="copy-button" :disabled="!canExportImage" :aria-busy="generatingImage" @click="viewTeamImage">{{ generatingImage ? '生成中…' : '查看图片' }}</button>
              <button class="copy-button" :disabled="!canCopy" @click="copyJson">{{ copied ? '已复制 ✓' : '复制 JSON' }}</button>
            </div>
          </div>
          <p v-if="imageExportError" class="image-export-error" role="alert">{{ imageExportError }}</p>
          <div v-if="encodeWarnings.length" class="encode-notes" role="status"><p v-for="warning in encodeWarnings" :key="warning">{{ warning }}</p></div>
          <div class="json-toolbar">
            <div class="tabs" role="tablist" aria-label="结果格式">
              <button id="calculation-tab" :class="{ active: activeTab === 'calculation' }" role="tab" :aria-selected="activeTab === 'calculation'" aria-controls="json-output" @click="activeTab = 'calculation'">阵容详情</button>
              <button id="team-tab" :class="{ active: activeTab === 'team' }" role="tab" :aria-selected="activeTab === 'team'" aria-controls="json-output" @click="activeTab = 'team'">阵容 JSON</button>
            </div>
            <span class="format-label">{{ activeTab === 'calculation' ? 'DETAIL' : 'JSON' }}</span>
          </div>
          <div v-if="calculationProjection.issues.length" class="calculation-issues" role="alert">
            <strong>还有 {{ calculationProjection.issues.length }} 项设置需要修正，修正后可复制 JSON 或生成阵容码。</strong>
            <p v-for="(issue, index) in calculationProjection.issues" :key="index">{{ issue.slot === null ? '' : `第 ${issue.slot} 位：` }}{{ issue.message }}</p>
          </div>
          <div id="json-output" class="json-output" role="tabpanel" :aria-labelledby="`${activeTab}-tab`" :aria-busy="busy" tabindex="0">
            <TeamConstraintsEditor v-if="calculationDraft && result" v-show="activeTab === 'calculation'" :model-value="calculationDraft" :members="result.draft.members" :issues="calculationProjection.issues" :catalog="editorCatalog" :catalog-error="editorCatalogError" :busy="busy" @update:model-value="updateCalculationDraft" @retry-catalog="refreshEditorCatalog" />
            <pre v-if="result && activeTab !== 'calculation'"><code><span v-for="(part, index) in highlighted" :key="index" :class="`syntax-${part.kind}`">{{ part.text }}</span></code></pre>
            <div v-else-if="!(activeTab === 'calculation' && calculationDraft && result)" class="json-empty"><span class="brace-icon" aria-hidden="true">{ }</span><h3>{{ busy ? '正在读取截图' : result ? '未定位到阵容表格' : '等一张截图，开始识别' }}</h3><p>{{ result && !busy ? '请换一张包含完整五列的清晰截图。' : activeTab === 'calculation' ? '识别后可逐位调整御魂搭配、计算指标与属性范围。' : '左侧粘贴图片后，这里会显示阵容 JSON。' }}</p><span class="empty-file">team.json</span></div>
          </div>
          <div class="json-footer"><span>{{ activeTab === 'calculation' && calculationDraft ? `${enabledMemberCount} / ${calculationDraft.members.length} 位配置御魂${manualAdjustmentMembers.length ? ` · ${manualAdjustmentMembers.length} 位计算后需卸装` : ''}${relaxedMembers.length ? ` · ${relaxedMembers.length} 位已放宽御魂限制` : ''}${conflictMembers.length ? ` · ${conflictMembers.length} 位冲突，不配置御魂` : ''}` : result ? `${result.draft.members.length} 个式神 · ${valuesRead} 项属性` : '等待识别结果' }}</span><span>截图面板与属性范围：40 表示 40%</span></div>
        </section>
      </div>
      <footer class="page-footer"><span>ONMYOJI TEAM</span><span>识图、参数调整与阵容二维码 · 尚未执行配装</span></footer>
    </main>
    <ImagePreviewDialog v-model="imagePreviewOpen" :src="teamImageUrl" :download-name="teamImageName" :notes="encodeWarnings" title="阵容二维码" />
  </div>
</template>

<style scoped>
.result-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.result-actions .copy-button { white-space: nowrap; }
.image-export-error { margin: 0; padding: 10px 20px; color: #9d4d38; background: #fff2eb; border-bottom: 1px solid #ecd9cf; font-size: 11px; }
.encode-notes { padding: 8px 20px; color: #8e7144; background: #fbf5e8; font-size: 10px; }.encode-notes p + p { margin-top: 5px; }
</style>
