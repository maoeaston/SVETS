// IPC handlers — 按功能模块拆分，此处统一 import 注册
// 每个模块在自己的文件中调用 ipcMain.handle()
import { registerAuthHandlers } from './handlers/auth'
import { registerStudentHandlers } from './handlers/student'
import { registerStrategyHandlers } from './handlers/strategy'
import { registerAssessmentHandlers } from './handlers/assessment'
import { registerTrainingHandlers } from './handlers/training'
import { registerOperationScoringHandlers } from './handlers/operation-scoring'
import { registerAbilityScoringHandlers } from './handlers/ability-scoring'
import { registerJobSkillScoringHandlers } from './handlers/job-skill-scoring'
import { registerObservationHandlers } from './handlers/observation'
import { registerAssignmentHandlers } from './handlers/assignment'
import { registerSafetyHandlers } from './handlers/safety'
import { registerFoundationHandlers } from './handlers/foundation'
import { registerResultsHandlers } from './handlers/results'
import { registerReportsHandlers } from './handlers/reports'

export function registerIpcHandlers(): void {
  registerAuthHandlers()
  registerStudentHandlers()
  registerStrategyHandlers()
  registerAssessmentHandlers()
  registerTrainingHandlers()
  registerOperationScoringHandlers()
  registerAbilityScoringHandlers()
  registerJobSkillScoringHandlers()
  registerObservationHandlers()
  registerAssignmentHandlers()
  registerSafetyHandlers()
  registerFoundationHandlers()
  registerResultsHandlers()
  registerReportsHandlers()
}
