<template>
  <div class="detail-page">
    <RouterLink :to="`${basePath}/safety`" class="back-link">← 返回安全事件列表</RouterLink>
    <PageState v-if="loading" kind="loading" title="正在读取安全事实" description="状态、责任人和绑定会话正在同步。" />
    <PageState v-else-if="errorKind" :kind="errorKind" :title="errorKind === 'forbidden' ? '当前账号不能查看这条事件' : errorKind === 'empty' ? '没有找到这条事件' : '安全事件没有加载成功'" description="没有改变任何阻断状态，可以重试或返回列表。" action-label="重新加载" secondary-label="返回列表" @action="loadIncident" @secondary="router.push(`${basePath}/safety`)" />

    <template v-else-if="incident">
      <header class="detail-header">
        <div><p>{{ incident.incidentId }}</p><h1>{{ incident.studentName }}的安全事件</h1><span>{{ reasonLabel(incident.reasonCode) }} · {{ contextLabel(incident.contextPhase) }} · {{ formatTime(incident.occurredAt) }}</span></div>
        <span :class="['status-badge', `status-${incident.status}`]">{{ statusLabel(incident.status) }}</span>
      </header>

      <PageState v-if="incident.requiresReviewBeforeNextSession" kind="blocked" compact title="同一学生和任务的新会话仍被阻断" :description="incident.status === 'PENDING_DETAIL' ? '教师需要先补录并确认事实，管理员随后完成复盘。' : '管理员需要解决或按明确原因作废事件。'" />
      <PageState v-if="successMessage" kind="success" compact title="操作已保存" :description="successMessage" action-label="关闭提示" @action="successMessage = ''" />
      <PageState v-if="actionError" kind="error" compact title="操作没有完成" :description="actionError" action-label="关闭提示" @action="actionError = ''" />

      <section class="fact-section">
        <header><h2>已记录事实</h2><span>{{ incident.bindingCount }} 个会话已关联</span></header>
        <p>{{ incident.description || '触发后尚未补充完整说明。' }}</p>
        <dl>
          <div><dt>触发人</dt><dd>{{ incident.triggeredByName }}</dd></div>
          <div><dt>确认人</dt><dd>{{ incident.confirmedByName ?? '尚未确认' }}</dd></div>
          <div><dt>任务</dt><dd>拆箱与上架</dd></div>
          <div><dt>解决人</dt><dd>{{ incident.resolvedByName ?? '尚未解决' }}</dd></div>
        </dl>
      </section>

      <form v-if="auth.role === 'TEACHER' && incident.status === 'PENDING_DETAIL'" class="action-form" @submit.prevent="confirmIncident">
        <div class="form-heading"><span>教师责任</span><div><h2>补录并确认现场事实</h2><p>提交后核心事实被冻结，只能由管理员按修正流程作废重建。</p></div></div>
        <label>安全原因<select v-model="teacherForm.reasonCode" required><option v-for="option in SAFETY_REASON_CODES" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
        <label>发生环节<select v-model="teacherForm.contextPhase" required><option v-for="option in SAFETY_CONTEXT_PHASES" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
        <label class="full">现场说明<textarea v-model.trim="teacherForm.description" rows="4" required placeholder="只记录可核实的现场事实"></textarea></label>
        <button type="submit" class="primary-action" :disabled="submitting">{{ submitting ? '正在提交' : '确认事实并交管理员复盘' }}</button>
      </form>

      <section v-if="auth.role === 'ADMIN' && ['PENDING_DETAIL', 'CONFIRMED'].includes(incident.status)" class="admin-actions">
        <div class="form-heading"><span>管理员责任</span><div><h2>完成复盘或作废记录</h2><p>不得通过修改 session 绕过安全事件生命周期。</p></div></div>

        <form v-if="incident.status === 'CONFIRMED'" class="action-form nested" @submit.prevent="resolveIncident">
          <h3>确认事件属实并解除阻断</h3>
          <label class="full">复盘与补救说明<textarea v-model.trim="resolveForm.notes" rows="3" required placeholder="记录已采取的补救措施"></textarea></label>
          <label class="check-label"><input v-model="resolveForm.followUp" type="checkbox"> 仍需后续跟进</label>
          <button type="submit" class="primary-action" :disabled="submitting">解决事件并解除阻断</button>
        </form>

        <form class="action-form nested danger-form" @submit.prevent="voidIncident">
          <h3>按明确原因作废</h3>
          <label>作废原因<select v-model="voidForm.reason" required><option value="FALSE_TRIGGER">误触或误报</option><option value="DUPLICATE_RECORD">重复记录</option><option value="NON_SAFETY_EVENT">不属于安全红线</option></select></label>
          <label v-if="voidForm.reason === 'DUPLICATE_RECORD'">真实事件编号<input v-model.trim="voidForm.replacementIncidentId" required placeholder="填写同一学生、同一任务的事件编号"></label>
          <label class="full">作废说明<textarea v-model.trim="voidForm.notes" rows="3" placeholder="说明核查依据"></textarea></label>
          <button type="submit" class="danger-action" :disabled="submitting">作废记录</button>
        </form>

        <details v-if="incident.status === 'CONFIRMED'" class="correction-panel">
          <summary>核心事实有误，需要作废并建立替代事件</summary>
          <form class="action-form nested" @submit.prevent="replaceIncident">
            <label>修正后原因<select v-model="replaceForm.reasonCode" required><option v-for="option in SAFETY_REASON_CODES" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
            <label>修正后环节<select v-model="replaceForm.contextPhase" required><option v-for="option in SAFETY_CONTEXT_PHASES" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
            <label class="full">修正后事实<textarea v-model.trim="replaceForm.description" rows="3" required></textarea></label>
            <label class="full">修正原因<textarea v-model.trim="replaceForm.correctionReason" rows="2" required></textarea></label>
            <button type="submit" class="danger-action" :disabled="submitting">作废旧事件并建立替代事件</button>
          </form>
        </details>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageState from '../../components/PageState.vue'
