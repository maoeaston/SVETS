<template>
  <div class="assessment-list">
    <header class="header">
      <h2 class="title">
        进行中的测评
      </h2>
      <div class="actions">
        <RouterLink
          to="/teacher/assessments/new"
          class="btn-primary"
        >
          发起测评
        </RouterLink>
      </div>
    </header>

    <PageState v-if="loading" kind="loading" title="正在读取测评任务" description="坐次、分配和安全状态正在同步。" />
    <PageState v-else-if="errorMsg" :kind="errorMsg.includes('权限') ? 'forbidden' : errorMsg.includes('阻断') ? 'blocked' : 'error'" title="测评列表没有加载成功" :description="errorMsg" action-label="重新加载" @action="fetchList" />
    <PageState v-else-if="items.length === 0" kind="empty" title="当前没有开放测评" description="可以发起测评，正式题库仍受独立激活门禁保护。" action-label="发起测评" @action="router.push('/teacher/assessments/new')" />

    <table
      v-if="!loading && !errorMsg && items.length > 0"
      class="table"
    >
      <thead>
        <tr>
          <th>学生</th>
          <th>策略</th>
          <th>状态</th>
          <th>进度</th>
          <th>开始时间</th>
          <th class="col-action">
            操作
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in items"
          :key="row.sessionId"
        >
          <td>{{ row.studentName }}</td>
          <td>
            <div>{{ formatType(row.strategyType) }}</div>
            <small class="muted">v{{ row.strategyVersion }} · {{ row.taskCode }}</small>
          </td>
          <td>
            <span :class="['tag', statusTagClass(row.status)]">
              {{ formatStatus(row.status) }}
            </span>
            <div
              v-if="row.redlineIncidentId"
              class="muted"
            >
              红线：{{ row.redlineIncidentId.slice(0, 8) }}
            </div>
          </td>
          <td>
            {{ row.onlineCompletedCount }} / {{ row.onlineQuestionCount }}
            <span
              v-if="row.pauseCount > 0"
              class="muted"
            >（中断 {{ row.pauseCount }} 次）</span>
          </td>
          <td>{{ formatTime(row.startedAt ?? row.createdAt) }}</td>
          <td class="col-action">
            <!-- M3 INIT + PREPARED：教师手动分配给学生 -->
            <button
              v-if="row.status === 'INIT' && row.deliveryPhase === 'PREPARED'"
              class="btn-inline btn-assign"
              :disabled="actingSessionId === row.sessionId"
              @click="handleAssign(row.businessSessionId, row.sessionId)"
            >
              分配给学生
            </button>
            <!-- M3 INIT + 已分配但学生未确认 -->
            <span
              v-else-if="row.status === 'INIT' && (row.deliveryPhase === 'ASSIGNED' || row.deliveryPhase === 'STUDENT_CONFIRMED')"
              class="muted"
            >
              {{ row.deliveryPhase === 'ASSIGNED' ? '待学生确认' : '待学生开始' }}
            </span>

            <!-- JOB_SKILL OFFLINE_PENDING：线下评分 + 观察录入 -->
            <template v-if="row.status === 'OFFLINE_PENDING' && row.strategyType === 'JOB_SKILL_ASSESSMENT'">
              <RouterLink
                :to="`/teacher/assessments/${row.sessionId}/job-skill-scoring`"
                class="btn-inline btn-scoring"
              >
                线下评分
              </RouterLink>
              <RouterLink
                :to="`/teacher/assessments/${row.sessionId}/observations`"
                class="btn-inline btn-obs"
              >
                观察录入
              </RouterLink>
            </template>
            <!-- BASE_ABILITY OFFLINE_PENDING：实操评分 -->
            <RouterLink
              v-else-if="row.status === 'OFFLINE_PENDING'"
              :to="`/teacher/assessments/${row.sessionId}/scoring`"
              class="btn-inline btn-scoring"
            >
              实操评分
            </RouterLink>

            <!-- EMOTION_INTERRUPTED 态：显示"恢复" -->
            <button
              v-if="row.status === 'EMOTION_INTERRUPTED'"
              class="btn-inline btn-resume"
              :disabled="actingSessionId === row.sessionId"
              @click="handleResume(row.sessionId)"
            >
              恢复
            </button>
            <button
              v-if="row.status === 'EMOTION_INTERRUPTED'"
              class="btn-inline btn-abort"
              :disabled="actingSessionId === row.sessionId"
              @click="handleEmotionCollapse(row.sessionId)"
            >
              结束本坐次
            </button>

            <button
              v-if="row.status === 'ACTIVE'"
              class="btn-inline btn-resume"
              :disabled="actingSessionId === row.sessionId"
              @click="handlePlannedPause(row.sessionId)"
            >
              暂停到下一坐次
            </button>
            <button
              v-if="row.status === 'SUSPENDED_REVIEW_REQUIRED'"
              class="btn-inline btn-resume"
              :disabled="actingSessionId === row.sessionId"
              @click="handleStartNextSitting(row.sessionId)"
            >
              开始下一坐次
            </button>

            <button
              class="btn-inline btn-redline"
              :disabled="actingSessionId === row.sessionId"
              @click="handleRedline(row.sessionId)"
            >
              立即安全停止
            </button>

            <!-- 终止 -->
            <button
              class="btn-inline btn-abort"
              :disabled="actingSessionId === row.sessionId"
              @click="handleAbort(row.sessionId, row.studentName)"
            >
              终止
            </button>
          </td>
        </tr>
      </tbody>
    </table>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { useAssessmentStore } from '../../stores/assessment'
