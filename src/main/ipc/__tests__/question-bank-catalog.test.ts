import { readFileSync } from 'fs'
import { resolve } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (...args: unknown[]) => unknown) {
      electronState.handlers.set(channel, handler)
    },
    removeHandler(channel: string) {
      electronState.handlers.delete(channel)
    }
  }
}))

import type { ApplicationRuntime } from '../../application/runtime/application-runtime'
import type { ActivationServicePort } from '../../activation/activation-service'
import { listQuestionBankCatalog } from '../../application/query/question-bank-catalog-query-service'
import { MemoryAdapter } from '../../db/memory-adapter'
import { seedBundledQuestionContent } from '../../db/content-pack-seed'
import { seedCaller, seedStudent } from '../../db/test-helpers'
import {
  clearAuthSessionBinding,
  issuePasswordAuthSession,
  replaceSenderAuthSession
} from '../../utils/auth-session'
import { registerQuestionBankCatalogIpcHandlers } from '../question-bank-catalog'

const schema = readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8')
let db: MemoryAdapter
const senderIds = [7101, 7102, 7103]

const activationGate = {
  assertBusinessAccess: vi.fn(async () => undefined)
} as unknown as ActivationServicePort

function event(senderId: number) {
  return { sender: { id: senderId } }
}

function bind(senderId: number, role: 'TEACHER' | 'ADMIN' | 'STUDENT'): void {
  const userId = role === 'STUDENT' ? seedStudent(db) : seedCaller(db, role)
  const issued = issuePasswordAuthSession(db, { userId, role, displayName: role })
  replaceSenderAuthSession(db, senderId, issued.rawToken, 'catalog-test')
}

beforeAll(async () => {
  db = await MemoryAdapter.create()
  db.exec(schema)
  seedBundledQuestionContent(db, [
    {
      domain: 'BASE_ABILITY',
      expectedCount: 96,
      sql: readFileSync(resolve(process.cwd(), 'doc/features/question-bank-import-base-ability-v02.sql'), 'utf8')
    },
    {
      domain: 'JOB_SPECIFIC',
      expectedCount: 298,
      sql: readFileSync(resolve(process.cwd(), 'doc/features/question-bank-import.sql'), 'utf8')
    }
  ])
  const runtime = {
    db,
    isBoundaryReady: () => true,
    registerBoundaryDisposer: () => undefined
  } as unknown as ApplicationRuntime
  registerQuestionBankCatalogIpcHandlers(runtime, activationGate)
})

afterAll(() => {
  for (const senderId of senderIds) clearAuthSessionBinding(senderId)
  db.close()
  electronState.handlers.clear()
})

describe('question bank catalog query', () => {
  it('returns the complete 298-question JOB_SKILL catalog with stable paging and filters', () => {
    const first = listQuestionBankCatalog(db, { page: 1, pageSize: 12 })
    const active = listQuestionBankCatalog(db, { status: 'ACTIVE', pageSize: 100 })
    const module = listQuestionBankCatalog(db, { moduleCode: 'M1', pageSize: 100 })

    expect(first).toMatchObject({ success: true, total: 298, page: 1, pageSize: 12 })
    expect(first.success && first.items).toHaveLength(12)
    expect(active).toMatchObject({ success: true, total: 24 })
    expect(module).toMatchObject({ success: true, total: 48 })
  })

  it('marks a damaged JSON row without hiding the rest of the catalog', () => {
    db.prepare(`UPDATE question_bank SET content_json = '{broken' WHERE question_id = 'GA-FM-001'`).run()

    const result = listQuestionBankCatalog(db, {
      domain: 'BASE_ABILITY', keyword: 'GA-FM-001', pageSize: 10
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.total).toBe(1)
      expect(result.items[0]).toMatchObject({ questionId: 'GA-FM-001', content: null, contentParseError: true })
    }
  })

  it('rejects invalid filters before querying', () => {
    expect(listQuestionBankCatalog(db, { pageSize: 101 }))
      .toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
    expect(listQuestionBankCatalog(db, { moduleCode: 'M7' }))
      .toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })
})

describe('question bank catalog IPC permissions', () => {
  it('allows TEACHER and denies unbound or STUDENT senders', async () => {
    const handler = electronState.handlers.get('questionBank:list')!
    bind(7101, 'TEACHER')
    bind(7102, 'STUDENT')

    await expect(handler(event(7101), { pageSize: 10 }))
      .resolves.toMatchObject({ success: true, total: 298 })
    await expect(handler(event(7102), {}))
      .resolves.toEqual({ success: false, errorCode: 'FORBIDDEN' })
    await expect(handler(event(7103), {}))
      .resolves.toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('checks installation activation before reading session or question data', async () => {
    const handler = electronState.handlers.get('questionBank:list')!
    activationGate.assertBusinessAccess = vi.fn(async () => { throw new Error('ACTIVATION_REQUIRED') })

    await expect(handler(event(7101), {})).rejects.toThrow('ACTIVATION_REQUIRED')
  })
})
