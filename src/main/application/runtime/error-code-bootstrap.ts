import type { DBAdapter } from '../../db/interface'
import { seedAssessmentErrorCodes } from '../../ipc/handlers/assessment'
import { seedAuthErrorCodes } from '../services/auth-service'
import { seedStrategyErrorCodes } from '../services/strategy-service'
import { seedStudentErrorCodes } from '../services/student-service'
import {
  assertInternalMutationCapability,
  type InternalMutationCapability
} from './internal-mutation-capability'

const ERROR_CODE_SEEDERS = [
  seedAuthErrorCodes,
  seedStudentErrorCodes,
  seedStrategyErrorCodes,
  seedAssessmentErrorCodes
] as const

/** The only production owner for handler error-code seed groups. */
export function bootstrapErrorCodes(
  db: DBAdapter,
  capability: InternalMutationCapability
): void {
  assertInternalMutationCapability(capability, 'POST_DB_INIT_PRE_BOUNDARY_READY')
  db.transaction(() => {
    for (const seed of ERROR_CODE_SEEDERS) seed(db)
  })()
}
