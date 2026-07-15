<template>
  <div class="assessment-view">
    <header class="header">
      <h2 class="title">
        测评答题
      </h2>
      <div
        v-if="session"
        class="progress-wrap"
      >
        <span class="progress-text">
          进度：{{ session.onlineCompletedCount }} / {{ session.onlineQuestionCount }}
        </span>
        <div class="progress-bar">
          <div
            class="progress-fill"
            :style="{ width: progressPercent + '%' }"
          />
        </div>
      </div>
    </header>

    <p
      v-if="store.errorMsg"
      class="error-msg"
      role="alert"
    >
      {{ store.errorMsg }}
    </p>

    <!-- 加载中 -->
    <p
      v-if="store.loading && !session"
      class="loading"
    >
      加载中…
    </p>

    <!-- 加载失败 / session 不存在 -->
    <p
      v-else-if="!session"
      class="empty"
    >
      测评不存在或加载失败
    </p>

    <!-- 已终止（红线） -->
    <div
      v-else-if="session.status === 'REDLINE_HALTED'"
      class="halted-state"
    >
      <p class="state-msg state-halted">
        ⚠ 测评已被安全红线终止
      </p>
      <p class="state-hint">
        请咨询教师了解详情
      </p>
    </div>

    <!-- 情绪中断中（教师未恢复） -->
    <div
      v-else-if="session.status === 'EMOTION_INTERRUPTED'"
      class="paused-state"
    >
      <p class="state-msg state-paused">
        已暂停 — 教师正赶来，请稍等
      </p>
    </div>

    <!-- 已结束（COMPLETED/ABORTED） -->
    <div
      v-else-if="session.status === 'COMPLETED' || session.status === 'ABORTED'"
      class="ended-state"
    >
      <p class="state-msg state-ended">
        测评已结束
      </p>
    </div>

    <!-- 线上题已完成，等待线下评分 -->
    <div
      v-else-if="session.status === 'OFFLINE_PENDING'"
      class="all-answered-state"
    >
      <p class="state-msg">
        已完成所有线上题目
      </p>
      <p class="state-hint">
        请等待教师安排线下评分
      </p>
    </div>

    <!-- M3 assignment gate：未分配或未确认时不得进入答题态 -->
    <div
      v-else-if="assignmentBlocked"
      class="assignment-blocked-state"
    >
      <p class="state-msg state-paused">
        {{ assignmentBlockedMessage }}
      </p>
      <p class="state-hint">
        请等待教师完成分配与确认
      </p>
    </div>

    <!-- 学生从未开始 → 显示"开始答题"按钮 -->
    <div
      v-else-if="session.status === 'ACTIVE' && !currentQuestion"
      class="start-state"
    >
      <p class="state-msg">
        点击下方按钮开始答题
      </p>
      <button
        class="btn-primary btn-large"
        :disabled="starting"
        @click="handleStart"
      >
        {{ starting ? '开始中…' : '开始答题' }}
      </button>
    </div>

    <!-- 所有 ONLINE 题已答完，等待教师评分/线下评分阶段 -->
    <div
      v-else-if="session.status === 'ACTIVE' && allOnlineAnswered"
      class="all-answered-state"
    >
      <p class="state-msg">
        已完成所有线上题目
      </p>
      <p class="state-hint">
        请等待教师安排线下评分
      </p>
    </div>

    <!-- 正常答题（ACTIVE + currentQuestion） -->
    <div
      v-else-if="session.status === 'ACTIVE' && currentQuestion"
      class="question-block"
    >
      <div class="question-meta">
        <span class="meta-item">第 {{ currentQuestion.questionOrder }} 题</span>
        <span class="meta-item">{{ formatModule(currentQuestion.moduleType) }}</span>
        <span class="meta-item">{{ formatPhase(currentQuestion.questionPhase) }}</span>
      </div>

      <!-- 题目主图（question_bank.media_asset_id，经 app:// 协议加载） -->
      <img
        v-if="currentQuestion.mediaAssetId"
        :src="'app://asset/' + currentQuestion.mediaAssetId"
        :alt="currentQuestion.mediaBrief ?? '题目主图'"
        class="question-image"
      >

      <p class="prompt">
        {{ currentQuestion.prompt }}
      </p>
      <p
        v-if="currentQuestion.assessmentPoint"
        class="assessment-point"
      >
        考点：{{ currentQuestion.assessmentPoint }}
      </p>

      <!-- TRUE_FALSE：是/否单选 -->
      <div
        v-if="currentQuestion.questionType === 'TRUE_FALSE'"
        class="answer-area"
      >
        <label class="choice">
          <input
            v-model="tfAnswer"
            type="radio"
            :value="true"
          >
          <span>是</span>
        </label>
        <label class="choice">
          <input
            v-model="tfAnswer"
            type="radio"
            :value="false"
          >
          <span>否</span>
        </label>
      </div>

      <!-- SINGLE_CHOICE：选项单选 -->
      <div
        v-else-if="currentQuestion.questionType === 'SINGLE_CHOICE'"
        class="answer-area"
      >
        <label
          v-for="opt in currentQuestion.options ?? []"
          :key="opt.key"
          class="choice"
        >
          <input
            v-model="scAnswer"
            type="radio"
            :value="opt.key"
          >
          <img
            v-if="opt.imageAssetId"
            :src="'app://asset/' + opt.imageAssetId"
            :alt="opt.text"
            class="option-image"
          >
          <span>{{ opt.key }}. {{ opt.text }}</span>
        </label>
      </div>

      <!-- DRAG：拖拽放置 UI -->
      <DragDropQuestion
        v-else
        v-model="dragMap"
        :drag-items="currentQuestion.dragItems ?? []"
        :drop-zones="currentQuestion.dropZones ?? []"
        :background-asset-id="currentQuestion.mediaAssetId"
        class="answer-area"
      />

      <div class="actions">
        <button
          class="btn-primary"
          :disabled="!canSubmit || submitting"
          @click="handleSubmit"
        >
          {{ submitting ? '提交中…' : '提交答案' }}
        </button>
        <button
          class="btn-secondary"
          :disabled="interrupting"
          @click="handleInterrupt"
        >
          我遇到困难了
        </button>
      </div>
    </div>

    <!-- 兜底：状态未识别 -->
    <p
      v-else
      class="empty"
    >
      测评状态异常（{{ session.status }}）
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import DragDropQuestion from '../../components/DragDropQuestion.vue'
import { useAuthStore } from '../../stores/auth'
import { useAssessmentStore } from '../../stores/assessment'
import type { AbilityTag } from '@shared/types/json-schemas'
import type { AnswerPayloadDetail } from '@shared/types/event-payloads'

