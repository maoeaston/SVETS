import type { IpcMainInvokeEvent } from 'electron'
import type { DBAdapter } from '../../db/interface'
import type { CanonicalJsonValue } from '../../domain/report-canonical'
import { readBaseTaskResultBinding } from '../../domain/report-source-reader'
import type { CollectedIpcHandler } from '../../ipc/legacy-handler-collector'
import {
  heartbeatAcceptedAuthSession,
  resolveBoundAuthSessionSnapshot
} from '../../utils/auth-session'
import { canonicalizeCommandRecord } from './command-envelope'
import {
  PUBLIC_ERROR_FAMILY_DEFAULT,
  createPreflightErrorMap,
  type PublicCommandErrorCode,
  type PublicErrorFamily
} from './public-error-contract'
import {
  CommandPreflightError,
  type AcceptedCommandContext,
  type CommandActor,
  type CommandPreflightReason,
  type CommandTargetResolverKind,
  type MutationCommandDefinition,
  type PreflightErrorDetailMap,
  type UserCommandRole
} from './command-types'

type CanonicalRecord = Record<string, CanonicalJsonValue>
type RequiredKind = 'NON_EMPTY_STRING' | 'POSITIVE_INTEGER' | 'PLAIN_OBJECT' | 'ARRAY' | 'STRING_TUPLE_3'

interface RequiredField {
  readonly path: string
  readonly kind: RequiredKind
  readonly failureReason: CommandPreflightReason
}

interface ValidatedMutationInput {
  readonly candidate: CanonicalRecord
  readonly callerUserId?: CanonicalJsonValue
  readonly callerRole?: CanonicalJsonValue
}

interface TargetResolutionSpec {
  readonly kind: CommandTargetResolverKind
  readonly owner: string
  readonly locatorFields: readonly string[]
  readonly authoritativeFields: readonly string[]
  readonly canonicalTargetFields: readonly string[]
  readonly clientHintFields: readonly string[]
  readonly stripPayloadFields: readonly string[]
  readonly executionFieldMap?: Readonly<Record<string, string>>
  readonly enforceStudentOwner?: boolean
  resolve(db: DBAdapter, input: CanonicalRecord, actor: CommandActor): Record<string, unknown>
}

interface MutationChannelSpec {
  readonly channel: string
  readonly roles: readonly UserCommandRole[] | 'UNAUTHENTICATED'
  readonly errorFamily: PublicErrorFamily
  readonly supportsForbidden: boolean
  readonly supportsNotFound: boolean
  readonly supportsValidation: boolean
  readonly required: readonly RequiredField[]
  readonly target: TargetResolutionSpec
  readonly sideEffects: readonly string[]
  readonly testReferences: readonly string[]
  readonly preflightErrorDetails: PreflightErrorDetailMap<PublicCommandErrorCode>
  readonly transactionOwner: string
}

export interface M5AMutationDefinitionDependencies {
  readonly db: DBAdapter
  eventForTransport(transportId: string): IpcMainInvokeEvent
  handlerForChannel(channel: string): CollectedIpcHandler
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function valueAt(record: CanonicalRecord, path: string): CanonicalJsonValue | undefined {
  let current: CanonicalJsonValue = record
  for (const segment of path.split('.')) {
    if (!isPlainRecord(current)) return undefined
    current = current[segment] as CanonicalJsonValue
    if (current === undefined) return undefined
  }
  return current
}

function requireFields(record: CanonicalRecord, fields: readonly RequiredField[]): void {
  for (const field of fields) {
    const value = valueAt(record, field.path)
    const valid = field.kind === 'NON_EMPTY_STRING'
      ? typeof value === 'string' && value.trim().length > 0
      : field.kind === 'POSITIVE_INTEGER'
        ? typeof value === 'number' && Number.isInteger(value) && value >= 1
        : field.kind === 'PLAIN_OBJECT'
          ? isPlainRecord(value)
          : field.kind === 'ARRAY'
            ? Array.isArray(value)
            : Array.isArray(value)
              && value.length === 3
              && value.every((item) => typeof item === 'string' && item.trim().length > 0)
    if (!valid) throw new CommandPreflightError(field.failureReason, field.path)
  }
}

function validateInput(rawInput: unknown, spec: MutationChannelSpec): ValidatedMutationInput {
  const normalized = rawInput === undefined && spec.required.length === 0 ? {} : rawInput
  const candidate = canonicalizeCommandRecord(normalized, '$.input')
  requireFields(candidate, spec.required)
  const callerUserId = candidate.callerUserId
  const callerRole = candidate.callerRole
  if (callerUserId !== undefined && typeof callerUserId !== 'string') {
    throw new CommandPreflightError('INVALID_PAYLOAD', 'callerUserId')
  }
  if (callerRole !== undefined && typeof callerRole !== 'string') {
    throw new CommandPreflightError('INVALID_PAYLOAD', 'callerRole')
  }
  delete candidate.callerUserId
  delete candidate.callerRole
  return Object.freeze({ candidate: Object.freeze(candidate), callerUserId, callerRole })
}

function requireString(input: CanonicalRecord, field: string): string {
  const value = input[field]
  if (typeof value !== 'string' || !value.trim()) throw new CommandPreflightError('INVALID_PAYLOAD', field)
  return value
}

function requireInteger(input: CanonicalRecord, field: string): number {
  const value = input[field]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new CommandPreflightError('INVALID_PAYLOAD', field)
  }
  return value
}

function targetNotFound(detail: string): never {
  throw new CommandPreflightError('TARGET_NOT_FOUND', detail)
}

function targetMismatch(detail: string): never {
  throw new CommandPreflightError('TARGET_MISMATCH', detail)
}

