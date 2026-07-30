import { join } from 'path'
import { app } from 'electron'

export function resolveActionLogPath(dataRoot: string): string {
  return join(dataRoot, 'action_log.jsonl')
}

/** Compatibility resolver only. Directory preparation belongs to the runtime. */
export function getActionLogPath(): string {
  const dataDir = join(app.getPath('userData'), 'data')
  return resolveActionLogPath(dataDir)
}
