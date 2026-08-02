<template>
  <main class="activation-page">
    <section class="activation-tool" aria-labelledby="activation-title">
      <header class="activation-header">
        <div class="brand-block">
          <span class="brand-mark" aria-hidden="true">炫灿</span>
          <div>
            <p>职途向导系统</p>
            <h1 id="activation-title">软件授权</h1>
          </div>
        </div>
        <span :class="['status-chip', { active: activation.activated }]">
          {{ activation.activated ? '已激活' : '未激活' }}
        </span>
      </header>

      <div v-if="activation.snapshot" class="license-summary" aria-live="polite">
        <div>
          <span>授权单位</span>
          <strong>{{ activation.snapshot.organizationName ?? '尚未绑定' }}</strong>
        </div>
        <div>
          <span>有效期</span>
          <strong>{{ formatDate(activation.snapshot.validUntil) }}</strong>
        </div>
        <div>
          <span>应用版本</span>
          <strong>{{ activation.snapshot.appVersion }}</strong>
        </div>
        <div>
          <span>题库版本</span>
          <strong>{{ activation.snapshot.questionBankVersion }}</strong>
        </div>
      </div>

      <form class="activation-form" @submit.prevent="handleActivate">
        <label for="activation-server">激活服务器</label>
        <div class="server-row">
          <input
            id="activation-server"
            v-model.trim="serverUrl"
            type="url"
            autocomplete="url"
            placeholder="https://license.example.com"
            required
            :disabled="activation.loading"
            @input="serverUrlDirty = true"
          >
          <button type="button" class="button secondary" :disabled="activation.loading || !serverChanged" @click="requestServerSave">
            保存地址
          </button>
        </div>

        <div v-if="confirmServerChange" class="confirm-change" role="alert">
          <p>切换服务器后，需要使用新服务器重新激活。</p>
          <div>
            <button type="button" class="button danger" :disabled="activation.loading" @click="saveServer">确认切换</button>
            <button type="button" class="button quiet" :disabled="activation.loading" @click="confirmServerChange = false">取消</button>
          </div>
        </div>

        <template v-if="!activation.activated">
          <label for="license-key">授权码</label>
          <input
            id="license-key"
            v-model="licenseKey"
            type="password"
            autocomplete="off"
            required
            :disabled="activation.loading"
          >
          <button type="submit" class="button primary" :disabled="activation.loading">
            {{ activation.loading ? '正在连接' : '激活并进入系统' }}
          </button>
        </template>
        <div v-else class="active-actions">
          <button type="button" class="button primary" :disabled="activation.loading" @click="goBack">
            返回工作台
          </button>
          <button type="button" class="button secondary" :disabled="activation.loading" @click="handleValidate">
            {{ activation.loading ? '正在验证' : '重新验证' }}
          </button>
        </div>

        <p v-if="message" :class="['form-message', messageKind]" role="status">{{ message }}</p>
      </form>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { ActivationErrorCode } from '@shared/types/activation'
import type { AuthRole } from '@shared/types/auth'
import { useActivationStore } from '../stores/activation'
import { useAuthStore } from '../stores/auth'

const activation = useActivationStore()
const auth = useAuthStore()
const router = useRouter()
const serverUrl = ref(activation.snapshot?.serverUrl ?? '')
const licenseKey = ref('')
const message = ref('')
const messageKind = ref<'error' | 'success'>('error')
const confirmServerChange = ref(false)
const serverUrlDirty = ref(false)

const serverChanged = computed(() => serverUrl.value.trim() !== (activation.snapshot?.serverUrl ?? ''))

watch(() => activation.snapshot?.serverUrl, (value) => {
  if (!serverUrlDirty.value) serverUrl.value = value ?? ''
}, { immediate: true })

function homeForRole(role: AuthRole | null): string {
  return role === 'STUDENT' ? '/student' : role === 'ADMIN' ? '/admin' : role === 'TEACHER' ? '/teacher' : '/login'
}

function errorText(code: ActivationErrorCode): string {
  return ({
    ACTIVATION_REQUIRED: '请先完成软件激活',
    INVALID_SERVER_URL: '服务器地址无效',
    INVALID_LICENSE_KEY: '请输入有效的授权码',
    INVALID_LICENSE: '授权码无效',
    EXPIRED: '授权已过期',
    DEVICE_LIMIT: '该授权的设备数量已满',
    SERVER_UNAVAILABLE: '暂时无法连接激活服务器',
    INVALID_RESPONSE: '激活服务器返回的数据无效',
    STORAGE_ERROR: '本机授权状态无法保存'
  })[code]
}

async function persistServer(): Promise<boolean> {
  const result = await activation.configureServer(serverUrl.value)
  if (!result.success) {
    show(errorText(result.errorCode), 'error')
    return false
  }
  serverUrl.value = result.snapshot.serverUrl
  serverUrlDirty.value = false
  confirmServerChange.value = false
  if (!result.snapshot.activated) auth.clear()
  show('服务器地址已保存', 'success')
  return true
}

