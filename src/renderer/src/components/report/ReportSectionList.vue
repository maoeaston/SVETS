<template>
  <section class="report-sections" aria-label="报告内容">
    <article v-for="section in sections" :key="section.sectionId" class="report-section">
      <header>
        <h2>{{ section.title }}</h2>
        <span>{{ section.fields.length }} 项</span>
      </header>
      <dl>
        <div v-for="field in section.fields" :key="field.fieldId" class="report-field">
          <dt>{{ field.label }}</dt>
          <dd>{{ formatValue(field.value) }}</dd>
        </div>
      </dl>
    </article>
  </section>
</template>

<script setup lang="ts">
import type { ReportPresentationSection } from '@shared/types/report'

defineProps<{
  sections: ReportPresentationSection[]
}>()

function formatValue(value: string | number | boolean | null): string {
  if (value === null) return '未记录'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}
</script>

<style scoped>
.report-sections { display: grid; gap: 14px; min-width: 0; }
.report-section { overflow: hidden; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface); }
.report-section header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 14px 16px; background: var(--color-surface-muted); }
.report-section h2 { margin: 0; color: var(--color-text); font-size: 16px; line-height: 1.35; }
.report-section header span { color: var(--color-text-muted); font-size: 12px; white-space: nowrap; }
dl { display: grid; }
.report-field { display: grid; grid-template-columns: minmax(140px, 220px) minmax(0, 1fr); gap: 12px; padding: 12px 16px; border-top: 1px solid var(--color-border-subtle); }
dt { color: var(--color-text-muted); font-size: 13px; line-height: 1.55; }
dd { min-width: 0; color: var(--color-text); font-size: 14px; line-height: 1.65; overflow-wrap: anywhere; white-space: pre-wrap; }
@media (max-width: 620px) {
  .report-field { grid-template-columns: 1fr; gap: 4px; }
}
</style>
