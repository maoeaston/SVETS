<template>
  <div class="safety-page">
    <header class="page-header">
      <div><p class="eyebrow">学生任务级安全事实</p><h1>{{ isAdmin ? '安全复盘' : '安全事件' }}</h1><p>{{ isAdmin ? '完成复盘后才能解除新会话阻断。' : '先补录并确认事实，管理员负责最终解除。' }}</p></div>
      <button type="button" class="refresh-button" :disabled="loading" @click="loadIncidents">刷新列表</button>
    </header>

    <section class="status-tabs" aria-label="安全事件状态筛选">
      <button v-for="option in statusOptions" :key="option.value || 'ALL'" type="button" :class="{ active: filterStatus === option.value }" @click="setStatus(option.value)">{{ option.label }}</button>
    </section>

    <PageState v-if="loading" kind="loading" title="正在读取安全事件" description="学生、任务和绑定会话正在同步。" />
    <PageState v-else-if="errorKind" :kind="errorKind" :title="errorKind === 'forbidden' ? '当前账号不能查看安全事件' : '安全事件没有加载成功'" description="没有改变任何阻断状态，可以原地重试。" action-label="重新加载" @action="loadIncidents" />
    <PageState v-else-if="items.length === 0" kind="empty" title="当前没有安全事件" description="切换状态可查看历史事件。" />

    <section v-else class="safety-list" aria-label="安全事件列表">
      <RouterLink v-for="item in items" :key="item.incidentId" :to="`${basePath}/safety/${item.incidentId}`" class="safety-row">
        <span :class="['status-mark', `status-${item.status}`]">{{ statusLabel(item.status) }}</span>
        <span class="event-copy"><strong>{{ item.studentName }} · {{ reasonLabel(item.reasonCode) }}</strong><small>{{ contextLabel(item.contextPhase) }}，{{ formatTime(item.occurredAt) }}</small><em>{{ item.bindingCount }} 个会话已关联 · {{ item.requiresReviewBeforeNextSession ? '仍在阻断' : '阻断已解除' }}</em></span>
        <span class="responsibility">{{ nextResponsibility(item.status) }}</span>
        <span aria-hidden="true" class="row-arrow">→</span>
      </RouterLink>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageState from '../../components/PageState.vue'
import { useAuthStore } from '../../stores/auth'
import { SAFETY_CONTEXT_PHASES, SAFETY_REASON_CODES } from '@shared/types/safety'
import type { SafetyIncidentStatus, SafetyIncidentView } from '@shared/types/safety-incident'

const auth = useAuthStore()
const isAdmin = computed(() => auth.role === 'ADMIN')
const basePath = computed(() => isAdmin.value ? '/admin' : '/teacher')
const loading = ref(true)
const errorKind = ref<'' | 'error' | 'forbidden'>('')
const items = ref<SafetyIncidentView[]>([])
const filterStatus = ref<SafetyIncidentStatus | ''>('')
const statusOptions: Array<{ value: SafetyIncidentStatus | ''; label: string }> = [
  { value: '', label: '全部' }, { value: 'PENDING_DETAIL', label: '待补录' },
  { value: 'CONFIRMED', label: '待复盘' }, { value: 'RESOLVED', label: '已解决' },
  { value: 'VOIDED', label: '已作废' }
]

async function loadIncidents(): Promise<void> {
  if (!auth.userId || !auth.role) { loading.value = false; errorKind.value = 'forbidden'; return }
  loading.value = true
  errorKind.value = ''
  try {
    const result = await window.api.safety.list({ callerUserId: auth.userId, callerRole: auth.role, status: filterStatus.value || undefined, limit: 100 })
    if (!result.success) { errorKind.value = result.errorCode === 'FORBIDDEN' ? 'forbidden' : 'error'; return }
    items.value = result.items
  } catch (error) {
    console.error('[SafetyIncidentListView] load failed:', error)
    errorKind.value = 'error'
  } finally { loading.value = false }
}

function setStatus(status: SafetyIncidentStatus | ''): void { filterStatus.value = status; void loadIncidents() }
function statusLabel(status: SafetyIncidentStatus): string { return ({ PENDING_DETAIL: '待补录', CONFIRMED: '待复盘', RESOLVED: '已解决', VOIDED: '已作废' })[status] }
function nextResponsibility(status: SafetyIncidentStatus): string { return status === 'PENDING_DETAIL' ? '教师补录事实' : status === 'CONFIRMED' ? '管理员复盘' : '查看历史' }
function reasonLabel(value: SafetyIncidentView['reasonCode']): string { return SAFETY_REASON_CODES.find((item) => item.value === value)?.label ?? value }
function contextLabel(value: SafetyIncidentView['contextPhase']): string { return SAFETY_CONTEXT_PHASES.find((item) => item.value === value)?.label ?? value }
function formatTime(value: string): string { const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }) }

onMounted(() => { void loadIncidents() })
</script>

<style scoped>
.safety-page { display: grid; gap: 18px; max-width: 1040px; margin: 0 auto; }
.page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 22px; }
.eyebrow { margin: 0 0 3px; color: var(--color-danger); font-size: 12px; font-weight: 800; }
h1 { margin: 0; font-size: clamp(25px, 3vw, 34px); line-height: 1.2; }
.page-header p:last-child { margin: 6px 0 0; color: var(--color-text-muted); font-size: 13px; }
.refresh-button { min-height: 40px; padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); cursor: pointer; }
.status-tabs { display: flex; gap: 8px; overflow-x: auto; }
.status-tabs button { flex: none; min-height: 40px; padding: 7px 13px; border: 1px solid var(--color-border); border-radius: var(--radius-pill); background: var(--color-surface); color: var(--color-text-muted); cursor: pointer; }
.status-tabs button.active { border-color: var(--color-ink); background: var(--color-ink); color: white; }
.safety-list { overflow: hidden; border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-surface); }
.safety-row { display: grid; grid-template-columns: 76px minmax(0, 1fr) auto 22px; align-items: center; gap: 14px; min-height: 92px; padding: 14px 16px; border-bottom: 1px solid var(--color-border-subtle); color: inherit; text-decoration: none; }
.safety-row:last-child { border-bottom: 0; }
.status-mark { padding: 7px 8px; border-radius: var(--radius-sm); background: var(--color-surface-muted); color: var(--color-text-muted); font-size: 12px; font-weight: 800; text-align: center; }
.status-PENDING_DETAIL, .status-CONFIRMED { background: var(--color-danger-soft); color: var(--color-danger); }
.status-RESOLVED { background: var(--color-success-soft); color: var(--color-success); }
.event-copy { display: grid; gap: 2px; min-width: 0; }
.event-copy strong { font-size: 15px; }
.event-copy small { color: var(--color-text-muted); }
.event-copy em { color: var(--color-text-faint); font-size: 11px; font-style: normal; }
.responsibility { padding: 5px 9px; border-radius: var(--radius-pill); background: var(--color-surface-muted); color: var(--color-text-muted); font-size: 11px; white-space: nowrap; }
.row-arrow { color: var(--color-danger); font-size: 18px; }
@media (hover: hover) { .safety-row:hover { background: var(--color-surface-muted); } }
@media (max-width: 660px) {
  .page-header { align-items: flex-start; flex-direction: column; gap: 12px; }
  .safety-row { grid-template-columns: 76px minmax(0, 1fr); }
  .responsibility { grid-column: 2; justify-self: start; }
  .row-arrow { display: none; }
}
</style>
