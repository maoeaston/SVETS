import { describe, expect, it } from 'vitest'
import type { CanonicalJsonValue } from '../../event-batch/canonical-json'
import type { VerifiedEventSource } from '../../event-batch/projection-source'
import { registerAssignmentPreparedFacts } from '../assignment-projector'
import {
  ASSIGNMENT_EVENT_PAYLOAD_VERSION,
  ASSIGNMENT_PLAN_VERSIONS,
  ASSIGNMENT_RESULT_RECIPE_VERSIONS
} from '../../../application/planners/assignment-planner'

function createdEvent(payload: Record<string, CanonicalJsonValue>): VerifiedEventSource {
  return {
    record: {
      type: 'EVENT',
      schema_version: 1,
      event_id: 'assignment-projector-event',
      aggregate_type: 'BUSINESS_SESSION',
      aggregate_id: 'assignment-projector-session',
      event_type: 'ASSIGNMENT_CREATED',
      event_sequence: 1,
      payload,
      checksum: 'assignment-projector-checksum',
      timestamp: '2026-07-30T11:00:00.000Z',
      actor_id: 'assignment-projector-teacher'
    },
    relativePath: 'segments/assignment-projector.jsonl',
    lineNumber: 2,
    byteOffset: 0
  } as unknown as VerifiedEventSource
}

function validCreatedPayload(): Record<string, CanonicalJsonValue> {
  const organizationId = 'organization-id'
  const nodeId = 'node-id'
  const deviceId = 'device-id'
  const runtimeId = 'runtime-id'
  const authId = 'auth-id'
  return {
    event_payload_version: ASSIGNMENT_EVENT_PAYLOAD_VERSION,
    batch_context: {
      schema_version: 'batch-context-v1',
      plan_version: ASSIGNMENT_PLAN_VERSIONS['assignment:create'],
      result_recipe_version: ASSIGNMENT_RESULT_RECIPE_VERSIONS['assignment:create'],
      root_command_type: 'assignment:create',
      root_command_id: 'assignment-projector-command',
      child_ordinal: 0
    },
    actor_role: 'TEACHER',
    app_version: '1.0.0-alpha.1',
    correlation_id: 'assignment-projector-correlation',
    root_result: { success: true },
    business_session_id: 'assignment-projector-session',
    session_id: 'assignment-projector-session',
    assignment_id: 'assignment-id',
    grant_id: 'grant-id',
    student_id: 'student-id',
    device_id: deviceId,
    device_runtime_session_id: runtimeId,
    teacher_auth_session_id: authId,
    teacher_user_id: 'assignment-projector-teacher',
    capabilities: ['ASSESSMENT_START'],
    identity_confirmation_method: 'TEACHER_ATTESTATION',
    grant_status: 'ACTIVE',
    assignment_status: 'PENDING_CONFIRM',
    assigned_by: 'assignment-projector-teacher',
    assigned_at: '2026-07-30T11:00:00.000Z',
    granted_at: '2026-07-30T11:00:00.000Z',
    expires_at: '2026-07-30T19:00:00.000Z',
    delivery_phase_before: 'PREPARED',
    delivery_phase_after: 'ASSIGNED',
    runtime_context_v2: {
      schema_version: 'local-runtime-context-plan-v2',
      context: {
        organization_id: organizationId,
        node_id: nodeId,
        device_id: deviceId,
        device_runtime_session_id: runtimeId,
        teacher_auth_session_id: authId
      },
      organization: { organization_id: organizationId, name: 'Organization', type: 'SCHOOL', status: 'ACTIVE' },
      node: { node_id: nodeId, organization_id: organizationId, node_name: 'Node', node_type: 'ELECTRON_KIOSK', status: 'ACTIVE' },
      device: {
        device_id: deviceId, node_id: nodeId, device_name: 'Device', device_role: 'HYBRID',
        credential_hash: null, trust_state: 'TRUSTED', is_kiosk_enabled: false, allows_self_login: true,
        capabilities: ['LOCAL_ASSIGNMENT'], last_heartbeat_at: null, status: 'ACTIVE'
      },
      runtime: {
        device_runtime_session_id: runtimeId, device_id: deviceId,
        started_at: '2026-07-30T11:00:00.000Z', last_heartbeat_at: '2026-07-30T11:00:00.000Z',
        client_version: null, status: 'ACTIVE'
      },
      auth_session: {
        auth_session_id: authId, user_id: 'assignment-projector-teacher', device_runtime_session_id: runtimeId,
        auth_method: 'DEVICE_KEY', capabilities: ['LOCAL_ASSIGNMENT'], token_hash: 'a'.repeat(64),
        refresh_token_hash: 'b'.repeat(64), issued_at: '2026-07-30T11:00:00.000Z',
        expires_at: '2026-07-30T19:00:00.000Z', last_activity_at: '2026-07-30T11:00:00.000Z', status: 'ACTIVE'
      }
    }
  }
}

describe('M5B-11 assignment projector', () => {
  it('注册五个 assignment 事件和五个结果配方', () => {
    const registry = registerAssignmentPreparedFacts()
    expect(registry.projectorNames()).toEqual(['m5b-assignment-prepared-projector-v1'])
    expect(registry.retainedRecipeVersions('assignment:create')).toEqual([
      ASSIGNMENT_RESULT_RECIPE_VERSIONS['assignment:create']
    ])
    expect(registry.retainedRecipeVersions('assignment:release')).toEqual([
      ASSIGNMENT_RESULT_RECIPE_VERSIONS['assignment:release']
    ])
  })

  it('拒绝不是哈希形态的凭据事实，避免 prepared EVENT 携带明文 token', () => {
    const payload = validCreatedPayload()
    const runtime = payload.runtime_context_v2 as Record<string, Record<string, CanonicalJsonValue>>
    runtime.auth_session!.token_hash = 'raw-device-token'

    expect(() => registerAssignmentPreparedFacts().eventRegistration(createdEvent(payload))).toThrow(
      /runtime context identity facts are invalid/
    )
  })
})
