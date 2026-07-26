import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import type { AuthRole } from '@shared/types/auth'

function homeForRole(role: AuthRole | null): string {
  if (role === 'STUDENT') {
    return '/student'
  }
  if (role === 'ADMIN') {
    return '/admin'
  }
  return '/teacher'
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    {
      path: '/login',
      meta: { anonymousOnly: true },
      component: () => import('../views/LoginView.vue')
    },
    {
      path: '/teacher',
      meta: { allowedRoles: ['TEACHER'] },
      component: () => import('../views/teacher/TeacherLayout.vue'),
      children: [
        { path: '', component: () => import('../views/teacher/TeacherHomeView.vue') },
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
          path: 'assessments/:sessionId/job-skill-scoring',
          component: () => import('../views/teacher/JobSkillScoringView.vue')
        },
        {
          path: 'assessments/:sessionId/observations',
          component: () => import('../views/teacher/TeacherObservationView.vue')
        },
        {
          path: 'trainings',
          component: () => import('../views/teacher/TrainingListView.vue')
        },
        {
          path: 'trainings/create',
          component: () => import('../views/teacher/TrainingCreateView.vue')
        },
        {
          path: 'reports',
          component: () => import('../views/teacher/ReportListView.vue')
        },
        {
          path: 'reports/:reportId',
          component: () => import('../views/teacher/ReportDetailView.vue')
        },
        {
          path: 'safety',
          component: () => import('../views/foundation/SafetyIncidentListView.vue')
        },
        {
          path: 'safety/:incidentId',
          component: () => import('../views/foundation/SafetyIncidentDetailView.vue')
        },
        {
          path: 'exceptions',
          component: () => import('../views/foundation/ExceptionListView.vue')
        },
        {
          path: 'exceptions/:errorEventId',
          component: () => import('../views/foundation/ExceptionDetailView.vue')
        }
      ]
    },
    {
      path: '/admin',
      meta: { allowedRoles: ['ADMIN'] },
      component: () => import('../views/admin/AdminLayout.vue'),
      children: [
        { path: '', component: () => import('../views/admin/AdminHomeView.vue') },
        {
          path: 'accounts',
          component: () => import('../views/admin/AccountManagementView.vue')
        },
        {
          path: 'strategies',
          component: () => import('../views/admin/StrategyListView.vue')
        },
        {
          path: 'strategies/:strategyId',
          component: () => import('../views/admin/StrategyVersionListView.vue')
        },
        {
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
        },
        {
          path: 'safety',
          component: () => import('../views/foundation/SafetyIncidentListView.vue')
        },
        {
          path: 'safety/:incidentId',
          component: () => import('../views/foundation/SafetyIncidentDetailView.vue')
        },
        {
          path: 'exceptions',
          component: () => import('../views/foundation/ExceptionListView.vue')
        },
        {
          path: 'exceptions/:errorEventId',
          component: () => import('../views/foundation/ExceptionDetailView.vue')
        },
        {
          path: 'readiness',
          component: () => import('../views/admin/SystemReadinessView.vue')
        }
      ]
    },
    {
      path: '/student',
      meta: { allowedRoles: ['STUDENT'] },
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
    },
    {
      path: '/:pathMatch(.*)*',
      component: () => import('../views/NotFoundView.vue')
    }
  ]
})

// 全局路由守卫：先向主进程恢复一次可信会话，再按路由 meta 控制页面体验。
// 主进程 auth_session 是最终权限来源；这里仅负责跳转体验，不代替 IPC 安全校验。
router.beforeEach(async (to) => {
  const authStore = useAuthStore()

  if (!authStore.initialized) {
    try {
      const restored = await window.api.auth.getCurrentSession()
      if (restored.success) {
        authStore.setUser(restored)
      } else {
        authStore.clear()
      }
    } catch (err) {
      console.error('[Router] failed to restore auth session:', err)
      authStore.clear()
    }
  }

  const allowedRoles = to.matched.flatMap((record) => {
    const roles = record.meta.allowedRoles
    return Array.isArray(roles) ? (roles as AuthRole[]) : []
  })
  const needsAuth = allowedRoles.length > 0
  const anonymousOnly = to.matched.some((record) => record.meta.anonymousOnly === true)

  if (needsAuth && !authStore.isLoggedIn) {
    return { path: '/login' }
  }

  if (authStore.isLoggedIn && anonymousOnly) {
    return { path: homeForRole(authStore.role) }
  }

  if (authStore.isLoggedIn && authStore.role && needsAuth && !allowedRoles.includes(authStore.role)) {
    return { path: homeForRole(authStore.role) }
  }
})

export default router
