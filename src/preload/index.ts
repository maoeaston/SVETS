import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/**
 * 安全桥：只暴露明确白名单的 IPC 通道给渲染进程。
 * 渲染进程不得直接访问文件系统或 SQLite。
 * 每新增一个功能通道，必须在此处显式声明。
 */
const api = {
  // 占位符 — 按功能模块逐步添加，例如：
  // assessment: { start: (params) => ipcRenderer.invoke('assessment:start', params) }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('[Preload]', error)
  }
} else {
  // @ts-ignore — 仅开发环境 contextIsolation 关闭时走这里
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
