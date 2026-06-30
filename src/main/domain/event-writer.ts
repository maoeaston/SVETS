import { createHash } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { getDatabase } from '../db/connection'
import type {
  ActionLogEntry,
  AggregateType,
  ActorRole,
  EventType
} from '@shared/types/event-payloads'

// 获取 action_log.jsonl 路径（只追加，永不修改）
function getLogPath(): string {
  const logsDir = join(app.getPath('userData'), 'data')
  mkdirSync(logsDir, { recursive: true })
  return join(logsDir, 'action_log.jsonl')
}

// checksum = SHA-256(JSON.stringify(payload)) — 与 doc/ 规范一致
function calculateChecksum(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
}

// 获取聚合根内的下一个 event_sequence
function nextSequence(aggregateId: string): number {
  const row = getDatabase()
    .prepare(
      `SELECT MAX(event_sequence) AS max_seq
       FROM domain_event_projection
       WHERE aggregate_id = ?`
    )
    .get(aggregateId) as { max_seq: number | null }
  return (row.max_seq ?? 0) + 1
}

export interface WriteEventParams {
  aggregateType: AggregateType
  aggregateId: string
  eventType: EventType
  payload: Record<string, unknown>
  actorId: string
  actorRole: ActorRole
  correlationId?: string
}

/**
 * 写入一个领域事件。
 *
 * 顺序（不可颠倒，见 AGENTS.md）：
 *   1. 生成 payload checksum
 *   2. 追加写入 action_log.jsonl（事实来源）
 *   3. 写入 domain_event_projection（查询投影）
 *
 * 注意：此函数不负责更新业务投影表（assessment_session 等），
 *       调用方需在此之后调用对应的 reducer。
 */
export function writeEvent(params: WriteEventParams): ActionLogEntry {
  const db = getDatabase()
  const { aggregateType, aggregateId, eventType, payload, actorId, actorRole, correlationId } =
    params

  const eventId = uuidv4()
  const eventSequence = nextSequence(aggregateId)
  const checksum = calculateChecksum(payload)
  const createdAt = new Date().toISOString()
  const appVersion = app.getVersion()

  const entry: ActionLogEntry = {
    event_id: eventId,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    event_type: eventType,
    event_sequence: eventSequence,
    payload,
    checksum,
    schema_version: 1,
    created_at: createdAt,
    actor_id: actorId,
    actor_role: actorRole,
    app_version: appVersion,
    ...(correlationId ? { correlation_id: correlationId } : {})
  }

  // Step 1: 追加写入 JSONL（文件锁由操作系统保证单进程安全）
  const logPath = getLogPath()
  appendFileSync(logPath, JSON.stringify(entry) + '\n', { encoding: 'utf-8' })

  // Step 2: 写入 domain_event_projection
  db.prepare(
    `INSERT INTO domain_event_projection (
       event_id, aggregate_type, aggregate_id,
       event_type, event_sequence, payload_json,
       checksum, source_log_path, schema_version, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    aggregateType,
    aggregateId,
    eventType,
    eventSequence,
    JSON.stringify(payload),
    checksum,
    logPath,
    1,
    createdAt
  )

  return entry
}
