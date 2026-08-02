import type { IpcMainInvokeEvent } from 'electron'
import type { ApplicationRuntime } from '../../application/runtime/application-runtime'
import {
  assertFeedbackQueryDoesNotExposeBody,
  getFeedbackReference,
  listFeedbackReferences
} from '../../application/query/feedback-query-service'

export type FeedbackReadHandler = (event: IpcMainInvokeEvent, rawInput?: unknown) => unknown | Promise<unknown>

export function collectFeedbackReadHandlers(runtime: ApplicationRuntime): ReadonlyMap<string, FeedbackReadHandler> {
  const db = runtime.db
  return new Map<string, FeedbackReadHandler>([
    ['feedback:list', (_event, params) => listFeedbackReferences(db, params as never)],
    ['feedback:get', (_event, params) => getFeedbackReference(db, params as never)]
  ])
}

export { assertFeedbackQueryDoesNotExposeBody }
