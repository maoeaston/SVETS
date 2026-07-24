import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { hashFile, hashRecord, questionSemanticHash } from './lib/job-skill-contract-hash.mjs'

const root = process.env.SVETS_REJECTED_REPLACEMENT_V4_RESULTS_ROOT
  ? resolve(process.env.SVETS_REJECTED_REPLACEMENT_V4_RESULTS_ROOT)
  : resolve(import.meta.dirname, '..')
const feature = (name) => resolve(root, 'doc/features', name)
const paths = {
  candidates: feature('job-skill-shelver-298-rejected-replacement-targeted-candidates-v4.json'),
  pendingGate: feature('job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-gate-v1.json'),
  contentSchema: feature('job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-result-v1.schema.json'),
  content: feature('job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-result-chen-xiaoqing-2026-07-22.json'),
  merged: feature('job-skill-shelver-298-rejected-replacement-targeted-v4-rereview-merged-gate-v1.json'),
  ledger: feature('job-skill-shelver-298-rejected-replacement-targeted-v4-rereview-ledger-v1.md')
}
const checkOnly = process.argv.includes('--check')
const rel = (path) => path.slice(root.length + 1)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const sameValues = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
const hashPattern = /^sha256:[a-f0-9]{64}$/
const v4Ids = ['M1_OP_042_V4', 'M3_OP_056_V4', 'M4_OP_045_V4', 'M4_OP_046_V4', 'M4_OP_048_V4', 'M5_OP_048_V4']
const priorPassIds = ['M4_OP_043_V2', 'M4_OP_044_V2', 'M1_OB_048_V3', 'M4_OP_047_V3', 'M5_OP_055_V3']
const contentReviewKeys = [
  'content_conclusion', 'occupational_authenticity', 'prompt_and_boundary',
  'rubric_observability', 'material_feasibility', 'content_note', 'required_revision'
]
const conclusionFields = [
  'content_conclusion', 'occupational_authenticity', 'prompt_and_boundary',
  'rubric_observability', 'material_feasibility'
]
const expectedAuthority = {
  activation_authority_granted: false,
  can_activate_questions: false,
  runtime_database_change_allowed: false,
  activation_sql_generated: false
}

function assertExactKeys(value, expected, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  assert(sameValues(Object.keys(value).sort(), [...expected].sort()), `${label} keys do not match the result Schema`)
}

function assertExactSet(actual, expected, label) {
  assert(new Set(actual).size === actual.length, `${label} contains duplicate IDs`)
  assert(actual.length === expected.length, `${label} count mismatch`)
  assert([...actual].sort().every((id, index) => id === [...expected].sort()[index]), `${label} has missing or out-of-scope IDs`)
}

function indexBy(records, label) {
  assert(Array.isArray(records), `${label} must be an array`)
  const map = new Map()
  for (const record of records) {
    assert(typeof record?.question_id === 'string', `${label} contains a record without an ID`)
    assert(!map.has(record.question_id), `${label} duplicate ID: ${record.question_id}`)
    map.set(record.question_id, record)
  }
  return map
}

for (const path of [paths.candidates, paths.pendingGate, paths.contentSchema, paths.content]) {
  assert(existsSync(path), `missing input: ${rel(path)}`)
}

const candidates = readJson(paths.candidates)
const pendingGate = readJson(paths.pendingGate)
const contentSchema = readJson(paths.contentSchema)
const content = readJson(paths.content)
const { candidate_set_hash: candidateSetHash, ...candidateSetBody } = candidates
const { gate_hash: pendingGateHash, ...pendingGateBody } = pendingGate

