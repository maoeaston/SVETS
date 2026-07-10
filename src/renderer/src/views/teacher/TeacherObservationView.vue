<template>
  <div class="obs-view">
    <header class="header">
      <RouterLink to="/teacher/assessments" class="back-link">← 返回列表</RouterLink>
      <h2 class="title">观察项录入</h2>
      <p class="muted">会话 ID：{{ sessionId.slice(0, 8) }}…</p>
    </header>
    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>
    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="obsQuestions.length === 0" class="empty">该会话无观察项</div>
    <div v-else class="obs-list">
      <div v-for="q in obsQuestions" :key="q.questionId" class="obs-card">
        <h3 class="obs-title">{{ q.jobModuleCode }} 观察项</h3>
        <p class="muted">题目 ID：{{ q.questionId }}</p>
        <!-- 已录入：只读 -->
        <div v-if="recordedMap[q.questionId]" class="recorded-view">
          <p>已录入</p>
          <p>已观察到目标行为：<strong>{{ recordedMap[q.questionId].observationPayload.observed ? '是' : '否' }}</strong></p>
          <p v-if="recordedMap[q.questionId].observationPayload.prompt_level">
            提示等级：<strong>{{ recordedMap[q.questionId].observationPayload.prompt_level }}</strong>
          </p>
          <p v-if="recordedMap[q.questionId].observationPayload.observation_note" class="note-text">
            观察说明：{{ recordedMap[q.questionId].observationPayload.observation_note }}
          </p>
        </div>
        <!-- 未录入：录入表单 -->
        <div v-else class="obs-form">
          <label class="check-label">
            <input v-model="forms[q.questionId].observed" type="checkbox">
            已观察到目标行为
          </label>
          <div class="field-row">
            <label class="field-label">提示等级：</label>
            <select v-model="forms[q.questionId].promptLevel" class="select-sm">
              <option value="">无</option>
              <option v-for="l in PROMPT_LEVELS" :key="l" :value="l">{{ l }}</option>
            </select>
          </div>
          <div class="field-row">
            <label class="field-label">观察说明：</label>
            <textarea v-model="forms[q.questionId].note" class="textarea-sm" rows="2" placeholder="可选备注…" />
          </div>
          <div class="field-row">
            <button
              class="btn-primary"
              :disabled="submittingId === q.questionId"
              @click="submitOne(q.questionId)"
            >
              {{ submittingId === q.questionId ? '提交中…' : '记录' }}
            </button>
            <span v-if="submitErrors[q.questionId]" class="inline-err">{{ submitErrors[q.questionId] }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import type { SessionScoringQuestion } from '@shared/types/job-skill-scoring'
import type { TeacherObservationRecord } from '@shared/types/teacher-observation'
import type { PromptLevel } from '@shared/types/json-schemas'

const PROMPT_LEVELS: PromptLevel[] = ['P0', 'P1', 'P2', 'P3']

const route = useRoute()
const auth = useAuthStore()
const sessionId = route.params.sessionId as string

const loading = ref(true)
const errorMsg = ref('')
const submittingId = ref<string | null>(null)
const obsQuestions = ref<SessionScoringQuestion[]>([])
const recordedMap = reactive<Record<string, TeacherObservationRecord>>()
const forms = reactive<Record<string, { observed: boolean; promptLevel: string; note: string }>>({})
const submitErrors = reactive<Record<string, string>>({})

onMounted(async () => {
  if (!auth.userId || !auth.role) { errorMsg.value = '未登录'; loading.value = false; return }
  try {
    const [qRes, rRes] = await Promise.all([
      window.api.assessment.getSessionScoringQuestions({ callerUserId: auth.userId, callerRole: auth.role, sessionId }),
      window.api.assessment.getTeacherObservations({ callerUserId: auth.userId, callerRole: auth.role, sessionId })
    ])
    if (!qRes.success || !rRes.success) { errorMsg.value = '加载失败'; return }
    obsQuestions.value = qRes.observationQuestions
    for (const r of rRes.records) recordedMap[r.questionId] = r
    for (const q of qRes.observationQuestions) {
      if (!recordedMap[q.questionId]) forms[q.questionId] = { observed: false, promptLevel: '', note: '' }
    }
  } catch (err) { console.error('[TeacherObservationView] load failed:', err); errorMsg.value = '加载失败，请重试' } finally { loading.value = false }
})

async function submitOne(questionId: string): Promise<void> {
  if (!auth.userId || !auth.role || submittingId.value) return
  submittingId.value = questionId
  submitErrors[questionId] = ''
  const f = forms[questionId]
  try {
    const res = await window.api.assessment.recordTeacherObservation({
      callerUserId: auth.userId, callerRole: auth.role, sessionId, questionId,
      observationPayload: {
        schema_version: 'teacher-observation-v1.0',
        observation_code: questionId,
        observed: f.observed,
        behavior_codes: [],
        prompt_level: (f.promptLevel || null) as PromptLevel | null,
        accommodations_used: [],
        observation_note: f.note || null,
        recorded_by: auth.userId,
        recorded_at: new Date().toISOString()
      }
    })
    if (!res.success) {
      const msgMap: Record<string, string> = {
        FORBIDDEN: '无权限', NOT_FOUND: '会话不存在',
        SESSION_WRONG_STRATEGY: '策略类型不匹配', SESSION_TERMINATED: '会话已终止',
        ALREADY_RECORDED: '已录入', ASSESSMENT_SYSTEM_ERROR: '系统错误'
      }
      submitErrors[questionId] = msgMap[res.errorCode] ?? res.errorCode; return
    }
    // 刷新该问题的录入状态
    const rRes = await window.api.assessment.getTeacherObservations({ callerUserId: auth.userId!, callerRole: auth.role!, sessionId })
    if (rRes.success) {
      for (const r of rRes.records) recordedMap[r.questionId] = r
    }
  } catch (err) { console.error('[TeacherObservationView] submitOne failed:', err); submitErrors[questionId] = '提交失败，请重试' } finally { submittingId.value = null }
}
</script>

<style scoped>
.obs-view { max-width: 720px; margin: 0 auto; padding: 24px; }
.header { margin-bottom: 20px; }
.back-link { display: inline-block; margin-bottom: 8px; color: #4f46e5; text-decoration: none; font-size: 14px; }
.title { font-size: 22px; font-weight: 600; margin: 0 0 4px; }
.muted { color: #6b7280; font-size: 13px; margin: 0; }
.error-msg { background: #fef2f2; border: 1px solid #fca5a5; color: #b91c1c; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; }
.loading, .empty { color: #6b7280; padding: 24px 0; }
.obs-list { display: flex; flex-direction: column; gap: 16px; }
.obs-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; }
.obs-title { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
.recorded-view { background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 12px; margin-top: 12px; font-size: 14px; }
.recorded-view p { margin: 4px 0; }
.note-text { color: #374151; }
.obs-form { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
.check-label { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
.field-row { display: flex; align-items: center; gap: 8px; font-size: 14px; flex-wrap: wrap; }
.field-label { min-width: 72px; color: #374151; }
.select-sm { padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; }
.textarea-sm { width: 320px; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; resize: vertical; }
.btn-primary { padding: 8px 18px; background: #4f46e5; color: white; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.inline-err { color: #b91c1c; font-size: 13px; }
</style>
