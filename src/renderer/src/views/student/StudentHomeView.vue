<template>
  <div class="student-home">
    <header class="student-header">
      <div>
        <p>今天的任务</p>
        <h1>{{ auth.displayName ?? '同学' }}，从这里继续</h1>
      </div>
      <button type="button" class="refresh-button" :disabled="loading" @click="loadTasks">刷新</button>
    </header>

    <PageState v-if="loading" kind="loading" title="正在准备你的任务" description="请稍等，已经完成的记录不会丢失。" />
    <PageState
      v-else-if="errorKind"
      :kind="errorKind"
      :title="errorKind === 'forbidden' ? '这个账号不能查看学生任务' : '任务没有加载成功'"
      description="没有提交或修改任何内容，可以再试一次。"
      action-label="再试一次"
      @action="loadTasks"
    />
    <PageState
      v-else-if="assessmentItems.length === 0 && trainingItems.length === 0"
      kind="empty"
      title="现在没有新任务"
      description="老师分配后，测评或训练会显示在这里。"
      action-label="刷新任务"
      @action="loadTasks"
    />

    <template v-else>
      <section v-if="assessmentItems.length > 0" class="task-section">
        <header><span class="section-no">01</span><div><h2>测评任务</h2><p>一次完成一小步，需要暂停时可以告诉老师。</p></div></header>
        <article v-for="item in assessmentItems" :key="item.sessionId" class="task-row">
          <div class="task-state" :class="statusTone(item.status)">{{ assessmentStatus(item.status) }}</div>
          <div class="task-main">
            <strong>拆箱与上架测评</strong>
            <span>已完成 {{ item.onlineCompletedCount }} / {{ item.onlineQuestionCount }} 题</span>
          </div>
          <button
            v-if="item.deliveryPhase === 'ASSIGNED' && item.assignmentId"
            type="button"
            class="task-action"
            :disabled="actingId === item.sessionId"
            @click="confirmAndStart(item.assignmentId, item.sessionId)"
          >{{ actingId === item.sessionId ? '正在开始' : '确认并开始' }}</button>
          <button v-else-if="item.status === 'ACTIVE'" type="button" class="task-action" @click="router.push(`/student/assessment/${item.sessionId}`)">继续测评</button>
          <span v-else class="task-guidance">{{ assessmentGuidance(item) }}</span>
        </article>
      </section>

      <section v-if="trainingItems.length > 0" class="task-section">
        <header><span class="section-no">02</span><div><h2>训练任务</h2><p>按“看、学、练、做”的顺序完成，可以重试。</p></div></header>
        <article v-for="item in trainingItems" :key="item.trainingSessionId" class="task-row">
          <div class="task-state" :class="trainingTone(item.status)">{{ trainingStatus(item.status) }}</div>
          <div class="task-main">
            <strong>{{ moduleLabel(item.moduleType) }}训练</strong>
            <span>已完成 {{ item.completedStepCount }} / {{ item.totalStepCount }} 步</span>
          </div>
          <button v-if="item.status === 'INIT' || item.status === 'ACTIVE'" type="button" class="task-action" @click="router.push(`/student/training/${item.trainingSessionId}`)">{{ item.status === 'INIT' ? '开始训练' : '继续训练' }}</button>
          <span v-else class="task-guidance">{{ item.status === 'COMPLETED' ? '已经完成' : '请等待老师处理' }}</span>
        </article>
      </section>
    </template>

    <PageState v-if="actionError" kind="error" compact title="没有开始成功" :description="actionError" action-label="关闭提示" @action="actionError = ''" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import PageState from '../../components/PageState.vue'
import { useAssessmentStore } from '../../stores/assessment'
import { useAuthStore } from '../../stores/auth'
import type { SessionListItem, SessionStatus } from '@shared/types/assessment'
import type { TrainingSessionListItem, TrainingSessionStatus } from '@shared/types/training'

const auth = useAuthStore()
const assessmentStore = useAssessmentStore()
const router = useRouter()
const loading = ref(true)
const errorKind = ref<'' | 'error' | 'forbidden'>('')
const actionError = ref('')
const actingId = ref<string | null>(null)
const trainingItems = ref<TrainingSessionListItem[]>([])
const assessmentItems = computed<SessionListItem[]>(() => assessmentStore.sessionList)

async function loadTasks(): Promise<void> {
  if (!auth.userId || !auth.role) { loading.value = false; errorKind.value = 'forbidden'; return }
  loading.value = true
  errorKind.value = ''
  try {
    const [assessmentResult, trainingResult] = await Promise.all([
      assessmentStore.loadMySessions(auth.userId, auth.role),
      window.api.training.listMySessions({ callerUserId: auth.userId, callerRole: auth.role })
    ])
    if (!assessmentResult.ok || !trainingResult.success) {
      const code = !assessmentResult.ok ? assessmentResult.errorCode : trainingResult.success ? '' : trainingResult.errorCode
      errorKind.value = code === 'FORBIDDEN' ? 'forbidden' : 'error'
      return
    }
    trainingItems.value = trainingResult.sessions
  } catch (error) {
    console.error('[StudentHomeView] tasks failed:', error)
    errorKind.value = 'error'
  } finally { loading.value = false }
}

