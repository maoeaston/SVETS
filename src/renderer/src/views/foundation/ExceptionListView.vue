<template>
  <div class="exception-page">
    <header class="page-header">
      <div><p class="eyebrow">最近 30 天</p><h1>{{ isAdmin ? '系统异常中心' : '教学异常' }}</h1><p>按优先级查看阻断原因、关联对象和恢复提示。</p></div>
      <button type="button" class="refresh-button" :disabled="loading" @click="loadExceptions">刷新列表</button>
    </header>

    <section class="priority-tabs" aria-label="异常优先级筛选">
      <button type="button" :class="{ active: !filters.priorityLevel }" @click="setPriority('')">全部 <span>{{ total }}</span></button>
      <button v-for="priority in priorities" :key="priority" type="button" :class="[`priority-${priority}`, { active: filters.priorityLevel === priority }]" @click="setPriority(priority)">{{ priority }} <span>{{ counts[priority] }}</span></button>
    </section>

    <section class="filters" aria-label="异常筛选条件">
      <label>类别<select v-model="filters.category" @change="loadExceptions"><option value="">全部类别</option><option v-for="category in categories" :key="category" :value="category">{{ categoryLabel(category) }}</option></select></label>
      <label>恢复状态<select v-model="filters.recoveryStatus" @change="loadExceptions"><option value="">全部状态</option><option v-for="status in recoveryStatuses" :key="status" :value="status">{{ recoveryLabel(status) }}</option></select></label>
    </section>

    <PageState v-if="loading" kind="loading" title="正在读取异常记录" description="加载完成前不会显示空数据结论。" />
    <PageState v-else-if="errorKind" :kind="errorKind" :title="errorKind === 'forbidden' ? '当前账号不能查看异常中心' : '异常记录没有加载成功'" description="没有修改任何异常状态，可以原地重试。" action-label="重新加载" @action="loadExceptions" />
    <PageState v-else-if="items.length === 0" kind="empty" title="当前筛选下没有异常" description="可以切换优先级或恢复状态查看其他记录。" action-label="清除筛选" @action="clearFilters" />

    <template v-else>
      <PageState v-if="hasBlocking" kind="blocked" compact title="列表中有阻断型异常" description="P0 或 P1 必须先按详情中的恢复提示处理，不能只关闭提示后继续。" />
      <section class="exception-list" aria-label="异常记录列表">
        <RouterLink v-for="item in items" :key="item.errorEventId" :to="`${basePath}/exceptions/${item.errorEventId}`" class="exception-row">
          <span :class="['priority-badge', `priority-${item.priorityLevel}`]">{{ item.priorityLevel }}</span>
          <span class="exception-copy"><strong>{{ item.title }}</strong><small>{{ item.message }}</small><em>{{ categoryLabel(item.category) }} · {{ formatTime(item.createdAt) }}</em></span>
          <span :class="['recovery-badge', `recovery-${item.recoveryStatus}`]">{{ recoveryLabel(item.recoveryStatus) }}</span>
          <span class="row-arrow" aria-hidden="true">→</span>
        </RouterLink>
      </section>
      <p class="list-foot">显示 {{ items.length }} / {{ total }} 条，优先显示 P0 与 P1。</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import PageState from '../../components/PageState.vue'
import { useAuthStore } from '../../stores/auth'
import type { ExceptionCategory, ExceptionListItem, ExceptionPriority, ExceptionPriorityCounts, RecoveryStatus } from '@shared/types/foundation'

const auth = useAuthStore()
const isAdmin = computed(() => auth.role === 'ADMIN')
const basePath = computed(() => isAdmin.value ? '/admin' : '/teacher')
const loading = ref(true)
const errorKind = ref<'' | 'error' | 'forbidden'>('')
const items = ref<ExceptionListItem[]>([])
const total = ref(0)
const counts = ref<ExceptionPriorityCounts>({ P0: 0, P1: 0, P2: 0, P3: 0 })
const priorities: ExceptionPriority[] = ['P0', 'P1', 'P2', 'P3']
const categories: ExceptionCategory[] = ['IPC', 'DB', 'AOL', 'RECOVERY', 'ASSET', 'FSM', 'SCORING', 'REPORT', 'AUTH', 'SYSTEM']
const recoveryStatuses: RecoveryStatus[] = ['UNRESOLVED', 'MANUAL_REVIEW_REQUIRED', 'AUTO_RECOVERED', 'RESOLVED', 'IGNORED']
const filters = reactive<{ priorityLevel: ExceptionPriority | ''; category: ExceptionCategory | ''; recoveryStatus: RecoveryStatus | '' }>({ priorityLevel: '', category: '', recoveryStatus: '' })
const hasBlocking = computed(() => items.value.some((item) => item.isBlocking && ['UNRESOLVED', 'MANUAL_REVIEW_REQUIRED'].includes(item.recoveryStatus)))

