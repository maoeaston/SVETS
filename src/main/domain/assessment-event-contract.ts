// assessment-event-contract.ts
// SESSION_STARTED 事件的合同解析与冻结 hash 校验层。
// handler 写前、reducer 应用前、recovery 重放前共用同一 parser，确保 payload-v2 冻结合同
// 自洽且不被篡改；未知 payload_version 或 envelope schema 错位均失败关闭。
//
// canonical / hashRecord 与 scripts/lib/base-ability-42plus8-authority.mjs 完全一致：
// 确定性 JSON key 排序 + SHA-256。contract 复算 hash 必须用同一算法，
// 否则与 authority 冻结值漂移。

import { createHash } from 'crypto'
import type {
  ActionLogEntry,
  SessionStartedPayload,
  SessionStartedPayloadV2,
  SessionQuestionSnapshotV2
} from '../../shared/types/event-payloads'

// 当前业务事件 envelope schema_version 只允许 1。
// envelope schema v2 是 F7 report 事件专属，业务 payload 不得占用。
const ENVELOPE_SCHEMA_VERSION = 1

/** 确定性 JSON canonicalization（递归 key 排序，数组保序）。 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(obj).sort().map((k) => [k, canonical(obj[k])])
    )
  }
  return value
}

/**
 * SHA-256 hash of canonical(value)。与 authority hashRecord 同算法。
 * exported 供 createSession 构造 v2 payload 冻结 hash 使用。
 */
export function hashRecord(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`
}

export class SessionStartedContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionStartedContractError'
  }
}

export interface ParsedSessionStartedV1 {
  version: 1
  payload: SessionStartedPayload
}
export interface ParsedSessionStartedV2 {
  version: 2
  payload: SessionStartedPayloadV2
}
export type ParsedSessionStarted =
  | ParsedSessionStartedV1
  | ParsedSessionStartedV2

/**
 * 解析 SESSION_STARTED 事件 payload。
 * 1. 断言 event_type === SESSION_STARTED 且 envelope schema_version === 1（业务 payload 不得占 envelope v2）；
 * 2. 按 payload.payload_version 判别 v1/v2：v2 复算逐题与集合 hash 自洽，v1 原样返回（历史回查分支）；
 * 3. 未知 payload_version 失败关闭（抛 SessionStartedContractError）。
 *
 * handler 写前、reducer 应用前、recovery 重放前共用本函数。
 */
export function parseSessionStartedPayload(event: ActionLogEntry): ParsedSessionStarted {
  if (event.event_type !== 'SESSION_STARTED') {
    throw new SessionStartedContractError(
      `parseSessionStartedPayload: event_type must be SESSION_STARTED, got ${event.event_type}`
    )
  }
  if (event.schema_version !== ENVELOPE_SCHEMA_VERSION) {
    throw new SessionStartedContractError(
      `parseSessionStartedPayload: envelope schema_version must be ${ENVELOPE_SCHEMA_VERSION}, got ${event.schema_version}`
    )
  }
  const raw = event.payload as Record<string, unknown> | null
  if (typeof raw !== "object" || raw === null) {
    throw new SessionStartedContractError('parseSessionStartedPayload: payload must be an object')
  }

  if (raw.payload_version === 2) {
    const payload = raw as unknown as SessionStartedPayloadV2
    verifySessionStartedPayloadV2(payload)
    return { version: 2, payload }
  }
  if (raw.payload_version === undefined) {
    // v1 历史事件：无 discriminator，按旧结构返回（保留回查 question_bank 的兼容分支）
    return { version: 1, payload: raw as unknown as SessionStartedPayload }
  }
  throw new SessionStartedContractError(
    `parseSessionStartedPayload: unknown payload_version ${JSON.stringify(raw.payload_version)}`
  )
}

/**
 * 校验 SESSION_STARTED payload v2 的全部冻结 hash 自洽。
 * 逐题 content/scoring hash 复算、renderer key/hash 格式、集合 root hash 复算；
 * 任一不匹配抛 SessionStartedContractError（失败关闭）。
 */
export function verifySessionStartedPayloadV2(payload: SessionStartedPayloadV2): void {
  if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
    throw new SessionStartedContractError('v2 payload: questions must be a non-empty array')
  }
  for (const q of payload.questions) {
    verifyQuestionSnapshotV2(q)
  }
  const roots = computeQuestionRootHashes(payload.questions)
  if (roots.content_root_hash !== payload.content_root_hash) {
    throw new SessionStartedContractError(
      `v2 payload: content_root_hash mismatch (expected ${payload.content_root_hash}, recomputed ${roots.content_root_hash})`
    )
  }
  if (roots.scoring_root_hash !== payload.scoring_root_hash) {
    throw new SessionStartedContractError(
      `v2 payload: scoring_root_hash mismatch (expected ${payload.scoring_root_hash}, recomputed ${roots.scoring_root_hash})`
    )
  }
  if (roots.renderer_requirements_root_hash !== payload.renderer_requirements_root_hash) {
    throw new SessionStartedContractError(
      `v2 payload: renderer_requirements_root_hash mismatch`
    )
  }
}

/**
 * 校验单题冻结快照：content_hash / scoring_hash 复算自洽；renderer_key 非空、
 * renderer_requirement_hash 为合法 sha256 格式（payload v2 只冻结 key+hash，不含完整 requirement 对象，
 * 故只校验格式与 root hash 层面的自洽）。
 */
export function verifyQuestionSnapshotV2(q: SessionQuestionSnapshotV2): void {
  const contentHash = hashRecord(q.content_json)
  if (contentHash !== q.content_hash) {
    throw new SessionStartedContractError(
      `v2 snapshot: content_hash mismatch for question ${q.question_id}`
    )
  }
  const scoringHash = hashRecord(q.scoring_rule_json)
  if (scoringHash !== q.scoring_hash) {
    throw new SessionStartedContractError(
      `v2 snapshot: scoring_hash mismatch for question ${q.question_id}`
    )
  }
  if (typeof q.renderer_key !== 'string' || q.renderer_key.length === 0) {
    throw new SessionStartedContractError(
      `v2 snapshot: renderer_key missing for question ${q.question_id}`
    )
  }
  if (typeof q.renderer_requirement_hash !== 'string' || !q.renderer_requirement_hash.startsWith('sha256:')) {
    throw new SessionStartedContractError(
      `v2 snapshot: renderer_requirement_hash malformed for question ${q.question_id}`
    )
  }
}

/**
 * 计算题集的三个 root hash（按 question_id 排序，与 authority 冻结顺序一致）。
 * createSession 构造 v2 payload 与 verify 复算共用，保证双向一致。
 */
export function computeQuestionRootHashes(
  questions: SessionQuestionSnapshotV2[]
): {
  content_root_hash: string
  scoring_root_hash: string
  renderer_requirements_root_hash: string
} {
  const sorted = [...questions].sort((a, b) => a.question_id.localeCompare(b.question_id))
  return {
    content_root_hash: hashRecord(
      sorted.map((q) => ({ question_id: q.question_id, content_hash: q.content_hash }))
    ),
    scoring_root_hash: hashRecord(
      sorted.map((q) => ({ question_id: q.question_id, scoring_hash: q.scoring_hash }))
    ),
    renderer_requirements_root_hash: hashRecord(
      sorted.map((q) => ({ question_id: q.question_id, renderer_requirement_hash: q.renderer_requirement_hash }))
    )
  }
}
