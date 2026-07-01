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
      children: []
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
  const protectedPrefixes = ['/teacher', '/student']
  const needsAuth = protectedPrefixes.some((p) => to.path.startsWith(p))

  if (needsAuth && !authStore.isLoggedIn) {
    return { path: '/login' }
  }
})

export default router
