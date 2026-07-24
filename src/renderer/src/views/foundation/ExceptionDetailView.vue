<template>
  <div class="detail-page">
    <RouterLink :to="`${basePath}/exceptions`" class="back-link">← 返回异常列表</RouterLink>
    <PageState v-if="loading" kind="loading" title="正在读取异常详情" description="关联对象和恢复状态正在同步。" />
    <PageState v-else-if="errorKind" :kind="errorKind" :title="errorKind === 'forbidden' ? '当前账号不能查看这条异常' : errorKind === 'empty' ? '没有找到这条异常' : '异常详情没有加载成功'" description="返回列表后可以重新选择，或原地重试。" action-label="重新加载" secondary-label="返回列表" @action="loadDetail" @secondary="router.push(`${basePath}/exceptions`)" />

    <template v-else-if="detail">
      <header class="detail-header">
        <span :class="['priority-badge', `priority-${detail.priorityLevel}`]">{{ detail.priorityLevel }}</span>
        <div><p>{{ detail.errorCode }}</p><h1>{{ detail.title }}</h1><span>{{ formatTime(detail.createdAt) }} · {{ categoryLabel(detail.category) }}</span></div>
        <span :class="['status-badge', { unresolved: isUnresolved }]">{{ recoveryLabel(detail.recoveryStatus) }}</span>
      </header>

      <PageState v-if="detail.isBlocking && isUnresolved" kind="blocked" compact title="这条异常会阻断当前流程" description="请按恢复提示处理并保留事件日志，不要用重复点击绕过。" />

      <section class="detail-section">
        <h2>发生了什么</h2>
        <p>{{ detail.message || detail.defaultMessage }}</p>
        <dl>
          <div><dt>严重度</dt><dd>{{ detail.severity }}</dd></div>
          <div><dt>关联对象</dt><dd>{{ detail.relatedAggregateType ?? '系统' }}</dd></div>
          <div><dt>对象编号</dt><dd class="mono">{{ detail.relatedAggregateId ?? '无' }}</dd></div>
          <div><dt>解决时间</dt><dd>{{ detail.resolvedAt ? formatTime(detail.resolvedAt) : '尚未解决' }}</dd></div>
        </dl>
      </section>

      <section class="recovery-section">
        <span class="recovery-index">恢复</span>
        <div><h2>建议下一步</h2><p>{{ detail.recoveryHint ?? '请联系管理员检查关联记录。' }}</p><small v-if="detail.recoveryAction">已记录动作：{{ detail.recoveryAction }}</small></div>
      </section>

      <section v-if="isAdmin && (detail.context || detail.stackTrace)" class="technical-section">
        <h2>管理员技术信息</h2>
        <pre v-if="detail.context">{{ JSON.stringify(detail.context, null, 2) }}</pre>
        <pre v-if="detail.stackTrace">{{ detail.stackTrace }}</pre>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageState from '../../components/PageState.vue'
import { useAuthStore } from '../../stores/auth'
import type { ExceptionCategory, ExceptionDetail, RecoveryStatus } from '@shared/types/foundation'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const isAdmin = computed(() => auth.role === 'ADMIN')
const basePath = computed(() => isAdmin.value ? '/admin' : '/teacher')
const loading = ref(true)
const errorKind = ref<'' | 'error' | 'forbidden' | 'empty'>('')
const detail = ref<ExceptionDetail | null>(null)
const isUnresolved = computed(() => detail.value ? ['UNRESOLVED', 'MANUAL_REVIEW_REQUIRED'].includes(detail.value.recoveryStatus) : false)

