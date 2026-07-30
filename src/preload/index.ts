import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const mutationChannels = new Set([
  'auth:createTeacherAccount', 'auth:login', 'auth:logout', 'auth:setTeacherAccountStatus',
  'student:create', 'student:update', 'student:archive',
  'strategy:createVersion', 'strategy:update', 'strategy:setActive',
  'assessment:createSession', 'assessment:submitAnswer', 'assessment:startSession',
  'assessment:emotionInterrupt', 'assessment:emotionResume', 'assessment:pauseSitting',
  'assessment:startNextSitting', 'assessment:recordEmotionCollapse', 'assessment:abortSession',
  'assessment:triggerRedline', 'assessment:calculateResult', 'assessment:submitOfflineAbilityScores',
  'assessment:submitOperationScores', 'assessment:submitJobSkillOfflineScores', 'assessment:recordTeacherObservation',
  'safety:confirm', 'safety:resolve', 'safety:void', 'safety:replaceForFactualCorrection',
  'assignment:create', 'assignment:confirmStudent', 'assignment:startAssessment', 'assignment:rebind', 'assignment:release',
  'training:createSession', 'training:startStep', 'training:completeStep', 'training:skipStep', 'training:failStep', 'training:retryStep',
  'reports:confirmTaskClosure', 'reports:replaceTaskClosure', 'reports:generate', 'reports:confirmPlacementReview', 'reports:lock', 'reports:export'
])

const clientInstanceId = crypto.randomUUID()
const rawInvoke = ipcRenderer.invoke.bind(ipcRenderer)

// Renderer-facing signatures remain unchanged; metadata is attached only at
// the privileged boundary and is never supplied by business callers.
ipcRenderer.invoke = ((channel: string, ...args: unknown[]) => {
  if (!mutationChannels.has(channel)) return rawInvoke(channel, ...args)
  return rawInvoke(channel, ...args, {
    schemaVersion: 1,
    clientInstanceId,
    idempotencyKey: crypto.randomUUID(),
    deviceId: null
  })
}) as typeof ipcRenderer.invoke

/**
 * 安全桥：只暴露明确白名单的 IPC 通道给渲染进程。
 * 渲染进程不得直接访问文件系统或 SQLite。
 * 每新增一个功能通道，必须在此处显式声明。
 */