import { useAuthStore } from '../../stores/auth'
import { SAFETY_CONTEXT_PHASES, SAFETY_REASON_CODES } from '@shared/types/safety'
import type { SafetyContextPhase, SafetyReasonCode } from '@shared/types/safety'
import type { SafetyIncidentStatus, SafetyIncidentView } from '@shared/types/safety-incident'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const basePath = computed(() => auth.role === 'ADMIN' ? '/admin' : '/teacher')
const loading = ref(true)
const submitting = ref(false)
const errorKind = ref<'' | 'error' | 'forbidden' | 'empty'>('')
const actionError = ref('')
const successMessage = ref('')
const incident = ref<SafetyIncidentView | null>(null)
const teacherForm = reactive<{ reasonCode: SafetyReasonCode; contextPhase: SafetyContextPhase; description: string }>({ reasonCode: 'OTHER_SAFETY_RISK', contextPhase: 'OTHER', description: '' })
const resolveForm = reactive({ notes: '', followUp: false })
const voidForm = reactive<{ reason: 'FALSE_TRIGGER' | 'DUPLICATE_RECORD' | 'NON_SAFETY_EVENT'; notes: string; replacementIncidentId: string }>({ reason: 'FALSE_TRIGGER', notes: '', replacementIncidentId: '' })
const replaceForm = reactive<{ reasonCode: SafetyReasonCode; contextPhase: SafetyContextPhase; description: string; correctionReason: string }>({ reasonCode: 'OTHER_SAFETY_RISK', contextPhase: 'OTHER', description: '', correctionReason: '' })

