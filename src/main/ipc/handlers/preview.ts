import type { IpcMainInvokeEvent } from 'electron'
import type { ApplicationRuntime } from '../../application/runtime/application-runtime'
import {
  getPreviewRelease,
  getPreviewSession,
  listPreviewSessionQuestions,
  listPreviewSources
} from '../../application/query/preview-query-service'

export type PreviewReadHandler = (event: IpcMainInvokeEvent, rawInput?: unknown) => unknown | Promise<unknown>

export function collectPreviewReadHandlers(runtime: ApplicationRuntime): ReadonlyMap<string, PreviewReadHandler> {
  const db = runtime.db
  return new Map<string, PreviewReadHandler>([
    ['preview:listSources', (_event, params) => listPreviewSources(db, params as never)],
    ['preview:getRelease', (_event, params) => getPreviewRelease(db, params as never)],
    ['preview:getSession', (_event, params) => getPreviewSession(db, params as never)],
    ['preview:listSessionQuestions', (_event, params) => listPreviewSessionQuestions(db, params as never)]
  ])
}
