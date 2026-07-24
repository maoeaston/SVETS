import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { hashFile, hashRecord, questionSemanticHash } from './lib/job-skill-contract-hash.mjs'

const root = process.env.SVETS_REJECTED_REPLACEMENT_RESULTS_ROOT
  ? resolve(process.env.SVETS_REJECTED_REPLACEMENT_RESULTS_ROOT)
  : resolve(import.meta.dirname, '..')
const feature = (name) => resolve(root, 'doc/features', name)
const paths = {
  candidates: feature('job-skill-shelver-298-rejected-replacement-candidates-v2.json'),
  pendingGate: feature('job-skill-shelver-298-rejected-replacement-review-gate-v1.json'),
  contentSchema: feature('job-skill-shelver-298-rejected-replacement-content-confirmation-result-v1.schema.json'),
  safetySchema: feature('job-skill-shelver-298-rejected-replacement-safety-technical-review-result-v1.schema.json'),
  content: feature('job-skill-shelver-298-rejected-replacement-content-confirmation-result-chen-xiaoqing-2026-07-22.json'),
  safety: feature('job-skill-shelver-298-rejected-replacement-safety-technical-review-result-he-dong-2026-07-22.json'),
  merged: feature('job-skill-shelver-298-rejected-replacement-review-merged-gate-v1.json'),
  ledger: feature('job-skill-shelver-298-rejected-replacement-review-ledger-v1.md')
}

const checkOnly = process.argv.includes('--check')
const rel = (path) => path.slice(root.length + 1)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const sameValues = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
const hashPattern = /^sha256:[a-f0-9]{64}$/
const expectedIds = [
  'M1_OB_048_V2', 'M1_OP_042_V2', 'M3_OP_056_V2', 'M4_OP_043_V2',
  'M4_OP_044_V2', 'M4_OP_045_V2', 'M4_OP_046_V2', 'M4_OP_047_V2',
  'M4_OP_048_V2', 'M5_OP_048_V2', 'M5_OP_055_V2'
]
const expectedAuthority = {
  activation_authority_granted: false,
  can_activate_questions: false,
  runtime_database_change_allowed: false,
  activation_sql_generated: false
}
const expectedContentReviewKeys = [
  'content_conclusion', 'occupational_authenticity', 'prompt_and_boundary',
  'rubric_observability', 'material_feasibility', 'content_note', 'required_revision'
]
const expectedSafetyReviewKeys = [
  'safety_conclusion', 'technical_conclusion', 'renderer_feasibility',
  'data_contract_integrity', 'safety_sensitive_decision', 'stop_condition_note', 'technical_note'
]

function assertExactKeys(value, expected, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  assert(sameValues(Object.keys(value).sort(), [...expected].sort()), `${label} keys do not match the result Schema`)
}

function assertExactSet(actual, expected, label) {
  assert(new Set(actual).size === actual.length, `${label} contains duplicate IDs`)
  assert(actual.length === expected.length && [...actual].sort().every((id, index) => id === [...expected].sort()[index]), `${label} has missing or out-of-scope IDs`)
}

function indexBy(records, label) {
  assert(Array.isArray(records), `${label} must be an array`)
  const result = new Map()
  for (const record of records) {
    assert(typeof record?.question_id === 'string', `${label} contains a record without an ID`)
    assert(!result.has(record.question_id), `${label} duplicate ID: ${record.question_id}`)
    result.set(record.question_id, record)
  }
  return result
}

