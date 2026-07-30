import type { ActionLogEntry } from '@shared/types/event-payloads'
import type { CanonicalJsonValue } from '../event-batch/canonical-json'
import {
  PreparedFactRegistry,
  type PreparedProjectorContext
} from '../event-batch/result-registry'
import { applyAssignmentEvent } from '../assignment-reducer'
import { applyAssessmentEvent } from '../assessment-reducer'
import {
  applyLocalRuntimeContextPlan,
  type LocalRuntimeContextPlan
} from '../local-runtime-context'
import {
  ASSIGNMENT_EVENT_PAYLOAD_VERSION,
  ASSIGNMENT_PLAN_VERSIONS,
  ASSIGNMENT_RESULT_RECIPE_VERSIONS,
  ASSIGNMENT_RUNTIME_EFFECT
} from '../../application/planners/assignment-planner'

export const ASSIGNMENT_PROJECTOR_NAME = 'm5b-assignment-prepared-projector-v1'

type AssignmentEventType =
  | 'ASSIGNMENT_CREATED'
  | 'ASSIGNMENT_STUDENT_CONFIRMED'
  | 'ASSIGNMENT_ASSESSMENT_STARTED'
  | 'GRANT_REBOUND'
  | 'ASSIGNMENT_RELEASED'

const EVENT_TYPES: readonly AssignmentEventType[] = [
  'ASSIGNMENT_CREATED',
  'ASSIGNMENT_STUDENT_CONFIRMED',
  'ASSIGNMENT_ASSESSMENT_STARTED',
  'GRANT_REBOUND',
  'ASSIGNMENT_RELEASED'
]

function record(value: CanonicalJsonValue | undefined, field: string): Readonly<Record<string, CanonicalJsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value
}

function text(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${field} is invalid`)
  return value
}

function integer(value: CanonicalJsonValue | undefined, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${field} is invalid`)
  return value as number
}

