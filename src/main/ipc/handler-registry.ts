import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { CommandBus } from '../application/command/command-bus'
import {
  M5A_MUTATION_CHANNELS,
  createM5AMutationDefinitions
} from '../application/command/m5a-command-definitions'
import { CommandRegistry } from '../application/command/command-registry'
import {
  createTeacherAccount,
  executeLoginCommand,
  executeLogoutCommand,
  setTeacherAccountStatus
} from '../application/services/auth-service'
import {
  archiveStudent,
  createStudent,
  updateStudent
} from '../application/services/student-service'
import {
  createVersion,
  setActive,
  updateStrategy
} from '../application/services/strategy-service'
import {
  M5A_READ_CHANNELS,
  M5A_READ_DEFINITIONS,
  requireM5AReadPolicy
} from '../application/query/m5a-read-definitions'
import type { ApplicationRuntime } from '../application/runtime/application-runtime'
import { createJobSkillReportAutomation } from '../application/services/job-skill-report-service'
import { resolveBoundAuthSessionSnapshot } from '../utils/auth-session'
import { registerAbilityScoringHandlers } from './handlers/ability-scoring'
import { registerAssessmentHandlers } from './handlers/assessment'
import { registerAssignmentHandlers } from './handlers/assignment'
import { registerAuthHandlers } from './handlers/auth'
import { registerFoundationHandlers } from './handlers/foundation'
import { registerJobSkillScoringHandlers } from './handlers/job-skill-scoring'
import { registerObservationHandlers } from './handlers/observation'
import { registerOperationScoringHandlers } from './handlers/operation-scoring'
import { registerReportsHandlers } from './handlers/reports'
import { registerResultsHandlers } from './handlers/results'
import { registerSafetyHandlers } from './handlers/safety'
import { registerStrategyHandlers } from './handlers/strategy'
import { registerStudentHandlers } from './handlers/student'
import { registerTrainingHandlers } from './handlers/training'
import {
  LegacyIpcHandlerCollector,
  type CollectedIpcHandler
} from './legacy-handler-collector'

type CentralListener = (event: IpcMainInvokeEvent, rawInput?: unknown) => Promise<unknown>

