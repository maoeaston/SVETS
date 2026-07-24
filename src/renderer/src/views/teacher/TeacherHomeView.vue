<template>
  <div class="overview-page">
    <header class="overview-header">
      <div>
        <p class="eyebrow">今天从待处理事项开始</p>
        <h1>教师工作概览</h1>
        <p>查看学生当前进度，先处理安全阻断和中断任务。</p>
      </div>
      <button class="refresh-button" type="button" :disabled="loading" @click="loadOverview">刷新状态</button>
    </header>

    <PageState
      v-if="loading"
      kind="loading"
      title="正在汇总教学状态"
      description="学生、测评、训练和安全记录正在从主进程同步。"
    />
    <PageState
      v-else-if="errorKind"
      :kind="errorKind"
      :title="errorKind === 'forbidden' ? '当前账号不能查看教师工作台' : '教学状态没有加载成功'"
      :description="errorKind === 'forbidden' ? '请返回与你的角色对应的首页。' : '没有写入任何数据，可以原地重试。'"
      action-label="重新加载"
      @action="loadOverview"
    />

    <template v-else-if="overview">
      <PageState
        v-if="overview.pendingSafetyCount > 0"
        kind="blocked"
        compact
        title="有安全事件等待处理"
        :description="`${overview.pendingSafetyCount} 条事件仍在阻断相关学生的新会话，请先补录或确认事实。`"
        action-label="查看安全事件"
        @action="router.push('/teacher/safety')"
      />

      <section class="status-ribbon" aria-label="当前教学数量">
        <div><strong>{{ overview.activeStudentCount }}</strong><span>在册学生</span></div>
        <div><strong>{{ overview.openAssessmentCount }}</strong><span>开放测评</span></div>
        <div><strong>{{ overview.openTrainingCount }}</strong><span>开放训练</span></div>
        <div><strong>{{ overview.unresolvedExceptionCount }}</strong><span>待看异常</span></div>
      </section>

      <section class="work-panel">
        <header>
          <h2>工作入口</h2>
          <span>按责任顺序排列</span>
        </header>
        <WorkspaceEntry index="01" title="学生档案" description="查看感官信息、建档与归档状态" :count="overview.activeStudentCount" to="/teacher/students" />
        <WorkspaceEntry index="02" title="测评任务" description="继续坐次、处理暂停并进入线下评分" :count="overview.openAssessmentCount" to="/teacher/assessments" />
        <WorkspaceEntry index="03" title="训练任务" description="查看四步训练进度和重试记录" :count="overview.openTrainingCount" to="/teacher/trainings" />
        <WorkspaceEntry index="04" title="安全事件" description="补录现场事实并提交管理员复盘" :count="overview.pendingSafetyCount" to="/teacher/safety" :urgent="overview.pendingSafetyCount > 0" />
        <WorkspaceEntry index="05" title="任务报告" description="F7 将开放报告列表、锁定与导出" :count="overview.reportCount" disabled />
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
  if (!auth.userId || !auth.role) {
    loading.value = false
    errorKind.value = 'forbidden'
    return
  }
  loading.value = true
  errorKind.value = ''
  try {
    const result = await window.api.foundation.getOverview({ callerUserId: auth.userId, callerRole: auth.role })
    if (!result.success) {
      errorKind.value = result.errorCode === 'FORBIDDEN' ? 'forbidden' : 'error'
      return
    }
    overview.value = result.overview
  } catch (error) {
    console.error('[TeacherHomeView] overview failed:', error)
    errorKind.value = 'error'
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadOverview() })
</script>

<style scoped>
.overview-page { display: grid; gap: 20px; max-width: 980px; margin: 0 auto; }
.overview-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.eyebrow { margin: 0 0 4px; color: var(--color-accent-dark); font-size: 12px; font-weight: 800; }
h1 { margin: 0; color: var(--color-text); font-size: clamp(25px, 3vw, 34px); line-height: 1.2; text-wrap: balance; }
.overview-header p:last-child { margin: 7px 0 0; color: var(--color-text-muted); font-size: 14px; }
.refresh-button { min-height: 40px; padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); cursor: pointer; }
.refresh-button:active { transform: scale(.96); }
.status-ribbon { display: grid; grid-template-columns: repeat(4, 1fr); overflow: hidden; border-radius: var(--radius-lg); background: var(--color-ink); color: white; box-shadow: var(--shadow-surface); }
.status-ribbon div { display: grid; gap: 2px; padding: 18px 20px; border-right: 1px solid oklch(1 0 0 / .1); }
.status-ribbon div:last-child { border-right: 0; }
.status-ribbon strong { font-size: 26px; font-variant-numeric: tabular-nums; }
.status-ribbon span { color: var(--color-sidebar-muted); font-size: 12px; }
.work-panel { overflow: hidden; border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-surface); }
.work-panel > header { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding: 18px 16px 12px; }
.work-panel h2 { margin: 0; font-size: 17px; }
.work-panel header span { color: var(--color-text-muted); font-size: 11px; }
@media (max-width: 680px) {
  .overview-header { align-items: flex-start; flex-direction: column; gap: 12px; }
  .status-ribbon { grid-template-columns: repeat(2, 1fr); }
  .status-ribbon div:nth-child(2) { border-right: 0; }
  .status-ribbon div:nth-child(-n + 2) { border-bottom: 1px solid oklch(1 0 0 / .1); }
}
</style>
