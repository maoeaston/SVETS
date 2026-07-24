<template>
  <div class="workspace-shell">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <aside class="workspace-sidebar">
      <RouterLink :to="homeTo" class="workspace-brand" aria-label="返回角色首页">
        <span class="brand-mark">炫灿</span>
        <span>职途向导</span>
        <small>{{ roleLabel }}</small>
      </RouterLink>
      <nav class="workspace-nav" :aria-label="`${roleLabel}导航`">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="workspace-nav-item"
        >
          <span class="nav-index" aria-hidden="true">{{ item.index }}</span>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <p class="workspace-boundary">本机离线运行，操作记录可追溯</p>
    </aside>

    <div class="workspace-main">
      <header class="workspace-topbar">
        <div>
          <span class="session-label">当前账号</span>
          <strong>{{ auth.displayName ?? '未登录' }}</strong>
        </div>
        <button class="shell-logout" type="button" @click="handleLogout">退出登录</button>
      </header>
      <main id="main-content" class="workspace-content" tabindex="-1">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

defineProps<{
  roleLabel: string
  homeTo: string
  navItems: Array<{ index: string; label: string; to: string }>
}>()

const router = useRouter()
const auth = useAuthStore()

async function handleLogout(): Promise<void> {
  try {
    await window.api.auth.logout()
  } catch (error) {
    console.error('[WorkspaceShell] logout failed:', error)
  } finally {
    auth.clear()
    await router.push('/login')
  }
}
</script>

<style scoped>
.workspace-shell { display: flex; min-height: 100%; background: var(--color-canvas); }
.skip-link { position: fixed; top: 8px; left: 8px; z-index: 50; padding: 10px 14px; border-radius: var(--radius-sm); background: var(--color-ink); color: white; transform: translateY(-160%); transition: transform 160ms var(--ease-out); }
.skip-link:focus { transform: translateY(0); }
.workspace-sidebar { display: flex; flex: 0 0 232px; flex-direction: column; min-width: 0; padding: 24px 16px 18px; background: var(--color-ink); color: var(--color-sidebar-text); }
.workspace-brand { display: grid; grid-template-columns: 44px minmax(0, 1fr); align-items: center; gap: 3px 11px; padding: 0 6px 22px; color: white; text-decoration: none; }
.brand-mark { display: grid; grid-row: 1 / 3; place-items: center; width: 44px; height: 44px; border-radius: var(--radius-md); background: var(--color-accent); color: var(--color-accent-ink); font-weight: 800; }
.workspace-brand > span:not(.brand-mark) { align-self: end; font-size: 17px; font-weight: 750; }
.workspace-brand small { align-self: start; color: var(--color-sidebar-muted); font-size: 12px; }
.workspace-nav { display: grid; gap: 4px; }
.workspace-nav-item { display: grid; grid-template-columns: 26px minmax(0, 1fr); align-items: center; min-height: 44px; padding: 7px 10px; border-radius: var(--radius-sm); color: var(--color-sidebar-text); text-decoration: none; transition-property: transform, opacity; transition-duration: 140ms; }
.workspace-nav-item:active, .shell-logout:active { transform: scale(.96); }
.workspace-nav-item.router-link-exact-active { background: var(--color-sidebar-active); color: white; }
.nav-index { color: var(--color-sidebar-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.workspace-nav-item.router-link-exact-active .nav-index { color: var(--color-accent-soft); }
.workspace-boundary { margin: auto 6px 0; padding-top: 22px; color: var(--color-sidebar-muted); font-size: 11px; line-height: 1.65; }
.workspace-main { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.workspace-topbar { display: flex; flex: 0 0 64px; align-items: center; justify-content: space-between; gap: 20px; padding: 0 28px; background: var(--color-surface); box-shadow: var(--shadow-divider); }
.workspace-topbar > div { display: grid; gap: 1px; }
.session-label { color: var(--color-text-muted); font-size: 11px; }
.workspace-topbar strong { color: var(--color-text); font-size: 14px; }
.shell-logout { min-height: 40px; padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: transparent; color: var(--color-text); cursor: pointer; transition-property: transform, opacity; transition-duration: 140ms; }
.workspace-content { flex: 1; min-height: 0; padding: 28px clamp(18px, 3vw, 42px) 44px; overflow-y: auto; outline: none; }
@media (hover: hover) {
  .workspace-nav-item:hover { background: var(--color-sidebar-hover); }
  .shell-logout:hover { background: var(--color-surface-muted); }
}
@media (max-width: 900px) {
  .workspace-shell { flex-direction: column; }
  .workspace-sidebar { flex: none; width: 100%; padding: 14px 16px 10px; }
  .workspace-brand { grid-template-columns: 38px minmax(0, 1fr); width: max-content; padding: 0 2px 12px; }
  .brand-mark { width: 38px; height: 38px; }
  .workspace-nav { display: flex; gap: 6px; padding-bottom: 2px; overflow-x: auto; }
  .workspace-nav-item { flex: none; grid-template-columns: auto auto; padding: 6px 11px; }
  .workspace-boundary { display: none; }
  .workspace-topbar { flex-basis: 58px; padding: 0 18px; }
}
@media (max-width: 520px) {
  .workspace-content { padding: 20px 15px 36px; }
  .workspace-topbar { padding: 0 15px; }
}
</style>