assert(hashRecord(candidateSetBody) === candidateSetHash, 'V4 candidate_set_hash drift')
assert(candidateSetHash === 'sha256:6ec5020603b1e7989d384fd1b40236a574c208e00d9bc85255cd3fd56536bdcb', 'unexpected V4 candidate_set_hash')
assert(hashRecord(pendingGateBody) === pendingGateHash, 'V4 pending gate_hash drift')
assert(pendingGate.candidate_set?.candidate_set_hash === candidateSetHash, 'V4 pending gate and candidate set do not match')
assert(candidates.status === 'DRAFT_TARGETED_CONTENT_REREVIEW_REQUIRED_NO_ACTIVATION_AUTHORITY', 'V4 candidate status drift')
assert(pendingGate.status === 'PENDING_TARGETED_V4_CONTENT_REREVIEW_NO_ACTIVATION_AUTHORITY', 'V4 pending gate status drift')
assertExactSet(candidates.questions.map((question) => question.question_id), v4Ids, 'V4 candidate set')
assertExactSet(candidates.cumulative_passed_references.map((question) => question.question_id), priorPassIds, 'prior passed references')
assertExactSet(pendingGate.review_routing.content, v4Ids, 'pending content route')
assertExactSet(pendingGate.review_routing.safety_technical, [], 'pending safety route')
assert(candidates.authority?.activation_authority_granted === false && candidates.authority?.can_activate_questions === false, 'V4 candidates grant authority')
assert(pendingGate.boundaries?.activation_authority_granted === false && pendingGate.boundaries?.can_activate_questions === false, 'V4 pending gate grants authority')

const candidatesById = indexBy(candidates.questions, 'V4 candidates')
const carriedById = indexBy(pendingGate.review_routing.carried_forward_safety_technical_passes, 'carried safety technical passes')
for (const candidate of candidates.questions) {
  const { candidate_record_hash: recordHash, ...recordBody } = candidate
  assert(hashRecord(recordBody) === recordHash, `${candidate.question_id} candidate_record_hash drift`)
  assert(questionSemanticHash(candidate.proposed_question) === candidate.new_semantic_hash, `${candidate.question_id} new_semantic_hash drift`)
  assert(candidate.question_version === 4, `${candidate.question_id} question_version must be 4`)
  assert(candidate.previous_question_id === candidate.question_id.replace(/_V4$/, '_V3'), `${candidate.question_id} version chain mismatch`)
  assert(candidate.activation_authority === 'NONE', `${candidate.question_id} granted activation authority`)
  assertExactSet(candidate.required_review_tracks, ['CONTENT'], `${candidate.question_id} review tracks`)
  assertExactSet(candidate.proposed_question.content.professional_review.tracks, ['CONTENT'], `${candidate.question_id} professional review tracks`)
  const carried = candidate.revision_trace.carried_forward_review_passes
  assert(carried.length === 1 && carried[0].track === 'SAFETY_TECHNICAL' && carried[0].status === 'PASS', `${candidate.question_id} carried safety pass missing`)
  assert(hashPattern.test(carried[0].source_record_hash), `${candidate.question_id} carried safety source hash invalid`)
  assert(sameValues(carriedById.get(candidate.question_id), { question_id: candidate.question_id, ...carried[0] }), `${candidate.question_id} pending carried safety hash mismatch`)
}

assert(contentSchema.properties?.candidate_set_hash?.const === candidateSetHash, 'content Schema candidate_set_hash drift')
assert(contentSchema.properties?.questions?.minItems === v4Ids.length && contentSchema.properties?.questions?.maxItems === v4Ids.length, 'content Schema scope count drift')
assertExactSet(contentSchema.properties.questions.items.properties.question_id.enum, v4Ids, 'content Schema question scope')
assert(contentSchema.properties?.authority?.properties?.activation_authority_granted?.const === false, 'content Schema grants authority')
assert(contentSchema.properties?.questions?.items?.properties?.activation_authority?.const === 'NONE', 'content Schema question authority drift')

assert(statSync(paths.content).size === 4902, 'Chen Xiaoqing V4 reviewer export byte count changed')
assert(hashFile(paths.content) === 'sha256:2347aa2e61ab73e69b43ff32ea28fb0aedfa9f07ac80364fe84ab32e1e0ead5c', 'Chen Xiaoqing V4 reviewer export bytes changed')

assertExactKeys(content, ['schema_version', 'package_id', 'candidate_set_id', 'candidate_set_hash', 'reviewer', 'submitted_at', 'authority', 'summary', 'questions'], 'V4 content result')
assert(content.schema_version === 'job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-result-v1', 'V4 content schema_version mismatch')
assert(content.package_id === 'job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-packet-chen-xiaoqing-v1', 'V4 content package_id mismatch')
assert(content.candidate_set_id === candidates.candidate_set_id && content.candidate_set_hash === candidateSetHash, 'V4 content candidate set mismatch')
assert(sameValues(content.reviewer, { name: '陈晓青', track: 'CONTENT_REREVIEW', role: '内容定点复审' }), 'V4 content reviewer mismatch')
assert(content.submitted_at === '2026-07-22T06:25:13.691Z' && !Number.isNaN(Date.parse(content.submitted_at)), 'V4 content submitted_at mismatch')
assert(sameValues(content.authority, expectedAuthority), 'V4 content attempted to grant authority')
assertExactKeys(content.summary, ['total', 'pass', 'return_for_revision'], 'V4 content summary')
assertExactSet(content.questions.map((question) => question.question_id), v4Ids, 'V4 content result route')

