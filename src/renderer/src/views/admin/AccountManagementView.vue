<template>
  <div class="accounts-page">
    <header class="page-header"><div><p class="eyebrow">管理员维护</p><h1>账号管理</h1><p>只创建教师账号，不显示密码哈希或会话令牌。</p></div><button type="button" class="refresh-button" :disabled="loading" @click="loadAccounts">刷新列表</button></header>

    <PageState v-if="successMessage" kind="success" compact title="账号操作已保存" :description="successMessage" action-label="关闭提示" @action="successMessage = ''" />
    <PageState v-if="actionError" kind="error" compact title="账号操作没有完成" :description="actionError" action-label="关闭提示" @action="actionError = ''" />

    <section class="create-panel">
      <header><span>新增</span><div><h2>创建教师账号</h2><p>新账号默认为启用状态，停用时会立即撤销现有会话。</p></div></header>
      <form @submit.prevent="createTeacher">
        <label>登录名<input v-model.trim="form.username" required autocomplete="off" minlength="2"></label>
        <label>教师姓名<input v-model.trim="form.displayName" required autocomplete="off"></label>
        <label>初始密码<input v-model="form.password" required type="password" autocomplete="new-password" minlength="6"></label>
        <button type="submit" :disabled="submitting">{{ submitting ? '正在创建' : '创建教师账号' }}</button>
      </form>
    </section>

    <PageState v-if="loading" kind="loading" title="正在读取账号列表" description="只返回账号摘要，不返回敏感凭证。" />
    <PageState v-else-if="errorKind" :kind="errorKind" :title="errorKind === 'forbidden' ? '当前账号不能管理账号' : '账号列表没有加载成功'" description="没有改变任何账号状态，可以原地重试。" action-label="重新加载" @action="loadAccounts" />
    <PageState v-else-if="accounts.length === 0" kind="empty" title="还没有账号记录" description="可以使用上方表单创建第一个教师账号。" />

    <section v-else class="account-list" aria-label="账号列表">
      <article v-for="account in accounts" :key="account.userId" class="account-row">
        <span class="role-mark">{{ roleLabel(account.role) }}</span>
        <div><strong>{{ account.displayName }}</strong><small>{{ account.username }} · {{ formatTime(account.createdAt) }}</small></div>
        <span :class="['status-badge', { disabled: account.status !== 'ACTIVE' }]">{{ account.status === 'ACTIVE' ? '已启用' : account.status === 'DISABLED' ? '已停用' : '已归档' }}</span>
        <button v-if="account.role === 'TEACHER'" type="button" class="status-action" :disabled="actingId === account.userId" @click="toggleTeacher(account)">{{ account.status === 'ACTIVE' ? '停用' : '重新启用' }}</button>
        <span v-else class="managed-note">{{ account.role === 'STUDENT' ? '随学生档案维护' : '当前管理员' }}</span>
      </article>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import PageState from '../../components/PageState.vue'
import { useAuthStore } from '../../stores/auth'
import type { AccountSummary, AuthRole } from '@shared/types/auth'

const auth = useAuthStore()
const loading = ref(true)
const submitting = ref(false)
const actingId = ref<string | null>(null)
const errorKind = ref<'' | 'error' | 'forbidden'>('')
const actionError = ref('')
const successMessage = ref('')
const accounts = ref<AccountSummary[]>([])
const form = reactive({ username: '', displayName: '', password: '' })

async function loadAccounts(): Promise<void> {
  if (!auth.userId || !auth.role) { loading.value = false; errorKind.value = 'forbidden'; return }
  loading.value = true
  errorKind.value = ''
  try {
    const result = await window.api.auth.listAccounts({ callerUserId: auth.userId, callerRole: auth.role })
    if (!result.success) { errorKind.value = 'forbidden'; return }
    accounts.value = result.accounts
  } catch (error) {
    console.error('[AccountManagementView] load failed:', error)
    errorKind.value = 'error'
  } finally { loading.value = false }
}

async function createTeacher(): Promise<void> {
  if (!auth.userId || !auth.role || form.password.length < 6) { actionError.value = '初始密码至少需要 6 个字符。'; return }
  submitting.value = true
  actionError.value = ''
  successMessage.value = ''
  try {
    const result = await window.api.auth.createTeacherAccount({ callerUserId: auth.userId, callerRole: auth.role, username: form.username, displayName: form.displayName, password: form.password })
    if (!result.success) { actionError.value = result.errorCode === 'USERNAME_TAKEN' ? '这个登录名已被使用。' : result.errorCode === 'FORBIDDEN' ? '当前账号无权创建教师。' : '请检查填写内容后重试。'; return }
    successMessage.value = `教师“${result.account.displayName}”已创建。`
    form.username = ''; form.displayName = ''; form.password = ''
    await loadAccounts()
  } catch (error) {
    console.error('[AccountManagementView] create failed:', error)
    actionError.value = '账号没有创建成功，请重试。'
  } finally { submitting.value = false }
}

