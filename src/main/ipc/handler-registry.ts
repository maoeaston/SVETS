import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { dirname } from 'path'
import { v4 as uuidv4 } from 'uuid'
import {
  M5A_MUTATION_CHANNELS,
  createM5AMutationDefinitions
} from '../application/command/m5a-command-definitions'
import {
  PREVIEW_PRINCIPAL_COMMAND_TYPES,
  createPreviewPrincipalCommandDefinitions
} from '../application/command/preview-principal-command-definitions'
import {
  PREVIEW_RELEASE_COMMAND_TYPES,
  createPreviewReleaseCommandDefinitions
} from '../application/command/preview-release-command-definitions'
import {
  PREVIEW_FEEDBACK_COMMAND_TYPES,
  createPreviewFeedbackCommandDefinitions
} from '../application/command/preview-feedback-command-definitions'
import {
  PREVIEW_SESSION_COMMAND_TYPES,
  createPreviewSessionCommandDefinitions
} from '../application/command/preview-session-command-definitions'
import {
  PREVIEW_SAFETY_COMMAND_TYPES,
  createPreviewSafetyCommandDefinitions
} from '../application/command/preview-safety-command-definitions'
import { CommandRegistry } from '../application/command/command-registry'
import { DurableCommandCoordinatorError } from '../application/command/durable-command-coordinator'
import { applyGateOnlyPostCommitBinding } from '../application/command/gate-only-command-apply'
import { prepareReportExportInteraction, completeReportExportCancellation } from '../application/planners/report-export-planner'
import {
  M5A_READ_CHANNELS,
  M5A_READ_DEFINITIONS,
  requireM5AReadPolicy
} from '../application/query/m5a-read-definitions'
import {
  PREVIEW_READ_CHANNELS as PREVIEW_QUERY_READ_CHANNELS,
  PREVIEW_READ_DEFINITIONS,
  requirePreviewReadPolicy
} from '../application/query/preview-read-definitions'
import {
  FEEDBACK_READ_DEFINITIONS,
  requireFeedbackReadPolicy
} from '../application/query/feedback-read-definitions'
import type { ApplicationRuntime } from '../application/runtime/application-runtime'
import { CommandPreflightError, type AnyMutationCommandDefinition } from '../application/command/command-types'
import {
  getSession,
  listMySessions,
  listSessions
} from '../application/query/assessment-query-service'
import { getOfflineAbilityScores } from '../application/query/ability-scoring-query-service'
import { getCurrentSessionQuery, listAccountsQuery } from '../application/query/auth-query-service'
import {
  getJobSkillOfflineScores,
  getSessionScoringQuestions
} from '../application/query/job-skill-scoring-query-service'
import { getTeacherObservations } from '../application/query/observation-query-service'
import { getOperationScores } from '../application/query/operation-scoring-query-service'
import {
  getReport,
  listReportGenerationCandidates,
  listReports
} from '../application/query/reports-query-service'
import { getSafetyIncident, listSafetyIncidents } from '../application/query/safety-query-service'
import {
  getStrategyQuery,
  listStrategiesQuery,
  listStrategyVersionsQuery
} from '../application/query/strategy-query-service'
import { getStudentQuery, listStudentsQuery } from '../application/query/student-query-service'
import {
  getTrainingSession,
  listMyTrainingSessions,
  listTrainingSessions
} from '../application/query/training-query-service'
import { resolveBoundAuthSessionSnapshot } from '../utils/auth-session'
import { resolveTrustedCallerSnapshot } from '../utils/auth-session'
import { assertPreviewProjectionStatus } from '../domain/projectors/preview-event-projection'
import { resolveAuthorizedPreviewInstallationIds } from '../application/query/preview-read-scope'
import { collectPreviewReadHandlers } from './handlers/preview'
import { assertFeedbackQueryDoesNotExposeBody, collectFeedbackReadHandlers } from './handlers/feedback'
import {
  PREVIEW_CHANNELS,
  PREVIEW_MUTATION_CHANNELS,
  PREVIEW_READ_CHANNELS as PREVIEW_IPC_READ_CHANNELS
} from './preview-channel-definitions'
import {
  FEEDBACK_CHANNELS,
  FEEDBACK_MUTATION_CHANNELS,
  FEEDBACK_READ_CHANNELS
} from './feedback-channel-definitions'
import { getException, getWorkspaceOverview, listExceptions } from './handlers/foundation'
import { getCurrentResult, listCurrentResultsByStudent } from './handlers/results'

