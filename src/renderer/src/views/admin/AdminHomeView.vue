<template>
  <div class="overview-page">
    <header class="overview-header">
      <div>
        <p class="eyebrow">系统维护与责任复盘</p>
        <h1>管理员维护概览</h1>
        <p>优先处理安全解除和阻断异常，再检查账号、策略与本地恢复状态。</p>
      </div>
      <button type="button" class="refresh-button" :disabled="loading" @click="loadOverview">刷新状态</button>
    </header>

    <PageState v-if="loading" kind="loading" title="正在读取系统状态" description="只读检查账号、策略、资源登记和恢复投影。" />
    <PageState
      v-else-if="errorKind"
      :kind="errorKind"
      :title="errorKind === 'forbidden' ? '当前账号不是管理员' : '系统状态没有加载成功'"
      description="没有执行任何维护动作，可以原地重试。"
      action-label="重新加载"
      @action="loadOverview"
    />

    <template v-else-if="overview">
      <PageState
        v-if="overview.pendingSafetyCount > 0"
        kind="blocked"
        compact
        title="有安全阻断等待管理员复盘"
        :description="`${overview.pendingSafetyCount} 条事件尚未进入终态，相关学生和任务不能发起新会话。`"
        action-label="进入安全复盘"
        @action="router.push('/admin/safety')"
      />

      <section class="maintenance-strip" aria-label="系统维护数量">
        <div><strong>{{ overview.unresolvedExceptionCount }}</strong><span>未解决异常</span></div>
        <div><strong>{{ overview.assetIssueCount }}</strong><span>损坏或缺失资源</span></div>
        <div><strong>{{ overview.unverifiedAssetCount }}</strong><span>未登记校验时间</span></div>
      </section>

      <section class="work-panel">
        <header><h2>维护入口</h2><span>所有写操作仍受主进程状态机保护</span></header>
        <WorkspaceEntry index="01" title="账号管理" description="创建、停用或重新启用教师账号" :count="overview.teacherAccountCount" to="/admin/accounts" />
        <WorkspaceEntry index="02" title="策略配置" description="查看版本并维护未被冻结的策略" :count="overview.activeStrategyCount" to="/admin/strategies" />
        <WorkspaceEntry index="03" title="安全复盘" description="解决或按明确原因作废安全事件" :count="overview.pendingSafetyCount" to="/admin/safety" :urgent="overview.pendingSafetyCount > 0" />
        <WorkspaceEntry index="04" title="异常中心" description="查看 P0-P3、阻断规则和恢复提示" :count="overview.unresolvedExceptionCount" to="/admin/exceptions" :urgent="overview.unresolvedExceptionCount > 0" />
        <WorkspaceEntry index="05" title="资源与恢复" description="查看资源登记问题、快照和恢复记录" :count="overview.assetIssueCount + overview.unverifiedAssetCount" to="/admin/readiness" />
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import PageState from '../../components/PageState.vue'
import WorkspaceEntry from '../../components/WorkspaceEntry.vue'
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
    console.error('[AdminHomeView] overview failed:', error)
    errorKind.value = 'error'
  } finally { loading.value = false }
}

onMounted(() => { void loadOverview() })
</script>

<style scoped>
.overview-page { display: grid; gap: 20px; max-width: 980px; margin: 0 auto; }
.overview-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.eyebrow { margin: 0 0 4px; color: var(--color-danger); font-size: 12px; font-weight: 800; }
h1 { margin: 0; font-size: clamp(25px, 3vw, 34px); line-height: 1.2; text-wrap: balance; }
.overview-header p:last-child { margin: 7px 0 0; color: var(--color-text-muted); font-size: 14px; }
.refresh-button { min-height: 40px; padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); cursor: pointer; }
.refresh-button:active { transform: scale(.96); }
.maintenance-strip { display: grid; grid-template-columns: repeat(3, 1fr); overflow: hidden; border-radius: var(--radius-lg); background: var(--color-ink); color: white; box-shadow: var(--shadow-surface); }
.maintenance-strip div { display: grid; gap: 2px; padding: 18px 20px; border-right: 1px solid oklch(1 0 0 / .1); }
.maintenance-strip div:last-child { border-right: 0; }
.maintenance-strip strong { font-size: 26px; font-variant-numeric: tabular-nums; }
.maintenance-strip span { color: var(--color-sidebar-muted); font-size: 12px; }
.work-panel { overflow: hidden; border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-surface); }
.work-panel > header { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding: 18px 16px 12px; }
.work-panel h2 { margin: 0; font-size: 17px; }
.work-panel header span { color: var(--color-text-muted); font-size: 11px; }
@media (max-width: 680px) {
  .overview-header { align-items: flex-start; flex-direction: column; gap: 12px; }
  .maintenance-strip { grid-template-columns: 1fr; }
  .maintenance-strip div { border-right: 0; border-bottom: 1px solid oklch(1 0 0 / .1); }
  .maintenance-strip div:last-child { border-bottom: 0; }
}
</style>
