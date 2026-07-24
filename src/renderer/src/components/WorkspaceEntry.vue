<template>
  <component
    :is="disabled ? 'div' : RouterLink"
    :to="disabled ? undefined : to"
    :class="['workspace-entry', { disabled, urgent }]"
    :aria-disabled="disabled || undefined"
  >
    <span class="entry-index" aria-hidden="true">{{ index }}</span>
    <span class="entry-copy">
      <strong>{{ title }}</strong>
      <small>{{ description }}</small>
    </span>
    <span class="entry-count">{{ countLabel }}</span>
    <span class="entry-arrow" aria-hidden="true">{{ disabled ? '·' : '→' }}</span>
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

const props = withDefaults(defineProps<{
  index: string
  title: string
  description: string
  count?: number | null
  countText?: string
  to?: string
  disabled?: boolean
  urgent?: boolean
}>(), { count: null, countText: '', to: '', disabled: false, urgent: false })

const countLabel = computed(() => props.countText || (props.count === null ? '查看' : `${props.count} 项`))
</script>

<style scoped>
.workspace-entry { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto 24px; align-items: center; gap: 13px; min-height: 76px; padding: 13px 16px; border-bottom: 1px solid var(--color-border-subtle); color: inherit; text-decoration: none; transition-property: transform, opacity; transition-duration: 140ms; }
.workspace-entry:last-child { border-bottom: 0; }
.workspace-entry:not(.disabled):active { transform: scale(.99); }
.entry-index { color: var(--color-text-faint); font-size: 12px; font-variant-numeric: tabular-nums; }
.entry-copy { display: grid; gap: 3px; min-width: 0; }
.entry-copy strong { color: var(--color-text); font-size: 15px; }
.entry-copy small { color: var(--color-text-muted); font-size: 12px; line-height: 1.55; text-wrap: pretty; }
.entry-count { padding: 5px 9px; border-radius: var(--radius-pill); background: var(--color-surface-muted); color: var(--color-text-muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.entry-arrow { color: var(--color-accent-dark); font-size: 20px; }
.workspace-entry.urgent .entry-count { background: var(--color-danger-soft); color: var(--color-danger); }
.workspace-entry.disabled { opacity: .66; }
@media (hover: hover) { .workspace-entry:not(.disabled):hover { background: var(--color-surface-muted); } }
@media (max-width: 520px) {
  .workspace-entry { grid-template-columns: 28px minmax(0, 1fr) auto; padding-inline: 12px; }
  .entry-arrow { display: none; }
  .entry-copy small { font-size: 11px; }
}
</style>
