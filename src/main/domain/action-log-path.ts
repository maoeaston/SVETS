import { mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export function getActionLogPath(): string {
  const dataDir = join(app.getPath('userData'), 'data')
  mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'action_log.jsonl')
}
