<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { Download, ImageOff, LoaderCircle, X } from "@lucide/vue";

const props = withDefaults(defineProps<{
  modelValue: boolean;
  src: string;
  downloadName: string;
  title?: string;
  notes?: string[];
}>(), { title: "阵容二维码", notes: () => [] });
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const titleId = useId();
const dialog = ref<HTMLDialogElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const image = ref<HTMLImageElement | null>(null);
const source = computed(() => props.src.trim());
const imageState = ref<"loading" | "loaded" | "failed">("loading");
const viewMode = ref<"fit" | "original">("fit");
const imageWidth = ref(0);
const imageHeight = ref(0);
const canDownload = computed(() => Boolean(source.value) && imageState.value === "loaded");
let returnFocus: HTMLElement | null = null;
let syncVersion = 0;
let backdropPointerDown = false;

function resetImage(): void {
  imageState.value = "loading";
  viewMode.value = "fit";
  imageWidth.value = 0;
  imageHeight.value = 0;
}

function restoreFocus(): void {
  const target = returnFocus;
  returnFocus = null;
  const active = document.activeElement;
  if (active !== document.body && active !== dialog.value && active !== target) return;
  if (target?.isConnected && !target.matches(":disabled") && !target.closest("[inert]")) {
    target.focus({ preventScroll: true });
  }
}

function requestClose(): void {
  if (props.modelValue) emit("update:modelValue", false);
  if (dialog.value?.open) dialog.value.close();
}

function onNativeClose(): void {
  // A queued close event can arrive after the parent has already reopened it.
  if (dialog.value?.open) return;
  if (props.modelValue) emit("update:modelValue", false);
  restoreFocus();
}

function onCancel(event: Event): void {
  event.preventDefault();
  requestClose();
}

function outsideDialog(event: MouseEvent | PointerEvent): boolean {
  const element = dialog.value;
  if (!element || event.target !== element) return false;
  const bounds = element.getBoundingClientRect();
  return event.clientX < bounds.left || event.clientX > bounds.right
    || event.clientY < bounds.top || event.clientY > bounds.bottom;
}

function onBackdropClick(event: MouseEvent): void {
  if (backdropPointerDown && outsideDialog(event)) requestClose();
  backdropPointerDown = false;
}

function onBackdropPointerDown(event: PointerEvent): void {
  backdropPointerDown = outsideDialog(event);
}

function onImageLoad(event?: Event): void {
  const element = event ? event.currentTarget as HTMLImageElement : image.value;
  if (!element || element.getAttribute("src") !== source.value || element.naturalWidth === 0) return;
  imageWidth.value = element.naturalWidth;
  imageHeight.value = element.naturalHeight;
  imageState.value = "loaded";
}

function onImageError(event: Event): void {
  const element = event.currentTarget as HTMLImageElement;
  if (element.getAttribute("src") === source.value) imageState.value = "failed";
}

watch([() => props.modelValue, source], async ([open, src], previous) => {
  const version = ++syncVersion;
  if (src !== previous?.[1] || (open && !previous?.[0])) resetImage();
  await nextTick();
  if (version !== syncVersion) return;
  const element = dialog.value;
  if (!element) return;
  if (!open || !src) {
    if (element.open) element.close();
    if (open && !src) emit("update:modelValue", false);
    return;
  }
  if (!element.open) {
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement && !element.contains(active) ? active : null;
    element.showModal();
    closeButton.value?.focus({ preventScroll: true });
  }
  // Cached images may finish before the watcher resumes.
  if (image.value?.complete) {
    if (image.value.naturalWidth > 0) onImageLoad();
    else imageState.value = "failed";
  }
}, { immediate: true, flush: "post" });