const route = useRoute()
const auth = useAuthStore()
const store = useAssessmentStore()

const starting = ref(false)
const submitting = ref(false)
const interrupting = ref(false)

// 答题输入
const tfAnswer = ref<boolean | null>(null)
const scAnswer = ref<string>('')
const dragMap = ref<Record<string, string>>({})

const session = computed(() => store.currentSession)
const currentQuestion = computed(() => store.currentQuestion)

const assignmentBlocked = computed(() => {
  const phase = session.value?.deliveryPhase
  return phase === 'PREPARED' || phase === 'ASSIGNED' || phase === 'STUDENT_CONFIRMED'
})

const assignmentBlockedMessage = computed(() => {
  const phase = session.value?.deliveryPhase
  if (phase === 'PREPARED') return '需要教师分配后才能开始测评'
  return '需要完成学生确认后才能开始测评'
})

const progressPercent = computed(() => {
  if (!session.value || session.value.onlineQuestionCount === 0) return 0
  return Math.round(
    (session.value.onlineCompletedCount / session.value.onlineQuestionCount) * 100
  )
})

/** 所有 ONLINE 题已答完：reducer applyAnswerSubmitted 答完最后一题时 current_question_id
 *  保持指向最后一题、status 仍 ACTIVE（不自动转 OFFLINE_PENDING）。识别此态显示等待提示，
 *  避免学生看到已答题目、重新提交得到 ALREADY_ANSWERED 死循环。 */
const allOnlineAnswered = computed(() => {
  if (!session.value) return false
  return session.value.onlineCompletedCount >= session.value.onlineQuestionCount
})

const canSubmit = computed(() => {
  const q = currentQuestion.value
  if (!q) return false
  if (q.questionType === 'TRUE_FALSE') return tfAnswer.value !== null
  if (q.questionType === 'SINGLE_CHOICE') return scAnswer.value.length > 0
  if (q.questionType === 'DRAG') {
    const items = q.dragItems ?? []
    return items.every((i) => {
      const z = dragMap.value[i.itemId]
      return typeof z === 'string' && z.length > 0
    })
  }
  return false
})

function resetAnswerInputs(): void {
  tfAnswer.value = null
  scAnswer.value = ''
  dragMap.value = {}
}

async function loadCurrent(): Promise<void> {
  if (!auth.userId || !auth.role) return
  const sessionId = route.params.sessionId as string
  if (!sessionId) return
  await store.loadSession(auth.userId, auth.role, sessionId)
  // 切题后重置答题输入
  resetAnswerInputs()
}

async function handleStart(): Promise<void> {
  if (!auth.userId || !auth.role) return
  const sessionId = route.params.sessionId as string
  starting.value = true
  await store.startSession(auth.userId, auth.role, sessionId)
  starting.value = false
  resetAnswerInputs()
}

