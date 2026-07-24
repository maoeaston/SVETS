<template>
  <div class="training-page">
    <header class="page-header"><div><p class="eyebrow">四步训练</p><h1>训练任务</h1><p>查看完成比例、跳过、失败与重试后的当前状态。</p></div><RouterLink to="/teacher/trainings/create" class="primary-link">新建训练</RouterLink></header>

    <section class="filter-bar">
      <label>学生编号<input v-model.trim="filterStudentId" placeholder="留空查看全部"></label>
      <label>状态<select v-model="filterStatus"><option value="">全部状态</option><option value="INIT">待开始</option><option value="ACTIVE">进行中</option><option value="EMOTION_INTERRUPTED">情绪中断</option><option value="SUSPENDED_REVIEW_REQUIRED">待复核</option><option value="COMPLETED">已完成</option><option value="REDLINE_HALTED">安全停止</option><option value="ABORTED">已终止</option></select></label>
      <button type="button" @click="load">查询</button>
    </section>

    <PageState v-if="loading" kind="loading" title="正在读取训练任务" description="步骤状态和完成比例正在同步。" />
    <PageState v-else-if="error" :kind="error.includes('权限') ? 'forbidden' : 'error'" title="训练任务没有加载成功" :description="error" action-label="重新加载" @action="load" />
    <PageState v-else-if="sessions.length === 0" kind="empty" title="当前没有训练记录" description="可以新建训练，或调整学生和状态筛选。" action-label="新建训练" @action="$router.push('/teacher/trainings/create')" />

    <section v-else class="training-list" aria-label="训练任务列表">
      <article v-for="session in sessions" :key="session.trainingSessionId" class="training-row">
        <span :class="['status-badge', `status-${session.status}`]">{{ statusLabel(session.status) }}</span>
        <div class="training-copy"><strong>{{ moduleLabel(session.moduleType) }}</strong><small>学生 {{ session.studentId }}</small><em>{{ formatTime(session.startedAt) }}</em></div>
        <div class="progress"><strong>{{ session.completionRate != null ? `${session.completionRate.toFixed(0)}%` : '未开始' }}</strong><span>{{ session.completedStepCount }} / {{ session.totalStepCount }} 步</span></div>
      </article>
      <footer>共 {{ total }} 条</footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PageState from '../../components/PageState.vue'
import { useAuthStore } from '../../stores/auth'
import type { TrainingSessionListItem, TrainingSessionStatus } from '@shared/types/training'

const auth = useAuthStore()
const sessions = ref<TrainingSessionListItem[]>([])
const total = ref(0)
const loading = ref(true)
const error = ref('')
const filterStudentId = ref('')
const filterStatus = ref<TrainingSessionStatus | ''>('')

async function load(): Promise<void> {
  if (!auth.userId || !auth.role) { loading.value = false; error.value = '无权限，请重新登录。'; return }
  loading.value = true
  error.value = ''
  try {
    const result = await window.api.training.listSessions({ callerUserId: auth.userId, callerRole: auth.role, studentId: filterStudentId.value || undefined, status: filterStatus.value || undefined, limit: 50, offset: 0 })
    if (!result.success) { error.value = result.errorCode === 'FORBIDDEN' ? '当前账号无权限查看训练任务。' : '训练任务没有加载成功，请重试。'; return }
    sessions.value = result.sessions
    total.value = result.total
  } catch (cause) {
    console.error('[TrainingListView] load failed:', cause)
    error.value = '训练任务没有加载成功，请重试。'
  } finally { loading.value = false }
}

function statusLabel(status: TrainingSessionStatus): string { return ({ INIT: '待开始', ACTIVE: '进行中', EMOTION_INTERRUPTED: '情绪中断', SUSPENDED_REVIEW_REQUIRED: '待复核', COMPLETED: '已完成', REDLINE_HALTED: '安全停止', ABORTED: '已终止' })[status] }
function moduleLabel(value: string | null): string { return ({ FINE_MOTOR: '精细动作', COGNITION: '认知理解', RULE_EXECUTION: '规则执行', EMOTION_REGULATION: '情绪调节', BASIC_SOCIAL: '基础社交', SAFETY_OPERATION: '安全操作' } as Record<string, string>)[value ?? ''] ?? '拆箱与上架训练' }
function formatTime(value: string | null): string { if (!value) return '尚未开始'; const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }) }

onMounted(() => { void load() })
</script>

<style scoped>
.training-page { display: grid; gap: 18px; max-width: 1040px; margin: 0 auto; }
.page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 22px; }
.eyebrow { margin: 0 0 3px; color: var(--color-accent-dark); font-size: 12px; font-weight: 800; }
h1 { margin: 0; font-size: clamp(25px, 3vw, 34px); line-height: 1.2; }
.page-header p:last-child { margin: 6px 0 0; color: var(--color-text-muted); font-size: 13px; }
.primary-link { padding: 9px 15px; border-radius: var(--radius-sm); background: var(--color-accent); color: var(--color-accent-ink); font-size: 13px; font-weight: 800; text-decoration: none; }
.filter-bar { display: flex; align-items: end; gap: 12px; }
.filter-bar label { display: grid; gap: 4px; color: var(--color-text-muted); font-size: 11px; }
.filter-bar input, .filter-bar select { min-height: 40px; padding: 7px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); }
.filter-bar button { min-height: 40px; padding: 7px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); cursor: pointer; }
.training-list { overflow: hidden; border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-surface); }
.training-row { display: grid; grid-template-columns: 82px minmax(0, 1fr) auto; align-items: center; gap: 15px; min-height: 82px; padding: 13px 16px; border-bottom: 1px solid var(--color-border-subtle); }
.status-badge { padding: 6px 8px; border-radius: var(--radius-sm); background: var(--color-surface-muted); color: var(--color-text-muted); font-size: 12px; font-weight: 800; text-align: center; }
.status-ACTIVE { background: var(--color-success-soft); color: var(--color-success); }
.status-REDLINE_HALTED { background: var(--color-danger-soft); color: var(--color-danger); }
.training-copy { display: grid; gap: 2px; }
.training-copy strong { font-size: 15px; }
.training-copy small { color: var(--color-text-muted); overflow-wrap: anywhere; }
.training-copy em { color: var(--color-text-faint); font-size: 11px; font-style: normal; }
.progress { display: grid; justify-items: end; }
.progress strong { font-size: 18px; font-variant-numeric: tabular-nums; }
.progress span { color: var(--color-text-muted); font-size: 11px; }
.training-list footer { padding: 10px 16px; color: var(--color-text-faint); font-size: 11px; text-align: right; }
@media (max-width: 620px) {
  .page-header { align-items: flex-start; flex-direction: column; gap: 12px; }
  .filter-bar { align-items: stretch; flex-direction: column; }
  .training-row { grid-template-columns: 80px minmax(0, 1fr); }
  .progress { grid-column: 2; justify-items: start; }
}
</style>
