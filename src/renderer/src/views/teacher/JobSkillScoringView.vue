<template>
  <main class="js-scoring">
    <header class="page-header">
      <div>
        <RouterLink to="/teacher/assessments" class="back-link">← 返回测评列表</RouterLink>
        <p class="eyebrow">教师评分端 · 18+6 固定卷</p>
        <h2>专业岗位线下实操评分</h2>
        <p class="muted">会话 {{ sessionId.slice(0, 8) }}…，逐题按完整行为锚点评分。</p>
      </div>
      <div class="progress-chip">已评 {{ scoredCount }} / {{ offlineQuestions.length }}</div>
    </header>

    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>
    <div v-if="loading" class="loading">正在加载题干、工具和评分锚点…</div>

    <section v-else-if="isReadOnly" class="result-card">
      <h3>评分已提交</h3>
      <article v-for="(item, idx) in existingItems" :key="item.questionId" class="result-row">
        <span class="result-index">{{ idx + 1 }}</span>
        <div>
          <strong>{{ moduleName(questionModule(item.questionId)) }}，{{ item.score }} / 2分</strong>
          <p>{{ item.selectedAnchor ?? '评分锚点已随评分标准快照保存' }}</p>
          <small>{{ item.anchorVersion ?? item.questionId }}<template v-if="item.observationNote"> · {{ item.observationNote }}</template></small>
        </div>
      </article>
    </section>

    <form v-else class="scoring-form" @submit.prevent="handleSubmit">
      <aside class="safety-console" :class="{ halted: safetyHalted }" aria-label="安全停止入口">
        <div>
          <strong>{{ safetyHalted ? '本次测评已触发安全停止' : '安全停止入口' }}</strong>
          <p>{{ safetyHalted ? '普通评分已锁定，不会生成普通完成结果。' : '出现任一题停止条件时立即使用，不要先完成普通评分。' }}</p>
        </div>
        <template v-if="!safetyHalted">
          <button type="button" class="btn-danger" :disabled="stopping" @click="handleSafetyStop">
            {{ stopping ? '停止中…' : '立即安全停止' }}
          </button>
        </template>
      </aside>

      <div class="question-list">
        <OfflineOperationCard
          v-for="q in offlineQuestions"
          :key="q.questionId"
          v-model="scores[q.questionId]"
          :note="notes[q.questionId]"
          :question="q"
          :module-name="moduleName(q.jobModuleCode)"
          mode="teacher"
          :disabled="safetyHalted || submitting"
          @update:note="notes[q.questionId] = $event"
        />
      </div>

      <footer class="submit-bar">
        <p>提交后保存数值分数、命中的完整锚点和锚点版本，不能在本页直接改写历史记录。</p>
        <button type="submit" class="btn-primary" :disabled="!canSubmit || submitting || safetyHalted">
          {{ submitting ? '提交中…' : '提交6题评分' }}
        </button>
      </footer>
    </form>
  </main>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import OfflineOperationCard from '../../components/OfflineOperationCard.vue'
import { useAuthStore } from '../../stores/auth'
import { useAssessmentStore } from '../../stores/assessment'
import type { SessionScoringQuestion, JobSkillOfflineScoreView } from '@shared/types/job-skill-scoring'