const api = {
  auth: {
    login: (params: { username: string; password: string }) =>
      ipcRenderer.invoke('auth:login', params),
    getCurrentSession: () => ipcRenderer.invoke('auth:getCurrentSession'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    listAccounts: (params: unknown) => ipcRenderer.invoke('auth:listAccounts', params),
    createTeacherAccount: (params: unknown) => ipcRenderer.invoke('auth:createTeacherAccount', params),
    setTeacherAccountStatus: (params: unknown) =>
      ipcRenderer.invoke('auth:setTeacherAccountStatus', params)
  },
  student: {
    list: (params: unknown) => ipcRenderer.invoke('student:list', params),
    get: (params: unknown) => ipcRenderer.invoke('student:get', params),
    create: (params: unknown) => ipcRenderer.invoke('student:create', params),
    update: (params: unknown) => ipcRenderer.invoke('student:update', params),
    archive: (params: unknown) => ipcRenderer.invoke('student:archive', params)
  },
  strategy: {
    list: (params: unknown) => ipcRenderer.invoke('strategy:list', params),
    get: (params: unknown) => ipcRenderer.invoke('strategy:get', params),
    listVersions: (params: unknown) => ipcRenderer.invoke('strategy:listVersions', params),
    createVersion: (params: unknown) => ipcRenderer.invoke('strategy:createVersion', params),
    update: (params: unknown) => ipcRenderer.invoke('strategy:update', params),
    setActive: (params: unknown) => ipcRenderer.invoke('strategy:setActive', params)
  },
  assessment: {
    createSession: (params: unknown) => ipcRenderer.invoke('assessment:createSession', params),
    getSession: (params: unknown) => ipcRenderer.invoke('assessment:getSession', params),
    listSessions: (params: unknown) => ipcRenderer.invoke('assessment:listSessions', params),
    submitAnswer: (params: unknown) => ipcRenderer.invoke('assessment:submitAnswer', params),
    startSession: (params: unknown) => ipcRenderer.invoke('assessment:startSession', params),
    listMySessions: (params: unknown) => ipcRenderer.invoke('assessment:listMySessions', params),
    emotionInterrupt: (params: unknown) => ipcRenderer.invoke('assessment:emotionInterrupt', params),
    emotionResume: (params: unknown) => ipcRenderer.invoke('assessment:emotionResume', params),
    pauseSitting: (params: unknown) => ipcRenderer.invoke('assessment:pauseSitting', params),
    startNextSitting: (params: unknown) => ipcRenderer.invoke('assessment:startNextSitting', params),
    recordEmotionCollapse: (params: unknown) => ipcRenderer.invoke('assessment:recordEmotionCollapse', params),
    abortSession: (params: unknown) => ipcRenderer.invoke('assessment:abortSession', params),
    triggerRedline: (params: unknown) => ipcRenderer.invoke('assessment:triggerRedline', params),
    calculateResult: (params: unknown) => ipcRenderer.invoke('assessment:calculateResult', params),
    submitOfflineAbilityScores: (params: unknown) =>
      ipcRenderer.invoke('assessment:submitOfflineAbilityScores', params),
    getOfflineAbilityScores: (params: unknown) =>
      ipcRenderer.invoke('assessment:getOfflineAbilityScores', params),
    submitOperationScores: (params: unknown) => ipcRenderer.invoke('assessment:submitOperationScores', params),
    getOperationScores: (params: unknown) => ipcRenderer.invoke('assessment:getOperationScores', params),
    submitJobSkillOfflineScores: (params: unknown) =>
      ipcRenderer.invoke('assessment:submitJobSkillOfflineScores', params),
    getJobSkillOfflineScores: (params: unknown) =>
      ipcRenderer.invoke('assessment:getJobSkillOfflineScores', params),
    getSessionScoringQuestions: (params: unknown) =>
      ipcRenderer.invoke('assessment:getSessionScoringQuestions', params),
    recordTeacherObservation: (params: unknown) =>
      ipcRenderer.invoke('assessment:recordTeacherObservation', params),
    getTeacherObservations: (params: unknown) =>
      ipcRenderer.invoke('assessment:getTeacherObservations', params)
  },
  safety: {
    list: (params: unknown) => ipcRenderer.invoke('safety:list', params),
    get: (params: unknown) => ipcRenderer.invoke('safety:get', params),
    confirm: (params: unknown) => ipcRenderer.invoke('safety:confirm', params),
    resolve: (params: unknown) => ipcRenderer.invoke('safety:resolve', params),
    void: (params: unknown) => ipcRenderer.invoke('safety:void', params),
    replaceForFactualCorrection: (params: unknown) =>
      ipcRenderer.invoke('safety:replaceForFactualCorrection', params)
  },
  assignment: {
    create: (params: unknown) => ipcRenderer.invoke('assignment:create', params),
    confirmStudent: (params: unknown) =>
      ipcRenderer.invoke('assignment:confirmStudent', params),
    startAssessment: (params: unknown) =>
      ipcRenderer.invoke('assignment:startAssessment', params),
    rebind: (params: unknown) => ipcRenderer.invoke('assignment:rebind', params),
    release: (params: unknown) => ipcRenderer.invoke('assignment:release', params)
  },
  training: {
    createSession: (params: unknown) => ipcRenderer.invoke('training:createSession', params),
    listSessions:  (params: unknown) => ipcRenderer.invoke('training:listSessions', params),
    listMySessions: (params: unknown) => ipcRenderer.invoke('training:listMySessions', params),
    getSession:    (params: unknown) => ipcRenderer.invoke('training:getSession', params),
    startStep:     (params: unknown) => ipcRenderer.invoke('training:startStep', params),
    completeStep:  (params: unknown) => ipcRenderer.invoke('training:completeStep', params),
    skipStep:      (params: unknown) => ipcRenderer.invoke('training:skipStep', params),
    failStep:      (params: unknown) => ipcRenderer.invoke('training:failStep', params),
    retryStep:     (params: unknown) => ipcRenderer.invoke('training:retryStep', params)
  },
  foundation: {
    getOverview: (params: unknown) => ipcRenderer.invoke('foundation:getOverview', params),
    listExceptions: (params: unknown) => ipcRenderer.invoke('foundation:listExceptions', params),
    getException: (params: unknown) => ipcRenderer.invoke('foundation:getException', params)
  },
  results: {
    getCurrent: (params: unknown) => ipcRenderer.invoke('results:getCurrent', params),
    listCurrentByStudent: (params: unknown) =>
      ipcRenderer.invoke('results:listCurrentByStudent', params)
  },
  reports: {
    list: (params: unknown) => ipcRenderer.invoke('reports:list', params),
    get: (params: unknown) => ipcRenderer.invoke('reports:get', params),
    listGenerationCandidates: (params: unknown) =>
      ipcRenderer.invoke('reports:listGenerationCandidates', params),
    confirmTaskClosure: (params: unknown) =>
      ipcRenderer.invoke('reports:confirmTaskClosure', params),
    replaceTaskClosure: (params: unknown) =>
      ipcRenderer.invoke('reports:replaceTaskClosure', params),
    generate: (params: unknown) => ipcRenderer.invoke('reports:generate', params),
    confirmPlacementReview: (params: unknown) =>
      ipcRenderer.invoke('reports:confirmPlacementReview', params),
    lock: (params: unknown) => ipcRenderer.invoke('reports:lock', params),
    export: (params: unknown) => ipcRenderer.invoke('reports:export', params)
  },
  runtime: {
    getHealth: () => ipcRenderer.invoke('runtime:getHealth')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('[Preload]', error)
  }
} else {
  // @ts-expect-error — 仅开发环境 contextIsolation 关闭时走这里
  window.electron = electronAPI
  // @ts-expect-error — 同上，window.api 全局挂载仅用于 dev contextIsolation 关闭场景
  window.api = api
}
