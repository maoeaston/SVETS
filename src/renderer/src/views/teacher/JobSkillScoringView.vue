<template>
  <div class="js-scoring">
    <header class="header">
      <RouterLink to="/teacher/assessments" class="back-link">← 返回列表</RouterLink>
      <h2 class="title">专业岗位线下评分</h2>
      <p class="muted">会话 ID：{{ sessionId.slice(0, 8) }}…</p>
    </header>
    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>
    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="isReadOnly" class="result-card">
      <h3>已评分（只读）</h3>
      <table class="table">
        <thead><tr><th>#</th><th>模块</th><th>得分</th><th>备注</th></tr></thead>
        <tbody>
          <tr v-for="(item, idx) in existingItems" :key="item.questionId">
            <td>{{ idx + 1 }}</td>
            <td>{{ moduleName(questionModule(item.questionId)) }}</td>
            <td>{{ item.score }} / 2</td>
            <td class="muted">{{ item.observationNote ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <form v-else class="scoring-form" @submit.prevent="handleSubmit">
      <table class="table">
        <thead>
          <tr><th>#</th><th>模块</th><th>得分（0/1/2）</th><th>备注（可选）</th></tr>
        </thead>
        <tbody>
          <tr v-for="(q, idx) in offlineQuestions" :key="q.questionId">
            <td>{{ idx + 1 }}</td>
            <td>{{ moduleName(q.jobModuleCode) }}</td>
            <td>
              <label v-for="s in [0, 1, 2]" :key="s" class="radio-label">
                <input v-model.number="scores[q.questionId]" type="radio" :name="q.questionId" :value="s">{{ s }}
              </label>
            </td>
            <td>
              <input v-model="notes[q.questionId]" type="text" class="note-input" placeholder="备注…">
            </td>
          </tr>
        </tbody>
      </table>
      <div class="summary-row">已评：{{ scoredCount }} / {{ offlineQuestions.length }} 项</div>
      <div class="form-actions">
        <button type="submit" class="btn-primary" :disabled="!canSubmit || submitting">
          {{ submitting ? '提交中…' : '提交评分' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import type { SessionScoringQuestion, JobSkillOfflineScoreView } from '@shared/types/job-skill-scoring'

const MODULE_NAMES: Record<string, string> = {
  M1: '货架整理与价签核对', M2: '拆箱补货与先进先出', M3: '临期破损商品分拣',
  M4: '库房收纳与简易盘点', M5: '突发情况应对', M6: '商品识别与分类'
}
const ERR_MAP: Record<string, string> = {
  FORBIDDEN: '无权限', NOT_FOUND: '会话不存在',
  SESSION_NOT_OFFLINE_PENDING: '该会话不在"待线下评分"状态',
  ALREADY_SCORED: '该会话已评分', BLOCKED_BY_SAFETY_INCIDENT: '存在安全事件无法评分',
  ASSESSMENT_SYSTEM_ERROR: '系统错误，请重试'
}

const route = useRoute()
const auth = useAuthStore()
const sessionId = route.params.sessionId as string

const loading = ref(true)
const errorMsg = ref('')
const submitting = ref(false)
const isReadOnly = ref(false)
const offlineQuestions = ref<SessionScoringQuestion[]>([])
const existingItems = ref<JobSkillOfflineScoreView[]>([])
const scores = reactive<Record<string, number | null>>({})
const notes = reactive<Record<string, string>>({})

function moduleName(code: string): string { return MODULE_NAMES[code] ?? code }
function questionModule(qId: string): string {
  return offlineQuestions.value.find(q => q.questionId === qId)?.jobModuleCode ?? ''
}
const scoredCount = computed(() => offlineQuestions.value.filter(q => scores[q.questionId] !== null).length)
const canSubmit = computed(() =>
  offlineQuestions.value.length > 0 &&
  offlineQuestions.value.every(q => scores[q.questionId] !== null) &&
  !submitting.value
)

onMounted(async () => {
  if (!auth.userId || !auth.role) { errorMsg.value = '未登录'; loading.value = false; return }
  try {
    const [qRes, sRes] = await Promise.all([
      window.api.assessment.getSessionScoringQuestions({ callerUserId: auth.userId, callerRole: auth.role, sessionId }),
      window.api.assessment.getJobSkillOfflineScores({ callerUserId: auth.userId, callerRole: auth.role, sessionId })
    ])
    if (!qRes.success || !sRes.success) { errorMsg.value = '加载失败'; return }
    offlineQuestions.value = qRes.offlineQuestions
    if (sRes.items.length > 0) { isReadOnly.value = true; existingItems.value = sRes.items; return }
    for (const q of qRes.offlineQuestions) { scores[q.questionId] = null; notes[q.questionId] = '' }
  } catch (err) { console.error('[JobSkillScoringView] load failed:', err); errorMsg.value = '加载失败，请重试' } finally { loading.value = false }
})

async function handleSubmit(): Promise<void> {
  if (!canSubmit.value || !auth.userId || !auth.role) return
  submitting.value = true; errorMsg.value = ''
  try {
    const res = await window.api.assessment.submitJobSkillOfflineScores({
      callerUserId: auth.userId, callerRole: auth.role, sessionId,
      scores: offlineQuestions.value.map(q => ({
        questionId: q.questionId,
        score: (scores[q.questionId] ?? 0) as 0 | 1 | 2,
        observationNote: notes[q.questionId] || undefined
      }))
    })
    if (!res.success) { errorMsg.value = ERR_MAP[res.errorCode] ?? res.errorCode; return }
    isReadOnly.value = true
    const detail = await window.api.assessment.getJobSkillOfflineScores({ callerUserId: auth.userId!, callerRole: auth.role!, sessionId })
    if (detail.success) existingItems.value = detail.items
  } catch (err) { console.error('[JobSkillScoringView] submit failed:', err); errorMsg.value = '提交失败，请重试' } finally { submitting.value = false }
}
</script>

<style scoped>
.js-scoring { max-width: 860px; margin: 0 auto; padding: 24px; }
.header { margin-bottom: 20px; }
.back-link { display: inline-block; margin-bottom: 8px; color: #4f46e5; text-decoration: none; font-size: 14px; }
.title { font-size: 22px; font-weight: 600; margin: 0 0 4px; }
.muted { color: #6b7280; font-size: 13px; }
.error-msg { background: #fef2f2; border: 1px solid #fca5a5; color: #b91c1c; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; }
.loading { color: #6b7280; padding: 24px 0; }
.result-card { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; }
.result-card h3 { margin: 0 0 12px; font-size: 16px; color: #166534; }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th, .table td { padding: 8px 12px; border: 1px solid #e5e7eb; vertical-align: middle; }
.table th { background: #f9fafb; font-weight: 600; text-align: left; }
.radio-label { display: inline-flex; align-items: center; gap: 3px; margin-right: 8px; cursor: pointer; }
.note-input { width: 120px; padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; }
.summary-row { margin: 16px 0; font-size: 14px; }
.form-actions { margin-top: 16px; }
.btn-primary { padding: 10px 24px; background: #4f46e5; color: white; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
