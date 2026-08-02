import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { ApplicationRuntime } from '../application/runtime/application-runtime'
import type { ActivationServicePort } from '../activation/activation-service'
import { listQuestionBankCatalog } from '../application/query/question-bank-catalog-query-service'
import { resolveBoundAuthSessionSnapshot } from '../utils/auth-session'
import type { QuestionBankCatalogParams, QuestionBankCatalogResult } from '../../shared/types/question-bank-catalog'

export const QUESTION_BANK_CATALOG_IPC_CHANNELS = ['questionBank:list'] as const

export interface QuestionBankCatalogIpcBoundary {
  readonly channels: readonly string[]
  dispose(): void
}

function inputParams(value: unknown): QuestionBankCatalogParams | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as QuestionBankCatalogParams
}

export function registerQuestionBankCatalogIpcHandlers(
  runtime: ApplicationRuntime,
  activation: ActivationServicePort
): QuestionBankCatalogIpcBoundary {
  const installed: string[] = []
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const channel of [...installed].reverse()) ipcMain.removeHandler(channel)
    installed.length = 0
  }

  try {
    ipcMain.handle('questionBank:list', async (
      event: IpcMainInvokeEvent,
      input: unknown
    ): Promise<QuestionBankCatalogResult> => {
      await activation.assertBusinessAccess()
      if (!runtime.isBoundaryReady()) return { success: false, errorCode: 'SYSTEM_ERROR' }
      const session = resolveBoundAuthSessionSnapshot(runtime.db, event.sender.id)
      if (!session.success || (session.role !== 'TEACHER' && session.role !== 'ADMIN')) {
        return { success: false, errorCode: 'FORBIDDEN' }
      }
      const params = inputParams(input)
      if (!params) return { success: false, errorCode: 'VALIDATION_ERROR' }
      return listQuestionBankCatalog(runtime.db, params)
    })
    installed.push('questionBank:list')
    runtime.registerBoundaryDisposer(dispose)
  } catch (error) {
    dispose()
    throw error
  }
  return Object.freeze({ channels: Object.freeze([...installed]), dispose })
}
