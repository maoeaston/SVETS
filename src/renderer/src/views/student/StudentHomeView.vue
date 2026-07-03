<template>
  <div class="student-home">
    <header class="header">
      <h2 class="title">
        我的测评
      </h2>
    </header>

    <p
      v-if="errorMsg"
      class="error-msg"
      role="alert"
    >
      {{ errorMsg }}
    </p>

    <div
      v-if="loading"
      class="loading"
    >
      加载中…
    </div>

    <div
      v-else-if="items.length === 0"
      class="empty"
    >
      暂无可继续的测评。请联系教师发起。
    </div>

    <div
      v-else
      class="session-cards"
    >
      <div
        v-for="row in items"
        :key="row.sessionId"
        class="session-card"
        :class="{ 'card-paused': row.status === 'EMOTION_INTERRUPTED' }"
      >
        <div class="card-header">
          <span :class="['tag', statusTagClass(row.status)]">{{ formatStatus(row.status) }}</span>
          <span class="muted">v{{ row.strategyVersion }}</span>
        </div>
        <div class="card-body">
          <div class="card-row">
            <span class="card-label">任务</span>
            <span>{{ formatTask(row.taskCode) }}</span>
          </div>
          <div class="card-row">
            <span class="card-label">进度</span>
            <span>{{ row.onlineCompletedCount }} / {{ row.onlineQuestionCount }}</span>
          </div>
          <div
            v-if="row.pauseCount > 0"
            class="card-row"
          >
            <span class="card-label">中断次数</span>
            <span>{{ row.pauseCount }}</span>
          </div>
        </div>
        <div class="card-actions">
          <button
            v-if="canContinue(row.status)"
            class="btn-primary"
            @click="goContinue(row.sessionId)"
          >
            {{ row.status === 'EMOTION_INTERRUPTED' ? '等待教师恢复' : '继续答题' }}
          </button>
          <span
            v-else
            class="muted"
          >当前状态不可继续</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { useAssessmentStore } from '../../stores/assessment'
import type { SessionListItem, SessionStatus } from '@shared/types/assessment'

const router = useRouter()
const auth = useAuthStore()
const store = useAssessmentStore()

const loading = ref(false)
const errorMsg = ref('')

const items = computed<SessionListItem[]>(() => store.sessionList)

async function fetchList(): Promise<void> {
  if (!auth.userId || !auth.role) {
    errorMsg.value = '未登录'
    return
  }
  loading.value = true
  errorMsg.value = ''
  const result = await store.loadMySessions(auth.userId, auth.role)
  loading.value = false
  if (!result.ok) {
    errorMsg.value = store.mapError(result.errorCode)
  }
}

function canContinue(status: SessionStatus): boolean {
  // 仅 ACTIVE 可继续；EMOTION_INTERRUPTED 显示按钮但点击会跳转到答题页（学生端会看到"暂停中"提示）
  return status === 'ACTIVE' || status === 'EMOTION_INTERRUPTED'
}

function goContinue(sessionId: string): void {
  void router.push(`/student/assessment/${sessionId}`)
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
  return 'tag-default'
}

function formatTask(t: string): string {
  return t === 'UNBOXING_AND_SHELVING' ? '拆箱与上架' : t
}

onMounted(() => {
  void fetchList()
})
</script>

<style scoped>
.student-home {
  max-width: 820px;
  margin: 0 auto;
}
.header {
  margin-bottom: 20px;
}
.title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}
.loading,
.empty {
  text-align: center;
  color: #9ca3af;
  padding: 48px 0;
  background: #fff;
  border-radius: 8px;
}
.error-msg {
  color: #dc2626;
  font-size: 14px;
  margin-bottom: 16px;
  padding: 10px 14px;
  background: #fef2f2;
  border-radius: 6px;
}
.session-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.session-card {
  background: #fff;
  border-radius: 8px;
  padding: 16px 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  border-left: 4px solid #3b82f6;
}
.card-paused {
  border-left-color: #d97706;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
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
.tag-default {
  background: #e5e7eb;
  color: #4b5563;
}
.muted {
  color: #9ca3af;
  font-size: 12px;
}
.card-body {
  margin-bottom: 12px;
}
.card-row {
  display: flex;
  gap: 12px;
  font-size: 14px;
  color: #374151;
  margin-bottom: 4px;
}
.card-label {
  flex: 0 0 80px;
  color: #6b7280;
  font-size: 13px;
}
.card-actions {
  display: flex;
  justify-content: flex-end;
}
.btn-primary {
  padding: 8px 20px;
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}
.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}
</style>