async function toggleTeacher(account: AccountSummary): Promise<void> {
  if (!auth.userId || !auth.role) return
  const status = account.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  const action = status === 'DISABLED' ? '停用' : '重新启用'
  if (!window.confirm(`确认${action}教师“${account.displayName}”？${status === 'DISABLED' ? '现有登录会话会立即撤销。' : '旧会话不会恢复。'}`)) return
  actingId.value = account.userId
  actionError.value = ''
  successMessage.value = ''
  try {
    const result = await window.api.auth.setTeacherAccountStatus({ callerUserId: auth.userId, callerRole: auth.role, teacherUserId: account.userId, status })
    if (!result.success) { actionError.value = result.errorCode === 'FORBIDDEN' ? '当前账号无权修改教师状态。' : '账号状态没有保存，请刷新后重试。'; return }
    successMessage.value = status === 'DISABLED' ? `教师已停用，撤销 ${result.revokedSessionCount} 个有效会话。` : '教师已重新启用，旧会话没有恢复。'
    await loadAccounts()
  } catch (error) {
    console.error('[AccountManagementView] status failed:', error)
    actionError.value = '账号状态没有保存，请重试。'
  } finally { actingId.value = null }
}

function roleLabel(role: AuthRole): string { return ({ STUDENT: '学生', TEACHER: '教师', ADMIN: '管理员' })[role] }
function formatTime(value: string): string { const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN') }

onMounted(() => { void loadAccounts() })
</script>

<style scoped>
.accounts-page { display: grid; gap: 18px; max-width: 1000px; margin: 0 auto; }
.page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 22px; }
.eyebrow { margin: 0 0 3px; color: var(--color-accent-dark); font-size: 12px; font-weight: 800; }
h1 { margin: 0; font-size: clamp(25px, 3vw, 34px); line-height: 1.2; }
.page-header p:last-child { margin: 6px 0 0; color: var(--color-text-muted); font-size: 13px; }
.refresh-button { min-height: 40px; padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); cursor: pointer; }
.create-panel { display: grid; gap: 16px; padding: 20px; border-radius: var(--radius-lg); background: var(--color-ink); color: white; box-shadow: var(--shadow-surface); }
.create-panel > header { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 12px; }
.create-panel header > span { color: var(--color-accent-soft); font-size: 12px; font-weight: 800; }
h2 { margin: 0; font-size: 17px; }
.create-panel header p { margin: 3px 0 0; color: var(--color-sidebar-muted); font-size: 12px; }
.create-panel form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; align-items: end; gap: 12px; }
.create-panel label { display: grid; gap: 5px; color: var(--color-sidebar-muted); font-size: 11px; }
.create-panel input { min-width: 0; min-height: 42px; padding: 8px 10px; border: 1px solid oklch(1 0 0 / .18); border-radius: var(--radius-sm); background: oklch(1 0 0 / .08); color: white; }
.create-panel button { min-height: 42px; padding: 8px 15px; border: 0; border-radius: var(--radius-sm); background: var(--color-accent); color: var(--color-accent-ink); font-weight: 800; cursor: pointer; }
.account-list { overflow: hidden; border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-surface); }
.account-row { display: grid; grid-template-columns: 74px minmax(0, 1fr) auto 96px; align-items: center; gap: 14px; min-height: 76px; padding: 12px 16px; border-bottom: 1px solid var(--color-border-subtle); }
.account-row:last-child { border-bottom: 0; }
.role-mark { color: var(--color-text-faint); font-size: 12px; }
.account-row div { display: grid; gap: 2px; }
.account-row strong { font-size: 15px; }
.account-row small { color: var(--color-text-muted); }
.status-badge { padding: 5px 9px; border-radius: var(--radius-pill); background: var(--color-success-soft); color: var(--color-success); font-size: 11px; }
.status-badge.disabled { background: var(--color-surface-muted); color: var(--color-text-muted); }
.status-action { min-height: 40px; padding: 7px 11px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: transparent; color: var(--color-text); cursor: pointer; }
.managed-note { color: var(--color-text-faint); font-size: 11px; text-align: right; }
@media (max-width: 820px) { .create-panel form { grid-template-columns: 1fr 1fr; } }
@media (max-width: 620px) {
  .page-header { align-items: flex-start; flex-direction: column; gap: 12px; }
  .create-panel form { grid-template-columns: 1fr; }
  .account-row { grid-template-columns: 62px minmax(0, 1fr); }
  .status-badge, .status-action, .managed-note { grid-column: 2; justify-self: start; }
}
</style>
