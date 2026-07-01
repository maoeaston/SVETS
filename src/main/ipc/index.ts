// IPC handlers — 按功能模块拆分，此处统一 import 注册
// 每个模块在自己的文件中调用 ipcMain.handle()
import { registerAuthHandlers } from './handlers/auth'

registerAuthHandlers()

export {}
