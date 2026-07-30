<template>
  <section v-if="visible" class="runtime-health-banner" role="alert">
    <strong>系统已进入只读保护</strong>
    <span>{{ message }}</span>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from 'vue'
import { formatRuntimeReadOnlyMessage, type RuntimeHealthSnapshot } from '../stores/runtime-health'

export default defineComponent({
  name: 'RuntimeHealthBanner',
  props: {
    health: {
      type: Object as PropType<RuntimeHealthSnapshot | null>,
      required: true
    }
  },
  setup(props) {
    const visible = computed(() => props.health?.state === 'CORRUPTION_READ_ONLY')
    const message = computed(() => props.health ? formatRuntimeReadOnlyMessage(props.health) : '')
    return { visible, message }
  }
})
</script>

<style scoped>
.runtime-health-banner {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 10px 16px;
  color: #5d1c10;
  background: #fff1eb;
  border-bottom: 1px solid #d77457;
  font-size: 14px;
}
</style>