function requestServerSave(): void {
  if (!serverChanged.value) return
  if (activation.activated) {
    confirmServerChange.value = true
    return
  }
  void persistServer()
}

async function saveServer(): Promise<void> {
  await persistServer()
}

async function handleActivate(): Promise<void> {
  try {
    if (serverChanged.value && !await persistServer()) return
    const result = await activation.activate(licenseKey.value)
    if (!result.success) {
      show(errorText(result.errorCode), 'error')
      return
    }
    licenseKey.value = ''
    show(result.snapshot.status === 'ACTIVE_CACHED' ? '已使用有效的缓存授权' : '激活成功', 'success')
    await router.push(homeForRole(auth.role))
  } catch {
    show('暂时无法连接激活服务', 'error')
  }
}

async function handleValidate(): Promise<void> {
  try {
    const result = await activation.validate()
    show(result.success ? '授权状态有效' : errorText(result.errorCode), result.success ? 'success' : 'error')
  } catch {
    show('暂时无法连接激活服务', 'error')
  }
}

async function goBack(): Promise<void> {
  await router.push(homeForRole(auth.role))
}

function show(text: string, kind: 'error' | 'success'): void {
  message.value = text
  messageKind.value = kind
}

function formatDate(value: string | null): string {
  if (!value) return '尚未确认'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.activation-page { display: grid; min-height: 100%; place-items: center; padding: 28px 18px; background: var(--color-canvas); overflow-y: auto; }
.activation-tool { width: min(680px, 100%); overflow: hidden; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface); box-shadow: var(--shadow-surface); }
.activation-header { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 24px 28px; border-bottom: 1px solid var(--color-border-subtle); }
.brand-block { display: flex; align-items: center; gap: 14px; min-width: 0; }
.brand-mark { display: grid; flex: 0 0 44px; height: 44px; place-items: center; border-radius: var(--radius-sm); background: var(--color-ink); color: white; font-size: 13px; font-weight: 800; }
.brand-block p { color: var(--color-text-muted); font-size: 12px; }
h1 { font-size: 22px; line-height: 1.25; }
.status-chip { flex: none; padding: 5px 10px; border-radius: var(--radius-pill); background: var(--color-warning-soft); color: var(--color-warning); font-size: 12px; font-weight: 800; }
.status-chip.active { background: var(--color-success-soft); color: var(--color-success); }
.license-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid var(--color-border-subtle); }
.license-summary div { min-width: 0; padding: 15px 18px; border-right: 1px solid var(--color-border-subtle); }
.license-summary div:last-child { border-right: 0; }
.license-summary span, .license-summary strong { display: block; overflow-wrap: anywhere; }
.license-summary span { color: var(--color-text-faint); font-size: 11px; }
.license-summary strong { margin-top: 2px; font-size: 13px; }
.activation-form { display: grid; gap: 11px; padding: 28px; }
.activation-form label { margin-top: 5px; color: var(--color-text-muted); font-size: 13px; font-weight: 700; }
.activation-form input { width: 100%; min-width: 0; min-height: 44px; padding: 9px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: white; color: var(--color-text); }
.activation-form input:focus { border-color: var(--color-accent-dark); outline: 3px solid color-mix(in oklch, var(--color-accent) 24%, transparent); }
.server-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px; }
.button { min-height: 42px; padding: 8px 15px; border-radius: var(--radius-sm); font-size: 14px; font-weight: 750; cursor: pointer; }
.button:disabled { cursor: not-allowed; opacity: .55; }
.button.primary { border: 0; background: var(--color-accent); color: var(--color-accent-ink); }
.button.secondary { border: 1px solid var(--color-border); background: white; color: var(--color-text); }
.button.danger { border: 0; background: var(--color-danger); color: white; }
.button.quiet { border: 0; background: transparent; color: var(--color-text-muted); }
.active-actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 8px; }
.confirm-change { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 14px; border-left: 3px solid var(--color-danger); background: var(--color-danger-soft); }
.confirm-change p { font-size: 13px; }
.confirm-change div { display: flex; flex: none; gap: 6px; }
.form-message { margin-top: 4px; padding: 10px 12px; border-radius: var(--radius-sm); font-size: 13px; }
.form-message.error { background: var(--color-danger-soft); color: var(--color-danger); }
.form-message.success { background: var(--color-success-soft); color: var(--color-success); }
@media (hover: hover) { .button:not(:disabled):hover { filter: brightness(.97); } }
@media (max-width: 620px) {
  .activation-page { align-items: start; padding: 0; }
  .activation-tool { min-height: 100%; border: 0; border-radius: 0; box-shadow: none; }
  .activation-header, .activation-form { padding: 20px 18px; }
  .license-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .license-summary div:nth-child(2) { border-right: 0; }
  .license-summary div:nth-child(-n+2) { border-bottom: 1px solid var(--color-border-subtle); }
  .server-row { grid-template-columns: 1fr; }
  .confirm-change { align-items: flex-start; flex-direction: column; }
}
</style>