const contentById = indexBy(content.questions, 'V4 content result questions')
for (const questionId of v4Ids) {
  const review = contentById.get(questionId)
  const candidate = candidatesById.get(questionId)
  assertExactKeys(review, ['question_id', 'previous_question_id', 'new_semantic_hash', 'candidate_record_hash', 'activation_authority', 'conclusion', 'review_fields'], `V4 content/${questionId}`)
  assert(/^M[1-6]_[A-Z]+_\d+_V4$/.test(review.question_id), `${questionId} invalid question_id`)
  assert(review.previous_question_id === candidate.previous_question_id, `${questionId} previous_question_id mismatch`)
  assert(review.new_semantic_hash === candidate.new_semantic_hash, `${questionId} semantic hash mismatch`)
  assert(review.candidate_record_hash === candidate.candidate_record_hash, `${questionId} candidate record hash mismatch`)
  assert(review.activation_authority === 'NONE', `${questionId} result granted activation authority`)
  assertExactKeys(review.review_fields, contentReviewKeys, `${questionId} review_fields`)
  assert(Object.values(review.review_fields).every((value) => typeof value === 'string' && value.trim().length > 0), `${questionId} has an empty review field`)
  assert(conclusionFields.every((field) => review.review_fields[field] === 'PASS'), `${questionId} contains a returned content subfield`)
  assert(review.conclusion === 'PASS', `${questionId} top-level conclusion mismatch`)
}
assert(sameValues(content.summary, { total: 6, pass: 6, return_for_revision: 0 }), 'V4 content summary cannot be reconciled')

const mergedQuestions = v4Ids.map((questionId) => {
  const candidate = candidatesById.get(questionId)
  const review = contentById.get(questionId)
  const carriedSafety = candidate.revision_trace.carried_forward_review_passes[0]
  const base = {
    question_id: questionId,
    previous_question_id: candidate.previous_question_id,
    source_question_id: candidate.source_question_id,
    question_version: 4,
    candidate_record_hash: candidate.candidate_record_hash,
    semantic_hash: candidate.new_semantic_hash,
    source_pending_gate: { path: rel(paths.pendingGate), gate_hash: pendingGateHash, status: pendingGate.status },
    required_review_tracks: ['CONTENT'],
    review_results: {
      content: { status: 'PASS', source: 'V4_RESULT', review_fields: review.review_fields, source_record_hash: hashRecord(review) },
      safety_technical: { status: 'PASS', source: 'CARRIED_FROM_PRIOR_REVIEW', source_record_hash: carriedSafety.source_record_hash }
    },
    status: 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY',
    failed_review_tracks: [],
    next_question_id: null,
    activation_authority: 'NONE',
    original_v1_remains_rejected: true,
    previous_v3_not_activated: true,
    supersedes_original: false
  }
  return { ...base, merged_record_hash: hashRecord(base) }
})

const cumulativePassed = [
  ...candidates.cumulative_passed_references.map((item) => ({
    question_id: item.question_id,
    version: item.version,
    semantic_hash: item.semantic_hash,
    candidate_record_hash: item.candidate_record_hash,
    activation_authority: 'NONE'
  })),
  ...mergedQuestions.map((item) => ({
    question_id: item.question_id,
    version: 4,
    semantic_hash: item.semantic_hash,
    candidate_record_hash: item.candidate_record_hash,
    activation_authority: 'NONE'
  }))
]