async function loadExceptions(): Promise<void> {
  if (!auth.userId || !auth.role) { loading.value = false; errorKind.value = 'forbidden'; return }
  loading.value = true
  errorKind.value = ''
  try {
    const result = await window.api.foundation.listExceptions({
      callerUserId: auth.userId,
      callerRole: auth.role,
      priorityLevel: filters.priorityLevel || undefined,
      category: filters.category || undefined,
      recoveryStatus: filters.recoveryStatus || undefined,
      limit: 100
    })
    if (!result.success) { errorKind.value = result.errorCode === 'FORBIDDEN' ? 'forbidden' : 'error'; return }
    items.value = result.items
    total.value = result.total
    counts.value = result.priorityCounts
  } catch (error) {
    console.error('[ExceptionListView] load failed:', error)
    errorKind.value = 'error'
  } finally { loading.value = false }
}

function setPriority(priority: ExceptionPriority | ''): void { filters.priorityLevel = priority; void loadExceptions() }
function clearFilters(): void { filters.priorityLevel = ''; filters.category = ''; filters.recoveryStatus = ''; void loadExceptions() }
function categoryLabel(category: ExceptionCategory): string { return ({ IPC: '进程通信', DB: '数据库', AOL: '事件日志', RECOVERY: '恢复', ASSET: '资源', FSM: '状态流转', SCORING: '评分', REPORT: '报告', AUTH: '账号权限', SYSTEM: '系统' })[category] }
function recoveryLabel(status: RecoveryStatus): string { return ({ UNRESOLVED: '未解决', MANUAL_REVIEW_REQUIRED: '需人工复核', AUTO_RECOVERED: '已自动恢复', RESOLVED: '已解决', IGNORED: '无需处理' })[status] }
function formatTime(value: string): string { const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }) }

onMounted(() => { void loadExceptions() })
</script>

<style scoped>
.exception-page { display: grid; gap: 18px; max-width: 1060px; margin: 0 auto; }
.page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 22px; }
.eyebrow { margin: 0 0 3px; color: var(--color-danger); font-size: 12px; font-weight: 800; }
h1 { margin: 0; font-size: clamp(25px, 3vw, 34px); line-height: 1.2; }
.page-header p:last-child { margin: 6px 0 0; color: var(--color-text-muted); font-size: 13px; }
.refresh-button { min-height: 40px; padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); cursor: pointer; }
.priority-tabs { display: flex; gap: 8px; overflow-x: auto; }
.priority-tabs button { flex: none; min-height: 42px; padding: 7px 13px; border: 1px solid var(--color-border); border-radius: var(--radius-pill); background: var(--color-surface); color: var(--color-text-muted); cursor: pointer; }
.priority-tabs button.active { border-color: var(--color-ink); background: var(--color-ink); color: white; }
.priority-tabs span { margin-left: 5px; font-variant-numeric: tabular-nums; }
.filters { display: flex; flex-wrap: wrap; gap: 12px; }
.filters label { display: flex; align-items: center; gap: 8px; color: var(--color-text-muted); font-size: 12px; }
.filters select { min-height: 40px; padding: 7px 34px 7px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); }
.exception-list { overflow: hidden; border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-surface); }
.exception-row { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto 22px; align-items: center; gap: 14px; min-height: 86px; padding: 13px 16px; border-bottom: 1px solid var(--color-border-subtle); color: inherit; text-decoration: none; }
.exception-row:last-child { border-bottom: 0; }
.priority-badge { display: grid; place-items: center; width: 44px; height: 34px; border-radius: var(--radius-sm); background: var(--color-surface-muted); font-size: 12px; font-weight: 850; }
.priority-P0 { background: var(--color-danger-soft); color: var(--color-danger); }
.priority-P1 { background: var(--color-warning-soft); color: var(--color-warning); }
.exception-copy { display: grid; gap: 2px; min-width: 0; }
.exception-copy strong { font-size: 15px; }
.exception-copy small { color: var(--color-text-muted); line-height: 1.5; text-wrap: pretty; }
.exception-copy em { color: var(--color-text-faint); font-size: 11px; font-style: normal; }
.recovery-badge { padding: 5px 9px; border-radius: var(--radius-pill); background: var(--color-surface-muted); color: var(--color-text-muted); font-size: 11px; white-space: nowrap; }
.recovery-UNRESOLVED, .recovery-MANUAL_REVIEW_REQUIRED { background: var(--color-danger-soft); color: var(--color-danger); }
.row-arrow { color: var(--color-accent-dark); font-size: 18px; }
.list-foot { margin: 0; color: var(--color-text-faint); font-size: 11px; text-align: right; }
@media (hover: hover) { .exception-row:hover { background: var(--color-surface-muted); } }
@media (max-width: 660px) {
  .page-header { align-items: flex-start; flex-direction: column; gap: 12px; }
  .exception-row { grid-template-columns: 44px minmax(0, 1fr); }
  .recovery-badge { grid-column: 2; justify-self: start; }
  .row-arrow { display: none; }
}
</style>