export interface CentralIpcBoundary {
  readonly registry: CommandRegistry
  readonly commandBus: CommandBus
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

function collectLegacyHandlers(runtime: ApplicationRuntime): LegacyIpcHandlerCollector {
  const collector = new LegacyIpcHandlerCollector()
  const getDb = runtime.getDb
  registerAuthHandlers(collector, {
    getDb,
    bindingOwnerId: runtime.bindingOwnerId,
    trackSender: (senderId, subscribeDestroyed) => runtime.trackSender(senderId, subscribeDestroyed)
  })
  registerStudentHandlers(collector, getDb)
  registerStrategyHandlers(collector, getDb)
  registerAssessmentHandlers(collector, {
    getDb,
    eventPort: runtime.legacyMutationPort
  })
  registerTrainingHandlers(collector, {
    getDb,
    eventPort: runtime.legacyMutationPort
  })
  registerOperationScoringHandlers(collector, {
    getDb,
    eventPort: runtime.legacyMutationPort
  })
  registerAbilityScoringHandlers(collector, {
    getDb,
    eventPort: runtime.legacyMutationPort
  })
  const jobSkillReportAutomation = createJobSkillReportAutomation(runtime.db, runtime.reportCoordinator)
  registerJobSkillScoringHandlers(collector, {
    getDb,
    eventPort: runtime.legacyMutationPort,
    automation: jobSkillReportAutomation
  })
  registerObservationHandlers(collector, {
    getDb,
    eventPort: runtime.legacyMutationPort,
    automation: jobSkillReportAutomation
  })
  registerAssignmentHandlers(collector, {
    getDb,
    eventPort: runtime.legacyMutationPort
  })
  registerSafetyHandlers(collector, {
    getDb,
    coordinator: runtime.reportCoordinator,
    eventPort: runtime.legacyMutationPort
  })
  registerFoundationHandlers(collector, getDb)
  registerResultsHandlers(collector, getDb)
  registerReportsHandlers(collector, { getDb, coordinator: runtime.reportCoordinator })
  return collector
}

function readFailure(errorCode: string): Readonly<{ success: false; errorCode: string }> {
  return Object.freeze({ success: false, errorCode })
}

function accountApplicationHandlers(runtime: ApplicationRuntime): ReadonlyMap<string, CollectedIpcHandler> {
  const handlers = new Map<string, CollectedIpcHandler>([
    ['auth:login', (event, rawInput) => executeLoginCommand(
      runtime.db,
      rawInput as Parameters<typeof executeLoginCommand>[1],
      {
        senderId: event.sender.id,
        bindingOwnerId: runtime.bindingOwnerId,
        trackSender: (senderId, subscribeDestroyed) => runtime.trackSender(senderId, subscribeDestroyed),
        subscribeDestroyed: (release) => event.sender.once('destroyed', release)
      }
    )],
    ['auth:logout', (event) => executeLogoutCommand(runtime.db, event.sender.id)],
    ['auth:createTeacherAccount', (_event, rawInput) => createTeacherAccount(
      runtime.db,
      rawInput as Parameters<typeof createTeacherAccount>[1]
    )],
    ['auth:setTeacherAccountStatus', (_event, rawInput) => setTeacherAccountStatus(
      runtime.db,
      rawInput as Parameters<typeof setTeacherAccountStatus>[1]
    )],
    ['student:create', (_event, rawInput) => createStudent(
      runtime.db,
      rawInput as Parameters<typeof createStudent>[1]
    )],
    ['student:update', (_event, rawInput) => updateStudent(
      runtime.db,
      rawInput as Parameters<typeof updateStudent>[1]
    )],
    ['student:archive', (_event, rawInput) => archiveStudent(
      runtime.db,
      rawInput as Parameters<typeof archiveStudent>[1]
    )],
    ['strategy:createVersion', (_event, rawInput) => createVersion(
      runtime.db,
      rawInput as Parameters<typeof createVersion>[1]
    )],
    ['strategy:update', (_event, rawInput) => updateStrategy(
      runtime.db,
      rawInput as Parameters<typeof updateStrategy>[1]
    )],
    ['strategy:setActive', (_event, rawInput) => setActive(
      runtime.db,
      rawInput as Parameters<typeof setActive>[1]
    )]
  ])
  if (handlers.size !== 10) throw new Error(`expected 10 M5A-5 application handlers, received ${handlers.size}`)
  return handlers
}

export function registerCentralIpcHandlers(runtime: ApplicationRuntime): CentralIpcBoundary {
  const expectedChannels = [...M5A_READ_CHANNELS, ...M5A_MUTATION_CHANNELS].sort()
  if (expectedChannels.length !== 74) {
    throw new Error(`expected 74 central IPC channels, received ${expectedChannels.length}`)
  }
  exactSet(M5A_READ_CHANNELS, M5A_READ_CHANNELS, 'M5A READ channels')
  exactSet(M5A_MUTATION_CHANNELS, M5A_MUTATION_CHANNELS, 'M5A MUTATION channels')

  const handlers = collectLegacyHandlers(runtime)
  exactSet(handlers.listChannels(), expectedChannels, 'collected IPC handlers')
  const applicationHandlers = accountApplicationHandlers(runtime)

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
    handlerForChannel(channel) {
      return applicationHandlers.get(channel) ?? handlers.require(channel)
    }
  })
  for (const definition of mutationDefinitions) registry.registerMutation(definition)
  registry.seal(expectedChannels)

  const commandBus = new CommandBus({
    registry,
    readinessGate: () => runtime.isBoundaryReady()
  })

  async function invokeRead(
    channel: string,
    event: IpcMainInvokeEvent,
    rawInput: unknown
  ): Promise<unknown> {
    const policy = requireM5AReadPolicy(channel)
    if (!runtime.isBoundaryReady()) return readFailure(policy.failureCode)
    const handler = handlers.require(channel)
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

  async function invokeMutation(
    channel: string,
    event: IpcMainInvokeEvent,
    rawInput: unknown
  ): Promise<unknown> {
    const transportId = uuidv4()
    activeEvents.set(transportId, event)
    try {
      const outcome = await commandBus.dispatch({
        commandType: channel,
        rawInput,
        transport: { source: 'IPC', transportId }
      })
      return outcome.status === 'REJECTED' ? outcome.publicError : outcome.result
    } finally {
      activeEvents.delete(transportId)
    }
  }

  function listener(channel: string): CentralListener {
    if (M5A_READ_CHANNELS.includes(channel)) {
      return (event, rawInput) => invokeRead(channel, event, rawInput)
    }
    if (M5A_MUTATION_CHANNELS.includes(channel)) {
      return (event, rawInput) => invokeMutation(channel, event, rawInput)
    }
    throw new Error(`central listener requested for unknown channel: ${channel}`)
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
    commandBus.close()
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
    exactSet(installed, expectedChannels, 'installed central IPC handlers')
    commandBus.open()
    runtime.registerBoundaryDisposer(dispose)
  } catch (error) {
    dispose()
    throw error
  }

  return Object.freeze({ registry, commandBus, channels: Object.freeze([...installed]), dispose })
}
