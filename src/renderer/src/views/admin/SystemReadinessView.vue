<template>
  <div class="readiness-page">
    <header class="page-header"><div><p class="eyebrow">只读维护状态</p><h1>资源与恢复</h1><p>这里展示已登记事实，不会执行资源校验、备份或恢复。</p></div><button type="button" class="refresh-button" :disabled="loading" @click="loadOverview">刷新状态</button></header>

    <PageState v-if="loading" kind="loading" title="正在读取本地维护状态" description="资源登记、快照和恢复异常正在同步。" />
    <PageState v-else-if="errorKind" :kind="errorKind" :title="errorKind === 'forbidden' ? '当前账号不能查看维护状态' : '维护状态没有加载成功'" description="没有执行任何校验或恢复动作，可以原地重试。" action-label="重新加载" @action="loadOverview" />

    <template v-else-if="overview">
      <PageState v-if="overview.assetIssueCount > 0" kind="blocked" compact title="存在缺失或损坏的资源登记" :description="`${overview.assetIssueCount} 项资源不能用于正式流程，请从异常中心核对记录。`" action-label="查看资源异常" @action="router.push('/admin/exceptions')" />

      <section class="readiness-ledger">
        <article><span>资源</span><div><strong>{{ overview.assetIssueCount }}</strong><h2>缺失或损坏</h2><p>{{ overview.unverifiedAssetCount }} 项尚未登记最后校验时间。这里只反映数据库登记状态，不代表已重新计算文件 hash。</p></div><RouterLink to="/admin/exceptions">查看异常记录 →</RouterLink></article>
        <article><span>快照</span><div><strong>{{ overview.snapshotCount }}</strong><h2>已登记快照</h2><p>{{ overview.lastSnapshotAt ? `最近登记于 ${formatTime(overview.lastSnapshotAt)}` : '当前没有快照登记。' }} F5 不执行真实备份或恢复。</p></div><RouterLink to="/admin/exceptions">查看恢复记录 →</RouterLink></article>
      </section>

      <section class="boundary-note"><h2>为什么没有“立即修复”按钮</h2><p>资源 hash 重算、备份和恢复都会访问运行文件。当前未获得写真实运行数据库或执行恢复的授权，因此本页只提供可信状态和异常入口，避免产生虚假的成功反馈。</p></section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import PageState from '../../components/PageState.vue'
import { useAuthStore } from '../../stores/auth'
import type { WorkspaceOverview } from '@shared/types/foundation'

const auth = useAuthStore()
const router = useRouter()
const loading = ref(true)
const errorKind = ref<'' | 'error' | 'forbidden'>('')
const overview = ref<WorkspaceOverview | null>(null)

async function loadOverview(): Promise<void> {
  if (!auth.userId || !auth.role) { loading.value = false; errorKind.value = 'forbidden'; return }
  loading.value = true
  errorKind.value = ''
  try {
    const result = await window.api.foundation.getOverview({ callerUserId: auth.userId, callerRole: auth.role })
    if (!result.success) { errorKind.value = result.errorCode === 'FORBIDDEN' ? 'forbidden' : 'error'; return }
    overview.value = result.overview
  } catch (error) {
    console.error('[SystemReadinessView] load failed:', error)
    errorKind.value = 'error'
  } finally { loading.value = false }
}

function formatTime(value: string): string { const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }) }

onMounted(() => { void loadOverview() })
</script>

<style scoped>
.readiness-page { display: grid; gap: 18px; max-width: 960px; margin: 0 auto; }
.page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 22px; }
.eyebrow { margin: 0 0 3px; color: var(--color-accent-dark); font-size: 12px; font-weight: 800; }
h1 { margin: 0; font-size: clamp(25px, 3vw, 34px); line-height: 1.2; }
.page-header p:last-child { margin: 6px 0 0; color: var(--color-text-muted); font-size: 13px; }
.refresh-button { min-height: 40px; padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); cursor: pointer; }
.readiness-ledger { overflow: hidden; border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-surface); }
.readiness-ledger article { display: grid; grid-template-columns: 70px minmax(0, 1fr) auto; gap: 16px; padding: 22px; border-bottom: 1px solid var(--color-border-subtle); }
.readiness-ledger article:last-child { border-bottom: 0; }
.readiness-ledger article > span { color: var(--color-text-faint); font-size: 12px; font-weight: 800; }
.readiness-ledger strong { float: left; margin-right: 12px; font-size: 30px; line-height: 1; font-variant-numeric: tabular-nums; }
.readiness-ledger h2 { margin: 0; font-size: 16px; }
.readiness-ledger p { clear: both; margin: 8px 0 0; color: var(--color-text-muted); font-size: 13px; line-height: 1.7; }
.readiness-ledger a { align-self: center; color: var(--color-accent-dark); font-size: 12px; text-decoration: none; white-space: nowrap; }
.boundary-note { padding: 18px 20px; border-radius: var(--radius-lg); background: var(--color-ink); color: white; }
.boundary-note h2 { margin: 0; font-size: 16px; }
.boundary-note p { margin: 6px 0 0; color: var(--color-sidebar-text); font-size: 13px; line-height: 1.75; }
@media (max-width: 640px) {
  .page-header { align-items: flex-start; flex-direction: column; gap: 12px; }
  .readiness-ledger article { grid-template-columns: 52px minmax(0, 1fr); }
  .readiness-ledger a { grid-column: 2; justify-self: start; }
}
</style>
