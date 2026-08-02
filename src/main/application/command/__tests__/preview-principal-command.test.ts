import { describe, expect, it } from 'vitest'
import { createPreviewPrincipalCommandDefinitions } from '../preview-principal-command-definitions'
import {
  bindAuthSessionToSender,
  clearAuthSessionBinding,
  issuePasswordAuthSession,
  resolveTrustedCallerSnapshot
} from '../../../utils/auth-session'
import { createTestDb, seedCaller } from '../../../db/test-helpers'
import { CommandPreflightError } from '../command-types'

function event(senderId: number): { sender: { id: number } } {
  return { sender: { id: senderId } }
}

function enrollmentInput() {
  return {
    enrollmentPackage: {
      payload: {
        enrollment: { mapping_id: 'mapping-1' },
        target_installation_id: 'installation-1',
        organization_id: 'organization-1'
      },
      payload_hash: 'a'.repeat(64),
      key_id: 'compiled-key',
      signature: 'signed-package',
      algorithm: 'Ed25519'
    }
  }
}

describe('preview principal command definitions', () => {
  it('只从 sender-bound auth_session 解析 ADMIN actor，正文不能冒充 caller/principal', async () => {
    const db = await createTestDb()
    const userId = seedCaller(db, 'ADMIN')
    const session = issuePasswordAuthSession(db, {
      userId,
      role: 'ADMIN',
      displayName: 'Admin'
    })
    const senderId = 4101
    bindAuthSessionToSender(senderId, session.rawToken)
    const definitions = createPreviewPrincipalCommandDefinitions({
      db,
      eventForTransport: () => event(senderId) as never
    })
    const definition = definitions[0]
    const input = definition.validateStructure(enrollmentInput())
    const actor = await definition.resolveActor({ source: 'IPC', transportId: 'transport-1' }, input)
    expect(actor).toMatchObject({ kind: 'USER', userId, role: 'ADMIN', authSessionId: session.snapshot.authSessionId })
    expect(definition.resolveTarget({ source: 'IPC', transportId: 'transport-1' }, actor, input)).toEqual({
      aggregate_type: 'PRINCIPAL_BINDING',
      target_installation_id: 'installation-1',
      organization_id: 'organization-1',
      mapping_id: 'mapping-1'
    })
    expect(() => definition.validateStructure({ ...enrollmentInput(), callerUserId: userId })).toThrow(CommandPreflightError)
    expect(resolveTrustedCallerSnapshot(db, senderId)).toMatchObject({ success: true, userId, role: 'ADMIN' })
    clearAuthSessionBinding(senderId)
    db.close()
  })

  it('非 ADMIN 或失效 sender binding 不能接受 principal mutation', async () => {
    const db = await createTestDb()
    const teacherId = seedCaller(db, 'TEACHER')
    const session = issuePasswordAuthSession(db, {
      userId: teacherId,
      role: 'TEACHER',
      displayName: 'Teacher'
    })
    const senderId = 4102
    bindAuthSessionToSender(senderId, session.rawToken)
    const definition = createPreviewPrincipalCommandDefinitions({
      db,
      eventForTransport: () => event(senderId) as never
    })[0]
    const input = definition.validateStructure(enrollmentInput())
    expect(() => definition.resolveActor({ source: 'IPC', transportId: 'transport-2' }, input)).toThrow(CommandPreflightError)
    clearAuthSessionBinding(senderId)
    expect(resolveTrustedCallerSnapshot(db, senderId)).toEqual({ success: false, errorCode: 'FORBIDDEN' })
    db.close()
  })
})