function boolean(value: CanonicalJsonValue | undefined, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} is invalid`)
  return value
}

function nullableText(value: CanonicalJsonValue | undefined, field: string): string | null {
  if (value === null) return null
  return text(value, field)
}

function stringArray(value: CanonicalJsonValue | undefined, field: string, nullable = false): string[] | null {
  if (value === null && nullable) return null
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`${field} must be a string array`)
  }
  return [...value] as string[]
}

function validateMetadata(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  if (payload.event_payload_version !== ASSIGNMENT_EVENT_PAYLOAD_VERSION) throw new Error('event payload version mismatch')
  const context = record(payload.batch_context, 'batch_context')
  const commandType = text(context.root_command_type, 'batch_context.root_command_type')
  if (!Object.prototype.hasOwnProperty.call(ASSIGNMENT_RESULT_RECIPE_VERSIONS, commandType)) {
    throw new Error('batch context root command is invalid')
  }
  if (context.plan_version !== ASSIGNMENT_PLAN_VERSIONS[commandType as keyof typeof ASSIGNMENT_PLAN_VERSIONS]) {
    throw new Error('batch context plan version is invalid')
  }
  if (context.result_recipe_version !== ASSIGNMENT_RESULT_RECIPE_VERSIONS[commandType as keyof typeof ASSIGNMENT_RESULT_RECIPE_VERSIONS]) {
    throw new Error('batch context result recipe version is invalid')
  }
  text(context.root_command_id, 'batch_context.root_command_id')
  integer(context.child_ordinal, 'batch_context.child_ordinal', 0)
  if (payload.actor_role !== 'TEACHER' && payload.actor_role !== 'ADMIN' && payload.actor_role !== 'STUDENT') {
    throw new Error('actor role is invalid')
  }
  text(payload.app_version, 'app_version')
  text(payload.correlation_id, 'correlation_id')
  if (payload.root_result !== undefined) {
    const result = record(payload.root_result, 'root_result')
    if (typeof result.success !== 'boolean') throw new Error('root_result.success is invalid')
  }
}

function validateRuntimeContext(value: CanonicalJsonValue | undefined): LocalRuntimeContextPlan {
  const runtime = record(value, 'runtime_context_v2')
  if (runtime.schema_version !== 'local-runtime-context-plan-v2') throw new Error('runtime context schema mismatch')
  const context = record(runtime.context, 'runtime_context_v2.context')
  const organization = record(runtime.organization, 'runtime_context_v2.organization')
  const node = record(runtime.node, 'runtime_context_v2.node')
  const device = record(runtime.device, 'runtime_context_v2.device')
  const deviceRuntime = record(runtime.runtime, 'runtime_context_v2.runtime')
  const auth = record(runtime.auth_session, 'runtime_context_v2.auth_session')
  const plan: LocalRuntimeContextPlan = {
    schema_version: 'local-runtime-context-plan-v2',
    context: {
      organizationId: text(context.organization_id, 'runtime.context.organization_id'),
      nodeId: text(context.node_id, 'runtime.context.node_id'),
      deviceId: text(context.device_id, 'runtime.context.device_id'),
      deviceRuntimeSessionId: text(context.device_runtime_session_id, 'runtime.context.device_runtime_session_id'),
      teacherAuthSessionId: text(context.teacher_auth_session_id, 'runtime.context.teacher_auth_session_id')
    },
    organization: {
      organization_id: text(organization.organization_id, 'runtime.organization.organization_id'),
      name: text(organization.name, 'runtime.organization.name'),
      type: text(organization.type, 'runtime.organization.type') as LocalRuntimeContextPlan['organization']['type'],
      status: 'ACTIVE'
    },
    node: {
      node_id: text(node.node_id, 'runtime.node.node_id'),
      organization_id: text(node.organization_id, 'runtime.node.organization_id'),
      node_name: text(node.node_name, 'runtime.node.node_name'),
      node_type: text(node.node_type, 'runtime.node.node_type') as LocalRuntimeContextPlan['node']['node_type'],
      status: 'ACTIVE'
    },
    device: {
      device_id: text(device.device_id, 'runtime.device.device_id'),
      node_id: text(device.node_id, 'runtime.device.node_id'),
      device_name: text(device.device_name, 'runtime.device.device_name'),
      device_role: text(device.device_role, 'runtime.device.device_role') as LocalRuntimeContextPlan['device']['device_role'],
      credential_hash: nullableText(device.credential_hash, 'runtime.device.credential_hash'),
      trust_state: text(device.trust_state, 'runtime.device.trust_state') as LocalRuntimeContextPlan['device']['trust_state'],
      is_kiosk_enabled: boolean(device.is_kiosk_enabled, 'runtime.device.is_kiosk_enabled'),
      allows_self_login: boolean(device.allows_self_login, 'runtime.device.allows_self_login'),
      capabilities: stringArray(device.capabilities, 'runtime.device.capabilities', true),
      last_heartbeat_at: nullableText(device.last_heartbeat_at, 'runtime.device.last_heartbeat_at'),
      status: 'ACTIVE'
    },
    runtime: {
      device_runtime_session_id: text(deviceRuntime.device_runtime_session_id, 'runtime.runtime.device_runtime_session_id'),
      device_id: text(deviceRuntime.device_id, 'runtime.runtime.device_id'),
      started_at: text(deviceRuntime.started_at, 'runtime.runtime.started_at'),
      last_heartbeat_at: text(deviceRuntime.last_heartbeat_at, 'runtime.runtime.last_heartbeat_at'),
      client_version: nullableText(deviceRuntime.client_version, 'runtime.runtime.client_version'),
      status: 'ACTIVE'
    },
    auth_session: {
      auth_session_id: text(auth.auth_session_id, 'runtime.auth_session.auth_session_id'),
      user_id: text(auth.user_id, 'runtime.auth_session.user_id'),
      device_runtime_session_id: text(auth.device_runtime_session_id, 'runtime.auth_session.device_runtime_session_id'),
      auth_method: 'DEVICE_KEY',
      capabilities: stringArray(auth.capabilities, 'runtime.auth_session.capabilities') ?? [],
      token_hash: text(auth.token_hash, 'runtime.auth_session.token_hash'),
      refresh_token_hash: nullableText(auth.refresh_token_hash, 'runtime.auth_session.refresh_token_hash'),
      issued_at: text(auth.issued_at, 'runtime.auth_session.issued_at'),
      expires_at: text(auth.expires_at, 'runtime.auth_session.expires_at'),
      last_activity_at: text(auth.last_activity_at, 'runtime.auth_session.last_activity_at'),
      status: 'ACTIVE'
    }
  }
  if (
    organization.status !== 'ACTIVE' || node.status !== 'ACTIVE' || device.status !== 'ACTIVE'
    || deviceRuntime.status !== 'ACTIVE' || auth.status !== 'ACTIVE'
    || plan.organization.organization_id !== plan.context.organizationId
    || plan.node.node_id !== plan.context.nodeId
    || plan.node.organization_id !== plan.context.organizationId
    || plan.device.device_id !== plan.context.deviceId
    || plan.device.node_id !== plan.context.nodeId
    || plan.runtime.device_runtime_session_id !== plan.context.deviceRuntimeSessionId
    || plan.runtime.device_id !== plan.context.deviceId
    || plan.auth_session.auth_session_id !== plan.context.teacherAuthSessionId
    || plan.auth_session.device_runtime_session_id !== plan.context.deviceRuntimeSessionId
    || !/^[a-f0-9]{64}$/.test(plan.auth_session.token_hash)
    || (plan.auth_session.refresh_token_hash !== null && !/^[a-f0-9]{64}$/.test(plan.auth_session.refresh_token_hash))
  ) throw new Error('runtime context identity facts are invalid')
  return plan
}

function validatePayload(eventType: AssignmentEventType, payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  validateMetadata(payload)
  text(payload.business_session_id, 'business_session_id')
  text(payload.session_id, 'session_id')
  text(payload.assignment_id, 'assignment_id')
  text(payload.student_id, 'student_id')
  text(payload.device_id, 'device_id')
  if (eventType === 'ASSIGNMENT_CREATED') {
    text(payload.grant_id, 'grant_id')
    text(payload.device_runtime_session_id, 'device_runtime_session_id')
    text(payload.teacher_auth_session_id, 'teacher_auth_session_id')
    text(payload.expires_at, 'expires_at')
    const runtime = validateRuntimeContext(payload.runtime_context_v2)
    if (runtime.context.deviceId !== payload.device_id
      || runtime.context.deviceRuntimeSessionId !== payload.device_runtime_session_id
      || runtime.context.teacherAuthSessionId !== payload.teacher_auth_session_id) {
      throw new Error('assignment created runtime facts conflict with payload')
    }
    return
  }
  if (eventType === 'GRANT_REBOUND') {
    text(payload.old_grant_id, 'old_grant_id')
    text(payload.new_grant_id, 'new_grant_id')
    text(payload.new_device_runtime_session_id, 'new_device_runtime_session_id')
    text(payload.teacher_auth_session_id, 'teacher_auth_session_id')
    integer(payload.assignment_version_before, 'assignment_version_before', 1)
    integer(payload.assignment_version_after, 'assignment_version_after', 2)
    const runtime = validateRuntimeContext(payload.runtime_context_v2)
    if (runtime.context.deviceId !== payload.device_id
      || runtime.context.deviceRuntimeSessionId !== payload.new_device_runtime_session_id
      || runtime.context.teacherAuthSessionId !== payload.teacher_auth_session_id) {
      throw new Error('grant rebound runtime facts conflict with payload')
    }
    return
  }
  text(payload.grant_id, 'grant_id')
  if (eventType === 'ASSIGNMENT_STUDENT_CONFIRMED') {
    text(payload.confirmed_at, 'confirmed_at')
  } else if (eventType === 'ASSIGNMENT_ASSESSMENT_STARTED') {
    text(payload.first_question_id, 'first_question_id')
    integer(payload.first_question_order, 'first_question_order', 1)
    text(payload.started_at, 'started_at')
  } else {
    text(payload.released_at, 'released_at')
  }
}

function runtimeEffect(context: PreparedProjectorContext): void {
  const plan = validateRuntimeContext(context.event.record.payload.runtime_context_v2)
  const applied = applyLocalRuntimeContextPlan(context.database, plan)
  if (
    applied.deviceId !== plan.context.deviceId
    || applied.deviceRuntimeSessionId !== plan.context.deviceRuntimeSessionId
    || applied.teacherAuthSessionId !== plan.context.teacherAuthSessionId
  ) throw new Error('runtime context apply result conflicts with prepared facts')
}

function project(context: PreparedProjectorContext): void {
  const event = context.event.record as unknown as ActionLogEntry
  if (event.event_type === 'ASSIGNMENT_CREATED' || event.event_type === 'GRANT_REBOUND') {
    // Projectors run before registered operational effects; establish FK parents first.
    runtimeEffect(context)
    applyAssignmentEvent(context.database, event)
    return
  }
  if (event.event_type === 'ASSIGNMENT_ASSESSMENT_STARTED') {
    applyAssessmentEvent(context.database, event)
    return
  }
  applyAssignmentEvent(context.database, event)
}

function assertProjected(context: PreparedProjectorContext): void {
  const payload = context.event.record.payload
  if (context.event.record.event_type === 'ASSIGNMENT_CREATED') {
    const row = context.database.prepare(
      `SELECT bsa.assignment_id, bsa.grant_id, g.device_runtime_session_id, g.teacher_auth_session_id
         FROM business_session_assignment bsa
         JOIN delegated_access_grant g ON g.grant_id = bsa.grant_id
        WHERE bsa.assignment_id = ?`
    ).get(payload.assignment_id) as Record<string, unknown> | undefined
    if (!row || row.grant_id !== payload.grant_id || row.device_runtime_session_id !== payload.device_runtime_session_id
      || row.teacher_auth_session_id !== payload.teacher_auth_session_id) {
      throw new Error('prepared assignment creation projection is missing')
    }
    return
  }
  if (context.event.record.event_type === 'GRANT_REBOUND') {
    const row = context.database.prepare(
      `SELECT bsa.grant_id, bsa.version, g.device_runtime_session_id, g.teacher_auth_session_id
         FROM business_session_assignment bsa
         JOIN delegated_access_grant g ON g.grant_id = bsa.grant_id
        WHERE bsa.assignment_id = ?`
    ).get(payload.assignment_id) as Record<string, unknown> | undefined
    if (!row || row.grant_id !== payload.new_grant_id || row.version !== payload.assignment_version_after
      || row.device_runtime_session_id !== payload.new_device_runtime_session_id
      || row.teacher_auth_session_id !== payload.teacher_auth_session_id) {
      throw new Error('prepared assignment rebound projection is missing')
    }
    return
  }
  if (context.event.record.event_type === 'ASSIGNMENT_ASSESSMENT_STARTED') {
    const row = context.database.prepare(
      'SELECT delivery_phase, current_question_id FROM assessment_session WHERE session_id = ?'
    ).get(payload.session_id) as Record<string, unknown> | undefined
    if (!row || row.delivery_phase !== 'ONLINE_IN_PROGRESS' || row.current_question_id !== payload.first_question_id) {
      throw new Error('prepared assignment start projection is missing')
    }
    return
  }
  const row = context.database.prepare(
    'SELECT status FROM business_session_assignment WHERE assignment_id = ?'
  ).get(payload.assignment_id) as Record<string, unknown> | undefined
  const expected = context.event.record.event_type === 'ASSIGNMENT_STUDENT_CONFIRMED' ? 'ACTIVE' : 'RELEASED'
  if (!row || row.status !== expected) throw new Error('prepared assignment projection is missing')
}

function rootResult(batch: PreparedProjectorContext['batch']): Readonly<Record<string, CanonicalJsonValue>> {
  const matches = batch.events
    .map((event) => event.record.payload.root_result)
    .filter((value): value is CanonicalJsonValue => value !== undefined)
  if (matches.length !== 1) throw new Error('prepared assignment batch requires exactly one root_result')
  const result = record(matches[0], 'root_result')
  if (typeof result.success !== 'boolean') throw new Error('root_result.success is invalid')
  return result
}

export function registerAssignmentPreparedFacts(registry = new PreparedFactRegistry()): PreparedFactRegistry {
  for (const eventType of EVENT_TYPES) {
    const hasRuntimeEffect = eventType === 'ASSIGNMENT_CREATED' || eventType === 'GRANT_REBOUND'
    registry.registerEvent({
      eventType,
      eventPayloadVersion: ASSIGNMENT_EVENT_PAYLOAD_VERSION,
      projectorName: ASSIGNMENT_PROJECTOR_NAME,
      validatePayload: (payload) => validatePayload(eventType, payload),
      project,
      assertProjected,
      operationalEffects: hasRuntimeEffect ? [
        {
          effectType: ASSIGNMENT_RUNTIME_EFFECT.effectType,
          effectVersion: ASSIGNMENT_RUNTIME_EFFECT.effectVersion,
          apply: runtimeEffect,
          assertApplied: runtimeEffect
        }
      ] : []
    })
  }
  for (const [commandType, resultRecipeVersion] of Object.entries(ASSIGNMENT_RESULT_RECIPE_VERSIONS)) {
    registry.registerResult({
      commandType,
      resultRecipeVersion,
      fromPrepared: ({ batch }) => rootResult(batch as PreparedProjectorContext['batch'])
    })
  }
  return registry
}