async function loadDetail(): Promise<void> {
  if (!auth.userId || !auth.role) { loading.value = false; errorKind.value = 'forbidden'; return }
  loading.value = true
  errorKind.value = ''
  try {
    const result = await window.api.foundation.getException({ callerUserId: auth.userId, callerRole: auth.role, errorEventId: String(route.params.errorEventId) })
    if (!result.success) { errorKind.value = result.errorCode === 'FORBIDDEN' ? 'forbidden' : result.errorCode === 'NOT_FOUND' ? 'empty' : 'error'; return }
    detail.value = result.exception
  } catch (error) {
    console.error('[ExceptionDetailView] load failed:', error)
    errorKind.value = 'error'
  } finally { loading.value = false }
}

function categoryLabel(category: ExceptionCategory): string { return ({ IPC: '进程通信', DB: '数据库', AOL: '事件日志', RECOVERY: '恢复', ASSET: '资源', FSM: '状态流转', SCORING: '评分', REPORT: '报告', AUTH: '账号权限', SYSTEM: '系统' })[category] }
function recoveryLabel(status: RecoveryStatus): string { return ({ UNRESOLVED: '未解决', MANUAL_REVIEW_REQUIRED: '需人工复核', AUTO_RECOVERED: '已自动恢复', RESOLVED: '已解决', IGNORED: '无需处理' })[status] }
function formatTime(value: string): string { const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }) }

onMounted(() => { void loadDetail() })
</script>

<style scoped>
.detail-page { display: grid; gap: 18px; max-width: 920px; margin: 0 auto; }
.back-link { width: max-content; color: var(--color-accent-dark); font-size: 13px; text-decoration: none; }
.detail-header { display: grid; grid-template-columns: 58px minmax(0, 1fr) auto; align-items: start; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--color-border); }
.priority-badge { display: grid; place-items: center; width: 54px; height: 42px; border-radius: var(--radius-sm); background: var(--color-surface-muted); font-size: 14px; font-weight: 850; }
.priority-P0 { background: var(--color-danger-soft); color: var(--color-danger); }
.priority-P1 { background: var(--color-warning-soft); color: var(--color-warning); }
.detail-header p { margin: 0; color: var(--color-text-faint); font-family: ui-monospace, monospace; font-size: 11px; }
h1 { margin: 2px 0 4px; font-size: clamp(24px, 3vw, 32px); line-height: 1.25; }
.detail-header div > span { color: var(--color-text-muted); font-size: 12px; }
.status-badge { padding: 6px 10px; border-radius: var(--radius-pill); background: var(--color-success-soft); color: var(--color-success); font-size: 11px; white-space: nowrap; }
.status-badge.unresolved { background: var(--color-danger-soft); color: var(--color-danger); }
.detail-section, .technical-section { padding: 20px; border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-surface); }
h2 { margin: 0 0 8px; font-size: 17px; }
.detail-section > p { margin: 0 0 16px; color: var(--color-text-muted); line-height: 1.75; text-wrap: pretty; }
dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; }
dl div { padding: 11px; border-radius: var(--radius-sm); background: var(--color-surface-muted); }
dt { color: var(--color-text-faint); font-size: 11px; }
dd { margin: 3px 0 0; overflow-wrap: anywhere; font-size: 13px; }
.mono { font-family: ui-monospace, monospace; }
.recovery-section { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 16px; padding: 20px; border-radius: var(--radius-lg); background: var(--color-ink); color: white; }
.recovery-index { color: var(--color-accent-soft); font-size: 12px; font-weight: 800; }
.recovery-section p { margin: 0; color: var(--color-sidebar-text); line-height: 1.75; }
.recovery-section small { display: block; margin-top: 8px; color: var(--color-sidebar-muted); }
pre { max-height: 280px; margin: 10px 0 0; padding: 14px; overflow: auto; border-radius: var(--radius-sm); background: var(--color-ink); color: var(--color-sidebar-text); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 620px) {
  .detail-header { grid-template-columns: 54px minmax(0, 1fr); }
  .status-badge { grid-column: 2; justify-self: start; }
  dl { grid-template-columns: 1fr; }
  .recovery-section { grid-template-columns: 1fr; }
}
</style>
