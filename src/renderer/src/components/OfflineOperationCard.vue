<template>
  <article class="offline-card" :class="{ selected: modelValue !== null }">
    <header class="card-head">
      <div>
        <p class="eyebrow">{{ moduleName }} · 线下实操</p>
        <h3>{{ question.prompt || question.questionId }}</h3>
      </div>
      <span class="version">{{ question.questionId }}@{{ question.questionVersion }}</span>
    </header>

    <section v-if="question.toolBrief" class="info-block tools">
      <h4>施测工具</h4>
      <p>{{ question.toolBrief }}</p>
    </section>

    <section v-if="question.safetyStopConditions" class="info-block safety" role="note">
      <h4>安全停止条件</h4>
      <p>{{ question.safetyStopConditions }}</p>
    </section>

    <template v-if="mode === 'teacher'">
      <section v-if="question.rubricCriteria.length" class="info-block criteria">
        <h4>观察指标</h4>
        <ol>
          <li v-for="criterion in question.rubricCriteria" :key="criterion.criterionId">
            {{ criterion.description }}
          </li>
        </ol>
      </section>

      <fieldset class="score-fieldset">
        <legend>选择与现场表现相符的评分锚点</legend>
        <button
          v-for="score in scores"
          :key="score"
          type="button"
          class="anchor-option"
          :class="{ active: modelValue === score }"
          :aria-pressed="modelValue === score"
          :disabled="disabled"
          @click="$emit('update:modelValue', score)"
        >
          <span class="score-number">{{ score }}分</span>
          <span>{{ anchorText(score) }}</span>
        </button>
      </fieldset>

      <details v-if="question.sealedAdminConfig && Object.keys(question.sealedAdminConfig).length" class="sealed-config">
        <summary>教师密封配置</summary>
        <pre>{{ JSON.stringify(question.sealedAdminConfig, null, 2) }}</pre>
      </details>

      <label class="note-field">
        <span>观察备注，可选</span>
        <textarea
          :value="note"
          :disabled="disabled"
          rows="2"
          placeholder="记录提示次数、错放或漏数等可观察事实"
          @input="$emit('update:note', ($event.target as HTMLTextAreaElement).value)"
        />
      </label>
    </template>
  </article>
</template>

<script setup lang="ts">
import type { SessionScoringQuestion } from '@shared/types/job-skill-scoring'

const props = defineProps<{
  question: SessionScoringQuestion
  moduleName: string
  mode: 'student' | 'teacher'
  modelValue?: 0 | 1 | 2 | null
  note?: string
  disabled?: boolean
}>()

defineEmits<{
  'update:modelValue': [value: 0 | 1 | 2]
  'update:note': [value: string]
}>()

const scores = [0, 1, 2] as const

function anchorText(score: 0 | 1 | 2): string {
  return props.question.scoreAnchors?.[String(score) as '0' | '1' | '2']
    ?? ['未能完成', '部分完成', '完全达标'][score]
}
</script>

<style scoped>
.offline-card { border: 1px solid #dbe2ea; border-radius: 12px; padding: 20px; background: #fff; display: grid; gap: 14px; min-width: 0; }
.offline-card.selected { border-color: #6d7f47; box-shadow: 0 0 0 2px rgb(109 127 71 / 12%); }
.card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.eyebrow { margin: 0 0 5px; color: #6d7f47; font-size: 12px; font-weight: 700; letter-spacing: .04em; }
h3 { margin: 0; color: #20251d; font-size: 17px; line-height: 1.55; }
.version { flex: none; padding: 4px 8px; border-radius: 999px; background: #f1f3ed; color: #56613f; font: 600 11px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
.info-block { padding: 12px 14px; border-radius: 8px; background: #f6f7f4; min-width: 0; }
.info-block h4 { margin: 0 0 5px; font-size: 13px; }
.info-block p, .info-block ol { margin: 0; color: #454b40; font-size: 14px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.info-block ol { padding-left: 20px; }
.safety { background: #fff5ed; border-left: 4px solid #c65d2e; }
.safety h4 { color: #9b3f1d; }
.score-fieldset { margin: 0; padding: 0; border: 0; display: grid; gap: 8px; }
.score-fieldset legend { margin-bottom: 8px; color: #343a30; font-size: 13px; font-weight: 700; }
.anchor-option { width: 100%; display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 10px; align-items: start; padding: 11px 12px; border: 1px solid #d9ded2; border-radius: 8px; background: #fbfcfa; color: #343a30; text-align: left; font: inherit; line-height: 1.55; cursor: pointer; }
.anchor-option:hover:not(:disabled) { border-color: #8c9b67; background: #f5f7f0; }
.anchor-option.active { border-color: #61723e; background: #eef3e5; }
.anchor-option:focus-visible { outline: 3px solid rgb(97 114 62 / 28%); outline-offset: 2px; }
.anchor-option:disabled { opacity: .62; cursor: not-allowed; }
.score-number { color: #4e602d; font-weight: 800; }
.sealed-config { border-top: 1px dashed #cbd2c2; padding-top: 10px; }
.sealed-config summary { color: #5b634f; font-size: 13px; font-weight: 700; cursor: pointer; }
.sealed-config pre { max-height: 220px; overflow: auto; margin: 8px 0 0; padding: 10px; border-radius: 6px; background: #20251d; color: #eef3e5; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.note-field { display: grid; gap: 6px; color: #4d5348; font-size: 13px; font-weight: 600; }
.note-field textarea { width: 100%; resize: vertical; min-height: 62px; padding: 9px 10px; border: 1px solid #cfd5c9; border-radius: 7px; color: #252a22; font: 14px/1.5 inherit; }
@media (max-width: 600px) {
  .offline-card { padding: 15px; }
  .card-head { display: grid; }
  .version { justify-self: start; }
  .anchor-option { grid-template-columns: 42px minmax(0, 1fr); }
}
</style>