import PageState from '../../components/PageState.vue'
import type { SessionListItem, SessionStatus, AssessmentErrorCode } from '@shared/types/assessment'

const auth = useAuthStore()
const store = useAssessmentStore()
const router = useRouter()

const loading = ref(false)
const errorMsg = ref('')
const actingSessionId = ref<string | null>(null)

const items = computed<SessionListItem[]>(() => store.sessionList)

async function fetchList(): Promise<void> {
  if (!auth.userId || !auth.role) {
    errorMsg.value = '未登录'
    return
  }
  loading.value = true
  errorMsg.value = ''
  const result = await store.loadTeacherSessions(auth.userId, auth.role)
  loading.value = false
  if (!result.ok) {
    errorMsg.value = store.mapError(result.errorCode as AssessmentErrorCode)
  }
}

function formatType(t: SessionListItem['strategyType']): string {
  return t === 'BASELINE_ASSESSMENT' ? '能力测评'
    : t === 'MOCK_EXAM' ? '模拟考试'
    : t === 'JOB_SKILL_ASSESSMENT' ? '专业岗位测评'
    : '未知'
}

function formatStatus(s: SessionStatus): string {
  const map: Record<SessionStatus, string> = {
    INIT: '待开始',
    ACTIVE: '答题中',
    EMOTION_INTERRUPTED: '情绪中断',
    SUSPENDED_REVIEW_REQUIRED: '待复核',
    OFFLINE_PENDING: '待线下评分',
    COMPLETED: '已完成',
    REDLINE_HALTED: '红线终止',
    ABORTED: '已终止'
  }
  return map[s] ?? s
}

function statusTagClass(s: SessionStatus): string {
  if (s === 'ACTIVE') return 'tag-active'
  if (s === 'EMOTION_INTERRUPTED') return 'tag-paused'
  if (s === 'REDLINE_HALTED') return 'tag-halted'
  if (s === 'OFFLINE_PENDING' || s === 'SUSPENDED_REVIEW_REQUIRED') return 'tag-pending'
  return 'tag-default'
}

function formatTime(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16)
}

async function handleAssign(businessSessionId: string, sessionId: string): Promise<void> {
  if (!auth.userId || !auth.role) return
  actingSessionId.value = sessionId
  const result = await store.createAssignment(auth.userId, auth.role, businessSessionId)
  actingSessionId.value = null
  if (!result.ok) {
    errorMsg.value = store.mapAssignmentError(result.errorCode)
    return
  }
  await fetchList()
}

async function handleResume(sessionId: string): Promise<void> {
  if (!auth.userId || !auth.role) return
  actingSessionId.value = sessionId
  const result = await store.emotionResume({
    callerUserId: auth.userId,
    callerRole: auth.role,
    sessionId
  })
  actingSessionId.value = null
  if (!result.ok) {
    errorMsg.value = store.mapError(result.errorCode)
    return
  }
  await fetchList()
}

async function handleEmotionCollapse(sessionId: string): Promise<void> {
  if (!auth.userId || !auth.role) return
  if (!window.confirm('确认学生无法在本坐次恢复？这只结束本坐次，不会直接作废整个测评。')) return
  actingSessionId.value = sessionId
  const result = await window.api.assessment.recordEmotionCollapse({
    callerUserId: auth.userId, callerRole: auth.role, sessionId
  })
  actingSessionId.value = null
  if (!result.success) {
    errorMsg.value = store.mapError(result.errorCode)
    return
  }
  await fetchList()
}

