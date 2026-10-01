<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { assetRequestUrl } from '../catalog';
import type { Member, SoulRegionAdjustment, SoulRegionDiagnostic } from '../types';

const props = defineProps<{
  diagnostics: SoulRegionDiagnostic[];
  members: Member[];
  selectedSlot: number;
  adjustment: SoulRegionAdjustment;
  busy?: boolean;
}>();
const emit = defineEmits<{ select: [slot: number]; rematch: [adjustment: SoulRegionAdjustment] }>();
const candidateIndex = ref(0);
const failedAvatar = ref('');
const draftOffsetX = ref(0);
const draftOffsetY = ref(0);
const draftSize = ref(100);
const canAdjust = computed(() => props.diagnostics.some((entry) =>
  entry.cropDataUrl && entry.region.width > 0 && entry.region.height > 0,
));
const adjustmentValid = computed(() =>
  [draftOffsetX.value, draftOffsetY.value].every((value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= -20 && value <= 20,
  ) && typeof draftSize.value === 'number' && Number.isFinite(draftSize.value)
    && draftSize.value >= 70 && draftSize.value <= 130 && draftSize.value % 5 === 0,
);

watch([
  () => props.adjustment.offsetX,
  () => props.adjustment.offsetY,
  () => props.adjustment.scale,
], ([offsetX, offsetY, size]) => {
  draftOffsetX.value = offsetX;
  draftOffsetY.value = offsetY;
  draftSize.value = Math.round(size * 100);
}, { immediate: true });

function applyAdjustment() {
  if (props.busy || !adjustmentValid.value) return;
  emit('rematch', { offsetX: draftOffsetX.value, offsetY: draftOffsetY.value, scale: draftSize.value / 100 });
}
function resetAdjustment() {
  if (!props.busy) emit('rematch', { offsetX: 0, offsetY: 0, scale: 1 });
}

const slots = computed(() => Array.from({ length: 5 }, (_, index) => {
  const slot = index + 1;
  const member = props.members.find((entry) => entry.slot === slot);
  return {
    slot,
    name: member?.shikigami.name || member?.shikigami.rawText || '名称未识别',
    diagnostic: props.diagnostics.find((entry) => entry.slot === slot),
  };
}));
const selected = computed(() => slots.value.find((entry) => entry.slot === props.selectedSlot));
const candidates = computed(() => selected.value?.diagnostic?.candidates.slice(0, 3) ?? []);
const candidate = computed(() => candidates.value[candidateIndex.value]);
const avatarUrl = computed(() => {
  const avatar = candidate.value?.avatar;
  if (!avatar || avatar === failedAvatar.value) return '';
  try { return assetRequestUrl(avatar); }
  catch { return ''; }
});

watch([
  () => props.selectedSlot,
  () => props.diagnostics,
  () => selected.value?.diagnostic?.cropDataUrl,
], () => {
  candidateIndex.value = 0;
  failedAvatar.value = '';
});

function score(value: number) {
  return Number.isFinite(value) ? value.toFixed(4) : '—';
}
function scale(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}
function offset(value: number) {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${Number(value.toFixed(2))}`;
}
function statusLabel(diagnostic?: SoulRegionDiagnostic) {
  switch (diagnostic?.matchStatus) {
    case 'pending': return '等待匹配';
    case 'candidate': return '候选待核对';
    case 'unrecognized': return '未识别';
    default: return '匹配不可用';
  }
}
function avatarFailed() {
  failedAvatar.value = candidate.value?.avatar ?? '';
}
</script>

<template>
  <section class="soul-diagnostics" aria-label="御魂图片匹配诊断">
    <div class="diagnostic-heading">
      <h3>御魂识别区域</h3>
      <span>点击位置，检查截图与候选</span>
    </div>

    <div class="region-cards" role="group" aria-label="选择御魂位置">
      <button
        v-for="entry in slots"
        :key="entry.slot"
        type="button"
        class="region-card"
        :class="{ selected: selectedSlot === entry.slot }"
        :aria-pressed="selectedSlot === entry.slot"
        :aria-label="`查看第 ${entry.slot} 位 ${entry.name} 的御魂识别区域`"
        :disabled="busy"
        @click="emit('select', entry.slot)"
      >
        <span class="card-number">{{ String(entry.slot).padStart(2, '0') }}</span>
        <span class="thumbnail checkerboard">
          <img v-if="entry.diagnostic?.cropDataUrl" :src="entry.diagnostic.cropDataUrl" alt="" />
          <span v-else class="thumbnail-empty" aria-hidden="true">—</span>
        </span>
        <span class="card-name" :title="entry.name">{{ entry.name }}</span>
        <span class="card-state" :class="{ unrecognized: entry.diagnostic?.matchStatus === 'unrecognized' }">{{ statusLabel(entry.diagnostic) }}</span>
      </button>
    </div>

    <form v-if="canAdjust" class="region-adjustment" @submit.prevent="applyAdjustment">
      <fieldset :disabled="busy">
        <legend>整行区域调整 <span>同时应用于五个位置</span></legend>
        <div class="adjustment-inputs">
          <label>
            <span>水平偏移 <small>px</small></span>
            <input v-model.number="draftOffsetX" type="number" min="-20" max="20" step="1" required />
          </label>
          <label>
            <span>垂直偏移 <small>px</small></span>
            <input v-model.number="draftOffsetY" type="number" min="-20" max="20" step="1" required />
          </label>
          <label>
            <span>框大小 <small>%</small></span>
            <input v-model.number="draftSize" type="number" min="70" max="130" step="5" required />
          </label>
        </div>
        <p class="adjustment-note">左右／上下偏移以原截图像素计，正数向右／向下；框大小以自动区域为 100%。</p>
        <div class="adjustment-actions">
          <button class="apply-adjustment" type="submit" :disabled="busy || !adjustmentValid">{{ busy ? '正在重算御魂…' : '应用并重算御魂' }}</button>
          <button class="reset-adjustment" type="button" :disabled="busy" @click="resetAdjustment">恢复自动区域</button>
        </div>
      </fieldset>
    </form>

    <div v-if="selected" class="diagnostic-detail">
      <div class="detail-heading">
        <strong>第 {{ selected.slot }} 位 · {{ selected.name }}</strong>
        <span v-if="selected.diagnostic" class="region-size">
          {{ Math.round(selected.diagnostic.region.width) }} × {{ Math.round(selected.diagnostic.region.height) }} 处理图 px
        </span>
      </div>

      <div class="match-status" :class="selected.diagnostic?.matchStatus || 'unavailable'" role="status">
        <strong>{{ statusLabel(selected.diagnostic) }}</strong>
        <span v-if="selected.diagnostic?.matchStatus === 'unrecognized'">下方候选仅供诊断，未作为有效御魂结果。</span>
        <span v-else-if="selected.diagnostic?.matchStatus === 'pending'">等待完成图片比对。</span>
        <p v-if="selected.diagnostic?.reason">{{ selected.diagnostic.reason }}</p>
      </div>

      <template v-if="selected.diagnostic?.cropDataUrl">
        <div v-if="candidates.length" class="candidate-buttons" role="group" aria-label="查看前三个御魂候选">
          <button
            v-for="(entry, index) in candidates"
            :key="entry.catalogId"
            type="button"
            :class="{ active: candidateIndex === index }"
            :aria-pressed="candidateIndex === index"
            :disabled="busy"
            @click="candidateIndex = index"
          >
            <span class="candidate-rank">{{ index + 1 }}</span>
            <span class="candidate-name">{{ entry.name }}</span>
            <span class="candidate-score">{{ score(entry.scores.total) }}</span>
          </button>
        </div>

        <div class="comparison-grid">
          <figure>
            <div class="image-frame checkerboard">
              <img :src="selected.diagnostic.cropDataUrl" :alt="`第 ${selected.slot} 位的原始截图裁切`" />
            </div>
            <figcaption>截图原区域</figcaption>
          </figure>
          <figure v-if="candidate">
            <div class="image-frame checkerboard">
              <img v-if="avatarUrl" :key="avatarUrl" :src="avatarUrl" :alt="`${candidate.name} 的 R2 原图`" @error="avatarFailed" />
              <span v-else class="image-unavailable">原图不可用</span>
            </div>
            <figcaption>{{ candidate.name }} · R2 原图</figcaption>
          </figure>
          <figure v-if="candidate">
            <div class="image-frame checkerboard pixel-preview">
              <img v-if="candidate.screenshotDataUrl" :src="candidate.screenshotDataUrl" alt="实际参与比对的截图像素，未评分区域透明" />
              <span v-else class="image-unavailable">比对图不可用</span>
            </div>
            <figcaption>参与比对的截图 <small>24 × 24</small></figcaption>
          </figure>
          <figure v-if="candidate">
            <div class="image-frame checkerboard pixel-preview">
              <img v-if="candidate.templateDataUrl" :src="candidate.templateDataUrl" :alt="`实际参与比对的${candidate.name}模板像素，未评分区域透明`" />
              <span v-else class="image-unavailable">比对图不可用</span>
            </div>
            <figcaption>参与比对的模板 <small>24 × 24</small></figcaption>
          </figure>
        </div>

        <template v-if="candidate">
          <dl class="score-breakdown" aria-label="候选分项评分">
            <div><dt>颜色分</dt><dd>{{ score(candidate.scores.color) }}</dd></div>
            <div><dt>结构分</dt><dd>{{ score(candidate.scores.structure) }}</dd></div>
            <div><dt>像素分</dt><dd>{{ score(candidate.scores.pixel) }}</dd></div>
            <div class="total-score"><dt>总分</dt><dd>{{ score(candidate.scores.total) }}</dd></div>
          </dl>
          <div class="match-meta">
            <span>截图裁切 ×{{ scale(candidate.sourceScale) }}</span>
            <span>模板裁切 ×{{ scale(candidate.templateScale) }}</span>
            <span>自动中心偏移 X {{ offset(candidate.sourceOffsetX) }} · Y {{ offset(candidate.sourceOffsetY) }} 处理图 px</span>
          </div>
          <div v-if="candidate.rejectionReasons.length" class="candidate-rejection">
            <strong>候选未通过条件</strong>
            <ul><li v-for="(reason, index) in candidate.rejectionReasons" :key="index">{{ reason }}</li></ul>
          </div>
          <p class="detail-note">截图裁切倍率相对橙色区域框，模板裁切倍率相对 R2 原图的居中正方形。灰色棋盘／透明区域不参与评分；分数用于比较相似程度，分数不是识别正确的概率。</p>
        </template>
        <p v-else-if="selected.diagnostic.matchStatus !== 'pending'" class="detail-empty">已显示截图区域，当前没有可比对的御魂候选。</p>
      </template>
      <p v-else class="detail-empty" role="status">这个位置暂时没有可用的截图裁切，请先核对截图中的橙色区域框。</p>
    </div>
    <p v-else class="selection-hint">选择上方位置，展开原图、候选与实际比对像素。</p>
    <p class="method-note">御魂匹配比较颜色分布、灰度相关与像素色差，并在区域附近自动搜索中心；候选仍需结合原截图核对。</p>
  </section>
</template>

<style scoped>
.soul-diagnostics { margin-top: 22px; color: #465343; }
.diagnostic-heading, .detail-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.diagnostic-heading { margin-bottom: 10px; }
.diagnostic-heading h3 { font-size: 12px; font-weight: 550; }
.diagnostic-heading > span { color: #8b9483; font-size: 10px; }
.region-cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; }
.region-card { display: flex; flex-direction: column; align-items: center; position: relative; min-width: 0; padding: 10px 5px 8px; border: 1px solid #e0e4d8; border-radius: 7px; background: #fafbf7; color: inherit; }
.region-card:hover { background: #f0f3e9; border-color: #c7d1ba; }
.region-card.selected { border-color: #c89745; background: #fcf7ea; box-shadow: 0 0 0 1px #c8974520; }
.region-card:focus-visible, .candidate-buttons button:focus-visible { outline: 2px solid #66806a; outline-offset: 3px; }
.card-number { align-self: flex-start; color: #979f8c; font: 9px ui-monospace, monospace; margin-bottom: 5px; }
.selected .card-number { color: #ad7830; }
.thumbnail { width: 44px; height: 44px; max-width: 100%; display: grid; place-items: center; border-radius: 4px; overflow: hidden; }
.thumbnail img { width: 100%; height: 100%; object-fit: contain; }
.thumbnail-empty { font-size: 20px; color: #aeb5a5; }
.card-name { display: block; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; margin-top: 7px; }
.card-state { color: #a0a792; font-size: 9px; margin-top: 2px; }
.selected .card-state { color: #a08555; }
.card-state.unrecognized { color: #ae6847; font-weight: 600; }
.region-adjustment { margin-top: 10px; padding: 11px 12px; border: 1px solid #e1e5d9; background: #fafbf7; border-radius: 7px; }
.region-adjustment fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.region-adjustment legend { padding: 0; color: #637456; font-size: 10px; }
.region-adjustment legend span { margin-left: 7px; color: #99a18f; font-size: 9px; }
.adjustment-inputs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin-top: 9px; }
.adjustment-inputs label { display: flex; flex-direction: column; gap: 4px; color: #7b8970; font-size: 9px; min-width: 0; }
.adjustment-inputs small { font: 9px ui-monospace, monospace; color: #a0a991; margin-left: 3px; }
.adjustment-inputs input { width: 100%; min-width: 0; padding: 5px 7px; border: 1px solid #dce3d3; border-radius: 4px; background: #fff; color: #53664a; font: 11px ui-monospace, monospace; }
.adjustment-inputs input:disabled { background: #f0f2eb; color: #9ba48f; }
.adjustment-inputs input:focus-visible, .adjustment-actions button:focus-visible { outline: 2px solid #66806a; outline-offset: 3px; }
.adjustment-note { color: #969f8b; font-size: 9px; line-height: 1.75; margin-top: 7px; }
.adjustment-actions { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin-top: 9px; }
.adjustment-actions button { border-radius: 4px; font-size: 10px; padding: 6px 9px; }
.apply-adjustment { background: #405b37; color: #f6f8f0; }
.apply-adjustment:hover:not(:disabled) { background: #314b29; }
.reset-adjustment { background: transparent; color: #849376; }
.reset-adjustment:hover:not(:disabled) { background: #edf1e6; color: #536b44; }
.diagnostic-detail { margin-top: 10px; padding: 13px; background: #f8f9f3; border: 1px solid #e1e5d9; border-radius: 7px; }
.detail-heading strong { font-size: 11px; font-weight: 550; overflow-wrap: anywhere; }
.region-size { font: 9px ui-monospace, monospace; color: #929c86; white-space: nowrap; }
.match-status { padding: 7px 9px; margin-top: 9px; border-radius: 5px; background: #edf1e6; color: #7a8b67; font-size: 10px; line-height: 1.7; }
.match-status strong { font-weight: 550; margin-right: 7px; }
.match-status p { margin-top: 2px; font-size: 9px; }
.match-status.unrecognized { background: #fbefdf; color: #a16d3d; border: 1px solid #eed9ba; }
.match-status.unrecognized strong { font-weight: 650; }
.match-status.pending, .match-status.unavailable { background: #eef0e9; color: #919985; }
.candidate-buttons { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
.candidate-buttons button { display: flex; align-items: center; gap: 6px; padding: 5px 7px; border: 1px solid #e0e5d7; border-radius: 5px; background: #fdfefa; color: #879278; font-size: 10px; min-width: 0; }
.candidate-buttons button:hover { background: #eef2e6; }
.candidate-buttons button.active { color: #425b35; border-color: #bdcbae; background: #eaf0e0; }
.candidate-rank { font: 9px ui-monospace, monospace; opacity: .7; }
.candidate-name { overflow-wrap: anywhere; }
.candidate-score { font: 9px ui-monospace, monospace; white-space: nowrap; }
.comparison-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 13px; }
.comparison-grid figure { margin: 0; min-width: 0; }
.image-frame { aspect-ratio: 1; max-width: 108px; width: 100%; display: grid; place-items: center; border: 1px solid #dce2d3; border-radius: 5px; overflow: hidden; margin: auto; }
.image-frame img { width: 100%; height: 100%; object-fit: contain; }
.checkerboard { background-color: #f4f5f1; background-image: linear-gradient(45deg, #e1e4dc 25%, transparent 25%), linear-gradient(-45deg, #e1e4dc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e1e4dc 75%), linear-gradient(-45deg, transparent 75%, #e1e4dc 75%); background-size: 12px 12px; background-position: 0 0, 0 6px, 6px -6px, -6px 0; }
.pixel-preview img { image-rendering: pixelated; }
.image-unavailable { padding: 8px; text-align: center; font-size: 9px; color: #929b85; }
figcaption { margin-top: 6px; text-align: center; font-size: 9px; color: #7a886d; overflow-wrap: anywhere; }
figcaption small { display: block; font: 8px ui-monospace, monospace; color: #9ba68e; margin-top: 2px; }
.match-meta { display: flex; flex-wrap: wrap; gap: 5px 13px; margin-top: 12px; color: #889477; font-size: 9px; }
.match-meta strong { font: 10px ui-monospace, monospace; color: #5b7349; margin-left: 3px; }
.score-breakdown { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; margin: 12px 0 0; }
.score-breakdown > div { text-align: center; border: 1px solid #e1e6d8; background: #fdfefa; border-radius: 4px; padding: 5px 3px; }
.score-breakdown dt { font-size: 9px; color: #939d87; }
.score-breakdown dd { margin: 2px 0 0; font: 10px ui-monospace, monospace; color: #6b8059; }
.score-breakdown .total-score { background: #edf2e5; border-color: #d8e1cb; }
.score-breakdown .total-score dd { color: #4d6938; }
.candidate-rejection { padding: 8px 10px; margin-top: 9px; background: #faf1e6; border-radius: 5px; color: #a18159; font-size: 9px; line-height: 1.7; }
.candidate-rejection strong { font-weight: 550; }
.candidate-rejection ul { margin: 3px 0 0; padding-left: 15px; }
.detail-note, .method-note, .selection-hint, .detail-empty { font-size: 10px; line-height: 1.75; color: #939c87; }
.detail-note { margin-top: 7px; }
.detail-empty { margin-top: 11px; }
.method-note { margin-top: 10px; }
.selection-hint { margin-top: 9px; }
@media (max-width: 1000px) and (min-width: 741px), (max-width: 440px) {
  .diagnostic-heading { flex-wrap: wrap; gap: 3px; }
  .comparison-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .card-name { font-size: 9px; }
  .card-state { font-size: 8px; }
  .region-cards { gap: 4px; }
  .region-card { padding-inline: 3px; }
}
@media (max-width: 320px) {
  .region-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .detail-heading { flex-wrap: wrap; }
}
</style>
