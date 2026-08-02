import { describe, expect, it } from 'vitest'
import { createPreviewReleaseCommandDefinitions } from '../preview-release-command-definitions'
import {
  bindAuthSessionToSender,
  clearAuthSessionBinding,
  issuePasswordAuthSession
} from '../../../utils/auth-session'
import { createTestDb, seedCaller } from '../../../db/test-helpers'
import { CommandPreflightError } from '../command-types'

function event(senderId: number): { sender: { id: number } } {
  return { sender: { id: senderId } }
}

function releaseInput() {
  return {
    releasePackage: {
      fact: {
        release_id: 'release-command-1',
        source_ref_id: 'source-command-1'
      }
    }
  }
}

describe('preview release command definitions', () => {
  it('uses sender-bound ADMIN identity and keeps release execution on M5B', async () => {
    const db = await createTestDb()
    const userId = seedCaller(db, 'ADMIN')
    const session = issuePasswordAuthSession(db, {
      userId,
      role: 'ADMIN',
      displayName: 'Admin'
    })
    const senderId = 4201
    bindAuthSessionToSender(senderId, session.rawToken)
    try {
      const definitions = createPreviewReleaseCommandDefinitions({
        db,
        eventForTransport: () => event(senderId) as never
      })
      expect(definitions.map((definition) => definition.commandType)).toEqual([
        'preview:releasePack',
        'preview:revokePack'
      ])
      const definition = definitions[0]
      const input = definition.validateStructure(releaseInput())
      const actor = await definition.resolveActor({ source: 'IPC', transportId: 'release-command-transport' }, input)

      expect(actor).toMatchObject({
        kind: 'USER',
        userId,
        role: 'ADMIN',
        authSessionId: session.snapshot.authSessionId
      })
      expect(definition.resolveTarget({ source: 'IPC', transportId: 'release-command-transport' }, actor, input)).toEqual({
        aggregate_type: 'PREVIEW_RELEASE',
        release_id: 'release-command-1',
        source_ref_id: 'source-command-1'
      })
      expect(definition.metadata.allowedSources).toEqual(['IPC'])
      expect(definition.metadata.targetResolver.testReferences).toContain(
        'src/main/application/command/__tests__/preview-release-command.test.ts'
      )
      expect(definition.execute({} as never)).toEqual({
        success: false,
        errorCode: 'PREVIEW_CONTRACT_MIGRATION_REQUIRED'
      })
    } finally {
      clearAuthSessionBinding(senderId)
      db.close()
    }
  })

  it('rejects caller identity in the request and non-ADMIN sender bindings', async () => {
    const db = await createTestDb()
    const teacherId = seedCaller(db, 'TEACHER')
    const session = issuePasswordAuthSession(db, {
      userId: teacherId,
      role: 'TEACHER',
      displayName: 'Teacher'
    })
    const senderId = 4202
    bindAuthSessionToSender(senderId, session.rawToken)
    try {
      const definition = createPreviewReleaseCommandDefinitions({
        db,
        eventForTransport: () => event(senderId) as never
      })[0]
      expect(() => definition.validateStructure({
        ...releaseInput(),
        callerUserId: teacherId
      })).toThrow(CommandPreflightError)
      const input = definition.validateStructure(releaseInput())
      expect(() => definition.resolveActor({ source: 'IPC', transportId: 'release-command-transport' }, input)).toThrow(CommandPreflightError)
    } finally {
      clearAuthSessionBinding(senderId)
      db.close()
    }
  })
})
