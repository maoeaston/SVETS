import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    {
      path: '/login',
      component: () => import('../views/LoginView.vue')
    },
    {
      path: '/teacher',
      component: () => import('../views/teacher/TeacherLayout.vue'),
      children: [
        { path: '', redirect: '/teacher/students' },
        {
          path: 'students',
          component: () => import('../views/teacher/StudentListView.vue')
        },
        {
          path: 'students/new',
          component: () => import('../views/teacher/StudentFormView.vue')
        },
        {
          path: 'students/:id',
          component: () => import('../views/teacher/StudentFormView.vue')
        }
      ]
    },
    {
      // /admin 与 /teacher 平级，复用 TeacherLayout（MVP 不为 ADMIN 单建 layout，
      // 与 student-profile 决策一致）。本步只注册 list + version-list 两条子路由；
      // form 三条（strategies/new、:strategyId/new-version、:strategyId/v/:version）
      // 在 Step 6 创建 StrategyFormView.vue 后再补，避免 lazy import 找不到模块致
      // typecheck 失败。
      path: '/admin',
      component: () => import('../views/teacher/TeacherLayout.vue'),
      children: [
        { path: '', redirect: '/admin/strategies' },
        {
          path: 'strategies',
          component: () => import('../views/admin/StrategyListView.vue')
        },
        {
          path: 'strategies/:strategyId',
          component: () => import('../views/admin/StrategyVersionListView.vue')
        },
        {
          // form 三条子路由（Step 6 补）——共用 StrategyFormView，按 route 判断模式
          path: 'strategies/new',
          component: () => import('../views/admin/StrategyFormView.vue')
        },
        {
          path: 'strategies/:strategyId/new-version',
          component: () => import('../views/admin/StrategyFormView.vue')
        },
        {
          path: 'strategies/:strategyId/v/:version',
          component: () => import('../views/admin/StrategyFormView.vue')
        }
      ]
    },
    {
      path: '/student',
      component: () => import('../views/student/StudentLayout.vue'),
      children: []
    }
  ]
})

// 全局路由守卫：/teacher 和 /student 前缀下所有路由均需登录
router.beforeEach((to) => {
  const authStore = useAuthStore()
  const protectedPrefixes = ['/teacher', '/student', '/admin']
  const needsAuth = protectedPrefixes.some((p) => to.path.startsWith(p))

  if (needsAuth && !authStore.isLoggedIn) {
    return { path: '/login' }
  }
})

export default router