function buildPayload(): AnswerPayloadDetail | null {
  const q = currentQuestion.value
  if (!q) return null
  if (q.questionType === 'TRUE_FALSE') {
    if (tfAnswer.value === null) return null
    return { question_type: 'TRUE_FALSE', selected: tfAnswer.value }
  }
  if (q.questionType === 'SINGLE_CHOICE') {
    if (!scAnswer.value) return null
    return { question_type: 'SINGLE_CHOICE', selected: scAnswer.value }
  }
  // DRAG
  const items = q.dragItems ?? []
  const placements = items
    .map((i) => ({ item_id: i.itemId, zone_id: dragMap.value[i.itemId] ?? '' }))
    .filter((p) => p.zone_id.length > 0)
  if (placements.length !== items.length) return null
  return { question_type: 'DRAG', placements }
}

async function handleSubmit(): Promise<void> {
  if (!auth.userId || !auth.role) return
  const s = session.value
  const q = currentQuestion.value
  if (!s || !q) return
  const payload = buildPayload()
  if (!payload) return
  submitting.value = true
  const result = await store.submitAnswer(
    auth.userId,
    auth.role,
    s.sessionId,
    q.questionId,
    payload
  )
  submitting.value = false
  if (!result.ok) return
  // 提交成功后 store 已自动 loadSession，currentQuestion 已推进；重置输入
  resetAnswerInputs()
}

async function handleInterrupt(): Promise<void> {
  if (!auth.userId || !auth.role) return
  const s = session.value
  if (!s) return
  if (!window.confirm('确认要中断答题吗？教师会收到通知并赶来协助。')) return
  interrupting.value = true
  await store.emotionInterrupt(
    auth.userId,
    auth.role,
    s.sessionId,
    '学生主动触发',
    currentQuestion.value?.questionOrder ?? null
  )
  interrupting.value = false
}

function formatModule(m: AbilityTag): string {
  const map: Record<AbilityTag, string> = {
    FINE_MOTOR: '精细动作',
    COGNITION: '认知',
    RULE_EXECUTION: '规则执行',
    EMOTION_REGULATION: '情绪调节',
    BASIC_SOCIAL: '基础社交',
    SAFETY_OPERATION: '安全操作',
    OFFLINE_OPERATION: '线下实操'
  }
  return map[m] ?? m
}

function formatPhase(p: 'ONLINE' | 'OFFLINE'): string {
  return p === 'ONLINE' ? '线上' : '线下'
}

// 路由参数变化（同组件复用，如 /student/assessment/A → /student/assessment/B）
watch(
  () => route.params.sessionId,
  () => {
    void loadCurrent()
  }
)

onMounted(() => {
  void loadCurrent()
})
</script>

<style scoped>
.assessment-view {
  background: #fff;
  border-radius: 8px;
  padding: 24px 32px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  max-width: 820px;
  margin: 0 auto;
  min-height: 60vh;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e5e7eb;
  flex-wrap: wrap;
  gap: 12px;
}
.title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}
.progress-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.progress-text {
  font-size: 13px;
  color: #6b7280;
}
.progress-bar {
  width: 200px;
  height: 8px;
  background: #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: #3b82f6;
  transition: width 0.3s ease;
}
.loading,
.empty {
  text-align: center;
  color: #9ca3af;
  padding: 48px 0;
}
.error-msg {
  color: #dc2626;
  font-size: 14px;
  margin-bottom: 16px;
  padding: 10px 14px;
  background: #fef2f2;
  border-radius: 6px;
}
.start-state,
.halted-state,
.paused-state,
.ended-state {
  text-align: center;
  padding: 60px 0;
}
.state-msg {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 12px;
}
.state-halted {
  color: #dc2626;
}
.state-paused {
  color: #d97706;
}
.state-ended {
  color: #6b7280;
}
.state-hint {
  font-size: 14px;
  color: #6b7280;
}
.btn-large {
  margin-top: 24px;
  padding: 14px 36px;
  font-size: 16px;
}
.question-block {
  padding: 8px 0;
}
.question-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 12px;
}
.meta-item {
  background: #f3f4f6;
  padding: 4px 10px;
  border-radius: 4px;
}
.prompt {
  font-size: 16px;
  color: #1a1a1a;
  line-height: 1.6;
  margin-bottom: 12px;
  white-space: pre-wrap;
}
.assessment-point {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 20px;
  font-style: italic;
}
.question-image {
  display: block;
  max-width: 100%;
  max-height: 320px;
  height: auto;
  margin: 0 0 16px 0;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  object-fit: contain;
}
.option-image {
  width: 64px;
  height: 64px;
  object-fit: contain;
  border-radius: 4px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  flex-shrink: 0;
}
.answer-area {
  margin: 20px 0;
}
.choice {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #374151;
  transition: background 0.15s;
}
.choice:hover {
  background: #f9fafb;
}
.actions {
  display: flex;
  gap: 12px;
  margin-top: 28px;
}
.btn-primary {
  padding: 10px 24px;
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
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-secondary {
  padding: 10px 20px;
  background: #fff;
  color: #d97706;
  border: 1px solid #fcd34d;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}
.btn-secondary:hover:not(:disabled) {
  background: #fffbeb;
}
.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