type CentralListener = (event: IpcMainInvokeEvent, rawInput?: unknown, transportMetadata?: unknown) => Promise<unknown>

export interface BusinessAccessGate {
  assertBusinessAccess(): Promise<void>
}

export interface CentralIpcBoundary {
  readonly registry: CommandRegistry
  readonly channels: readonly string[]
  dispose(): void
}

function exactSet(actual: readonly string[], expected: readonly string[], label: string): void {
  const actualUnique = [...new Set(actual)].sort()
  const expectedUnique = [...new Set(expected)].sort()
  const missing = expectedUnique.filter((value) => !actualUnique.includes(value))
  const extra = actualUnique.filter((value) => !expectedUnique.includes(value))
  if (missing.length || extra.length || actual.length !== actualUnique.length) {
    throw new Error(`${label} mismatch; missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`)
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

type ReadHandler = (event: IpcMainInvokeEvent, rawInput?: unknown) => unknown | Promise<unknown>

function collectReadHandlers(runtime: ApplicationRuntime): ReadonlyMap<string, ReadHandler> {
  const db = runtime.db
  return new Map<string, ReadHandler>([
    ['assessment:getJobSkillOfflineScores', (_event, params) => getJobSkillOfflineScores(db, params as never)],
    ['assessment:getOfflineAbilityScores', (_event, params) => getOfflineAbilityScores(db, params as never)],
    ['assessment:getOperationScores', (_event, params) => getOperationScores(db, params as never)],
    ['assessment:getSession', (_event, params) => getSession(db, params as never)],
    ['assessment:getSessionScoringQuestions', (_event, params) => getSessionScoringQuestions(db, params as never)],
    ['assessment:getTeacherObservations', (_event, params) => getTeacherObservations(db, params as never)],
    ['assessment:listMySessions', (_event, params) => listMySessions(db, params as never)],
    ['assessment:listSessions', (_event, params) => listSessions(db, params as never)],
    ['auth:getCurrentSession', (event) => getCurrentSessionQuery(db, event.sender.id)],
    ['auth:listAccounts', (_event, params) => listAccountsQuery(db, params as never)],
    ['foundation:getException', (_event, params) => getException(db, params as never)],
    ['foundation:getOverview', (_event, params) => getWorkspaceOverview(db, params as never)],
    ['foundation:listExceptions', (_event, params) => listExceptions(db, params as never)],
    ['reports:get', (_event, params) => getReport(db, params as never)],
    ['reports:list', (_event, params) => listReports(db, params as never)],
    ['reports:listGenerationCandidates', (_event, params) => listReportGenerationCandidates(db, params as never)],
    ['results:getCurrent', (_event, params) => getCurrentResult(db, params as never)],
    ['results:listCurrentByStudent', (_event, params) => listCurrentResultsByStudent(db, params as never)],
    ['safety:get', (_event, params) => getSafetyIncident(db, params as never)],
    ['safety:list', (_event, params) => listSafetyIncidents(db, params as never)],
    ['strategy:get', (_event, params) => getStrategyQuery(db, params as never)],
    ['strategy:list', (_event, params) => listStrategiesQuery(db, params as never)],
    ['strategy:listVersions', (_event, params) => listStrategyVersionsQuery(db, params as never)],
    ['student:get', (_event, params) => getStudentQuery(db, params as never)],
    ['student:list', (_event, params) => listStudentsQuery(db, params as never)],
    ['training:getSession', (_event, params) => getTrainingSession(db, params as never)],
    ['training:listMySessions', (_event, params) => listMyTrainingSessions(db, params as never)],
    ['training:listSessions', (_event, params) => listTrainingSessions(db, params as never)]
  ])
}

function readFailure(errorCode: string): Readonly<{ success: false; errorCode: string }> {
  return Object.freeze({ success: false, errorCode })
}

export function resolveTrustedStudentProfileId(db: ApplicationRuntime['db'], userId: string): string | null {
  const row = db.prepare(
    `SELECT student_id
       FROM student_profile
      WHERE user_id = ? AND status = 'ACTIVE'
      LIMIT 1`
  ).get(userId) as { student_id?: string } | undefined
  return row?.student_id ?? null
}

function publicPreflightFailure(
  definition: AnyMutationCommandDefinition,
  error: unknown
): Readonly<{ success: false; errorCode: string }> | null {
  let reason: keyof typeof definition.metadata.preflightErrorMap | null = null
  let detail: string | undefined
  if (error instanceof CommandPreflightError) {
    reason = error.reason
    detail = error.safeDetail
  } else if (error instanceof DurableCommandCoordinatorError) {
    reason = error.code === 'UNKNOWN_COMMAND'
      ? 'UNKNOWN_COMMAND'
      : error.code === 'INVALID_TRANSPORT'
        ? 'SOURCE_NOT_ALLOWED'
        : error.code === 'INVALID_PAYLOAD'
          ? 'INVALID_PAYLOAD'
          : error.code === 'INVALID_ACTOR'
            ? 'INVALID_ACTOR'
            : null
  }
  if (!reason) return null
  const detailCode = detail === undefined
    ? undefined
    : definition.metadata.preflightErrorDetailMap?.[reason]?.[detail]
  return readFailure(detailCode ?? definition.metadata.preflightErrorMap[reason])
}

export function registerCentralIpcHandlers(
  runtime: ApplicationRuntime,
  businessAccessGate: BusinessAccessGate
): CentralIpcBoundary {
  const expectedChannels = [...M5A_READ_CHANNELS, ...M5A_MUTATION_CHANNELS, ...PREVIEW_CHANNELS, ...FEEDBACK_CHANNELS, 'runtime:getHealth'].sort()
  if (expectedChannels.length !== 92) {
    throw new Error(`expected 92 central IPC channels, received ${expectedChannels.length}`)
  }
  exactSet(M5A_READ_CHANNELS, M5A_READ_CHANNELS, 'M5A READ channels')
  exactSet(M5A_MUTATION_CHANNELS, M5A_MUTATION_CHANNELS, 'M5B MUTATION channels')
  exactSet(PREVIEW_MUTATION_CHANNELS, [...PREVIEW_PRINCIPAL_COMMAND_TYPES, ...PREVIEW_RELEASE_COMMAND_TYPES], 'preview mutation source set')
  exactSet(PREVIEW_IPC_READ_CHANNELS, PREVIEW_QUERY_READ_CHANNELS, 'preview read source set')
  exactSet(FEEDBACK_MUTATION_CHANNELS, PREVIEW_FEEDBACK_COMMAND_TYPES, 'feedback mutation source set')
  exactSet(FEEDBACK_READ_CHANNELS, ['feedback:list', 'feedback:get'], 'feedback read source set')

  const readHandlers = collectReadHandlers(runtime)
  exactSet([...readHandlers.keys()], M5A_READ_CHANNELS, 'M5B read handlers')
  const previewReadHandlers = collectPreviewReadHandlers(runtime)
  exactSet([...previewReadHandlers.keys()], PREVIEW_IPC_READ_CHANNELS, 'preview read handlers')
  const feedbackReadHandlers = collectFeedbackReadHandlers(runtime)
  exactSet([...feedbackReadHandlers.keys()], FEEDBACK_READ_CHANNELS, 'feedback read handlers')

  const activeEvents = new Map<string, IpcMainInvokeEvent>()
  const registry = new CommandRegistry()
  for (const definition of M5A_READ_DEFINITIONS) registry.registerRead(definition)
  const mutationDefinitions = createM5AMutationDefinitions({
    db: runtime.db,
    eventForTransport(transportId) {
      const event = activeEvents.get(transportId)
      if (!event) throw new Error(`unknown IPC transport: ${transportId}`)
      return event
    },
    handlerForChannel() {
      return (() => { throw new Error('M5B durable executor owns production mutations') }) as never
    }
  })
  for (const definition of mutationDefinitions) registry.registerMutation(definition)
  const previewPrincipalDefinitions = createPreviewPrincipalCommandDefinitions({
    db: runtime.db,
    eventForTransport(transportId) {
      const event = activeEvents.get(transportId)
      if (!event) throw new Error(`unknown IPC transport: ${transportId}`)
      return event
    }
  })
  for (const definition of previewPrincipalDefinitions) registry.registerMutation(definition)
  const previewReleaseDefinitions = createPreviewReleaseCommandDefinitions({
    db: runtime.db,
    eventForTransport(transportId) {
      const event = activeEvents.get(transportId)
      if (!event) throw new Error(`unknown IPC transport: ${transportId}`)
      return event
    }
  })
  for (const definition of previewReleaseDefinitions) registry.registerMutation(definition)
  const previewFeedbackDefinitions = createPreviewFeedbackCommandDefinitions({
    db: runtime.db,
    eventForTransport(transportId) {
      const event = activeEvents.get(transportId)
      if (!event) throw new Error(`unknown IPC transport: ${transportId}`)
      return event
    }
  })
  for (const definition of previewFeedbackDefinitions) registry.registerMutation(definition)
  for (const definition of createPreviewSessionCommandDefinitions()) registry.registerMutation(definition)
  for (const definition of createPreviewSafetyCommandDefinitions()) registry.registerMutation(definition)
  for (const definition of PREVIEW_READ_DEFINITIONS) registry.registerRead(definition)
  for (const definition of FEEDBACK_READ_DEFINITIONS) registry.registerRead(definition)
  registry.registerRead({
    commandType: 'runtime:getHealth',
    metadata: {
      mode: 'READ',
      executionMode: 'ASYNC',
      allowedSources: ['IPC'],
      actorPolicy: { kind: 'BOOTSTRAP' },
      targetResolver: {
        owner: 'runtime:health',
        kind: 'STATIC_CONTEXT',
        locatorFields: [],
        authoritativeFields: ['in-memory runtime state'],
        canonicalTargetFields: ['runtime_scope'],
        clientHintFields: [],
        notFoundMapping: 'SYSTEM_ERROR',
        mismatchMapping: 'SYSTEM_ERROR',
        testReferences: ['src/main/ipc/__tests__/handler-registry.test.ts']
      },
      payloadContract: 'm5b.runtime.health.v1',
      sideEffects: [],
      phase: 'QUERY_ONLY',
      transactionOwner: 'NONE_READ_ONLY',
      retryPolicy: 'REPLAY_SAFE',
      concurrencyPolicy: { kind: 'NONE_READ_ONLY' },
      publicErrorCodes: ['SYSTEM_ERROR'],
      preflightErrorMap: {
        UNKNOWN_COMMAND: 'SYSTEM_ERROR',
        BOUNDARY_NOT_READY: 'SYSTEM_ERROR',
        SOURCE_NOT_ALLOWED: 'SYSTEM_ERROR',
        INVALID_PAYLOAD: 'SYSTEM_ERROR',
        INVALID_ACTOR: 'SYSTEM_ERROR',
        TARGET_NOT_FOUND: 'SYSTEM_ERROR',
        TARGET_MISMATCH: 'SYSTEM_ERROR',
        ACTIVE_KEY_CONFLICT: 'SYSTEM_ERROR',
        INTERNAL_PREFLIGHT_FAILURE: 'SYSTEM_ERROR'
      },
      testReferences: ['src/main/ipc/__tests__/handler-registry.test.ts']
    }
  })
  registry.seal([
    ...expectedChannels,
    ...PREVIEW_SESSION_COMMAND_TYPES,
    ...PREVIEW_SAFETY_COMMAND_TYPES
  ])

  const mutationExecutor = runtime.createMutationExecutor(registry)

  async function invokeRead(
    channel: string,
    event: IpcMainInvokeEvent,
    rawInput: unknown
  ): Promise<unknown> {
    const policy = requireM5AReadPolicy(channel)
    if (!runtime.isBoundaryReady()) return readFailure(policy.failureCode)
    const handler = readHandlers.get(channel)
    if (!handler) throw new Error(`missing M5B read handler: ${channel}`)
    if (policy.actors === 'OPTIONAL_SESSION') return handler(event)
    if (!isPlainRecord(rawInput)) return readFailure(policy.failureCode)

    const session = resolveBoundAuthSessionSnapshot(runtime.db, event.sender.id)
    if (!session.success || !policy.actors.includes(session.role)) return readFailure('FORBIDDEN')
    if (rawInput.callerUserId !== undefined && rawInput.callerUserId !== session.userId) {
      return readFailure('FORBIDDEN')
    }
    if (rawInput.callerRole !== undefined && rawInput.callerRole !== session.role) {
      return readFailure('FORBIDDEN')
    }
    return handler(event, {
      ...rawInput,
      callerUserId: session.userId,
      callerRole: session.role
    })
  }

  async function invokePreviewOrFeedbackRead(
    channel: string,
    event: IpcMainInvokeEvent,
    rawInput: unknown
  ): Promise<unknown> {
    const isPreview = PREVIEW_IPC_READ_CHANNELS.includes(channel as never)
    const policy = isPreview ? requirePreviewReadPolicy(channel) : requireFeedbackReadPolicy(channel)
    const handlers = isPreview ? previewReadHandlers : feedbackReadHandlers
    if (!runtime.isBoundaryReady()) return readFailure('PREVIEW_CONTRACT_MIGRATION_REQUIRED')
    try {
      assertPreviewProjectionStatus(runtime.db)
    } catch (error) {
      return readFailure(error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : policy.failureCode)
    }
    if (!isPlainRecord(rawInput)) return readFailure(policy.failureCode)
    const caller = resolveTrustedCallerSnapshot(runtime.db, event.sender.id)
    if (!caller.success || !policy.actors.includes(caller.role)) return readFailure('FORBIDDEN')
    if (!caller.organizationId) return readFailure('PREVIEW_SCOPE_INVALID')
    if (rawInput.callerUserId !== undefined && rawInput.callerUserId !== caller.userId) return readFailure('FORBIDDEN')
    if (rawInput.callerRole !== undefined && rawInput.callerRole !== caller.role) return readFailure('FORBIDDEN')
    if (rawInput.organizationId !== undefined && rawInput.organizationId !== caller.organizationId) return readFailure('FORBIDDEN')
    const trustedInput: Record<string, unknown> = {
      ...rawInput,
      organizationId: caller.organizationId,
      callerUserId: caller.userId,
      callerRole: caller.role,
      authorizedInstallationIds: resolveAuthorizedPreviewInstallationIds(runtime.db, {
        userId: caller.userId,
        organizationId: caller.organizationId,
        role: caller.role
      })
    }
    if (isPreview && (channel === 'preview:getSession' || channel === 'preview:listSessionQuestions') && caller.role === 'STUDENT') {
      const studentProfileId = resolveTrustedStudentProfileId(runtime.db, caller.userId)
      if (!studentProfileId) return readFailure('PREVIEW_SCOPE_INVALID')
      trustedInput.studentId = studentProfileId
      trustedInput.deviceId = caller.deviceId
    }
    try {
      const result = await handlers.get(channel)?.(event, trustedInput)
      if (result === null || result === undefined) return readFailure(policy.failureCode)
      if (channel === 'feedback:list' || channel === 'feedback:get') assertFeedbackQueryDoesNotExposeBody(result)
      return result
    } catch (error) {
      return readFailure(error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : policy.failureCode)
    }
  }

  async function invokeMutation(
    channel: string,
    event: IpcMainInvokeEvent,
    rawInput: unknown,
    transportMetadata: unknown
  ): Promise<unknown> {
    if (!runtime.isWritable()) {
      return registry.requireMutation(channel).mapUnexpectedExecutionError(
        new Error('runtime is not writable'),
        { commandType: channel } as never
      )
    }
    const transportId = uuidv4()
    activeEvents.set(transportId, event)
    try {
      const accepted = await mutationExecutor.accept({
        commandType: channel,
        rawInput,
        transport: { source: 'IPC', transportId },
        transportMetadata
      })
      if (accepted.status === 'REPLAYED') return accepted.publicResult
      let reportExportInteraction
      if (channel === 'reports:export') {
        try {
          const response = await dialog.showSaveDialog({
            title: '导出报告',
            defaultPath: 'task-report.html',
            filters: [{ name: 'HTML', extensions: ['html'] }]
          })
          if (response.canceled || !response.filePath) {
            return completeReportExportCancellation({
              commandStore: runtime.commandStore,
              envelope: accepted.envelope,
              completedAt: new Date().toISOString()
            }).publicResult
          }
          reportExportInteraction = prepareReportExportInteraction(accepted.envelope, {
            artifactRoot: dirname(response.filePath),
            targetPath: response.filePath
          })
        } catch (error) {
          mutationExecutor.failRetryableBeforePrepare(accepted)
          throw error
        }
      }
      const completed = await mutationExecutor.execute({
        accepted,
        senderId: event.sender.id,
        reportExportInteraction
      })
      applyGateOnlyPostCommitBinding({
        commandType: channel,
        publicResult: completed.publicResult,
        actor: accepted.envelope.actor,
        senderId: event.sender.id,
        bindingOwnerId: runtime.bindingOwnerId
      })
      return completed.publicResult
    } catch (error) {
      const definition = registry.requireMutation(channel)
      const preflightFailure = publicPreflightFailure(definition, error)
      if (preflightFailure) return preflightFailure
      return definition.mapUnexpectedExecutionError(
        error,
        { commandType: channel } as never
      )
    } finally {
      activeEvents.delete(transportId)
    }
  }

  function listener(channel: string): CentralListener {
    let downstream: CentralListener
    if (PREVIEW_IPC_READ_CHANNELS.includes(channel as never) || FEEDBACK_READ_CHANNELS.includes(channel as never)) {
      downstream = (event, rawInput) => invokePreviewOrFeedbackRead(channel, event, rawInput)
    } else if (M5A_READ_CHANNELS.includes(channel)) {
      downstream = (event, rawInput) => invokeRead(channel, event, rawInput)
    } else if (M5A_MUTATION_CHANNELS.includes(channel) || PREVIEW_PRINCIPAL_COMMAND_TYPES.includes(channel as never) || PREVIEW_RELEASE_COMMAND_TYPES.includes(channel as never) || PREVIEW_FEEDBACK_COMMAND_TYPES.includes(channel as never)) {
      downstream = (event, rawInput, transportMetadata) => invokeMutation(channel, event, rawInput, transportMetadata)
    } else {
      throw new Error(`central listener requested for unknown channel: ${channel}`)
    }
    return async (event, rawInput, transportMetadata) => {
      await businessAccessGate.assertBusinessAccess()
      return downstream(event, rawInput, transportMetadata)
    }
  }

  const installed: string[] = []
  const install = (channel: string, operation: () => void): void => {
    operation()
    installed.push(channel)
  }
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    activeEvents.clear()
    for (const channel of [...installed].reverse()) ipcMain.removeHandler(channel)
    installed.length = 0
  }

  try {
    install('assessment:abortSession', () => ipcMain.handle('assessment:abortSession', listener('assessment:abortSession')))
    install('assessment:calculateResult', () => ipcMain.handle('assessment:calculateResult', listener('assessment:calculateResult')))
    install('assessment:createSession', () => ipcMain.handle('assessment:createSession', listener('assessment:createSession')))
    install('assessment:emotionInterrupt', () => ipcMain.handle('assessment:emotionInterrupt', listener('assessment:emotionInterrupt')))
    install('assessment:emotionResume', () => ipcMain.handle('assessment:emotionResume', listener('assessment:emotionResume')))
    install('assessment:getJobSkillOfflineScores', () => ipcMain.handle('assessment:getJobSkillOfflineScores', listener('assessment:getJobSkillOfflineScores')))
    install('assessment:getOfflineAbilityScores', () => ipcMain.handle('assessment:getOfflineAbilityScores', listener('assessment:getOfflineAbilityScores')))
    install('assessment:getOperationScores', () => ipcMain.handle('assessment:getOperationScores', listener('assessment:getOperationScores')))
    install('assessment:getSession', () => ipcMain.handle('assessment:getSession', listener('assessment:getSession')))
    install('assessment:getSessionScoringQuestions', () => ipcMain.handle('assessment:getSessionScoringQuestions', listener('assessment:getSessionScoringQuestions')))
    install('assessment:getTeacherObservations', () => ipcMain.handle('assessment:getTeacherObservations', listener('assessment:getTeacherObservations')))
    install('assessment:listMySessions', () => ipcMain.handle('assessment:listMySessions', listener('assessment:listMySessions')))
    install('assessment:listSessions', () => ipcMain.handle('assessment:listSessions', listener('assessment:listSessions')))
    install('assessment:pauseSitting', () => ipcMain.handle('assessment:pauseSitting', listener('assessment:pauseSitting')))
    install('assessment:recordEmotionCollapse', () => ipcMain.handle('assessment:recordEmotionCollapse', listener('assessment:recordEmotionCollapse')))
    install('assessment:recordTeacherObservation', () => ipcMain.handle('assessment:recordTeacherObservation', listener('assessment:recordTeacherObservation')))
    install('assessment:startNextSitting', () => ipcMain.handle('assessment:startNextSitting', listener('assessment:startNextSitting')))
    install('assessment:startSession', () => ipcMain.handle('assessment:startSession', listener('assessment:startSession')))
    install('assessment:submitAnswer', () => ipcMain.handle('assessment:submitAnswer', listener('assessment:submitAnswer')))
    install('assessment:submitJobSkillOfflineScores', () => ipcMain.handle('assessment:submitJobSkillOfflineScores', listener('assessment:submitJobSkillOfflineScores')))
    install('assessment:submitOfflineAbilityScores', () => ipcMain.handle('assessment:submitOfflineAbilityScores', listener('assessment:submitOfflineAbilityScores')))
    install('assessment:submitOperationScores', () => ipcMain.handle('assessment:submitOperationScores', listener('assessment:submitOperationScores')))
    install('assessment:triggerRedline', () => ipcMain.handle('assessment:triggerRedline', listener('assessment:triggerRedline')))
    install('assignment:confirmStudent', () => ipcMain.handle('assignment:confirmStudent', listener('assignment:confirmStudent')))
    install('assignment:create', () => ipcMain.handle('assignment:create', listener('assignment:create')))
    install('assignment:rebind', () => ipcMain.handle('assignment:rebind', listener('assignment:rebind')))
    install('assignment:release', () => ipcMain.handle('assignment:release', listener('assignment:release')))
    install('assignment:startAssessment', () => ipcMain.handle('assignment:startAssessment', listener('assignment:startAssessment')))
    install('auth:createTeacherAccount', () => ipcMain.handle('auth:createTeacherAccount', listener('auth:createTeacherAccount')))
    install('auth:getCurrentSession', () => ipcMain.handle('auth:getCurrentSession', listener('auth:getCurrentSession')))
    install('auth:listAccounts', () => ipcMain.handle('auth:listAccounts', listener('auth:listAccounts')))
    install('auth:login', () => ipcMain.handle('auth:login', listener('auth:login')))
    install('auth:logout', () => ipcMain.handle('auth:logout', listener('auth:logout')))
    install('auth:setTeacherAccountStatus', () => ipcMain.handle('auth:setTeacherAccountStatus', listener('auth:setTeacherAccountStatus')))
    install('foundation:getException', () => ipcMain.handle('foundation:getException', listener('foundation:getException')))
    install('foundation:getOverview', () => ipcMain.handle('foundation:getOverview', listener('foundation:getOverview')))
    install('foundation:listExceptions', () => ipcMain.handle('foundation:listExceptions', listener('foundation:listExceptions')))
    install('reports:confirmPlacementReview', () => ipcMain.handle('reports:confirmPlacementReview', listener('reports:confirmPlacementReview')))
    install('reports:confirmTaskClosure', () => ipcMain.handle('reports:confirmTaskClosure', listener('reports:confirmTaskClosure')))
    install('reports:export', () => ipcMain.handle('reports:export', listener('reports:export')))
    install('reports:generate', () => ipcMain.handle('reports:generate', listener('reports:generate')))
    install('reports:get', () => ipcMain.handle('reports:get', listener('reports:get')))
    install('reports:list', () => ipcMain.handle('reports:list', listener('reports:list')))
    install('reports:listGenerationCandidates', () => ipcMain.handle('reports:listGenerationCandidates', listener('reports:listGenerationCandidates')))
    install('reports:lock', () => ipcMain.handle('reports:lock', listener('reports:lock')))
    install('reports:replaceTaskClosure', () => ipcMain.handle('reports:replaceTaskClosure', listener('reports:replaceTaskClosure')))
    install('results:getCurrent', () => ipcMain.handle('results:getCurrent', listener('results:getCurrent')))
    install('results:listCurrentByStudent', () => ipcMain.handle('results:listCurrentByStudent', listener('results:listCurrentByStudent')))
    install('preview:getRelease', () => ipcMain.handle('preview:getRelease', listener('preview:getRelease')))
    install('preview:getSession', () => ipcMain.handle('preview:getSession', listener('preview:getSession')))
    install('preview:listSessionQuestions', () => ipcMain.handle('preview:listSessionQuestions', listener('preview:listSessionQuestions')))
    install('preview:listSources', () => ipcMain.handle('preview:listSources', listener('preview:listSources')))
    install('preview:enrollPrincipal', () => ipcMain.handle('preview:enrollPrincipal', listener('preview:enrollPrincipal')))
    install('preview:rotatePrincipal', () => ipcMain.handle('preview:rotatePrincipal', listener('preview:rotatePrincipal')))
    install('preview:releasePack', () => ipcMain.handle('preview:releasePack', listener('preview:releasePack')))
    install('preview:revokePack', () => ipcMain.handle('preview:revokePack', listener('preview:revokePack')))
    install('feedback:saveDraft', () => ipcMain.handle('feedback:saveDraft', listener('feedback:saveDraft')))
    install('feedback:submit', () => ipcMain.handle('feedback:submit', listener('feedback:submit')))
    install('feedback:reconcile', () => ipcMain.handle('feedback:reconcile', listener('feedback:reconcile')))
    install('feedback:delete', () => ipcMain.handle('feedback:delete', listener('feedback:delete')))
    install('feedback:purge', () => ipcMain.handle('feedback:purge', listener('feedback:purge')))
    install('feedback:repair', () => ipcMain.handle('feedback:repair', listener('feedback:repair')))
    install('feedback:export', () => ipcMain.handle('feedback:export', listener('feedback:export')))
    install('feedback:get', () => ipcMain.handle('feedback:get', listener('feedback:get')))
    install('feedback:list', () => ipcMain.handle('feedback:list', listener('feedback:list')))
    install('safety:confirm', () => ipcMain.handle('safety:confirm', listener('safety:confirm')))
    install('safety:get', () => ipcMain.handle('safety:get', listener('safety:get')))
    install('safety:list', () => ipcMain.handle('safety:list', listener('safety:list')))
    install('safety:replaceForFactualCorrection', () => ipcMain.handle('safety:replaceForFactualCorrection', listener('safety:replaceForFactualCorrection')))
    install('safety:resolve', () => ipcMain.handle('safety:resolve', listener('safety:resolve')))
    install('safety:void', () => ipcMain.handle('safety:void', listener('safety:void')))
    install('strategy:createVersion', () => ipcMain.handle('strategy:createVersion', listener('strategy:createVersion')))
    install('strategy:get', () => ipcMain.handle('strategy:get', listener('strategy:get')))
    install('strategy:list', () => ipcMain.handle('strategy:list', listener('strategy:list')))
    install('strategy:listVersions', () => ipcMain.handle('strategy:listVersions', listener('strategy:listVersions')))
    install('strategy:setActive', () => ipcMain.handle('strategy:setActive', listener('strategy:setActive')))
    install('strategy:update', () => ipcMain.handle('strategy:update', listener('strategy:update')))
    install('student:archive', () => ipcMain.handle('student:archive', listener('student:archive')))
    install('student:create', () => ipcMain.handle('student:create', listener('student:create')))
    install('student:get', () => ipcMain.handle('student:get', listener('student:get')))
    install('student:list', () => ipcMain.handle('student:list', listener('student:list')))
    install('student:update', () => ipcMain.handle('student:update', listener('student:update')))
    install('training:completeStep', () => ipcMain.handle('training:completeStep', listener('training:completeStep')))
    install('training:createSession', () => ipcMain.handle('training:createSession', listener('training:createSession')))
    install('training:failStep', () => ipcMain.handle('training:failStep', listener('training:failStep')))
    install('training:getSession', () => ipcMain.handle('training:getSession', listener('training:getSession')))
    install('training:listMySessions', () => ipcMain.handle('training:listMySessions', listener('training:listMySessions')))
    install('training:listSessions', () => ipcMain.handle('training:listSessions', listener('training:listSessions')))
    install('training:retryStep', () => ipcMain.handle('training:retryStep', listener('training:retryStep')))
    install('training:skipStep', () => ipcMain.handle('training:skipStep', listener('training:skipStep')))
    install('training:startStep', () => ipcMain.handle('training:startStep', listener('training:startStep')))
    install('runtime:getHealth', () => ipcMain.handle('runtime:getHealth', () => runtime.health()))
    exactSet(installed, expectedChannels, 'installed central IPC handlers')
    runtime.registerBoundaryDisposer(dispose)
  } catch (error) {
    dispose()
    throw error
  }

  return Object.freeze({ registry, channels: Object.freeze([...installed]), dispose })
}