function canonicalEqual(left: CanonicalJsonValue, right: CanonicalJsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function compareHints(
  input: CanonicalRecord,
  target: Record<string, unknown>,
  hints: Readonly<Record<string, string>>
): void {
  for (const [inputField, targetField] of Object.entries(hints)) {
    const hint = input[inputField]
    if (hint === undefined) continue
    const authoritative = target[targetField] as CanonicalJsonValue
    if (!canonicalEqual(hint, authoritative)) targetMismatch(inputField)
  }
}

function usernameCreateTarget(
  owner: string,
  aggregateType: string,
  extra: Record<string, CanonicalJsonValue> = {}
): TargetResolutionSpec {
  return {
    kind: 'CREATE_FROM_VALIDATED_REFERENCES',
    owner,
    locatorFields: ['username'],
    authoritativeFields: ['validated normalized username'],
    canonicalTargetFields: ['aggregate_type', 'normalized_username', ...Object.keys(extra)],
    clientHintFields: ['username'],
    stripPayloadFields: [],
    resolve(_db, input) {
      return {
        aggregate_type: aggregateType,
        normalized_username: requireString(input, 'username').trim(),
        ...extra
      }
    }
  }
}

function actorTarget(owner: string): TargetResolutionSpec {
  return {
    kind: 'ACTOR_SCOPED',
    owner,
    locatorFields: [],
    authoritativeFields: ['auth_session.auth_session_id', 'auth_session.user_id'],
    canonicalTargetFields: ['aggregate_type', 'auth_session_id', 'user_id'],
    clientHintFields: ['callerUserId', 'callerRole'],
    stripPayloadFields: [],
    resolve: (_db, _input, actor) => {
      if (actor.kind !== 'USER') throw new CommandPreflightError('INVALID_ACTOR')
      return {
        aggregate_type: 'AUTH_SESSION',
        auth_session_id: actor.authSessionId,
        user_id: actor.userId
      }
    }
  }
}

function assessmentTarget(owner: string, enforceStudentOwner = false): TargetResolutionSpec {
  return {
    kind: 'EXISTING_AGGREGATE',
    owner,
    locatorFields: ['sessionId'],
    authoritativeFields: [
      'assessment_session.session_id',
      'assessment_session.student_id',
      'assessment_session.job_code',
      'assessment_session.task_code'
    ],
    canonicalTargetFields: ['aggregate_type', 'session_id', 'student_id', 'job_code', 'task_code'],
    clientHintFields: ['studentId', 'jobCode', 'taskCode'],
    stripPayloadFields: ['sessionId', 'studentId', 'jobCode', 'taskCode'],
    executionFieldMap: { session_id: 'sessionId' },
    enforceStudentOwner,
    resolve(db, input) {
      const sessionId = requireString(input, 'sessionId')
      const row = db.prepare(
        `SELECT session_id, student_id, job_code, task_code
           FROM assessment_session
          WHERE session_id = ?`
      ).get(sessionId) as {
        session_id: string
        student_id: string
        job_code: string
        task_code: string
      } | undefined
      if (!row) targetNotFound('assessment_session')
      const target = { aggregate_type: 'ASSESSMENT_SESSION', ...row }
      compareHints(input, target, { studentId: 'student_id', jobCode: 'job_code', taskCode: 'task_code' })
      return target
    }
  }
}

function createSessionTarget(
  owner: string,
  expectedStrategyTypes?: string | readonly string[]
): TargetResolutionSpec {
  return {
    kind: 'CREATE_FROM_VALIDATED_REFERENCES',
    owner,
    locatorFields: ['studentId', 'strategyId', 'strategyVersion', 'taskCode'],
    authoritativeFields: [
      'student_profile.student_id',
      'strategy_config.strategy_id',
      'strategy_config.version',
      'strategy_config.job_code',
      'strategy_config.strategy_type'
    ],
    canonicalTargetFields: [
      'aggregate_type', 'student_id', 'job_code', 'task_code',
      'strategy_id', 'strategy_version', 'strategy_type'
    ],
    clientHintFields: ['studentId', 'taskCode'],
    stripPayloadFields: ['studentId', 'strategyId', 'strategyVersion', 'taskCode'],
    executionFieldMap: {
      student_id: 'studentId',
      strategy_id: 'strategyId',
      strategy_version: 'strategyVersion',
      task_code: 'taskCode'
    },
    resolve(db, input) {
      const studentId = requireString(input, 'studentId')
      const strategyId = requireString(input, 'strategyId')
      const strategyVersion = requireInteger(input, 'strategyVersion')
      const taskCode = requireString(input, 'taskCode')
      const student = db.prepare(
        `SELECT s.student_id
           FROM student_profile s
           JOIN user_account u ON u.user_id = s.student_id
          WHERE s.student_id = ? AND s.status = 'ACTIVE' AND u.status = 'ACTIVE'`
      ).get(studentId) as { student_id: string } | undefined
      if (!student) targetNotFound('student_profile')
      const strategy = db.prepare(
        `SELECT strategy_id, version, job_code, strategy_type
           FROM strategy_config
          WHERE strategy_id = ? AND version = ?`
      ).get(strategyId, strategyVersion) as {
        strategy_id: string
        version: number
        job_code: string
        strategy_type: string
      } | undefined
      if (!strategy) targetNotFound('strategy_config')
      const allowedStrategyTypes = typeof expectedStrategyTypes === 'string'
        ? [expectedStrategyTypes]
        : expectedStrategyTypes
      if (allowedStrategyTypes && !allowedStrategyTypes.includes(strategy.strategy_type)) {
        throw new CommandPreflightError('INVALID_PAYLOAD', 'strategyType')
      }
      return {
        aggregate_type: allowedStrategyTypes?.length === 1 && allowedStrategyTypes[0] === 'TRAINING_PRACTICE'
          ? 'TRAINING_SESSION'
          : 'ASSESSMENT_SESSION',
        student_id: student.student_id,
        job_code: strategy.job_code,
        task_code: taskCode,
        strategy_id: strategy.strategy_id,
        strategy_version: strategy.version,
        strategy_type: strategy.strategy_type
      }
    }
  }
}

function trainingStepTarget(owner: string): TargetResolutionSpec {
  return {
    kind: 'EXISTING_AGGREGATE',
    owner,
    locatorFields: ['trainingSessionId', 'stepRecordId'],
    authoritativeFields: [
      'training_step_record.training_step_record_id',
      'training_session.training_session_id',
      'training_session.student_id',
      'training_session.job_code',
      'training_session.task_code'
    ],
    canonicalTargetFields: [
      'aggregate_type', 'training_session_id', 'step_record_id',
      'student_id', 'job_code', 'task_code'
    ],
    clientHintFields: ['trainingSessionId', 'stepRecordId'],
    stripPayloadFields: ['trainingSessionId', 'stepRecordId'],
    executionFieldMap: {
      training_session_id: 'trainingSessionId',
      step_record_id: 'stepRecordId'
    },
    enforceStudentOwner: true,
    resolve(db, input) {
      const requestedSessionId = input.trainingSessionId
      if (typeof requestedSessionId !== 'string' || !requestedSessionId.trim()) {
        targetNotFound('training_session')
      }
      const session = db.prepare(
        `SELECT training_session_id, student_id, job_code, task_code
           FROM training_session WHERE training_session_id = ?`
      ).get(requestedSessionId) as {
        training_session_id: string
        student_id: string
        job_code: string
        task_code: string
      } | undefined
      if (!session) targetNotFound('training_session')
      const stepRecordId = input.stepRecordId
      if (typeof stepRecordId !== 'string' || !stepRecordId.trim()) {
        targetMismatch('training_step_record')
      }
      const step = db.prepare(
        `SELECT training_step_record_id
           FROM training_step_record
          WHERE training_step_record_id = ? AND training_session_id = ?`
      ).get(stepRecordId, requestedSessionId) as { training_step_record_id: string } | undefined
      if (!step) targetMismatch('training_step_record')
      return {
        aggregate_type: 'TRAINING_SESSION',
        training_session_id: session.training_session_id,
        step_record_id: step.training_step_record_id,
        student_id: session.student_id,
        job_code: session.job_code,
        task_code: session.task_code
      }
    }
  }
}

function studentTarget(owner: string): TargetResolutionSpec {
  return {
    kind: 'EXISTING_AGGREGATE',
    owner,
    locatorFields: ['studentId'],
    authoritativeFields: ['student_profile.student_id'],
    canonicalTargetFields: ['aggregate_type', 'student_id'],
    clientHintFields: ['studentId'],
    stripPayloadFields: ['studentId'],
    executionFieldMap: { student_id: 'studentId' },
    resolve(db, input) {
      const studentId = requireString(input, 'studentId')
      const row = db.prepare('SELECT student_id FROM student_profile WHERE student_id = ?')
        .get(studentId) as { student_id: string } | undefined
      if (!row) targetNotFound('student_profile')
      return { aggregate_type: 'STUDENT_PROFILE', student_id: row.student_id }
    }
  }
}

function strategyTarget(owner: string): TargetResolutionSpec {
  return {
    kind: 'EXISTING_AGGREGATE',
    owner,
    locatorFields: ['strategyId', 'version'],
    authoritativeFields: [
      'strategy_config.strategy_id', 'strategy_config.version',
      'strategy_config.strategy_type', 'strategy_config.job_code'
    ],
    canonicalTargetFields: ['aggregate_type', 'strategy_id', 'version', 'strategy_type', 'job_code'],
    clientHintFields: ['strategyId', 'version'],
    stripPayloadFields: ['strategyId', 'version'],
    executionFieldMap: { strategy_id: 'strategyId', version: 'version' },
    resolve(db, input) {
      const strategyId = requireString(input, 'strategyId')
      const version = requireInteger(input, 'version')
      const row = db.prepare(
        `SELECT strategy_id, version, strategy_type, job_code
           FROM strategy_config WHERE strategy_id = ? AND version = ?`
      ).get(strategyId, version) as {
        strategy_id: string
        version: number
        strategy_type: string
        job_code: string
      } | undefined
      if (!row) targetNotFound('strategy_config')
      return { aggregate_type: 'STRATEGY_CONFIG', ...row }
    }
  }
}

function strategyCreateTarget(owner: string): TargetResolutionSpec {
  return {
    kind: 'CREATE_FROM_VALIDATED_REFERENCES',
    owner,
    locatorFields: ['strategy.strategyId', 'strategy.version'],
    authoritativeFields: ['strategy_config.strategy_id', 'strategy_config.strategy_type', 'strategy_config.job_code'],
    canonicalTargetFields: ['aggregate_type', 'strategy_id', 'version', 'strategy_type', 'job_code'],
    clientHintFields: ['strategy.strategyId', 'strategy.version', 'strategy.strategyType', 'strategy.jobCode'],
    stripPayloadFields: [],
    resolve(db, input) {
      const strategy = input.strategy
      if (!isPlainRecord(strategy)) throw new CommandPreflightError('INVALID_PAYLOAD', 'strategy')
      const strategyId = strategy.strategyId
      const version = strategy.version
      const strategyType = strategy.strategyType
      const jobCode = strategy.jobCode
      if (typeof strategyId !== 'string' || !strategyId.trim()) throw new CommandPreflightError('INVALID_PAYLOAD', 'strategy.strategyId')
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new CommandPreflightError('INVALID_PAYLOAD', 'strategy.version')
      if (typeof strategyType !== 'string' || !strategyType.trim()) throw new CommandPreflightError('INVALID_PAYLOAD', 'strategy.strategyType')
      if (typeof jobCode !== 'string' || !jobCode.trim()) throw new CommandPreflightError('INVALID_PAYLOAD', 'strategy.jobCode')
      const family = db.prepare(
        `SELECT strategy_type, job_code FROM strategy_config
          WHERE strategy_id = ? ORDER BY version ASC LIMIT 1`
      ).get(strategyId) as { strategy_type: string; job_code: string } | undefined
      if (version > 1 && !family) targetNotFound('strategy_config_family')
      if (version > 1 && family?.strategy_type !== strategyType) {
        targetMismatch('strategy.strategyType')
      }
      if (version > 1 && family?.job_code !== jobCode) {
        targetMismatch('strategy.jobCode')
      }
      return {
        aggregate_type: 'STRATEGY_CONFIG',
        strategy_id: strategyId,
        version,
        strategy_type: version > 1 ? family!.strategy_type : strategyType,
        job_code: version > 1 ? family!.job_code : jobCode
      }
    }
  }
}

function teacherAccountTarget(owner: string): TargetResolutionSpec {
  return {
    kind: 'EXISTING_AGGREGATE',
    owner,
    locatorFields: ['teacherUserId'],
    authoritativeFields: ['user_account.user_id', 'user_account.role'],
    canonicalTargetFields: ['aggregate_type', 'teacher_user_id', 'role'],
    clientHintFields: ['teacherUserId'],
    stripPayloadFields: ['teacherUserId'],
    executionFieldMap: { teacher_user_id: 'teacherUserId' },
    resolve(db, input) {
      const userId = requireString(input, 'teacherUserId')
      const row = db.prepare('SELECT user_id, role FROM user_account WHERE user_id = ?')
        .get(userId) as { user_id: string; role: string } | undefined
      if (!row || row.role !== 'TEACHER') targetNotFound('teacher user_account')
      return { aggregate_type: 'USER_ACCOUNT', teacher_user_id: row.user_id, role: row.role }
    }
  }
}

function assignmentTarget(owner: string): TargetResolutionSpec {
  return {
    kind: 'EXISTING_AGGREGATE',
    owner,
    locatorFields: ['assignmentId'],
    authoritativeFields: [
      'business_session_assignment.assignment_id',
      'business_session.business_session_id',
      'business_session.student_id',
      'business_session.job_code',
      'business_session.task_code',
      'assessment_session.session_id/delivery_phase',
      'delegated_access_grant.grant_id/status/runtime/auth/teacher',
      'device_runtime_session.device_id/status',
      'auth_session.status'
    ],
    canonicalTargetFields: [
      'aggregate_type', 'assignment_id', 'business_session_id',
      'session_id', 'student_id', 'job_code', 'task_code',
      'assignment_status', 'assignment_version', 'grant_id', 'grant_status',
      'device_id', 'device_runtime_session_id', 'runtime_status',
      'teacher_auth_session_id', 'auth_session_status', 'teacher_user_id',
      'delivery_phase'
    ],
    clientHintFields: ['assignmentId', 'businessSessionId', 'studentId', 'jobCode', 'taskCode'],
    stripPayloadFields: ['assignmentId', 'businessSessionId', 'studentId', 'jobCode', 'taskCode'],
    executionFieldMap: { assignment_id: 'assignmentId' },
    resolve(db, input) {
      const assignmentId = requireString(input, 'assignmentId')
      const row = db.prepare(
        `SELECT bsa.assignment_id, bs.business_session_id, a.session_id,
                bs.student_id, bs.job_code, bs.task_code,
                bsa.status AS assignment_status, bsa.version AS assignment_version,
                g.grant_id, g.status AS grant_status,
                g.device_runtime_session_id, drs.device_id, drs.status AS runtime_status,
                g.teacher_auth_session_id, auth.status AS auth_session_status,
                g.teacher_user_id, a.delivery_phase
           FROM business_session_assignment bsa
           JOIN business_session bs ON bs.business_session_id = bsa.business_session_id
           JOIN assessment_session a ON a.business_session_id = bs.business_session_id
           JOIN delegated_access_grant g ON g.grant_id = bsa.grant_id
           JOIN device_runtime_session drs ON drs.device_runtime_session_id = g.device_runtime_session_id
           JOIN auth_session auth ON auth.auth_session_id = g.teacher_auth_session_id
          WHERE bsa.assignment_id = ?`
      ).get(assignmentId) as {
        assignment_id: string
        business_session_id: string
        session_id: string
        student_id: string
        job_code: string
        task_code: string
        assignment_status: string
        assignment_version: number
        grant_id: string
        grant_status: string
        device_runtime_session_id: string
        device_id: string
        runtime_status: string
        teacher_auth_session_id: string
        auth_session_status: string
        teacher_user_id: string
        delivery_phase: string
      } | undefined
      if (!row) targetNotFound('business_session_assignment')
      const target = { aggregate_type: 'BUSINESS_SESSION_ASSIGNMENT', ...row }
      compareHints(input, target, {
        businessSessionId: 'business_session_id',
        studentId: 'student_id',
        jobCode: 'job_code',
        taskCode: 'task_code'
      })
      return target
    }
  }
}

function assignmentCreateTarget(owner: string): TargetResolutionSpec {
  return {
    kind: 'CREATE_FROM_VALIDATED_REFERENCES',
    owner,
    locatorFields: ['businessSessionId'],
    authoritativeFields: [
      'business_session.business_session_id', 'business_session.student_id',
      'business_session.job_code', 'business_session.task_code',
      'assessment_session.session_id/status/delivery_phase',
      'business_session_assignment.assignment_id/status',
      'delegated_access_grant.grant_id/status/runtime/auth',
      'device_runtime_session.device_id/status',
      'auth_session.status'
    ],
    canonicalTargetFields: [
      'aggregate_type', 'business_session_id', 'session_id', 'student_id', 'job_code', 'task_code',
      'assessment_status', 'delivery_phase', 'current_assignment_id', 'current_assignment_status',
      'current_grant_id', 'current_grant_status', 'current_runtime_id', 'current_runtime_status',
      'current_device_id', 'current_auth_session_id', 'current_auth_session_status'
    ],
    clientHintFields: ['businessSessionId', 'studentId', 'jobCode', 'taskCode'],
    stripPayloadFields: ['businessSessionId', 'studentId', 'jobCode', 'taskCode'],
    executionFieldMap: { business_session_id: 'businessSessionId' },
    resolve(db, input) {
      const businessSessionId = requireString(input, 'businessSessionId')
      const row = db.prepare(
        `SELECT bs.business_session_id, a.session_id, bs.student_id, bs.job_code, bs.task_code,
                a.status AS assessment_status, a.delivery_phase,
                bsa.assignment_id AS current_assignment_id,
                bsa.status AS current_assignment_status,
                g.grant_id AS current_grant_id, g.status AS current_grant_status,
                drs.device_runtime_session_id AS current_runtime_id,
                drs.status AS current_runtime_status, drs.device_id AS current_device_id,
                auth.auth_session_id AS current_auth_session_id,
                auth.status AS current_auth_session_status
           FROM business_session bs
           JOIN assessment_session a ON a.business_session_id = bs.business_session_id
      LEFT JOIN business_session_assignment bsa ON bsa.business_session_id = bs.business_session_id
      LEFT JOIN delegated_access_grant g ON g.grant_id = bsa.grant_id
      LEFT JOIN device_runtime_session drs ON drs.device_runtime_session_id = g.device_runtime_session_id
      LEFT JOIN auth_session auth ON auth.auth_session_id = g.teacher_auth_session_id
          WHERE bs.business_session_id = ? AND bs.session_type = 'ASSESSMENT'`
      ).get(businessSessionId) as {
        business_session_id: string
        session_id: string
        student_id: string
        job_code: string
        task_code: string
        assessment_status: string
        delivery_phase: string
        current_assignment_id: string | null
        current_assignment_status: string | null
        current_grant_id: string | null
        current_grant_status: string | null
        current_runtime_id: string | null
        current_runtime_status: string | null
        current_device_id: string | null
        current_auth_session_id: string | null
        current_auth_session_status: string | null
      } | undefined
      if (!row) targetNotFound('assessment business_session')
      const target = { aggregate_type: 'BUSINESS_SESSION', ...row }
      compareHints(input, target, { studentId: 'student_id', jobCode: 'job_code', taskCode: 'task_code' })
      return target
    }
  }
}

function safetyTarget(owner: string): TargetResolutionSpec {
  return {
    kind: 'EXISTING_AGGREGATE',
    owner,
    locatorFields: ['incidentId'],
    authoritativeFields: [
      'safety_incident.incident_id', 'safety_incident.student_id',
      'safety_incident.job_code', 'safety_incident.task_code',
      'safety_incident.status/confirmed_by/replacement_incident_id/requires_review_before_next_session'
    ],
    canonicalTargetFields: [
      'aggregate_type', 'incident_id', 'student_id', 'job_code', 'task_code',
      'incident_status', 'confirmed_by', 'replacement_incident_id', 'requires_review_before_next_session'
    ],
    clientHintFields: ['incidentId', 'studentId', 'jobCode', 'taskCode'],
    stripPayloadFields: ['incidentId', 'studentId', 'jobCode', 'taskCode'],
    executionFieldMap: { incident_id: 'incidentId' },
    resolve(db, input) {
      const incidentId = requireString(input, 'incidentId')
      const row = db.prepare(
        `SELECT incident_id, student_id, job_code, task_code,
                status AS incident_status, confirmed_by, replacement_incident_id,
                requires_review_before_next_session
           FROM safety_incident WHERE incident_id = ?`
      ).get(incidentId) as {
        incident_id: string
        student_id: string
        job_code: string
        task_code: string
        incident_status: string
        confirmed_by: string | null
        replacement_incident_id: string | null
        requires_review_before_next_session: number
      } | undefined
      if (!row) targetNotFound('safety_incident')
      const target = { aggregate_type: 'SAFETY_INCIDENT', ...row }
      compareHints(input, target, { studentId: 'student_id', jobCode: 'job_code', taskCode: 'task_code' })
      return target
    }
  }
}

function closureTarget(owner: string, replacement: boolean): TargetResolutionSpec {
  return {
    kind: replacement ? 'EXISTING_AGGREGATE' : 'CREATE_FROM_VALIDATED_REFERENCES',
    owner,
    locatorFields: replacement ? ['taskClosureId', 'resultIds'] : ['resultIds'],
    authoritativeFields: [
      'result_record.result_id/source_aggregate_id/job_code',
      'assessment_session.task_code', 'training_session.task_code',
      ...(replacement ? ['task_closure.task_closure_id/student_id/job_code/task_code'] : [])
    ],
    canonicalTargetFields: [
      'aggregate_type', 'student_id', 'job_code', 'task_code', 'source_result_ids',
      ...(replacement ? ['task_closure_id'] : [])
    ],
    clientHintFields: replacement ? ['taskClosureId', 'resultIds'] : ['resultIds'],
    stripPayloadFields: replacement ? ['taskClosureId', 'resultIds'] : ['resultIds'],
    executionFieldMap: replacement
      ? { task_closure_id: 'taskClosureId', source_result_ids: 'resultIds' }
      : { source_result_ids: 'resultIds' },
    resolve(db, input) {
      const ids = input.resultIds
      if (!Array.isArray(ids) || ids.length !== 3 || ids.some((id) => typeof id !== 'string')) {
        throw new CommandPreflightError('INVALID_PAYLOAD', 'resultIds')
      }
      let binding
      try {
        binding = readBaseTaskResultBinding(db, ids as string[])
      } catch {
        const found = (db.prepare(
          `SELECT COUNT(*) AS count FROM result_record
            WHERE result_id IN (?, ?, ?)`
        ).get(...ids) as { count: number }).count
        if (found === 3) targetMismatch('resultIds')
        targetNotFound('result_record')
      }
      const target: Record<string, unknown> = {
        aggregate_type: 'TASK_CLOSURE',
        student_id: binding.studentId,
        job_code: binding.jobCode,
        task_code: binding.taskCode,
        source_result_ids: binding.sourceResultIds
      }
      if (replacement) {
        const closureId = requireString(input, 'taskClosureId')
        const closure = db.prepare(
          `SELECT task_closure_id, student_id, job_code, task_code
             FROM task_closure WHERE task_closure_id = ?`
        ).get(closureId) as {
          task_closure_id: string
          student_id: string
          job_code: string
          task_code: string
        } | undefined
        if (!closure) targetNotFound('task_closure')
        if (
          closure.student_id !== binding.studentId
          || closure.job_code !== binding.jobCode
          || closure.task_code !== binding.taskCode
        ) targetMismatch('taskClosureId')
        target.task_closure_id = closure.task_closure_id
      }
      return target
    }
  }
}

function reportTarget(owner: string): TargetResolutionSpec {
  return {
    kind: 'EXISTING_AGGREGATE',
    owner,
    locatorFields: ['reportId'],
    authoritativeFields: [
      'task_report.report_id/student_id/task_closure_id/source_aggregate_type/source_aggregate_id',
      'task_closure.job_code/task_code', 'safety_incident.job_code/task_code',
      'assessment_session.job_code/task_code', 'training_session.job_code/task_code'
    ],
    canonicalTargetFields: ['aggregate_type', 'report_id', 'student_id', 'job_code', 'task_code'],
    clientHintFields: ['reportId'],
    stripPayloadFields: ['reportId'],
    executionFieldMap: { report_id: 'reportId' },
    resolve(db, input) {
      const reportId = requireString(input, 'reportId')
      const row = db.prepare(
        `SELECT r.report_id, r.student_id,
                COALESCE(tc.job_code, si.job_code, a.job_code, t.job_code) AS job_code,
                COALESCE(tc.task_code, si.task_code, a.task_code, t.task_code) AS task_code
           FROM task_report r
           LEFT JOIN task_closure tc ON tc.task_closure_id = r.task_closure_id
           LEFT JOIN safety_incident si
             ON r.source_aggregate_type = 'SAFETY_INCIDENT' AND si.incident_id = r.source_aggregate_id
           LEFT JOIN assessment_session a
             ON r.source_aggregate_type = 'ASSESSMENT_SESSION' AND a.session_id = r.source_aggregate_id
           LEFT JOIN training_session t
             ON r.source_aggregate_type = 'TRAINING_SESSION' AND t.training_session_id = r.source_aggregate_id
          WHERE r.report_id = ?`
      ).get(reportId) as {
        report_id: string
        student_id: string | null
        job_code: string | null
        task_code: string | null
      } | undefined
      if (!row) targetNotFound('task_report')
      return { aggregate_type: 'TASK_REPORT', ...row }
    }
  }
}

function reportGenerationTarget(owner: string): TargetResolutionSpec {
  return {
    kind: 'EXISTING_AGGREGATE',
    owner,
    locatorFields: ['reportScope', 'taskClosureId|resultId|incidentId'],
    authoritativeFields: [
      'task_closure.student_id/job_code/task_code',
      'result_record.student_id/job_code/source_aggregate_id',
      'assessment_session.task_code',
      'safety_incident.student_id/job_code/task_code'
    ],
    canonicalTargetFields: [
      'aggregate_type', 'report_scope', 'source_id', 'student_id', 'job_code', 'task_code'
    ],
    clientHintFields: ['reportScope', 'taskClosureId', 'resultId', 'incidentId'],
    stripPayloadFields: ['reportScope', 'taskClosureId', 'resultId', 'incidentId'],
    resolve(db, input) {
      const scope = requireString(input, 'reportScope')
      if (scope === 'BASE_ABILITY') {
        const sourceId = requireString(input, 'taskClosureId')
        const row = db.prepare(
          `SELECT task_closure_id AS source_id, student_id, job_code, task_code
             FROM task_closure WHERE task_closure_id = ?`
        ).get(sourceId) as { source_id: string; student_id: string; job_code: string; task_code: string } | undefined
        if (!row) targetNotFound('task_closure')
        return { aggregate_type: 'TASK_REPORT', report_scope: scope, ...row }
      }
      if (scope === 'JOB_SKILL') {
        const sourceId = requireString(input, 'resultId')
        const row = db.prepare(
          `SELECT r.result_id AS source_id, r.student_id, r.job_code, a.task_code
             FROM result_record r
             JOIN assessment_session a
               ON r.source_aggregate_type = 'ASSESSMENT_SESSION'
              AND a.session_id = r.source_aggregate_id
            WHERE r.result_id = ? AND r.result_type = 'JOB_SKILL_SCORE'`
        ).get(sourceId) as { source_id: string; student_id: string; job_code: string; task_code: string } | undefined
        if (!row) targetNotFound('JOB_SKILL result_record')
        return { aggregate_type: 'TASK_REPORT', report_scope: scope, ...row }
      }
      if (scope === 'SAFETY') {
        const sourceId = requireString(input, 'incidentId')
        const row = db.prepare(
          `SELECT incident_id AS source_id, student_id, job_code, task_code
             FROM safety_incident WHERE incident_id = ?`
        ).get(sourceId) as { source_id: string; student_id: string; job_code: string; task_code: string } | undefined
        if (!row) targetNotFound('safety_incident')
        return { aggregate_type: 'TASK_REPORT', report_scope: scope, ...row }
      }
      throw new CommandPreflightError('INVALID_PAYLOAD', 'reportScope')
    },
    executionFieldMap: {
      report_scope: 'reportScope'
    }
  }
}

const required = {
  string: (path: string, failureReason: CommandPreflightReason = 'INVALID_PAYLOAD'): RequiredField => ({
    path, kind: 'NON_EMPTY_STRING', failureReason
  }),
  integer: (path: string, failureReason: CommandPreflightReason = 'INVALID_PAYLOAD'): RequiredField => ({
    path, kind: 'POSITIVE_INTEGER', failureReason
  }),
  object: (path: string, failureReason: CommandPreflightReason = 'INVALID_PAYLOAD'): RequiredField => ({
    path, kind: 'PLAIN_OBJECT', failureReason
  }),
  array: (path: string, failureReason: CommandPreflightReason = 'INVALID_PAYLOAD'): RequiredField => ({
    path, kind: 'ARRAY', failureReason
  }),
  tuple3: (path: string, failureReason: CommandPreflightReason = 'INVALID_PAYLOAD'): RequiredField => ({
    path, kind: 'STRING_TUPLE_3', failureReason
  })
}

function mutation(
  channel: string,
  roles: readonly UserCommandRole[] | 'UNAUTHENTICATED',
  errorFamily: PublicErrorFamily,
  target: TargetResolutionSpec,
  requiredFields: readonly RequiredField[],
  options: Partial<Pick<MutationChannelSpec, 'supportsForbidden' | 'supportsNotFound' | 'supportsValidation' | 'sideEffects' | 'testReferences' | 'preflightErrorDetails' | 'transactionOwner'>> = {}
): MutationChannelSpec {
  return {
    channel,
    roles,
    errorFamily,
    supportsForbidden: options.supportsForbidden ?? roles !== 'UNAUTHENTICATED',
    supportsNotFound: options.supportsNotFound ?? target.kind !== 'STATIC_CONTEXT',
    supportsValidation: options.supportsValidation ?? true,
    required: requiredFields,
    target,
    sideEffects: options.sideEffects ?? ['AUTH_SESSION_HEARTBEAT', 'LEGACY_HANDLER_MUTATION'],
    testReferences: options.testReferences ?? ['src/main/ipc/__tests__/handler-registry.test.ts'],
    preflightErrorDetails: options.preflightErrorDetails ?? {},
    transactionOwner: options.transactionOwner ?? `legacy-handler:${channel}`
  }
}

const TEACHER_ADMIN = ['TEACHER', 'ADMIN'] as const
const ALL_USERS = ['STUDENT', 'TEACHER', 'ADMIN'] as const
const STUDENT = ['STUDENT'] as const
const TEACHER = ['TEACHER'] as const
const ADMIN = ['ADMIN'] as const

const PASSWORD_COMMANDS = new Set([
  'auth:createTeacherAccount',
  'auth:login',
  'student:create'
])

const ASSIGNMENT_CONFIRM_ERROR_DETAILS = {
  INVALID_PAYLOAD: { confirmationMethod: 'UNSUPPORTED_CONFIRMATION_METHOD' }
} as const satisfies PreflightErrorDetailMap<PublicCommandErrorCode>

const STRATEGY_CREATE_ERROR_DETAILS = {
  TARGET_MISMATCH: {
    'strategy.strategyType': 'STRATEGY_TYPE_MISMATCH',
    'strategy.jobCode': 'JOB_CODE_MISMATCH'
  }
} as const satisfies PreflightErrorDetailMap<PublicCommandErrorCode>

const TRAINING_STEP_ERROR_DETAILS = {
  TARGET_MISMATCH: { training_step_record: 'STEP_NOT_FOUND' }
} as const satisfies PreflightErrorDetailMap<PublicCommandErrorCode>

const TASK_CLOSURE_ERROR_DETAILS = {
  TARGET_MISMATCH: {
    resultIds: 'TASK_CLOSURE_INVALID',
    taskClosureId: 'TASK_CLOSURE_INVALID'
  }
} as const satisfies PreflightErrorDetailMap<PublicCommandErrorCode>

const AUTH_LOGIN_ERROR_DETAILS = {
  INVALID_PAYLOAD: {
    username: 'INVALID_CREDENTIALS',
    password: 'INVALID_CREDENTIALS'
  }
} as const satisfies PreflightErrorDetailMap<PublicCommandErrorCode>

const M5A5_TEST_REFERENCES = [
  'src/main/application/services/__tests__/account-command-bus.test.ts',
  'src/main/ipc/__tests__/handler-registry.test.ts'
] as const

const M5A6_TEST_REFERENCES = [
  'src/main/application/services/__tests__/training-command-bus.test.ts',
  'src/main/ipc/handlers/__tests__/training-create.test.ts',
  'src/main/ipc/handlers/__tests__/training-steps.test.ts',
  'src/main/ipc/handlers/__tests__/training-complete.test.ts',
  'src/main/ipc/handlers/__tests__/training-redline.test.ts'
] as const

const M5A7_TEST_REFERENCES = [
  'src/main/application/services/__tests__/assessment-command-bus.test.ts',
  'src/main/ipc/handlers/__tests__/assessment-create.test.ts',
  'src/main/ipc/handlers/__tests__/assessment-start-session.test.ts',
  'src/main/ipc/handlers/__tests__/assessment-answer.test.ts',
  'src/main/ipc/handlers/__tests__/assessment-emotion.test.ts',
  'src/main/ipc/handlers/__tests__/assessment-redline.test.ts',
  'src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts',
  'src/main/ipc/handlers/__tests__/assessment-read.test.ts'
] as const

const M5A8_TEST_REFERENCES = [
  'src/main/application/services/__tests__/scoring-command-bus.test.ts',
  'src/main/application/services/__tests__/multi-event-command-failure.test.ts',
  'src/main/ipc/handlers/__tests__/assessment-ability-scoring.test.ts',
  'src/main/ipc/handlers/__tests__/operation-scoring.test.ts',
  'src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts',
  'src/main/ipc/handlers/__tests__/observation.test.ts',
  'src/main/ipc/handlers/__tests__/job-skill-result.test.ts',
  'src/main/ipc/handlers/__tests__/job-skill-report.test.ts'
] as const

const M5A9_TEST_REFERENCES = [
  'src/main/application/services/__tests__/assignment-safety-command-bus.test.ts',
  'src/main/ipc/handlers/__tests__/assignment.test.ts',
  'src/main/domain/__tests__/local-runtime-context.test.ts',
  'src/main/ipc/handlers/__tests__/safety.test.ts',
  'src/main/ipc/handlers/__tests__/report-integration.test.ts',
  'src/main/ipc/handlers/__tests__/assessment-redline.test.ts',
  'src/main/ipc/handlers/__tests__/training-redline.test.ts'
] as const

const M5A10_TEST_REFERENCES = [
  'src/main/application/services/__tests__/reports-command-bus.test.ts',
  'src/main/ipc/handlers/__tests__/reports.test.ts',
  'src/main/ipc/handlers/__tests__/report-export.test.ts',
  'src/main/domain/__tests__/task-closure-service.test.ts',
  'src/main/domain/__tests__/report-export.test.ts',
  'src/main/domain/__tests__/report-coordinator.test.ts',
  'src/main/domain/__tests__/report-generation.test.ts'
] as const

const TRAINING_EVENT_SIDE_EFFECTS = [
  'AUTH_SESSION_HEARTBEAT',
  'LEGACY_EVENT_PORT_WRITE',
  'TRAINING_PROJECTION'
] as const

const ASSESSMENT_EVENT_SIDE_EFFECTS = [
  'AUTH_SESSION_HEARTBEAT',
  'LEGACY_EVENT_PORT_WRITE',
  'ASSESSMENT_PROJECTION',
  'ASSESSMENT_ERROR_LOG'
] as const

const ASSESSMENT_RESULT_SIDE_EFFECTS = [
  ...ASSESSMENT_EVENT_SIDE_EFFECTS,
  'RESULT_PROJECTION'
] as const

const ASSESSMENT_REDLINE_SIDE_EFFECTS = [
  ...ASSESSMENT_RESULT_SIDE_EFFECTS,
  'SAFETY_INCIDENT_DML',
  'TRAINING_HALT_ACCEPTED_CHILD'
] as const

const SCORING_EVENT_SIDE_EFFECTS = [
  'AUTH_SESSION_HEARTBEAT',
  'LEGACY_EVENT_PORT_WRITE',
  'ASSESSMENT_PROJECTION'
] as const

const SCORING_RESULT_SIDE_EFFECTS = [
  ...SCORING_EVENT_SIDE_EFFECTS,
  'RESULT_PROJECTION'
] as const

const JOB_SKILL_AUTOMATION_SIDE_EFFECTS = [
  ...SCORING_RESULT_SIDE_EFFECTS,
  'JOB_SKILL_RESULT_ACCEPTED_CHILD',
  'JOB_SKILL_REPORT_ACCEPTED_CHILD',
  'RUNTIME_REPORT_COORDINATOR'
] as const

const ASSIGNMENT_EVENT_SIDE_EFFECTS = [
  'AUTH_SESSION_HEARTBEAT',
  'LEGACY_EVENT_PORT_WRITE',
  'ASSIGNMENT_PROJECTION',
  'ASSESSMENT_PROJECTION'
] as const

const ASSIGNMENT_RUNTIME_SIDE_EFFECTS = [
  ...ASSIGNMENT_EVENT_SIDE_EFFECTS,
  'LOCAL_RUNTIME_ACCEPTED_CHILD'
] as const

const SAFETY_EVENT_SIDE_EFFECTS = [
  'AUTH_SESSION_HEARTBEAT',
  'LEGACY_EVENT_PORT_WRITE',
  'SAFETY_INCIDENT_DML',
  'RUNTIME_REPORT_COORDINATOR',
  'SAFETY_REPORT_AUTOMATION'
] as const

const REPORT_EVENT_SIDE_EFFECTS = [
  'AUTH_SESSION_HEARTBEAT',
  'RUNTIME_REPORT_COORDINATOR',
  'SCHEMA_V2_F7_EVENT',
  'REPORT_PROJECTION'
] as const

const TASK_CLOSURE_SIDE_EFFECTS = [
  ...REPORT_EVENT_SIDE_EFFECTS,
  'TASK_CLOSURE_PROJECTION',
  'REPORT_LINEAGE_UPDATE'
] as const

const REPORT_EXPORT_SIDE_EFFECTS = [
  ...REPORT_EVENT_SIDE_EFFECTS,
  'REPORT_FILE_TEMP_WRITE_HASH_RENAME',
  'REPORT_EXPORT_ERROR_LOG',
  'OWNED_TEMP_CLEANUP'
] as const

const MUTATION_SPECS: readonly MutationChannelSpec[] = [
  mutation('assessment:abortSession', TEACHER_ADMIN, 'ASSESSMENT_SCORING', assessmentTarget('assessment:abortSession'), [required.string('sessionId', 'TARGET_NOT_FOUND')], { sideEffects: ASSESSMENT_EVENT_SIDE_EFFECTS, testReferences: M5A7_TEST_REFERENCES, transactionOwner: 'assessment-service.abortSession' }),
  mutation('assessment:calculateResult', TEACHER_ADMIN, 'ASSESSMENT_SCORING', assessmentTarget('assessment:calculateResult'), [required.string('sessionId', 'TARGET_NOT_FOUND')], { sideEffects: ASSESSMENT_RESULT_SIDE_EFFECTS, testReferences: M5A7_TEST_REFERENCES, transactionOwner: 'assessment-service.calculateResult' }),
  mutation('assessment:createSession', TEACHER_ADMIN, 'ASSESSMENT_SCORING', createSessionTarget('assessment:createSession', ['BASELINE_ASSESSMENT', 'MOCK_EXAM', 'JOB_SKILL_ASSESSMENT']), [required.string('studentId', 'TARGET_NOT_FOUND'), required.string('strategyId', 'TARGET_NOT_FOUND'), required.integer('strategyVersion', 'TARGET_NOT_FOUND'), required.string('taskCode')], { sideEffects: ASSESSMENT_EVENT_SIDE_EFFECTS, testReferences: M5A7_TEST_REFERENCES, transactionOwner: 'assessment-service.createSession' }),
  mutation('assessment:emotionInterrupt', STUDENT, 'ASSESSMENT_SCORING', assessmentTarget('assessment:emotionInterrupt', true), [required.string('sessionId', 'TARGET_NOT_FOUND')], { sideEffects: ASSESSMENT_EVENT_SIDE_EFFECTS, testReferences: M5A7_TEST_REFERENCES, transactionOwner: 'assessment-service.emotionInterrupt' }),
  mutation('assessment:emotionResume', ['STUDENT', 'TEACHER'], 'ASSESSMENT_SCORING', assessmentTarget('assessment:emotionResume', true), [required.string('sessionId', 'TARGET_NOT_FOUND')], { sideEffects: ASSESSMENT_EVENT_SIDE_EFFECTS, testReferences: M5A7_TEST_REFERENCES, transactionOwner: 'assessment-service.emotionResume' }),
  mutation('assessment:pauseSitting', TEACHER, 'ASSESSMENT_SCORING', assessmentTarget('assessment:pauseSitting'), [required.string('sessionId', 'TARGET_NOT_FOUND')], { sideEffects: ASSESSMENT_EVENT_SIDE_EFFECTS, testReferences: M5A7_TEST_REFERENCES, transactionOwner: 'assessment-service.pauseSitting' }),
  mutation('assessment:recordEmotionCollapse', TEACHER, 'ASSESSMENT_SCORING', assessmentTarget('assessment:recordEmotionCollapse'), [required.string('sessionId', 'TARGET_NOT_FOUND')], { sideEffects: ASSESSMENT_EVENT_SIDE_EFFECTS, testReferences: M5A7_TEST_REFERENCES, transactionOwner: 'assessment-service.recordEmotionCollapse' }),
  mutation('assessment:recordTeacherObservation', TEACHER_ADMIN, 'ASSESSMENT_SCORING', assessmentTarget('assessment:recordTeacherObservation'), [required.string('sessionId', 'TARGET_NOT_FOUND'), required.string('questionId', 'TARGET_NOT_FOUND')], { sideEffects: JOB_SKILL_AUTOMATION_SIDE_EFFECTS, testReferences: M5A8_TEST_REFERENCES, transactionOwner: 'observation-service.recordTeacherObservation' }),
  mutation('assessment:startNextSitting', TEACHER, 'ASSESSMENT_SCORING', assessmentTarget('assessment:startNextSitting'), [required.string('sessionId', 'TARGET_NOT_FOUND')], { sideEffects: ASSESSMENT_EVENT_SIDE_EFFECTS, testReferences: M5A7_TEST_REFERENCES, transactionOwner: 'assessment-service.startNextSitting' }),
  mutation('assessment:startSession', STUDENT, 'ASSESSMENT_SCORING', assessmentTarget('assessment:startSession', true), [required.string('sessionId', 'TARGET_NOT_FOUND')], { sideEffects: ASSESSMENT_EVENT_SIDE_EFFECTS, testReferences: M5A7_TEST_REFERENCES, transactionOwner: 'assessment-service.startSession' }),
  mutation('assessment:submitAnswer', STUDENT, 'ASSESSMENT_SCORING', assessmentTarget('assessment:submitAnswer', true), [required.string('sessionId', 'TARGET_NOT_FOUND'), required.string('questionId'), required.object('answerPayload')], { sideEffects: ASSESSMENT_EVENT_SIDE_EFFECTS, testReferences: M5A7_TEST_REFERENCES, transactionOwner: 'assessment-service.submitAnswer' }),
  mutation('assessment:submitJobSkillOfflineScores', TEACHER_ADMIN, 'ASSESSMENT_SCORING', assessmentTarget('assessment:submitJobSkillOfflineScores'), [required.string('sessionId', 'TARGET_NOT_FOUND'), required.array('scores')], { sideEffects: JOB_SKILL_AUTOMATION_SIDE_EFFECTS, testReferences: M5A8_TEST_REFERENCES, transactionOwner: 'job-skill-scoring-service.submitJobSkillOfflineScores' }),
  mutation('assessment:submitOfflineAbilityScores', TEACHER_ADMIN, 'ASSESSMENT_SCORING', assessmentTarget('assessment:submitOfflineAbilityScores'), [required.string('sessionId', 'TARGET_NOT_FOUND'), required.array('scores')], { sideEffects: SCORING_EVENT_SIDE_EFFECTS, testReferences: M5A8_TEST_REFERENCES, transactionOwner: 'ability-scoring-service.submitOfflineAbilityScores' }),
  mutation('assessment:submitOperationScores', TEACHER_ADMIN, 'ASSESSMENT_SCORING', assessmentTarget('assessment:submitOperationScores'), [required.string('sessionId', 'TARGET_NOT_FOUND'), required.array('scores')], { sideEffects: SCORING_RESULT_SIDE_EFFECTS, testReferences: M5A8_TEST_REFERENCES, transactionOwner: 'operation-scoring-service.submitOperationScores' }),
  mutation('assessment:triggerRedline', TEACHER_ADMIN, 'ASSESSMENT_SCORING', assessmentTarget('assessment:triggerRedline'), [required.string('sessionId', 'TARGET_NOT_FOUND')], { sideEffects: ASSESSMENT_REDLINE_SIDE_EFFECTS, testReferences: M5A7_TEST_REFERENCES, transactionOwner: 'assessment-service.triggerRedline' }),
  mutation('assignment:confirmStudent', ALL_USERS, 'ASSIGNMENT', { ...assignmentTarget('assignment:confirmStudent'), enforceStudentOwner: true }, [required.string('assignmentId', 'TARGET_NOT_FOUND'), required.string('confirmationMethod')], { preflightErrorDetails: ASSIGNMENT_CONFIRM_ERROR_DETAILS, sideEffects: ASSIGNMENT_EVENT_SIDE_EFFECTS, testReferences: M5A9_TEST_REFERENCES, transactionOwner: 'assignment-service.confirmStudentAssignment' }),
  mutation('assignment:create', TEACHER_ADMIN, 'ASSIGNMENT', assignmentCreateTarget('assignment:create'), [required.string('businessSessionId', 'TARGET_NOT_FOUND')], { sideEffects: ASSIGNMENT_RUNTIME_SIDE_EFFECTS, testReferences: M5A9_TEST_REFERENCES, transactionOwner: 'assignment-service.createAssignment' }),
  mutation('assignment:rebind', TEACHER_ADMIN, 'ASSIGNMENT', assignmentTarget('assignment:rebind'), [required.string('assignmentId', 'TARGET_NOT_FOUND')], { sideEffects: ASSIGNMENT_RUNTIME_SIDE_EFFECTS, testReferences: M5A9_TEST_REFERENCES, transactionOwner: 'assignment-service.rebindAssignment' }),
  mutation('assignment:release', TEACHER_ADMIN, 'ASSIGNMENT', assignmentTarget('assignment:release'), [required.string('assignmentId', 'TARGET_NOT_FOUND'), required.string('releaseReason')], { sideEffects: ASSIGNMENT_EVENT_SIDE_EFFECTS, testReferences: M5A9_TEST_REFERENCES, transactionOwner: 'assignment-service.releaseAssignment' }),
  mutation('assignment:startAssessment', STUDENT, 'ASSIGNMENT', { ...assignmentTarget('assignment:startAssessment'), enforceStudentOwner: true }, [required.string('assignmentId', 'TARGET_NOT_FOUND')], { sideEffects: ASSIGNMENT_EVENT_SIDE_EFFECTS, testReferences: M5A9_TEST_REFERENCES, transactionOwner: 'assignment-service.startAssignedAssessment' }),
  mutation('auth:createTeacherAccount', ADMIN, 'AUTH_STUDENT_STRATEGY', usernameCreateTarget('auth:createTeacherAccount', 'USER_ACCOUNT', { requested_role: 'TEACHER' }), [required.string('username'), required.string('password'), required.string('displayName')], { supportsNotFound: false, sideEffects: ['AUTH_SESSION_HEARTBEAT', 'USER_ACCOUNT_DML', 'AUTH_AUDIT'], testReferences: M5A5_TEST_REFERENCES, transactionOwner: 'auth-service.createTeacherAccount' }),
  mutation('auth:login', 'UNAUTHENTICATED', 'AUTH_STUDENT_STRATEGY', usernameCreateTarget('auth:login', 'AUTH_LOGIN'), [required.string('username'), required.string('password')], { supportsForbidden: false, supportsNotFound: false, supportsValidation: false, sideEffects: ['AUTH_LOGIN_SESSION', 'AUTH_LOGIN_AUDIT'], preflightErrorDetails: AUTH_LOGIN_ERROR_DETAILS, testReferences: M5A5_TEST_REFERENCES, transactionOwner: 'auth-service.executeLoginCommand' }),
  mutation('auth:logout', ALL_USERS, 'AUTH_STUDENT_STRATEGY', actorTarget('auth:logout'), [], { supportsForbidden: false, supportsNotFound: false, supportsValidation: false, sideEffects: ['AUTH_SESSION_HEARTBEAT', 'AUTH_SESSION_REVOCATION', 'MEMORY_BINDING_CLEAR', 'AUTH_LOGOUT_AUDIT'], testReferences: M5A5_TEST_REFERENCES, transactionOwner: 'auth-service.executeLogoutCommand' }),
  mutation('auth:setTeacherAccountStatus', ADMIN, 'AUTH_STUDENT_STRATEGY', teacherAccountTarget('auth:setTeacherAccountStatus'), [required.string('teacherUserId'), required.string('status')], { sideEffects: ['AUTH_SESSION_HEARTBEAT', 'USER_ACCOUNT_DML', 'AUTH_SESSION_REVOCATION', 'AUTH_AUDIT'], testReferences: M5A5_TEST_REFERENCES, transactionOwner: 'auth-service.setTeacherAccountStatus' }),
  mutation('reports:confirmPlacementReview', TEACHER, 'REPORT', reportTarget('reports:confirmPlacementReview'), [required.string('reportId')], { sideEffects: REPORT_EVENT_SIDE_EFFECTS, testReferences: M5A10_TEST_REFERENCES, transactionOwner: 'reports-service.confirmPlacementReview' }),
  mutation('reports:confirmTaskClosure', TEACHER, 'REPORT', closureTarget('reports:confirmTaskClosure', false), [required.tuple3('resultIds')], { preflightErrorDetails: TASK_CLOSURE_ERROR_DETAILS, sideEffects: TASK_CLOSURE_SIDE_EFFECTS, testReferences: M5A10_TEST_REFERENCES, transactionOwner: 'reports-service.confirmTaskClosure' }),
  mutation('reports:export', TEACHER, 'REPORT', reportTarget('reports:export'), [required.string('reportId')], { sideEffects: REPORT_EXPORT_SIDE_EFFECTS, testReferences: M5A10_TEST_REFERENCES, transactionOwner: 'reports-service.exportReport' }),
  mutation('reports:generate', TEACHER, 'REPORT', reportGenerationTarget('reports:generate'), [required.string('reportScope')], { sideEffects: REPORT_EVENT_SIDE_EFFECTS, testReferences: M5A10_TEST_REFERENCES, transactionOwner: 'reports-service.generateReport' }),
  mutation('reports:lock', TEACHER, 'REPORT', reportTarget('reports:lock'), [required.string('reportId')], { sideEffects: REPORT_EVENT_SIDE_EFFECTS, testReferences: M5A10_TEST_REFERENCES, transactionOwner: 'reports-service.lockReport' }),
  mutation('reports:replaceTaskClosure', TEACHER, 'REPORT', closureTarget('reports:replaceTaskClosure', true), [required.string('taskClosureId'), required.tuple3('resultIds'), required.string('correctionReason')], { preflightErrorDetails: TASK_CLOSURE_ERROR_DETAILS, sideEffects: TASK_CLOSURE_SIDE_EFFECTS, testReferences: M5A10_TEST_REFERENCES, transactionOwner: 'reports-service.replaceTaskClosure' }),
  mutation('safety:confirm', TEACHER, 'SAFETY', safetyTarget('safety:confirm'), [required.string('incidentId', 'TARGET_NOT_FOUND'), required.string('reasonCode'), required.string('contextPhase'), required.string('description')], { sideEffects: SAFETY_EVENT_SIDE_EFFECTS, testReferences: M5A9_TEST_REFERENCES, transactionOwner: 'safety-service.confirmSafetyIncident' }),
  mutation('safety:replaceForFactualCorrection', ADMIN, 'SAFETY', safetyTarget('safety:replaceForFactualCorrection'), [required.string('incidentId', 'TARGET_NOT_FOUND'), required.string('reasonCode'), required.string('contextPhase'), required.string('description'), required.string('correctionReason')], { sideEffects: SAFETY_EVENT_SIDE_EFFECTS, testReferences: M5A9_TEST_REFERENCES, transactionOwner: 'safety-service.replaceSafetyIncidentForFactualCorrection' }),
  mutation('safety:resolve', ADMIN, 'SAFETY', safetyTarget('safety:resolve'), [required.string('incidentId', 'TARGET_NOT_FOUND'), required.string('resolutionNotes')], { sideEffects: SAFETY_EVENT_SIDE_EFFECTS, testReferences: M5A9_TEST_REFERENCES, transactionOwner: 'safety-service.resolveSafetyIncident' }),
  mutation('safety:void', ADMIN, 'SAFETY', safetyTarget('safety:void'), [required.string('incidentId', 'TARGET_NOT_FOUND'), required.string('voidReason')], { sideEffects: SAFETY_EVENT_SIDE_EFFECTS, testReferences: M5A9_TEST_REFERENCES, transactionOwner: 'safety-service.voidSafetyIncident' }),
  mutation('strategy:createVersion', ADMIN, 'AUTH_STUDENT_STRATEGY', strategyCreateTarget('strategy:createVersion'), [required.object('strategy'), required.string('strategy.strategyId'), required.integer('strategy.version'), required.string('strategy.strategyType'), required.string('strategy.jobCode')], { preflightErrorDetails: STRATEGY_CREATE_ERROR_DETAILS, sideEffects: ['AUTH_SESSION_HEARTBEAT', 'STRATEGY_CONFIG_DML', 'STRATEGY_AUDIT'], testReferences: M5A5_TEST_REFERENCES, transactionOwner: 'strategy-service.createVersion' }),
  mutation('strategy:setActive', ADMIN, 'AUTH_STUDENT_STRATEGY', strategyTarget('strategy:setActive'), [required.string('strategyId', 'TARGET_NOT_FOUND'), required.integer('version', 'TARGET_NOT_FOUND')], { sideEffects: ['AUTH_SESSION_HEARTBEAT', 'STRATEGY_CONFIG_DML', 'STRATEGY_AUDIT'], testReferences: M5A5_TEST_REFERENCES, transactionOwner: 'strategy-service.setActive' }),
  mutation('strategy:update', ADMIN, 'AUTH_STUDENT_STRATEGY', strategyTarget('strategy:update'), [required.string('strategyId', 'TARGET_NOT_FOUND'), required.integer('version', 'TARGET_NOT_FOUND'), required.object('patch')], { sideEffects: ['AUTH_SESSION_HEARTBEAT', 'STRATEGY_CONFIG_DML', 'STRATEGY_AUDIT'], testReferences: M5A5_TEST_REFERENCES, transactionOwner: 'strategy-service.updateStrategy' }),
  mutation('student:archive', TEACHER_ADMIN, 'AUTH_STUDENT_STRATEGY', studentTarget('student:archive'), [required.string('studentId', 'TARGET_NOT_FOUND')], { sideEffects: ['AUTH_SESSION_HEARTBEAT', 'STUDENT_ACCOUNT_PROFILE_DML', 'STUDENT_AUDIT'], testReferences: M5A5_TEST_REFERENCES, transactionOwner: 'student-service.archiveStudent' }),
  mutation('student:create', TEACHER_ADMIN, 'AUTH_STUDENT_STRATEGY', usernameCreateTarget('student:create', 'STUDENT_PROFILE_CREATE'), [required.string('username'), required.string('password'), required.string('studentName')], { supportsNotFound: false, sideEffects: ['AUTH_SESSION_HEARTBEAT', 'STUDENT_ACCOUNT_PROFILE_DML', 'STUDENT_AUDIT'], testReferences: M5A5_TEST_REFERENCES, transactionOwner: 'student-service.createStudent' }),
  mutation('student:update', TEACHER_ADMIN, 'AUTH_STUDENT_STRATEGY', studentTarget('student:update'), [required.string('studentId', 'TARGET_NOT_FOUND'), required.object('patch')], { sideEffects: ['AUTH_SESSION_HEARTBEAT', 'STUDENT_ACCOUNT_PROFILE_DML', 'STUDENT_AUDIT'], testReferences: M5A5_TEST_REFERENCES, transactionOwner: 'student-service.updateStudent' }),
  mutation('training:completeStep', STUDENT, 'TRAINING', trainingStepTarget('training:completeStep'), [], { preflightErrorDetails: TRAINING_STEP_ERROR_DETAILS, sideEffects: TRAINING_EVENT_SIDE_EFFECTS, testReferences: M5A6_TEST_REFERENCES, transactionOwner: 'training-service.completeStep' }),
  mutation('training:createSession', TEACHER_ADMIN, 'TRAINING', createSessionTarget('training:createSession', 'TRAINING_PRACTICE'), [required.string('studentId', 'TARGET_NOT_FOUND'), required.string('strategyId', 'TARGET_NOT_FOUND'), required.integer('strategyVersion', 'TARGET_NOT_FOUND'), required.string('taskCode'), required.string('moduleType')], { sideEffects: TRAINING_EVENT_SIDE_EFFECTS, testReferences: M5A6_TEST_REFERENCES, transactionOwner: 'training-service.createTrainingSession' }),
  mutation('training:failStep', STUDENT, 'TRAINING', trainingStepTarget('training:failStep'), [], { preflightErrorDetails: TRAINING_STEP_ERROR_DETAILS, sideEffects: TRAINING_EVENT_SIDE_EFFECTS, testReferences: M5A6_TEST_REFERENCES, transactionOwner: 'training-service.failStep' }),
  mutation('training:retryStep', STUDENT, 'TRAINING', trainingStepTarget('training:retryStep'), [], { preflightErrorDetails: TRAINING_STEP_ERROR_DETAILS, sideEffects: TRAINING_EVENT_SIDE_EFFECTS, testReferences: M5A6_TEST_REFERENCES, transactionOwner: 'training-service.retryStep' }),
  mutation('training:skipStep', STUDENT, 'TRAINING', trainingStepTarget('training:skipStep'), [], { preflightErrorDetails: TRAINING_STEP_ERROR_DETAILS, sideEffects: TRAINING_EVENT_SIDE_EFFECTS, testReferences: M5A6_TEST_REFERENCES, transactionOwner: 'training-service.skipStep' }),
  mutation('training:startStep', STUDENT, 'TRAINING', trainingStepTarget('training:startStep'), [], { preflightErrorDetails: TRAINING_STEP_ERROR_DETAILS, sideEffects: TRAINING_EVENT_SIDE_EFFECTS, testReferences: M5A6_TEST_REFERENCES, transactionOwner: 'training-service.startStep' })
]

export const M5A_MUTATION_CHANNELS = Object.freeze(
  MUTATION_SPECS.map((spec) => spec.channel).sort()
)

function errorContract(spec: MutationChannelSpec): {
  defaultCode: PublicCommandErrorCode
  codes: readonly PublicCommandErrorCode[]
  map: ReturnType<typeof createPreflightErrorMap<PublicCommandErrorCode>>
  detailMap: PreflightErrorDetailMap<PublicCommandErrorCode>
} {
  const defaultCode = PUBLIC_ERROR_FAMILY_DEFAULT[spec.errorFamily]
  const codes = new Set<PublicCommandErrorCode>([defaultCode])
  const overrides: Partial<Record<import('./command-types').CommandPreflightReason, PublicCommandErrorCode>> = {}
  const detailMap: Partial<Record<CommandPreflightReason, Record<string, PublicCommandErrorCode>>> = {}
  const addDetail = (
    reason: CommandPreflightReason,
    detail: string,
    errorCode: PublicCommandErrorCode
  ): void => {
    ;(detailMap[reason] ??= {})[detail] = errorCode
    codes.add(errorCode)
  }
  if (spec.supportsForbidden) {
    codes.add('FORBIDDEN')
    overrides.INVALID_ACTOR = 'FORBIDDEN'
    overrides.TARGET_MISMATCH = 'FORBIDDEN'
    addDetail('TARGET_MISMATCH', 'callerUserId', 'FORBIDDEN')
    addDetail('TARGET_MISMATCH', 'callerRole', 'FORBIDDEN')
  }
  if (spec.supportsNotFound) {
    codes.add('NOT_FOUND')
    overrides.TARGET_NOT_FOUND = 'NOT_FOUND'
  }
  if (spec.supportsValidation) {
    codes.add('VALIDATION_ERROR')
    overrides.INVALID_PAYLOAD = 'VALIDATION_ERROR'
  }
  for (const [reason, details] of Object.entries(spec.preflightErrorDetails)) {
    for (const [detail, errorCode] of Object.entries(details ?? {})) {
      addDetail(reason as CommandPreflightReason, detail, errorCode)
    }
  }
  return {
    defaultCode,
    codes: [...codes],
    map: createPreflightErrorMap(defaultCode, overrides),
    detailMap
  }
}

function eventFor(
  dependencies: M5AMutationDefinitionDependencies,
  transportId: string
): IpcMainInvokeEvent {
  try {
    return dependencies.eventForTransport(transportId)
  } catch {
    throw new CommandPreflightError('INTERNAL_PREFLIGHT_FAILURE')
  }
}

function trustedParams(
  context: AcceptedCommandContext,
  spec: MutationChannelSpec
): CanonicalRecord {
  const params: CanonicalRecord = { ...context.envelope.payload }
  for (const [targetField, inputField] of Object.entries(spec.target.executionFieldMap ?? {})) {
    const value = context.envelope.target[targetField]
    if (value !== undefined) params[inputField] = value
  }
  if (spec.channel === 'reports:generate') {
    const sourceId = context.envelope.target.source_id
    if (context.envelope.target.report_scope === 'BASE_ABILITY') params.taskClosureId = sourceId
    if (context.envelope.target.report_scope === 'JOB_SKILL') params.resultId = sourceId
    if (context.envelope.target.report_scope === 'SAFETY') params.incidentId = sourceId
  }
  const actor = context.envelope.actor
  if (actor.kind === 'USER') {
    params.callerUserId = actor.userId
    params.callerRole = actor.role
  }
  return params
}

function commandConcurrencyKey(
  target: Readonly<Record<string, CanonicalJsonValue>>
): string {
  const value = (field: string): CanonicalJsonValue | undefined => target[field]
  if (value('session_id') !== undefined) return `ASSESSMENT_SESSION:${String(value('session_id'))}`
  if (value('training_session_id') !== undefined) return `TRAINING_SESSION:${String(value('training_session_id'))}`
  if (value('business_session_id') !== undefined) return `BUSINESS_SESSION:${String(value('business_session_id'))}`
  if (value('report_id') !== undefined) return `TASK_REPORT:${String(value('report_id'))}`
  if (value('incident_id') !== undefined) return `SAFETY_INCIDENT:${String(value('incident_id'))}`
  if (value('task_closure_id') !== undefined) return `TASK_CLOSURE:${String(value('task_closure_id'))}`
  if (
    value('student_id') !== undefined
    && value('job_code') !== undefined
    && value('task_code') !== undefined
  ) {
    return `${String(value('aggregate_type'))}:${String(value('student_id'))}:${String(value('job_code'))}:${String(value('task_code'))}`
  }
  if (value('student_id') !== undefined) return `STUDENT_PROFILE:${String(value('student_id'))}`
  if (value('strategy_id') !== undefined) {
    return `STRATEGY_CONFIG:${String(value('strategy_id'))}:${String(value('version') ?? value('strategy_version') ?? '')}`
  }
  if (value('teacher_user_id') !== undefined) return `USER_ACCOUNT:${String(value('teacher_user_id'))}`
  if (value('auth_session_id') !== undefined) return `AUTH_SESSION:${String(value('auth_session_id'))}`
  if (value('normalized_username') !== undefined) {
    return `${String(value('aggregate_type'))}:${String(value('normalized_username'))}`
  }
  return JSON.stringify(target)
}

function createDefinition(
  spec: MutationChannelSpec,
  dependencies: M5AMutationDefinitionDependencies
): MutationCommandDefinition<unknown, ValidatedMutationInput, unknown, PublicCommandErrorCode> {
  const errors = errorContract(spec)
  const handler = dependencies.handlerForChannel(spec.channel)
  return {
    commandType: spec.channel,
    metadata: {
      mode: 'MUTATION',
      executionMode: 'ASYNC',
      allowedSources: ['IPC'],
      actorPolicy: spec.roles === 'UNAUTHENTICATED'
        ? { kind: 'BOOTSTRAP' }
        : { kind: 'ACTIVE_USER', roles: spec.roles },
      targetResolver: {
        owner: spec.target.owner,
        kind: spec.target.kind,
        locatorFields: spec.target.locatorFields,
        authoritativeFields: spec.target.authoritativeFields,
        canonicalTargetFields: spec.target.canonicalTargetFields,
        clientHintFields: spec.target.clientHintFields,
        notFoundMapping: spec.supportsNotFound ? 'NOT_FOUND' : errors.defaultCode,
        mismatchMapping: spec.supportsForbidden ? 'FORBIDDEN' : errors.defaultCode,
        testReferences: spec.testReferences
      },
      payloadContract: `m5a.ipc.${spec.channel}.v1`,
      sideEffects: spec.sideEffects,
      phase: 'RUNTIME_ACCEPTED',
      transactionOwner: spec.transactionOwner,
      retryPolicy: 'NO_AUTO_RETRY',
      durableCommand: {
        requestHash: {
          schemaVersion: 'command-request-hash-v1',
          secretFields: PASSWORD_COMMANDS.has(spec.channel) ? ['password'] : [],
          secretIdentityFields: PASSWORD_COMMANDS.has(spec.channel) ? ['username'] : []
        },
        resultSchemaVersion: 'command-result-v1',
        resultRecipeVersion: `m5b.${spec.channel}.result.v1`,
        prePonrRetryPolicy: 'RETRYABLE_SYSTEM_FAILURE',
        maxAttempts: 3
      },
      concurrencyPolicy: { kind: 'FAIL_FAST_ACTIVE_KEY', keyOwner: `m5a:${spec.channel}` },
      publicErrorCodes: errors.codes,
      preflightErrorMap: errors.map,
      preflightErrorDetailMap: errors.detailMap,
      testReferences: spec.testReferences
    },
    validateStructure(rawInput) {
      return validateInput(rawInput, spec)
    },
    resolveActor(transport, input) {
      if (spec.roles === 'UNAUTHENTICATED') return { kind: 'UNAUTHENTICATED' }
      const event = eventFor(dependencies, transport.transportId)
      const session = resolveBoundAuthSessionSnapshot(dependencies.db, event.sender.id)
      if (!session.success) throw new CommandPreflightError('INVALID_ACTOR')
      if (input.callerUserId !== undefined && input.callerUserId !== session.userId) {
        throw new CommandPreflightError('TARGET_MISMATCH', 'callerUserId')
      }
      if (input.callerRole !== undefined && input.callerRole !== session.role) {
        throw new CommandPreflightError('TARGET_MISMATCH', 'callerRole')
      }
      return {
        kind: 'USER',
        userId: session.userId,
        role: session.role,
        authSessionId: session.authSessionId
      }
    },
    normalizeBusinessInput(_transport, _actor, input) {
      const normalized: CanonicalRecord = { ...input.candidate }
      if (typeof normalized.username === 'string') normalized.username = normalized.username.trim()
      return normalized
    },
    resolveTarget(_transport, actor, input) {
      const target = spec.target.resolve(dependencies.db, input.candidate, actor)
      if (
        spec.target.enforceStudentOwner
        && actor.kind === 'USER'
        && actor.role === 'STUDENT'
        && target.student_id !== actor.userId
      ) targetMismatch('student owner')
      return target
    },
    canonicalPayload(_transport, _actor, _target, input) {
      const payload: CanonicalRecord = { ...input.candidate }
      for (const field of spec.target.stripPayloadFields) delete payload[field]
      return payload
    },
    concurrencyKey(envelope) {
      return commandConcurrencyKey(envelope.target)
    },
    execute(context) {
      if (context.envelope.actor.kind === 'USER') {
        heartbeatAcceptedAuthSession(dependencies.db, context)
      }
      const event = dependencies.eventForTransport(context.transport.transportId)
      return handler(event, trustedParams(context, spec), context)
    },
    mapUnexpectedExecutionError() {
      return { success: false as const, errorCode: errors.defaultCode }
    }
  }
}

export function createM5AMutationDefinitions(
  dependencies: M5AMutationDefinitionDependencies
): readonly MutationCommandDefinition<unknown, ValidatedMutationInput, unknown, PublicCommandErrorCode>[] {
  const channels = MUTATION_SPECS.map((spec) => spec.channel)
  if (new Set(channels).size !== channels.length) throw new Error('duplicate M5A mutation channel')
  if (channels.length !== 46) throw new Error(`expected 46 M5A mutation channels, received ${channels.length}`)
  return MUTATION_SPECS.map((spec) => createDefinition(spec, dependencies))
}