const MODULE_NAMES: Record<string, string> = {
  M1: '货架整理与价签核对', M2: '拆箱补货与先进先出', M3: '临期破损商品分拣',
  M4: '库房收纳与简易盘点', M5: '突发情况应对', M6: '商品识别与分类'
}
const ERR_MAP: Record<string, string> = {
  FORBIDDEN: '无权限', NOT_FOUND: '会话不存在', VALIDATION_ERROR: '评分锚点版本不一致，请刷新后重新评分',
  SESSION_NOT_OFFLINE_PENDING: '该会话不在线下评分阶段', ALREADY_SCORED: '该会话已评分',
  BLOCKED_BY_SAFETY_INCIDENT: '存在安全事件，普通评分已阻断', ASSESSMENT_SYSTEM_ERROR: '系统错误，请重试'
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const assessmentStore = useAssessmentStore()
const sessionId = route.params.sessionId as string
const loading = ref(true)
const errorMsg = ref('')
const submitting = ref(false)
const stopping = ref(false)
const safetyHalted = ref(false)
const isReadOnly = ref(false)
const offlineQuestions = ref<SessionScoringQuestion[]>([])
const existingItems = ref<JobSkillOfflineScoreView[]>([])
const scores = reactive<Record<string, 0 | 1 | 2 | null>>({})
const notes = reactive<Record<string, string>>({})

function moduleName(code: string): string { return MODULE_NAMES[code] ?? code }
function questionModule(questionId: string): string { return offlineQuestions.value.find((q) => q.questionId === questionId)?.jobModuleCode ?? '' }
const scoredCount = computed(() => offlineQuestions.value.filter((q) => scores[q.questionId] !== null).length)
const canSubmit = computed(() => offlineQuestions.value.length > 0 && offlineQuestions.value.every((q) => scores[q.questionId] !== null) && !submitting.value)

onMounted(async () => {
  if (!auth.userId || !auth.role) { errorMsg.value = '未登录'; loading.value = false; return }
  try {
    const [questionResult, scoreResult] = await Promise.all([
      window.api.assessment.getSessionScoringQuestions({ callerUserId: auth.userId, callerRole: auth.role, sessionId }),
      window.api.assessment.getJobSkillOfflineScores({ callerUserId: auth.userId, callerRole: auth.role, sessionId })
    ])
    if (!questionResult.success || !scoreResult.success) { errorMsg.value = '加载失败'; return }
    offlineQuestions.value = questionResult.offlineQuestions
    if (scoreResult.items.length > 0) { isReadOnly.value = true; existingItems.value = scoreResult.items; return }
    for (const question of questionResult.offlineQuestions) { scores[question.questionId] = null; notes[question.questionId] = '' }
  } catch (error) {
    console.error('[JobSkillScoringView] load failed:', error)
    errorMsg.value = '加载失败，请重试'
  } finally { loading.value = false }
})

async function handleSafetyStop(): Promise<void> {
  if (!auth.userId || !auth.role) return
  stopping.value = true
  const result = await assessmentStore.triggerRedline({
    callerUserId: auth.userId, callerRole: auth.role, sessionId,
    contextPhase: 'OFFLINE_SCORING'
  })
  stopping.value = false
  if (!result.success) { errorMsg.value = ERR_MAP[result.errorCode] ?? result.errorCode; return }
  safetyHalted.value = true
  errorMsg.value = ''
  await router.push(`/teacher/safety/${result.incidentId}`)
}

async function handleSubmit(): Promise<void> {
  if (!canSubmit.value || !auth.userId || !auth.role || safetyHalted.value) return
  submitting.value = true
  errorMsg.value = ''
  try {
    const result = await window.api.assessment.submitJobSkillOfflineScores({
      callerUserId: auth.userId, callerRole: auth.role, sessionId,
      scores: offlineQuestions.value.map((question) => {
        const score = (scores[question.questionId] ?? 0) as 0 | 1 | 2
        return {
          questionId: question.questionId,
          score,
          anchorVersion: question.anchorVersion,
          selectedAnchor: question.scoreAnchors?.[String(score) as '0' | '1' | '2'],
          observationNote: notes[question.questionId] || undefined
        }
      })
    })
    if (!result.success) { errorMsg.value = ERR_MAP[result.errorCode] ?? result.errorCode; return }
    isReadOnly.value = true
    const detail = await window.api.assessment.getJobSkillOfflineScores({ callerUserId: auth.userId, callerRole: auth.role, sessionId })
    if (detail.success) existingItems.value = detail.items
  } catch (error) {
    console.error('[JobSkillScoringView] submit failed:', error)
    errorMsg.value = '提交失败，请重试'
  } finally { submitting.value = false }
}
</script>

<style scoped>
.js-scoring { max-width: 980px; margin: 0 auto; padding: 24px; color: #252a22; }
.page-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; margin-bottom: 20px; padding-bottom: 17px; border-bottom: 1px solid #dde2d7; }
.back-link { display: inline-block; margin-bottom: 13px; color: #566a31; text-decoration: none; font-size: 14px; }
.eyebrow { margin: 0 0 4px; color: #75805d; font-size: 12px; font-weight: 700; letter-spacing: .06em; }
h2 { margin: 0 0 5px; font-size: 24px; }
.muted { margin: 0; color: #6c7365; font-size: 13px; }
.progress-chip { flex: none; padding: 8px 12px; border-radius: 999px; background: #eef2e7; color: #566a31; font-size: 13px; font-weight: 700; }
.error-msg { padding: 11px 14px; border: 1px solid #e8a58d; border-radius: 8px; background: #fff2ed; color: #9b3f1d; }
.loading { padding: 40px 0; color: #697061; }
.safety-console { position: sticky; top: 12px; z-index: 5; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; margin-bottom: 16px; padding: 13px 15px; border: 1px solid #e5a282; border-radius: 10px; background: #fff8f3; box-shadow: 0 5px 18px rgb(83 48 32 / 10%); }
.safety-console strong { color: #923b1d; }
.safety-console p { margin: 3px 0 0; color: #754d3b; font-size: 12px; }
.safety-console.halted { grid-template-columns: 1fr; background: #fce7df; }
.btn-danger, .btn-primary { border: 0; border-radius: 7px; padding: 10px 16px; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-danger { background: #a53d1d; }
.btn-primary { background: #5f713a; }
.btn-danger:disabled, .btn-primary:disabled { opacity: .48; cursor: not-allowed; }
.question-list { display: grid; gap: 16px; }
.submit-bar { position: sticky; bottom: 0; display: flex; justify-content: space-between; align-items: center; gap: 18px; margin-top: 20px; padding: 13px 15px; border: 1px solid #d8ded0; border-radius: 10px; background: rgb(255 255 255 / 96%); box-shadow: 0 -4px 20px rgb(55 63 45 / 9%); }
.submit-bar p { margin: 0; color: #697061; font-size: 12px; line-height: 1.5; }
.result-card { display: grid; gap: 10px; padding: 20px; border: 1px solid #a9bc84; border-radius: 12px; background: #f4f8ec; }
.result-card h3 { margin: 0 0 4px; color: #425426; }
.result-row { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; padding: 12px; border-radius: 8px; background: #fff; }
.result-index { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #e5edd6; color: #4d612c; font-weight: 800; }
.result-row p { margin: 4px 0; line-height: 1.55; }
.result-row small { color: #747b6c; }
@media (max-width: 720px) {
  .js-scoring { padding: 15px; }
  .page-header { align-items: flex-start; }
  .safety-console { position: static; grid-template-columns: 1fr; }
  .submit-bar { align-items: stretch; flex-direction: column; }
  .btn-primary { width: 100%; }
}
</style>
