// IPC handlers — 按功能模块拆分，此处统一 import 注册
// 每个模块在自己的文件中调用 ipcMain.handle()
import { registerAuthHandlers } from './handlers/auth'
import { registerStudentHandlers } from './handlers/student'
import { registerStrategyHandlers } from './handlers/strategy'
import { registerAssessmentHandlers } from './handlers/assessment'
import { registerTrainingHandlers } from './handlers/training'
import { registerOperationScoringHandlers } from './handlers/operation-scoring'

registerAuthHandlers()
registerStudentHandlers()
registerStrategyHandlers()
registerAssessmentHandlers()
registerTrainingHandlers()
registerOperationScoringHandlers()

export {}
