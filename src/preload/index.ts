import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/**
 * 安全桥：只暴露明确白名单的 IPC 通道给渲染进程。
 * 渲染进程不得直接访问文件系统或 SQLite。
 * 每新增一个功能通道，必须在此处显式声明。
 */
const api = {
  auth: {
    login: (params: { username: string; password: string }) =>
      ipcRenderer.invoke('auth:login', params)
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
    abortSession: (params: unknown) => ipcRenderer.invoke('assessment:abortSession', params),
    triggerRedline: (params: unknown) => ipcRenderer.invoke('assessment:triggerRedline', params),
    calculateResult: (params: unknown) => ipcRenderer.invoke('assessment:calculateResult', params),
    submitOperationScores: (params: unknown) => ipcRenderer.invoke('assessment:submitOperationScores', params),
    getOperationScores: (params: unknown) => ipcRenderer.invoke('assessment:getOperationScores', params),
    submitJobSkillOfflineScores: (params: unknown) =>
      ipcRenderer.invoke('assessment:submitJobSkillOfflineScores', params),
    getJobSkillOfflineScores: (params: unknown) =>
      ipcRenderer.invoke('assessment:getJobSkillOfflineScores', params),
    recordTeacherObservation: (params: unknown) =>
      ipcRenderer.invoke('assessment:recordTeacherObservation', params),
    getTeacherObservations: (params: unknown) =>
      ipcRenderer.invoke('assessment:getTeacherObservations', params)
  },
  training: {
    createSession: (params: unknown) => ipcRenderer.invoke('training:createSession', params),
    listSessions:  (params: unknown) => ipcRenderer.invoke('training:listSessions', params),
    getSession:    (params: unknown) => ipcRenderer.invoke('training:getSession', params),
    startStep:     (params: unknown) => ipcRenderer.invoke('training:startStep', params),
    completeStep:  (params: unknown) => ipcRenderer.invoke('training:completeStep', params),
    skipStep:      (params: unknown) => ipcRenderer.invoke('training:skipStep', params),
    failStep:      (params: unknown) => ipcRenderer.invoke('training:failStep', params),
    retryStep:     (params: unknown) => ipcRenderer.invoke('training:retryStep', params)
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
