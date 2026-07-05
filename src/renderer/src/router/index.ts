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
        },
        {
          path: 'assessments',
          component: () => import('../views/teacher/AssessmentListView.vue')
        },
        {
          path: 'assessments/new',
          component: () => import('../views/teacher/AssessmentCreateView.vue')
        },
        {
          path: 'assessments/:sessionId/scoring',
          component: () => import('../views/teacher/OperationScoringView.vue')
        },
        {
          path: 'trainings',
          component: () => import('../views/teacher/TrainingListView.vue')
        },
        {
          path: 'trainings/create',
          component: () => import('../views/teacher/TrainingCreateView.vue')
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
      children: [
        {
          path: '',
          component: () => import('../views/student/StudentHomeView.vue')
        },
        {
          path: 'assessment/:sessionId',
          component: () => import('../views/student/AssessmentView.vue')
        },
        {
          path: 'training/:sessionId',
          component: () => import('../views/student/TrainingView.vue')
        }
      ]
    }
  ]
})

// 全局路由守卫：登录 + role-prefix 检查。
// [!] role 检查避免教师误访问学生答题页等场景触发 handler FORBIDDEN（handler 兜底，
// 但 UX 差——用户看到"无权限"而非"页面不存在"）。
router.beforeEach((to) => {
  const authStore = useAuthStore()
  const protectedPrefixes = ['/teacher', '/student', '/admin']
  const needsAuth = protectedPrefixes.some((p) => to.path.startsWith(p))

  if (needsAuth && !authStore.isLoggedIn) {
    return { path: '/login' }
  }

  // role 与前缀匹配：ADMIN 复用 /teacher layout（MVP 决策），故 /teacher 允许 TEACHER + ADMIN
  if (authStore.isLoggedIn && authStore.role) {
    const role = authStore.role
    if (to.path.startsWith('/student') && role !== 'STUDENT') {
      // role ∈ {TEACHER, ADMIN} → 回 /teacher
      return { path: '/teacher' }
    }
    if (to.path.startsWith('/teacher') && role !== 'TEACHER' && role !== 'ADMIN') {
      // role === STUDENT → 回 /student
      return { path: '/student' }
    }
    if (to.path.startsWith('/admin') && role !== 'ADMIN') {
      // role ∈ {STUDENT, TEACHER} → 回 /teacher
      return { path: '/teacher' }
    }
  }
})

export default router