async function confirmAndStart(assignmentId: string, sessionId: string): Promise<void> {
  if (!auth.userId || !auth.role) return
  actingId.value = sessionId
  actionError.value = ''
  const result = await assessmentStore.confirmAndStartAssignment(auth.userId, auth.role, assignmentId)
  actingId.value = null
  if (!result.ok) { actionError.value = assessmentStore.mapAssignmentError(result.errorCode); return }
  await router.push(`/student/assessment/${result.sessionId}`)
}

function assessmentStatus(status: SessionStatus): string {
  return ({ INIT: '待开始', ACTIVE: '进行中', EMOTION_INTERRUPTED: '暂停中', SUSPENDED_REVIEW_REQUIRED: '待老师处理', OFFLINE_PENDING: '待线下完成', COMPLETED: '已完成', REDLINE_HALTED: '已安全停止', ABORTED: '已结束' })[status]
}
function assessmentGuidance(item: SessionListItem): string {
  if (item.status === 'EMOTION_INTERRUPTED' || item.status === 'SUSPENDED_REVIEW_REQUIRED') return '请等待老师恢复'
  if (item.status === 'OFFLINE_PENDING') return '线上部分已完成'
  if (item.status === 'INIT') return '等待老师分配'
  return item.status === 'COMPLETED' ? '已经完成' : '请联系老师'
}
function statusTone(status: SessionStatus): string { return status === 'ACTIVE' ? 'positive' : status === 'REDLINE_HALTED' ? 'halted' : 'waiting' }
function trainingStatus(status: TrainingSessionStatus): string { return ({ INIT: '待开始', ACTIVE: '进行中', EMOTION_INTERRUPTED: '暂停中', SUSPENDED_REVIEW_REQUIRED: '待老师处理', COMPLETED: '已完成', REDLINE_HALTED: '已安全停止', ABORTED: '已结束' })[status] }
function trainingTone(status: TrainingSessionStatus): string { return status === 'ACTIVE' ? 'positive' : status === 'REDLINE_HALTED' ? 'halted' : 'waiting' }
function moduleLabel(moduleType: string | null): string { return ({ FINE_MOTOR: '精细动作', COGNITION: '认知理解', RULE_EXECUTION: '规则执行', EMOTION_REGULATION: '情绪调节', BASIC_SOCIAL: '基础社交', SAFETY_OPERATION: '安全操作' } as Record<string, string>)[moduleType ?? ''] ?? '拆箱与上架' }

onMounted(() => { void loadTasks() })
</script>

<style scoped>
.student-home { display: grid; gap: 22px; max-width: 900px; margin: 0 auto; }
.student-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
.student-header p { margin: 0 0 3px; color: var(--color-accent-dark); font-size: 13px; font-weight: 800; }
h1 { margin: 0; font-size: clamp(25px, 4vw, 36px); line-height: 1.25; text-wrap: balance; }
.refresh-button { min-height: 44px; padding: 8px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); cursor: pointer; }
.task-section { overflow: hidden; border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-surface); }
.task-section > header { display: flex; gap: 14px; padding: 18px 18px 14px; background: var(--color-surface-muted); }
.section-no { color: var(--color-accent-dark); font-size: 12px; font-variant-numeric: tabular-nums; }
.task-section h2 { margin: 0; font-size: 18px; }
.task-section header p { margin: 3px 0 0; color: var(--color-text-muted); font-size: 12px; }
.task-row { display: grid; grid-template-columns: 86px minmax(0, 1fr) auto; align-items: center; gap: 16px; min-height: 86px; padding: 14px 18px; border-bottom: 1px solid var(--color-border-subtle); }
.task-row:last-child { border-bottom: 0; }
.task-state { padding: 6px 10px; border-radius: var(--radius-pill); background: var(--color-surface-muted); color: var(--color-text-muted); text-align: center; font-size: 12px; font-weight: 750; white-space: nowrap; }
.task-state.positive { background: var(--color-success-soft); color: var(--color-success); }
.task-state.halted { background: var(--color-danger-soft); color: var(--color-danger); }
.task-main { display: grid; gap: 4px; min-width: 0; }
.task-main strong { font-size: 16px; }
.task-main span, .task-guidance { color: var(--color-text-muted); font-size: 13px; }
.task-action { min-height: 44px; padding: 9px 18px; border: 0; border-radius: var(--radius-sm); background: var(--color-accent); color: var(--color-accent-ink); font-size: 14px; font-weight: 800; cursor: pointer; transition-property: transform, opacity; transition-duration: 140ms; }
.task-action:active { transform: scale(.96); }
.task-action:disabled { opacity: .55; cursor: wait; }
@media (max-width: 640px) {
  .student-header { align-items: flex-start; }
  .task-row { grid-template-columns: 1fr; gap: 10px; }
  .task-state { justify-self: start; }
  .task-action { justify-self: start; }
}
</style>