async function loadIncident(): Promise<void> {
  if (!auth.userId || !auth.role) { loading.value = false; errorKind.value = 'forbidden'; return }
  loading.value = true
  errorKind.value = ''
  try {
    const result = await window.api.safety.get({ callerUserId: auth.userId, callerRole: auth.role, incidentId: String(route.params.incidentId) })
    if (!result.success) { errorKind.value = result.errorCode === 'FORBIDDEN' ? 'forbidden' : result.errorCode === 'NOT_FOUND' ? 'empty' : 'error'; return }
    incident.value = result.incident
    teacherForm.reasonCode = result.incident.reasonCode
    teacherForm.contextPhase = result.incident.contextPhase
    teacherForm.description = result.incident.description ?? ''
  } catch (error) {
    console.error('[SafetyIncidentDetailView] load failed:', error)
    errorKind.value = 'error'
  } finally { loading.value = false }
}

async function runMutation(run: () => Promise<{ success: true; incidentId: string } | { success: false; errorCode: string }>, success: string): Promise<void> {
  submitting.value = true
  actionError.value = ''
  successMessage.value = ''
  try {
    const result = await run()
    if (!result.success) { actionError.value = mutationError(result.errorCode); return }
    successMessage.value = success
    await loadIncident()
  } catch (error) {
    console.error('[SafetyIncidentDetailView] mutation failed:', error)
    actionError.value = '操作没有保存，请检查后重试。'
  } finally { submitting.value = false }
}

async function confirmIncident(): Promise<void> {
  if (!auth.userId || !auth.role || !incident.value) return
  await runMutation(() => window.api.safety.confirm({ callerUserId: auth.userId!, callerRole: auth.role!, incidentId: incident.value!.incidentId, reasonCode: teacherForm.reasonCode, contextPhase: teacherForm.contextPhase, description: teacherForm.description }), '事实已确认，事件已交由管理员复盘。')
}
async function resolveIncident(): Promise<void> {
  if (!auth.userId || !auth.role || !incident.value || !window.confirm('确认已完成复盘并解除阻断？')) return
  await runMutation(() => window.api.safety.resolve({ callerUserId: auth.userId!, callerRole: auth.role!, incidentId: incident.value!.incidentId, resolutionNotes: resolveForm.notes, followUpRequired: resolveForm.followUp }), '事件已解决，新会话阻断已解除。')
}
async function voidIncident(): Promise<void> {
  if (!auth.userId || !auth.role || !incident.value || !window.confirm('确认按所选原因作废这条安全事件？')) return
  await runMutation(() => window.api.safety.void({ callerUserId: auth.userId!, callerRole: auth.role!, incidentId: incident.value!.incidentId, voidReason: voidForm.reason, voidNotes: voidForm.notes || null, replacementIncidentId: voidForm.reason === 'DUPLICATE_RECORD' ? voidForm.replacementIncidentId : null }), '事件已按明确原因作废，历史记录仍保留。')
}
async function replaceIncident(): Promise<void> {
  if (!auth.userId || !auth.role || !incident.value || !window.confirm('确认作废旧事实并建立替代事件？新事件会继续保持阻断。')) return
  await runMutation(() => window.api.safety.replaceForFactualCorrection({ callerUserId: auth.userId!, callerRole: auth.role!, incidentId: incident.value!.incidentId, reasonCode: replaceForm.reasonCode, contextPhase: replaceForm.contextPhase, description: replaceForm.description, correctionReason: replaceForm.correctionReason }), '旧事件已作废，替代事件已建立并继续保持阻断。')
}

function mutationError(code: string): string { return ({ FORBIDDEN: '当前账号无权执行此操作。', INVALID_STATE: '事件状态已经变化，请刷新后再处理。', VALIDATION_ERROR: '请填写完整且合法的内容。', NOT_FOUND: '事件不存在或已不可访问。', SAFETY_SYSTEM_ERROR: '系统没有保存操作，请重试。' } as Record<string, string>)[code] ?? '操作没有完成，请重试。' }
function statusLabel(status: SafetyIncidentStatus): string { return ({ PENDING_DETAIL: '待教师补录', CONFIRMED: '待管理员复盘', RESOLVED: '已解决', VOIDED: '已作废' })[status] }
function reasonLabel(value: SafetyReasonCode): string { return SAFETY_REASON_CODES.find((item) => item.value === value)?.label ?? value }
function contextLabel(value: SafetyContextPhase): string { return SAFETY_CONTEXT_PHASES.find((item) => item.value === value)?.label ?? value }
function formatTime(value: string): string { const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }) }

