// 渲染进程可调用的 IPC API 接口声明
// 每个功能模块在 src/main/ipc/handlers/ 中实现，此处同步声明类型

export interface LoginSuccess {
  success: true
  userId: string
  role: 'STUDENT' | 'TEACHER' | 'ADMIN'
  displayName: string
}

export interface LoginError {
  success: false
  errorCode: 'INVALID_CREDENTIALS' | 'ACCOUNT_DISABLED' | 'SYSTEM_ERROR'
}

export type LoginResult = LoginSuccess | LoginError

export interface IpcApi {
  auth: {
    login: (params: { username: string; password: string }) => Promise<LoginResult>
  }
}