const mergedBase = {
  schema_version: 'job-skill-shelver-298-rejected-replacement-targeted-v4-rereview-merged-gate-v1',
  gate_id: 'job-skill-shelver-298-rejected-replacement-targeted-v4-rereview-merged-gate-v1',
  status: 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY',
  generated_at: '2026-07-22T18:00:00+08:00',
  candidate_set: { path: rel(paths.candidates), candidate_set_hash: candidateSetHash, sha256: hashFile(paths.candidates) },
  pending_gate: { path: rel(paths.pendingGate), gate_hash: pendingGateHash, sha256: hashFile(paths.pendingGate) },
  source_result: {
    content: {
      source_path: 'E:\\Downloads\\job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-packet-chen-xiaoqing-v1-result.json',
      received_path: rel(paths.content),
      bytes: statSync(paths.content).size,
      sha256: hashFile(paths.content),
      reviewer: content.reviewer,
      submitted_at: content.submitted_at,
      attachment_byte_match_verified: true
    }
  },
  validation: {
    schema_identity_submitted_at_scope_hash_summary: 'PASSED',
    exact_content_question_set: v4Ids,
    carried_forward_safety_technical_pass_hashes: 'PASSED',
    effective_status_policy: 'FAIL_CLOSED_IF_ANY_CONTENT_SUBFIELD_RETURNS',
    source_internal_consistency: 'PASSED',
    source_consistency_anomalies: [],
    scope_anomalies: []
  },
  summary: {
    v4_total: 6,
    v4_passed_review_only_no_activation_authority: 6,
    v4_return_for_revision: 0,
    v4_pending: 0,
    content_v4: { total: 6, passed: 6, return_for_revision: 0 },
    safety_technical_v4: { total: 6, passed_carried_forward: 6, return_for_revision: 0 },
    cumulative_replacement_review: { total: 11, passed_review_only_no_activation_authority: 11, return_for_revision: 0 }
  },
  cumulative_passed_references: cumulativePassed,
  authority: {
    activation_authority_granted: false,
    can_activate_questions: false,
    candidate_set_ready_for_separate_authority_amendment: true,
    separate_authority_amendment_required: true,
    authority_amendment_executed: false,
    existing_287_unchanged: true,
    rejected_originals_11_unchanged: true,
    runtime_database_unchanged: true,
    activation_sql_generated: false,
    delivery_lock_unchanged: true,
    next_revision_required: 0
  },
  questions: mergedQuestions
}
const merged = { ...mergedBase, gate_hash: hashRecord(mergedBase) }

const ledger = `# 6 道 V4 内容定点复审结果接收台账

**状态：** ${merged.status}  
**候选集：** \`${candidateSetHash}\`  
**结论：** 6 道 V4 内容复审全部通过，连同此前 5 道通过引用，11 道替代题均已完成所需审核。审核通过不等于激活。

## 原件接收

| 审核范围 | 原始路径 | 仓库固化路径 | 字节数 | SHA-256 |
|---|---|---|---:|---|
| 陈晓青：6 道 V4 内容定点复审 | \`E:\\Downloads\\job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-packet-chen-xiaoqing-v1-result.json\` | \`${rel(paths.content)}\` | ${statSync(paths.content).size} | \`${hashFile(paths.content)}\` |

附件已逐字节固化，脚本锁定字节数和 SHA-256。原件不做格式化或内容改写。

## 校验与合并

- Schema 身份、审核包 ID、候选集 ID 和 hash、审核人、提交时间、6 道题精确集合、逐题语义 hash 与候选记录 hash 均已通过。
- 陈晓青内容轨：6 道通过、0 道退回。
- 6 条赫东安全技术通过记录继续按来源审核 hash 携带，没有扩大复审范围。
- 累计通过引用：${cumulativePassed.map((item) => `\`${item.question_id}\``).join('、')}。

## 权限边界

- 11 道替代题均已完成所需审核，可进入单独的运行权威修订评估；本次没有执行该修订。
- 所有逐题结果继续保持 \`activation_authority=NONE\`，本台账和合并门禁不授予激活权。
- 未修改运行权威、现有 287 道题、原 11 道 V1 淘汰状态、delivery lock 或运行数据库。
- 未生成激活 SQL。后续若要纳入运行题库，必须单独更新权威、delivery lock 和线下工具合同，并重新通过相应门禁。
`

for (const [path, value] of [
  [paths.merged, `${JSON.stringify(merged, null, 2)}\n`],
  [paths.ledger, ledger]
]) {
  if (checkOnly) {
    assert(existsSync(path), `missing generated artifact: ${rel(path)}`)
    assert(readFileSync(path, 'utf8') === value, `${rel(path)} is stale`)
  } else writeFileSync(path, value)
}

console.log(`Rejected replacement targeted V4 results ${checkOnly ? 'verified' : 'ingested'}: 6 V4 passed, 0 returned; cumulative 11/11 passed review only; activation authority NONE.`)