onMounted(() => { void loadIncident() })
</script>

<style scoped>
.detail-page { display: grid; gap: 18px; max-width: 940px; margin: 0 auto; }
.back-link { width: max-content; color: var(--color-accent-dark); font-size: 13px; text-decoration: none; }
.detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding-bottom: 18px; border-bottom: 1px solid var(--color-border); }
.detail-header p { margin: 0; color: var(--color-text-faint); font-family: ui-monospace, monospace; font-size: 11px; overflow-wrap: anywhere; }
h1 { margin: 3px 0 4px; font-size: clamp(24px, 3vw, 32px); line-height: 1.25; }
.detail-header div > span { color: var(--color-text-muted); font-size: 12px; }
.status-badge { flex: none; padding: 7px 11px; border-radius: var(--radius-pill); background: var(--color-surface-muted); color: var(--color-text-muted); font-size: 12px; font-weight: 800; }
.status-PENDING_DETAIL, .status-CONFIRMED { background: var(--color-danger-soft); color: var(--color-danger); }
.status-RESOLVED { background: var(--color-success-soft); color: var(--color-success); }
.fact-section, .action-form, .admin-actions { padding: 20px; border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-surface); }
.fact-section > header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
h2 { margin: 0; font-size: 17px; }
.fact-section header span { color: var(--color-text-muted); font-size: 11px; }
.fact-section > p { margin: 10px 0 16px; color: var(--color-text-muted); line-height: 1.75; }
dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; }
dl div { padding: 10px; border-radius: var(--radius-sm); background: var(--color-surface-muted); }
dt { color: var(--color-text-faint); font-size: 11px; }
dd { margin: 3px 0 0; font-size: 13px; }
.form-heading { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 12px; grid-column: 1 / -1; padding-bottom: 14px; border-bottom: 1px solid var(--color-border-subtle); }
.form-heading > span { color: var(--color-danger); font-size: 12px; font-weight: 800; }
.form-heading p { margin: 3px 0 0; color: var(--color-text-muted); font-size: 12px; }
.action-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.action-form label { display: grid; gap: 5px; color: var(--color-text-muted); font-size: 12px; }
.action-form .full, .action-form h3, .action-form button, .check-label { grid-column: 1 / -1; }
select, textarea, input { width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: white; color: var(--color-text); }
select, input { min-height: 42px; padding: 8px 10px; }
textarea { padding: 10px; line-height: 1.65; resize: vertical; }
.primary-action, .danger-action { justify-self: start; min-height: 42px; padding: 9px 16px; border: 0; border-radius: var(--radius-sm); font-size: 13px; font-weight: 800; cursor: pointer; }
.primary-action { background: var(--color-accent); color: var(--color-accent-ink); }
.danger-action { background: var(--color-danger); color: white; }
.primary-action:active, .danger-action:active { transform: scale(.96); }
.admin-actions { display: grid; gap: 16px; }
.action-form.nested { box-shadow: none; border: 1px solid var(--color-border); }
.action-form h3 { margin: 0; font-size: 15px; }
.check-label { display: flex !important; grid-template-columns: none !important; align-items: center; gap: 8px !important; }
.check-label input { width: 18px; height: 18px; }
.correction-panel { border-top: 1px solid var(--color-border); padding-top: 14px; }
.correction-panel summary { color: var(--color-danger); font-size: 13px; font-weight: 750; cursor: pointer; }
.correction-panel .action-form { margin-top: 12px; }
@media (max-width: 700px) {
  .detail-header { flex-direction: column; }
  dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .action-form { grid-template-columns: 1fr; }
  .form-heading { grid-template-columns: 1fr; }
}
@media (max-width: 440px) { dl { grid-template-columns: 1fr; } }
</style>
