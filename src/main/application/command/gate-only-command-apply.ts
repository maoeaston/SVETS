import type { DBAdapter } from '../../db/interface'
import {
  createTeacherAccount,
  loginWithPassword,
  logoutAuthSessionById,
  setTeacherAccountStatus
} from '../services/auth-service'
import {
  archiveStudent,
  createStudent,
  updateStudent
} from '../services/student-service'
import {
  createVersion,
  setActive,
  updateStrategy
} from '../services/strategy-service'
import {
  bindPersistentAuthSessionToSender,
  boundAuthSessionIdForSender,
  clearPersistentAuthSessionBindingIfMatches,
  revokeAuthSessionById
} from '../../utils/auth-session'
import type { CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import type { CommandActor, CommandEnvelopeV2 } from './command-types'
import type { M5bGateOnlyCommandType } from './gate-only-executor'

const EXTERNAL_IMMEDIATE = { transactionScope: 'EXTERNAL_IMMEDIATE' } as const

function payload(envelope: CommandEnvelopeV2): Record<string, CanonicalJsonValue> {
  return { ...envelope.payload }
}

function userActor(actor: CommandActor): Extract<CommandActor, { kind: 'USER' }> {
  if (actor.kind !== 'USER') throw new Error('gate-only command requires a USER actor')
  return actor
}

function userParams(envelope: CommandEnvelopeV2): Record<string, CanonicalJsonValue> {
  const actor = userActor(envelope.actor)
  return {
    ...payload(envelope),
    callerUserId: actor.userId,
    callerRole: actor.role
  }
}

function targetText(envelope: CommandEnvelopeV2, field: string): string {
  const value = envelope.target[field]
  if (typeof value !== 'string' || !value.length) throw new Error(`gate-only target ${field} is invalid`)
  return value
}

function targetInteger(envelope: CommandEnvelopeV2, field: string): number {
  const value = envelope.target[field]
  if (!Number.isInteger(value)) throw new Error(`gate-only target ${field} is invalid`)
  return value as number
}

export interface GateOnlyApplyOptions {
  readonly senderId?: number
}

/** Maps the ten reviewed command types to their legacy-equivalent DML without opening a nested transaction. */
export function applyGateOnlyCommand(
  database: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: GateOnlyApplyOptions = {}
): object {
  switch (envelope.commandType as M5bGateOnlyCommandType) {
    case 'auth:createTeacherAccount':
      return createTeacherAccount(database, userParams(envelope) as never)
    case 'auth:login': {
      const result = loginWithPassword(database, payload(envelope) as never)
      if (result.success && options.senderId !== undefined) {
        const previousAuthSessionId = boundAuthSessionIdForSender(database, options.senderId)
        if (previousAuthSessionId && previousAuthSessionId !== result.response.authSessionId) {
          revokeAuthSessionById(database, previousAuthSessionId, 'REPLACED_BY_LOGIN')
        }
      }
      return result.response
    }
    case 'auth:logout': {
      const actor = userActor(envelope.actor)
      return logoutAuthSessionById(database, actor.authSessionId)
    }
    case 'auth:setTeacherAccountStatus':
      return setTeacherAccountStatus(database, {
        ...userParams(envelope),
        teacherUserId: targetText(envelope, 'teacher_user_id')
      } as never, EXTERNAL_IMMEDIATE)
    case 'student:create':
      return createStudent(database, userParams(envelope) as never, EXTERNAL_IMMEDIATE)
    case 'student:update':
      return updateStudent(database, {
        ...userParams(envelope),
        studentId: targetText(envelope, 'student_id')
      } as never, EXTERNAL_IMMEDIATE)
    case 'student:archive':
      return archiveStudent(database, {
        ...userParams(envelope),
        studentId: targetText(envelope, 'student_id')
      } as never, EXTERNAL_IMMEDIATE)
    case 'strategy:createVersion':
      return createVersion(database, userParams(envelope) as never, EXTERNAL_IMMEDIATE)
    case 'strategy:update':
      return updateStrategy(database, {
        ...userParams(envelope),
        strategyId: targetText(envelope, 'strategy_id'),
        version: targetInteger(envelope, 'version')
      } as never)
    case 'strategy:setActive':
      return setActive(database, {
        ...userParams(envelope),
        strategyId: targetText(envelope, 'strategy_id'),
        version: targetInteger(envelope, 'version')
      } as never)
    default:
      throw new Error(`unrecognized gate-only command ${envelope.commandType}`)
  }
}

/**
 * This in-memory effect runs only after the durable result commit. It contains
 * no raw token and can be rebuilt exactly from a successful login replay.
 */
export function applyGateOnlyPostCommitBinding(options: {
  readonly commandType: string
  readonly publicResult: Readonly<Record<string, CanonicalJsonValue>>
  readonly actor: CommandActor
  readonly senderId: number
  readonly bindingOwnerId?: string | null
}): void {
  if (options.commandType === 'auth:login' && options.publicResult.success === true) {
    const authSessionId = options.publicResult.authSessionId
    if (typeof authSessionId !== 'string' || !authSessionId.length) {
      throw new Error('successful login result lacks authSessionId')
    }
    bindPersistentAuthSessionToSender(options.senderId, authSessionId, options.bindingOwnerId ?? null)
    return
  }
  if (options.commandType === 'auth:logout' && options.publicResult.success === true && options.actor.kind === 'USER') {
    clearPersistentAuthSessionBindingIfMatches(options.senderId, options.actor.authSessionId)
  }
}
