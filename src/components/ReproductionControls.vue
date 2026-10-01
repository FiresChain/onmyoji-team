<script setup lang="ts">
import { computed } from 'vue';
import { REPRODUCTION_STATS, effectiveOrderStats } from '../calculation-config';
import type { CalculationDraft, ReproductionStat } from '../calculation-types';
import { STATS } from '../types';

const props = defineProps<{ modelValue: CalculationDraft['reproduction'] }>();
const emit = defineEmits<{ 'update:modelValue': [settings: CalculationDraft['reproduction']] }>();
const labels = computed(() => REPRODUCTION_STATS.map((stat) => ({ stat, label: STATS.find(([key]) => key === stat)?.[1] ?? stat })));
const activeOrder = computed(() => effectiveOrderStats(props.modelValue));

function update(settings: Partial<CalculationDraft['reproduction']>): void {
  emit('update:modelValue', {
    tolerancePercent: settings.tolerancePercent ?? props.modelValue.tolerancePercent,
    constraintStats: [...(settings.constraintStats ?? props.modelValue.constraintStats)],
    orderStats: [...(settings.orderStats ?? props.modelValue.orderStats)],
  });
}
function toggle(field: 'constraintStats' | 'orderStats', stat: ReproductionStat, checked: boolean): void {
  const selected = props.modelValue[field];
  update({ [field]: checked ? [...selected, stat] : selected.filter((item) => item !== stat) });
}
</script>

<template>
  <section class="reproduction-controls" aria-label="全局计算设置">
    <div class="settings-heading"><h2>全局计算设置</h2><p>选择截图属性如何进入配装计算</p></div>
    <div class="settings-grid">
      <fieldset class="settings-group"><legend>属性约束</legend>
        <div class="settings-options"><label v-for="item in labels" :key="item.stat"><input type="checkbox" :checked="modelValue.constraintStats.includes(item.stat)" @change="toggle('constraintStats', item.stat, ($event.target as HTMLInputElement).checked)" />{{ item.label }}</label></div>
        <p>仅勾选的截图属性会导出上下限；效果命中默认用作计算指标。</p>
      </fieldset>
      <fieldset class="settings-group settings-tolerance"><legend>误差范围</legend>
        <div class="tolerance-row"><div class="tolerance-input"><span aria-hidden="true">±</span><input :value="modelValue.tolerancePercent" type="number" min="0" max="100" step="0.1" inputmode="decimal" aria-label="误差百分比" @input="update({ tolerancePercent: ($event.target as HTMLInputElement).value })" /><span>%</span></div>
          <div class="tolerance-presets" role="group" aria-label="误差快捷设置"><button v-for="percent in [1, 5, 10, 20]" :key="percent" type="button" :class="{ active: Number(modelValue.tolerancePercent) === percent }" :aria-pressed="Number(modelValue.tolerancePercent) === percent" @click="update({ tolerancePercent: String(percent) })">{{ percent }}%</button></div>
        </div>
        <p>修改误差会按当前截图重建属性上下限；御魂、指标和额外属性仍保留。40% 暴击 ±10% 对应 36%～44%。</p>
      </fieldset>
      <fieldset class="settings-group"><legend>顺序约束</legend>
        <div class="settings-options"><label v-for="item in labels" :key="item.stat" :class="{ unavailable: !modelValue.constraintStats.includes(item.stat) }"><input type="checkbox" :checked="modelValue.orderStats.includes(item.stat)" :disabled="!modelValue.constraintStats.includes(item.stat)" @change="toggle('orderStats', item.stat, ($event.target as HTMLInputElement).checked)" />{{ item.label }}</label></div>
        <p>仅对已勾选属性生效；停用属性约束时会记住其顺序选择。当前生效 {{ activeOrder.length }} 项。</p>
      </fieldset>
    </div>
  </section>
</template>

<style scoped>
.reproduction-controls { margin: 0 0 22px; padding: 19px 22px; border: 1px solid #dedfd7; border-radius: 12px; background: #fdfdfb; color: #4d6043; }
.settings-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 14px; margin-bottom: 15px; }.settings-heading h2 { font-size: 14px; font-weight: 650; }.settings-heading p { font-size: 11px; color: #8a9581; }
.settings-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(210px, .85fr) minmax(0, 1.2fr); gap: 18px; }
.settings-group { min-width: 0; margin: 0; padding: 0; border: 0; }.settings-group legend { padding: 0; margin-bottom: 10px; font-size: 11px; font-weight: 650; }.settings-group p { margin: 10px 0 0; color: #8a9581; font-size: 10px; line-height: 1.55; }
.settings-options { display: flex; flex-wrap: wrap; gap: 7px 13px; }.settings-options label { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; font-size: 11px; }.settings-options label.unavailable { color: #a3aa9c; }.settings-options input { margin: 0; accent-color: #527145; }
.tolerance-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }.tolerance-input { display: flex; align-items: center; gap: 3px; padding: 5px 7px; border: 1px solid #dce1d6; border-radius: 5px; background: #fff; font-size: 12px; }.tolerance-input input { width: 46px; border: 0; color: #42563f; background: transparent; font: inherit; text-align: right; }.tolerance-presets { display: flex; flex-wrap: wrap; gap: 4px; }.tolerance-presets button { padding: 5px 7px; border: 1px solid #dce1d6; border-radius: 5px; color: #607358; background: #fff; font-size: 10px; }.tolerance-presets button.active { color: #fff; border-color: #527145; background: #527145; }
@media (max-width: 1000px) { .settings-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }.settings-tolerance { grid-column: 1 / -1; grid-row: 2; } }
@media (max-width: 640px) { .reproduction-controls { padding: 16px; }.settings-grid { grid-template-columns: 1fr; gap: 18px; }.settings-tolerance { grid-column: auto; grid-row: auto; } }
</style>