function countBy(records, selector) {
  const counts = {}
  for (const record of records) {
    const key = selector(record)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

const candidates = readJson(paths.candidates)
const pendingGate = readJson(paths.pendingGate)
const contentSchema = readJson(paths.contentSchema)
const safetySchema = readJson(paths.safetySchema)
const content = readJson(paths.content)
const safety = readJson(paths.safety)
const { candidate_set_hash: candidateSetHash, ...candidateSetBody } = candidates
const { gate_hash: pendingGateHash, ...pendingGateBody } = pendingGate

assert(hashRecord(candidateSetBody) === candidateSetHash, 'replacement candidate_set_hash drift')
assert(candidateSetHash === 'sha256:28a1d072fb81ed85dd3ee923f40c04a569a2b18248f1092684bf2faef2bd34ab', 'unexpected replacement candidate_set_hash')
assert(hashRecord(pendingGateBody) === pendingGateHash, 'replacement pending gate_hash drift')
assert(pendingGate.candidate_set?.candidate_set_hash === candidateSetHash, 'pending gate and candidate set do not match')
assertExactSet(candidates.questions.map((question) => question.question_id), expectedIds, 'replacement candidate set')
assert(candidates.status === 'DRAFT_REPLACEMENT_REVIEW_REQUIRED_NO_ACTIVATION_AUTHORITY', 'candidate set authority status drift')
assert(candidates.authority?.changes_current_authority === false, 'candidate set must not change current authority')
assert(pendingGate.boundaries?.phase4_authority_unchanged === true, 'pending gate must preserve phase 4 authority')

const candidatesById = indexBy(candidates.questions, 'replacement candidates')
for (const candidate of candidates.questions) {
  const { candidate_record_hash: recordHash, ...recordBody } = candidate
  assert(hashRecord(recordBody) === recordHash, `${candidate.question_id} candidate_record_hash drift`)
  assert(questionSemanticHash(candidate.proposed_question) === candidate.new_semantic_hash, `${candidate.question_id} new_semantic_hash drift`)
  assert(candidate.question_version === 2, `${candidate.question_id} question_version must be 2`)
  assert(candidate.previous_question_id === candidate.question_id.replace(/_V2$/, ''), `${candidate.question_id} version chain mismatch`)
  assert(sameValues(candidate.required_review_tracks, ['CONTENT', 'SAFETY_TECHNICAL']), `${candidate.question_id} review tracks drift`)
  assert(candidate.activation_authority === 'NONE', `${candidate.question_id} candidate granted activation authority`)
  assert(candidate.replacement_relationship?.rejected_original_remains_rejected === true, `${candidate.question_id} original rejection drift`)
  assert(candidate.replacement_relationship?.supersedes_original === false, `${candidate.question_id} must not supersede original before authority amendment`)
}

assert(contentSchema.properties?.candidate_set_hash?.const === candidateSetHash, 'content result Schema candidate_set_hash drift')
assert(safetySchema.properties?.candidate_set_hash?.const === candidateSetHash, 'safety result Schema candidate_set_hash drift')
assert(contentSchema.properties?.authority?.properties?.activation_authority_granted?.const === false, 'content result Schema grants activation authority')
assert(safetySchema.properties?.authority?.properties?.activation_authority_granted?.const === false, 'safety result Schema grants activation authority')
assert(contentSchema.properties?.questions?.items?.properties?.activation_authority?.const === 'NONE', 'content result Schema question authority drift')
assert(safetySchema.properties?.questions?.items?.properties?.activation_authority?.const === 'NONE', 'safety result Schema question authority drift')

assert(statSync(paths.content).size === 15635, 'Chen Xiaoqing replacement reviewer export byte count changed')
assert(statSync(paths.safety).size === 14101, 'He Dong replacement reviewer export byte count changed')
assert(hashFile(paths.content) === 'sha256:c1ee9285ee6dec38bc52d487ed4d7391d581c02ee9caf9a3c3a85bdb6bce4e6e', 'Chen Xiaoqing replacement reviewer export bytes changed')
assert(hashFile(paths.safety) === 'sha256:755837f746e55ba580f9d20b7fd9ea129cc29277f068e8d399d114bad715aabe', 'He Dong replacement reviewer export bytes changed')

function validateResult(result, config) {
  const { label, schemaVersion, packageId, reviewer, submittedAt, reviewKeys, kind } = config
  assertExactKeys(result, ['schema_version', 'package_id', 'candidate_set_id', 'candidate_set_hash', 'reviewer', 'submitted_at', 'authority', 'summary', 'questions'], label)
  assert(result.schema_version === schemaVersion, `${label} schema_version mismatch`)
  assert(result.package_id === packageId, `${label} package_id mismatch`)
  assert(result.candidate_set_id === candidates.candidate_set_id, `${label} candidate_set_id mismatch`)
  assert(result.candidate_set_hash === candidateSetHash, `${label} candidate_set_hash mismatch`)
  assert(sameValues(result.reviewer, reviewer), `${label} reviewer mismatch`)
  assert(result.submitted_at === submittedAt && !Number.isNaN(Date.parse(result.submitted_at)), `${label} submitted_at mismatch`)
  assert(sameValues(result.authority, expectedAuthority), `${label} attempted to grant authority`)
  assertExactKeys(result.summary, ['total', 'pass', 'return_for_revision'], `${label} summary`)
  assertExactSet(result.questions.map((question) => question.question_id), expectedIds, `${label} question set`)

  const byId = indexBy(result.questions, `${label} questions`)
  for (const questionId of expectedIds) {
    const review = byId.get(questionId)
    const candidate = candidatesById.get(questionId)
    assertExactKeys(review, ['question_id', 'previous_question_id', 'new_semantic_hash', 'candidate_record_hash', 'activation_authority', 'conclusion', 'review_fields'], `${label}/${questionId}`)
    assert(/^M[1-6]_[A-Z]+_\d+_V2$/.test(review.question_id), `${questionId} invalid question_id`)
    assert(review.previous_question_id === candidate.previous_question_id, `${questionId} previous_question_id mismatch`)
    assert(hashPattern.test(review.new_semantic_hash) && review.new_semantic_hash === candidate.new_semantic_hash, `${questionId} new_semantic_hash mismatch`)
    assert(hashPattern.test(review.candidate_record_hash) && review.candidate_record_hash === candidate.candidate_record_hash, `${questionId} candidate_record_hash mismatch`)
    assert(review.activation_authority === 'NONE', `${questionId} result granted activation authority`)
    assert(['PASS', 'RETURN_FOR_REVISION'].includes(review.conclusion), `${questionId} invalid conclusion`)
    assertExactKeys(review.review_fields, reviewKeys, `${label}/${questionId}/review_fields`)
    assert(Object.values(review.review_fields).every((value) => typeof value === 'string' && value.trim().length > 0), `${questionId} has an empty review field`)
    if (kind === 'content') {
      for (const field of ['content_conclusion', 'occupational_authenticity', 'prompt_and_boundary', 'rubric_observability', 'material_feasibility']) {
        assert(['PASS', 'RETURN_FOR_REVISION'].includes(review.review_fields[field]), `${questionId} invalid ${field}`)
      }
      assert(review.conclusion === review.review_fields.content_conclusion, `${questionId} content conclusion drift`)
    } else {
      for (const field of ['safety_conclusion', 'technical_conclusion', 'renderer_feasibility', 'data_contract_integrity']) {
        assert(['PASS', 'RETURN_FOR_REVISION'].includes(review.review_fields[field]), `${questionId} invalid ${field}`)
      }
      assert(['KEEP', 'ADD', 'REMOVE'].includes(review.review_fields.safety_sensitive_decision), `${questionId} invalid safety_sensitive_decision`)
    }
  }

  const passed = result.questions.filter((question) => question.conclusion === 'PASS').length
  const returned = result.questions.length - passed
  assert(sameValues(result.summary, { total: result.questions.length, pass: passed, return_for_revision: returned }), `${label} declared summary cannot be reconciled`)
  return { byId, declaredPassed: passed, declaredReturned: returned }
}

const contentReview = validateResult(content, {
  label: 'content result', kind: 'content',
  schemaVersion: 'job-skill-shelver-298-rejected-replacement-content-confirmation-result-v1',
  packageId: 'job-skill-shelver-298-rejected-replacement-content-confirmation-packet-chen-xiaoqing-v1',
  reviewer: { name: '陈晓青', track: 'CONTENT_CONFIRMATION', role: '内容确认' },
  submittedAt: '2026-07-22T02:03:21.072Z', reviewKeys: expectedContentReviewKeys
})
const safetyReview = validateResult(safety, {
  label: 'safety/technical result', kind: 'safety',
  schemaVersion: 'job-skill-shelver-298-rejected-replacement-safety-technical-review-result-v1',
  packageId: 'job-skill-shelver-298-rejected-replacement-safety-technical-review-packet-he-dong-v1',
  reviewer: { name: '赫东', track: 'SAFETY_TECHNICAL_REVIEW', role: '安全与技术审核' },
  submittedAt: '2026-07-22T02:01:26.248616Z', reviewKeys: expectedSafetyReviewKeys
})

const effectiveSafetyStatus = (review) => [
  'safety_conclusion', 'technical_conclusion', 'renderer_feasibility', 'data_contract_integrity'
].some((field) => review.review_fields[field] === 'RETURN_FOR_REVISION') ? 'RETURN_FOR_REVISION' : 'PASS'

const sourceConsistencyAnomalies = safety.questions.flatMap((review) => {
  const effective = effectiveSafetyStatus(review)
  return review.conclusion === effective ? [] : [{
    question_id: review.question_id,
    source_declared_conclusion: review.conclusion,
    effective_safety_technical_conclusion: effective,
    reason: 'Top-level conclusion ignored one or more safety/technical subfield returns; merged fail-closed.'
  }]
})
assertExactSet(sourceConsistencyAnomalies.map((item) => item.question_id), ['M1_OP_042_V2', 'M4_OP_045_V2', 'M4_OP_046_V2'], 'known safety export inconsistencies')

const mergedQuestions = expectedIds.map((questionId) => {
  const candidate = candidatesById.get(questionId)
  const contentResult = contentReview.byId.get(questionId)
  const safetyResult = safetyReview.byId.get(questionId)
  const safetyStatus = effectiveSafetyStatus(safetyResult)
  const failedReviewTracks = [
    contentResult.conclusion === 'RETURN_FOR_REVISION' ? 'CONTENT' : null,
    safetyStatus === 'RETURN_FOR_REVISION' ? 'SAFETY_TECHNICAL' : null
  ].filter(Boolean)
  const passed = failedReviewTracks.length === 0
  const base = {
    question_id: questionId,
    previous_question_id: candidate.previous_question_id,
    question_version: 2,
    candidate_record_hash: candidate.candidate_record_hash,
    semantic_hash: candidate.new_semantic_hash,
    source_pending_gate: { path: rel(paths.pendingGate), gate_hash: pendingGateHash, status: 'PENDING_REPLACEMENT_REVIEW' },
    required_review_tracks: ['CONTENT', 'SAFETY_TECHNICAL'],
    review_results: {
      content: { status: contentResult.conclusion, review_fields: contentResult.review_fields, source_record_hash: hashRecord(contentResult) },
      safety_technical: { status: safetyStatus, source_declared_status: safetyResult.conclusion, review_fields: safetyResult.review_fields, source_record_hash: hashRecord(safetyResult) }
    },
    status: passed ? 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY' : 'RETURN_FOR_REVISION',
    failed_review_tracks: failedReviewTracks,
    next_question_id: passed ? null : questionId.replace(/_V2$/, '_V3'),
    activation_authority: 'NONE',
    original_v1_remains_rejected: true,
    supersedes_original: false
  }
  return { ...base, merged_record_hash: hashRecord(base) }
})

const passed = mergedQuestions.filter((question) => question.status === 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY')
const returned = mergedQuestions.filter((question) => question.status === 'RETURN_FOR_REVISION')
const safetyEffectivePassed = safety.questions.filter((review) => effectiveSafetyStatus(review) === 'PASS').length
const mergedBase = {
  schema_version: 'job-skill-shelver-298-rejected-replacement-review-merged-gate-v1',
  gate_id: 'job-skill-shelver-298-rejected-replacement-review-merged-gate-v1',
  status: returned.length === 0 ? 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY' : 'COMPLETED_WITH_RETURNS_NO_ACTIVATION_AUTHORITY',
  generated_at: '2026-07-22T10:30:00+08:00',
  candidate_set: { path: rel(paths.candidates), candidate_set_hash: candidateSetHash, sha256: hashFile(paths.candidates) },
  pending_gate: { path: rel(paths.pendingGate), gate_hash: pendingGateHash, sha256: hashFile(paths.pendingGate) },
  source_results: {
    content: {
      source_path: 'E:\\Downloads\\job-skill-shelver-298-rejected-replacement-content-confirmation-packet-chen-xiaoqing-v1-result.json',
      received_path: rel(paths.content), bytes: statSync(paths.content).size, sha256: hashFile(paths.content),
      reviewer: content.reviewer, submitted_at: content.submitted_at, attachment_byte_match_verified: true
    },
    safety_technical: {
      source_path: 'E:\\Downloads\\job-skill-shelver-298-rejected-replacement-safety-technical-review-packet-he-dong-v1-result.json',
      received_path: rel(paths.safety), bytes: statSync(paths.safety).size, sha256: hashFile(paths.safety),
      reviewer: safety.reviewer, submitted_at: safety.submitted_at, attachment_byte_match_verified: true
    }
  },
  validation: {
    schema_identity_submitted_at_scope_hash_summary: 'PASSED',
    exact_content_question_set: expectedIds,
    exact_safety_technical_question_set: expectedIds,
    safety_technical_effective_status_policy: 'FAIL_CLOSED_IF_ANY_SAFETY_OR_TECHNICAL_SUBFIELD_RETURNS',
    source_internal_consistency: sourceConsistencyAnomalies.length === 0 ? 'PASSED' : 'PASSED_WITH_FAIL_CLOSED_NORMALIZATION',
    source_consistency_anomalies: sourceConsistencyAnomalies,
    scope_anomalies: []
  },
  summary: {
    total: mergedQuestions.length,
    passed_review_only_no_activation_authority: passed.length,
    return_for_revision: returned.length,
    pending: 0,
    content: { total: content.questions.length, passed: contentReview.declaredPassed, return_for_revision: contentReview.declaredReturned },
    safety_technical_source_declared: { total: safety.questions.length, passed: safetyReview.declaredPassed, return_for_revision: safetyReview.declaredReturned },
    safety_technical_effective: { total: safety.questions.length, passed: safetyEffectivePassed, return_for_revision: safety.questions.length - safetyEffectivePassed },
    returns_by_failed_tracks: countBy(returned, (question) => question.failed_review_tracks.join('+'))
  },
  authority: {
    activation_authority_granted: false,
    can_activate_questions: false,
    candidate_set_ready_for_separate_authority_amendment: returned.length === 0,
    authority_amendment_executed: false,
    existing_287_unchanged: true,
    rejected_originals_11_unchanged: true,
    runtime_database_unchanged: true,
    activation_sql_generated: false,
    delivery_lock_unchanged: true,
    next_revision_required: returned.length
  },
  questions: mergedQuestions
}
const merged = { ...mergedBase, gate_hash: hashRecord(mergedBase) }

const returnIds = returned.map((question) => `\`${question.question_id}\``).join('、') || '无'
const anomalyIds = sourceConsistencyAnomalies.map((item) => `\`${item.question_id}\``).join('、') || '无'
const ledger = `# 11道V2替代候选双轨审核接收台账

**状态：** ${merged.status}  
**候选集：** \`${candidateSetHash}\`  
**结论：** 11道新题中仅${passed.length}道双轨通过，${returned.length}道退回复修；审核通过不等于激活，现有287道运行题和原11道淘汰题均未改变。

## 原件接收

| 审核范围 | 原始路径 | 仓库固化路径 | 字节数 | SHA-256 |
|---|---|---|---:|---|
| 陈晓青：内容确认 | \`E:\\Downloads\\job-skill-shelver-298-rejected-replacement-content-confirmation-packet-chen-xiaoqing-v1-result.json\` | \`${rel(paths.content)}\` | ${statSync(paths.content).size} | \`${hashFile(paths.content)}\` |
| 赫东：安全与技术 | \`E:\\Downloads\\job-skill-shelver-298-rejected-replacement-safety-technical-review-packet-he-dong-v1-result.json\` | \`${rel(paths.safety)}\` | ${statSync(paths.safety).size} | \`${hashFile(paths.safety)}\` |

两份附件均已逐字节固化，脚本锁定字节数和SHA-256。原件不做格式化或内容改写。

## 校验与合并

- Schema身份、审核包ID、候选集ID/hash、审核人、提交时间、11题精确集合、逐题语义hash与候选记录hash均已通过。
- 陈晓青内容轨：${contentReview.declaredPassed}题通过、${contentReview.declaredReturned}题退回。
- 赫东原件顶层汇总：${safetyReview.declaredPassed}题通过、${safetyReview.declaredReturned}题退回；按安全与技术子项失败关闭后：${safetyEffectivePassed}题通过、${safety.questions.length - safetyEffectivePassed}题退回。
- [!] 赫东包导出逻辑忽略技术子项，导致${anomalyIds}的顶层结论与逐项意见冲突；合并结果保留原件值，并按逐项明确的退回意见失败关闭。
- 双轨同时通过：${passed.map((question) => `\`${question.question_id}\``).join('、')}。
- 退回复修：${returnIds}。

## 权限边界

- 所有逐题结果继续保持 \`activation_authority=NONE\`；本台账和合并门禁不授予激活权。
- 未修改运行权威、现有287道题、原11道V1淘汰状态、delivery lock或运行数据库。
- 未生成激活SQL；9道退回题进入V3复修前，候选集不具备独立权威修订条件。
`

for (const [path, value] of new Map([
  [paths.merged, `${JSON.stringify(merged, null, 2)}\n`],
  [paths.ledger, ledger]
])) {
  if (checkOnly) assert(readFileSync(path, 'utf8') === value, `${rel(path)} is stale`)
  else writeFileSync(path, value)
}

console.log(`Rejected replacement review results ${checkOnly ? 'verified' : 'ingested'}: ${passed.length} passed review only, ${returned.length} returned; activation authority remains NONE.`)