async function handlePlannedPause(sessionId: string): Promise<void> {
  if (!auth.userId || !auth.role) return
  if (!window.confirm('确认按计划暂停本坐次？学生将在下一坐次从当前未提交题继续。')) return
  actingSessionId.value = sessionId
  const result = await store.pauseSitting({ callerUserId: auth.userId, callerRole: auth.role, sessionId })
  actingSessionId.value = null
  if (!result.ok) {
    errorMsg.value = store.mapError(result.errorCode)
    return
  }
  await fetchList()
}

async function handleStartNextSitting(sessionId: string): Promise<void> {
  if (!auth.userId || !auth.role) return
  actingSessionId.value = sessionId
  const result = await store.startNextSitting({ callerUserId: auth.userId, callerRole: auth.role, sessionId })
  actingSessionId.value = null
  if (!result.ok) {
    errorMsg.value = store.mapError(result.errorCode)
    return
  }
  await fetchList()
}

async function handleAbort(sessionId: string, studentName: string): Promise<void> {
  if (!auth.userId || !auth.role) return
  if (!window.confirm(`确认终止「${studentName}」的测评？终止后不可恢复。`)) return
  actingSessionId.value = sessionId
  const result = await store.abortSession({
    callerUserId: auth.userId,
    callerRole: auth.role,
    sessionId
  })
  actingSessionId.value = null
  if (!result.ok) {
    errorMsg.value = store.mapError(result.errorCode)
    return
  }
  await fetchList()
}

async function handleRedline(sessionId: string): Promise<void> {
  if (!auth.userId || !auth.role) return
  actingSessionId.value = sessionId
  const result = await store.triggerRedline({
    callerUserId: auth.userId,
    callerRole: auth.role,
    sessionId
  })
  actingSessionId.value = null
  if (!result.success) {
    errorMsg.value = store.mapError(result.errorCode)
    return
  }
  await router.push(`/teacher/safety/${result.incidentId}`)
}

onMounted(() => {
  void fetchList()
})
</script>

<style scoped>
.assessment-list {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  gap: 16px;
  flex-wrap: wrap;
}
.title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.table {
  width: 100%;
  border-collapse: collapse;
}
.table th,
.table td {
  padding: 12px 8px;
  text-align: left;
  font-size: 14px;
  color: #374151;
  border-bottom: 1px solid #e5e7eb;
  vertical-align: top;
}
.table th {
  font-weight: 600;
  background: #f9fafb;
  color: #6b7280;
}
.col-action {
  width: 280px;
}
.muted {
  color: #9ca3af;
  font-size: 12px;
  display: block;
  margin-top: 2px;
}
.tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
}
.tag-active {
  background: #dcfce7;
  color: #166534;
}
.tag-paused {
  background: #fef3c7;
  color: #92400e;
}
.tag-halted {
  background: #fee2e2;
  color: #991b1b;
}
.tag-pending {
  background: #ede9fe;
  color: #5b21b6;
}
.tag-default {
  background: #e5e7eb;
  color: #4b5563;
}
.loading,
.empty {
  text-align: center;
  color: #9ca3af;
  padding: 32px 0;
}
.error-msg {
  color: #dc2626;
  font-size: 14px;
  margin-bottom: 12px;
  padding: 10px 14px;
  background: #fef2f2;
  border-radius: 6px;
}
.btn-primary {
  padding: 8px 16px;
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  text-decoration: none;
}
.btn-primary:hover {
  background: #2563eb;
}
.btn-inline {
  padding: 4px 10px;
  margin-right: 4px;
  margin-bottom: 4px;
  background: #fff;
  border: 1px solid #d0d7de;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  color: #374151;
}
.btn-inline:hover:not(:disabled) {
  background: #f3f4f6;
}
.btn-inline:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-resume {
  color: #166534;
  border-color: #86efac;
}
.btn-scoring {
  color: #1d4ed8;
  border-color: #93c5fd;
  text-decoration: none;
}
.btn-obs {
  color: #166534;
  border-color: #86efac;
  text-decoration: none;
}
.btn-abort {
  color: #b45309;
  border-color: #fcd34d;
}
.btn-assign {
  color: #1d4ed8;
  border-color: #93c5fd;
}
.btn-redline {
  color: #dc2626;
  border-color: #fecaca;
}
.btn-redline-confirm {
  color: #fff;
  background: #dc2626;
  border-color: #dc2626;
}
.btn-redline-confirm:hover:not(:disabled) {
  background: #b91c1c;
}
.redline-select {
  padding: 4px 8px;
  border: 1px solid #d0d7de;
  border-radius: 4px;
  font-size: 12px;
  margin-right: 4px;
  margin-bottom: 4px;
  max-width: 120px;
}
</style>
