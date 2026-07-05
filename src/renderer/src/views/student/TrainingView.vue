<template>
  <div class="training-view">
    <div v-if="loading">加载中…</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <template v-else-if="session">
      <div class="session-header">
        <h2>训练任务</h2>
        <div class="session-meta">
          <span>模块：{{ session.moduleType ?? '-' }}</span>
          <span :class="['badge', `badge-${session.status.toLowerCase()}`]">{{ session.status }}</span>
          <span v-if="session.completionRate != null">
            完成率：{{ session.completionRate.toFixed(1) }}%
          </span>
        </div>
      </div>

      <div v-if="session.status === 'COMPLETED'" class="completion-banner">
        训练完成！完成率 {{ session.completionRate?.toFixed(1) }}%
      </div>
      <div v-if="session.status === 'REDLINE_HALTED'" class="halt-banner">
        训练已因安全事件终止
      </div>

      <div class="steps-list">
        <div
          v-for="step in session.steps"
          :key="step.stepRecordId"
          :class="['step-card', `step-${step.status.toLowerCase()}`]"
        >
          <div class="step-info">
            <span class="step-order">步骤 {{ step.stepOrder }}</span>
            <span class="step-name">{{ step.stepName }}</span>
            <span class="step-type">{{ step.stepType }}</span>
            <span :class="['badge', `badge-step-${step.status.toLowerCase()}`]">{{ step.status }}</span>
            <span v-if="step.attemptCount > 0" class="attempt-count">尝试 {{ step.attemptCount }} 次</span>
          </div>

          <div class="step-content">
            <p style="color:#888">（步骤内容占位：{{ step.stepName }}）</p>
          </div>

          <div class="step-actions" v-if="isSessionOpen">
            <button
              v-if="step.status === 'NOT_STARTED'"
              :disabled="!canStart(step.stepOrder)"
              @click="doStart(step)"
            >开始</button>
            <button
              v-if="step.status === 'IN_PROGRESS'"
              @click="doComplete(step)"
            >完成</button>
            <button
              v-if="step.status === 'NOT_STARTED' || step.status === 'IN_PROGRESS'"
              @click="doSkip(step)"
            >跳过</button>
            <button
              v-if="step.status === 'IN_PROGRESS'"
              @click="doFail(step)"
            >标记失败</button>
            <button
              v-if="step.status === 'FAILED'"
              @click="doRetry(step)"
            >重试</button>
          </div>
          <div v-if="stepError[step.stepRecordId]" class="step-error">
            {{ stepError[step.stepRecordId] }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import type { TrainingSessionDetail, TrainingStepView } from '@shared/types/training'

const route = useRoute()
const authStore = useAuthStore()

const session = ref<TrainingSessionDetail | null>(null)
const loading = ref(false)
const error = ref('')
const stepError = ref<Record<string, string>>({})

const sessionId = route.params.sessionId as string

const isSessionOpen = computed(() => {
  const s = session.value?.status
  return s === 'INIT' || s === 'ACTIVE'
})

function canStart(stepOrder: number): boolean {
  if (!session.value) return false
  const prev = session.value.steps.filter(s => s.stepOrder < stepOrder)
  return prev.every(s => s.status !== 'NOT_STARTED')
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await window.api.training.getSession({
      callerUserId: authStore.userId!,
      callerRole: authStore.role!,
      trainingSessionId: sessionId
    })
    if (result.success) {
      session.value = result.session
    } else {
      error.value = `加载失败：${result.errorCode}`
    }
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}

async function stepAction(
  step: TrainingStepView,
  action: 'startStep' | 'completeStep' | 'skipStep' | 'failStep' | 'retryStep'
) {
  stepError.value[step.stepRecordId] = ''
  try {
    const result = await window.api.training[action]({
      callerUserId: authStore.userId!,
      callerRole: authStore.role!,
      trainingSessionId: sessionId,
      stepRecordId: step.stepRecordId
    })
    if (result.success) {
      await load()
    } else {
      const msgs: Record<string, string> = {
        STEP_PREREQUISITE_NOT_MET: '前序步骤尚未开始',
        STEP_INVALID_TRANSITION: '当前步骤状态不允许此操作',
        SESSION_HALTED: '训练已因安全事件终止'
      }
      stepError.value[step.stepRecordId] = msgs[result.errorCode] ?? result.errorCode
    }
  } catch (e) {
    stepError.value[step.stepRecordId] = String(e)
  }
}

const doStart    = (s: TrainingStepView) => stepAction(s, 'startStep')
const doComplete = (s: TrainingStepView) => stepAction(s, 'completeStep')
const doSkip     = (s: TrainingStepView) => stepAction(s, 'skipStep')
const doFail     = (s: TrainingStepView) => stepAction(s, 'failStep')
const doRetry    = (s: TrainingStepView) => stepAction(s, 'retryStep')

onMounted(load)
</script>

<style scoped>
.training-view { padding: 20px; max-width: 700px; }
.session-header { margin-bottom: 16px; }
.session-meta { display: flex; gap: 12px; align-items: center; margin-top: 4px; font-size: 14px; }
.steps-list { display: flex; flex-direction: column; gap: 12px; }
.step-card { border: 1px solid #ddd; border-radius: 6px; padding: 16px; background: #fafafa; }
.step-card.step-in_progress { border-color: #1a6fb5; background: #f0f7ff; }
.step-card.step-completed { border-color: #28a745; background: #f5fff7; opacity: 0.85; }
.step-card.step-skipped { opacity: 0.6; }
.step-card.step-failed { border-color: #dc3545; background: #fff5f5; }
.step-info { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.step-order { font-size: 12px; color: #888; }
.step-name { font-weight: 600; }
.step-type { font-size: 12px; background: #eee; padding: 2px 6px; border-radius: 3px; }
.attempt-count { font-size: 12px; color: #666; }
.step-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.step-actions button { padding: 6px 14px; border-radius: 4px; cursor: pointer; border: 1px solid #ccc; font-size: 13px; }
.step-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.step-error { color: red; font-size: 12px; margin-top: 4px; }
.badge { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
.badge-init, .badge-step-not_started { background: #e0f0ff; color: #1a6fb5; }
.badge-active, .badge-step-in_progress { background: #d4edda; color: #155724; }
.badge-completed, .badge-step-completed { background: #c3e6cb; color: #155724; }
.badge-step-skipped { background: #f0f0f0; color: #666; }
.badge-step-failed, .badge-redline_halted { background: #f8d7da; color: #721c24; }
.completion-banner { background: #d4edda; color: #155724; padding: 12px 16px; border-radius: 6px; margin-bottom: 12px; font-weight: 600; }
.halt-banner { background: #f8d7da; color: #721c24; padding: 12px 16px; border-radius: 6px; margin-bottom: 12px; font-weight: 600; }
.error { color: red; margin: 12px 0; }
</style>