onBeforeUnmount(() => {
  ++syncVersion;
  if (dialog.value?.open) dialog.value.close();
  restoreFocus();
});
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="image-preview-dialog"
      :aria-labelledby="titleId"
      @cancel="onCancel"
      @close="onNativeClose"
      @pointerdown="onBackdropPointerDown"
      @click="onBackdropClick"
    >
      <header class="preview-toolbar">
        <h2 :id="titleId">{{ title }}</h2>
        <div class="preview-actions">
          <a v-if="canDownload" class="preview-download" :href="source" :download="downloadName">
            <Download :size="15" aria-hidden="true" />下载 PNG
          </a>
          <button v-else type="button" class="preview-download" disabled>
            <Download :size="15" aria-hidden="true" />下载 PNG
          </button>
          <button ref="closeButton" type="button" class="preview-close" aria-label="关闭图片预览" @click="requestClose">
            <X :size="19" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div class="preview-controls">
        <div class="preview-modes" role="group" aria-label="图片显示方式">
          <button type="button" :aria-pressed="viewMode === 'fit'" :disabled="imageState !== 'loaded'" @click="viewMode = 'fit'">适应窗口</button>
          <button type="button" :aria-pressed="viewMode === 'original'" :disabled="imageState !== 'loaded'" @click="viewMode = 'original'">原始大小</button>
        </div>
        <span v-if="imageState === 'loaded'" class="preview-dimensions">{{ imageWidth }} × {{ imageHeight }}</span>
      </div>

      <div class="preview-viewport" :class="{ 'original-size': viewMode === 'original' }" :aria-busy="imageState === 'loading'">
        <img
          v-if="source"
          :key="source"
          ref="image"
          class="preview-image"
          :class="{ 'image-hidden': imageState !== 'loaded' }"
          :src="source"
          :alt="title"
          :style="viewMode === 'original' ? { width: `${imageWidth}px`, height: `${imageHeight}px` } : undefined"
          @load="onImageLoad"
          @error="onImageError"
        />
        <div v-if="imageState !== 'loaded'" class="preview-feedback" role="status" aria-live="polite">
          <template v-if="imageState === 'loading'">
            <LoaderCircle class="preview-spinner" :size="24" aria-hidden="true" />
            <p>正在加载图片…</p>
          </template>
          <template v-else>
            <ImageOff :size="28" aria-hidden="true" />
            <p>图片加载失败</p>
            <span>请关闭后重新打开图片预览。</span>
          </template>
        </div>
      </div>
      <footer class="preview-footer"><div v-if="notes.length" class="preview-notes"><p v-for="note in notes" :key="note">{{ note }}</p></div>{{ viewMode === 'original' && imageState === 'loaded' ? '滑动或滚动查看图片细节' : '下载图片保留原始清晰度' }}</footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.image-preview-dialog { width: min(1200px, calc(100% - 48px)); height: min(840px, calc(100dvh - 48px)); max-width: none; max-height: none; padding: 0; border: 1px solid #d6dccf; border-radius: 14px; background: #fdfdfb; color: #26342e; box-shadow: 0 24px 80px #20302533; overflow: hidden; }
.image-preview-dialog[open] { display: flex; flex-direction: column; }
.image-preview-dialog::backdrop { background: #24372bcc; backdrop-filter: blur(4px); }
.preview-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; border-bottom: 1px solid #e4e8de; }
.preview-toolbar h2 { min-width: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.preview-actions { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.preview-download { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 12px; border-radius: 6px; background: #334f3f; color: #f7f9f2; font: inherit; font-size: 12px; }
.preview-download:hover:not(:disabled) { background: #263e30; }
.preview-close { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 6px; background: transparent; color: #788571; }
.preview-close:hover { background: #edf1e7; color: #334f3f; }
.preview-controls { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 20px; background: #fafbf7; border-bottom: 1px solid #e9eae4; }
.preview-modes { display: flex; gap: 3px; padding: 3px; border-radius: 6px; background: #edf0e7; }
.preview-modes button { background: transparent; color: #7d8974; font-size: 11px; padding: 5px 10px; border-radius: 4px; }
.preview-modes button[aria-pressed="true"] { background: #fff; color: #435b37; box-shadow: 0 1px 3px #3a462515; }
.preview-dimensions { color: #8b9681; font: 11px ui-monospace, monospace; white-space: nowrap; }
.preview-viewport { position: relative; flex: 1; min-height: 0; min-width: 0; display: flex; align-items: center; justify-content: center; padding: 24px; overflow: hidden; background: #eef0e9; }
.preview-image { display: block; flex-shrink: 1; min-width: 0; min-height: 0; width: auto; height: auto; max-width: 100%; max-height: 100%; object-fit: contain; }
.preview-viewport.original-size { display: block; overflow: auto; }
.original-size .preview-image { max-width: none; max-height: none; margin: 0 auto; }
.preview-image.image-hidden { visibility: hidden; }
.preview-feedback { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; padding: 20px; color: #7d8c73; text-align: center; }
.preview-feedback p { font-size: 13px; }
.preview-feedback span { color: #939d8a; font-size: 11px; }
.preview-spinner { animation: preview-spin 1s linear infinite; }
.preview-footer { padding: 9px 20px; border-top: 1px solid #e4e8de; color: #8f9a83; font-size: 10px; }
.preview-notes { max-height: 80px; overflow: auto; margin-bottom: 6px; color: #8e7144; line-height: 1.6; }
@keyframes preview-spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .image-preview-dialog { width: calc(100% - 16px); height: calc(100dvh - 24px); border-radius: 10px; }
  .preview-toolbar { padding: 12px; gap: 8px; }
  .preview-toolbar h2 { font-size: 14px; }
  .preview-actions { gap: 6px; }
  .preview-download { padding: 7px 9px; font-size: 11px; }
  .preview-controls { padding: 8px 12px; }
  .preview-viewport { padding: 12px; }
  .preview-footer { padding: 8px 12px; }
}
@media (prefers-reduced-motion: reduce) { .preview-spinner { animation: none; } }
</style>
