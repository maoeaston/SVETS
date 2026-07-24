<template>
  <section :class="['page-state', `state-${kind}`, { compact }]" :role="stateRole" :aria-live="liveMode">
    <span class="state-mark" aria-hidden="true">{{ mark }}</span>
    <div class="state-copy">
      <strong>{{ title }}</strong>
      <p v-if="description">{{ description }}</p>
    </div>
    <div v-if="actionLabel || secondaryLabel" class="state-actions">
      <button v-if="actionLabel" type="button" class="state-action primary" @click="$emit('action')">
        {{ actionLabel }}
      </button>
      <button v-if="secondaryLabel" type="button" class="state-action secondary" @click="$emit('secondary')">
        {{ secondaryLabel }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  kind: 'loading' | 'empty' | 'error' | 'forbidden' | 'blocked' | 'success'
  title: string
  description?: string
  actionLabel?: string
  secondaryLabel?: string
  compact?: boolean
}>(), { description: '', actionLabel: '', secondaryLabel: '', compact: false })

defineEmits<{ action: []; secondary: [] }>()

const mark = computed(() => ({
  loading: '···', empty: '○', error: '×', forbidden: '—', blocked: '!', success: '✓'
})[props.kind])
const stateRole = computed(() => ['error', 'forbidden', 'blocked'].includes(props.kind) ? 'alert' : 'status')
const liveMode = computed(() => props.kind === 'loading' ? 'polite' : 'assertive')
</script>

<style scoped>
.page-state { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 14px; min-height: 112px; padding: 22px; border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-surface); }
.page-state.compact { min-height: 0; padding: 14px 16px; border-radius: var(--radius-md); }
.state-mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; background: var(--color-surface-muted); color: var(--color-text-muted); font-size: 20px; font-weight: 800; }
.state-copy { min-width: 0; }
.state-copy strong { display: block; color: var(--color-text); font-size: 15px; }
.state-copy p { margin: 4px 0 0; color: var(--color-text-muted); font-size: 13px; line-height: 1.65; text-wrap: pretty; }
.state-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.state-action { min-height: 40px; padding: 8px 14px; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; cursor: pointer; transition-property: transform, opacity; transition-duration: 140ms; }
.state-action:active { transform: scale(.96); }
.state-action.primary { border: 0; background: var(--color-accent); color: var(--color-accent-ink); }
.state-action.secondary { border: 1px solid var(--color-border); background: transparent; color: var(--color-text); }
.state-loading .state-mark { animation: state-pulse 1.2s ease-in-out infinite; }
.state-error .state-mark, .state-forbidden .state-mark, .state-blocked .state-mark { background: var(--color-danger-soft); color: var(--color-danger); }
.state-success .state-mark { background: var(--color-success-soft); color: var(--color-success); }
@keyframes state-pulse { 50% { opacity: .45; transform: scale(.94); } }
@media (max-width: 620px) {
  .page-state { grid-template-columns: 42px minmax(0, 1fr); }
  .state-actions { grid-column: 2; justify-content: flex-start; }
}
@media (prefers-reduced-motion: reduce) { .state-loading .state-mark { animation: none; } }
</style>
