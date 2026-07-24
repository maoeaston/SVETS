import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { hashFile, hashRecord, questionSemanticHash } from './lib/job-skill-contract-hash.mjs'

const root = process.env.SVETS_REJECTED_REPLACEMENT_V3_RESULTS_ROOT
  ? resolve(process.env.SVETS_REJECTED_REPLACEMENT_V3_RESULTS_ROOT)
  : resolve(import.meta.dirname, '..')
const feature = (name) => resolve(root, 'doc/features', name)
const paths = {
  candidates: feature('job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.json'),
  pendingGate: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-review-gate-v1.json'),
  contentSchema: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-result-v1.schema.json'),
  safetySchema: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-result-v1.schema.json'),
  content: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-result-chen-xiaoqing-2026-07-22.json'),
  safety: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-result-he-dong-2026-07-22.json'),
  merged: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-rereview-merged-gate-v1.json'),
  ledger: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-rereview-ledger-v1.md')
}
const checkOnly = process.argv.includes('--check')
const rel = (path) => path.slice(root.length + 1)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const sameValues = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
const hashPattern = /^sha256:[a-f0-9]{64}$/
const v3Ids = [
  'M1_OB_048_V3', 'M1_OP_042_V3', 'M3_OP_056_V3', 'M4_OP_045_V3', 'M4_OP_046_V3',
  'M4_OP_047_V3', 'M4_OP_048_V3', 'M5_OP_048_V3', 'M5_OP_055_V3'
]
const contentIds = v3Ids.filter((id) => id !== 'M4_OP_047_V3')
const safetyIds = v3Ids.filter((id) => !['M3_OP_056_V3', 'M5_OP_055_V3'].includes(id))
const passedV2Ids = ['M4_OP_043_V2', 'M4_OP_044_V2']
const expectedAuthority = {
  activation_authority_granted: false,
  can_activate_questions: false,
  runtime_database_change_allowed: false,
  activation_sql_generated: false
}
const contentReviewKeys = [
  'content_conclusion', 'occupational_authenticity', 'prompt_and_boundary',
  'rubric_observability', 'material_feasibility', 'content_note', 'required_revision'
]
const safetyReviewKeys = [
  'safety_conclusion', 'technical_conclusion', 'renderer_feasibility',
  'data_contract_integrity', 'safety_sensitive_decision', 'stop_condition_note', 'technical_note'
]

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

function countBy(records, selector) {
  const counts = {}
  for (const record of records) {
    const key = selector(record)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

for (const path of Object.values(paths).slice(0, 6)) assert(existsSync(path), `missing input: ${rel(path)}`)
const candidates = readJson(paths.candidates)
const pendingGate = readJson(paths.pendingGate)
const contentSchema = readJson(paths.contentSchema)
const safetySchema = readJson(paths.safetySchema)
const content = readJson(paths.content)
const safety = readJson(paths.safety)
const { candidate_set_hash: candidateSetHash, ...candidateSetBody } = candidates
const { gate_hash: pendingGateHash, ...pendingGateBody } = pendingGate

assert(hashRecord(candidateSetBody) === candidateSetHash, 'V3 candidate_set_hash drift')
assert(candidateSetHash === 'sha256:6066f243639237f898095b79ecd667d93bf54a1dc2ecf39a85852d7df96870f4', 'unexpected V3 candidate_set_hash')
assert(hashRecord(pendingGateBody) === pendingGateHash, 'V3 pending gate_hash drift')
assert(pendingGate.candidate_set?.candidate_set_hash === candidateSetHash, 'V3 pending gate and candidate set do not match')
assertExactSet(candidates.questions.map((question) => question.question_id), v3Ids, 'V3 candidate set')
assertExactSet(candidates.passed_v2_references.map((question) => question.question_id), passedV2Ids, 'passed V2 references')
assertExactSet(pendingGate.review_routing.content, contentIds, 'pending content route')
assertExactSet(pendingGate.review_routing.safety_technical, safetyIds, 'pending safety route')
assert(candidates.status === 'DRAFT_TARGETED_REREVIEW_REQUIRED_NO_ACTIVATION_AUTHORITY', 'V3 candidate status drift')
assert(candidates.authority?.activation_authority_granted === false && candidates.authority?.can_activate_questions === false, 'V3 candidates grant authority')
assert(pendingGate.boundaries?.activation_authority_granted === false && pendingGate.boundaries?.can_activate_questions === false, 'V3 pending gate grants authority')

const candidatesById = indexBy(candidates.questions, 'V3 candidates')
for (const candidate of candidates.questions) {
  const { candidate_record_hash: recordHash, ...recordBody } = candidate
  assert(hashRecord(recordBody) === recordHash, `${candidate.question_id} candidate_record_hash drift`)
  assert(questionSemanticHash(candidate.proposed_question) === candidate.new_semantic_hash, `${candidate.question_id} new_semantic_hash drift`)
  assert(candidate.question_version === 3, `${candidate.question_id} question_version must be 3`)
  assert(candidate.previous_question_id === candidate.question_id.replace(/_V3$/, '_V2'), `${candidate.question_id} version chain mismatch`)
  assert(candidate.activation_authority === 'NONE', `${candidate.question_id} granted activation authority`)
  assertExactSet(candidate.proposed_question.content.professional_review.tracks, candidate.required_review_tracks, `${candidate.question_id} professional review tracks`)
  assert(candidate.replacement_relationship?.rejected_original_remains_rejected === true, `${candidate.question_id} original rejection drift`)
  assert(candidate.replacement_relationship?.previous_v2_not_activated === true, `${candidate.question_id} previous V2 activation drift`)
  assert(candidate.replacement_relationship?.supersedes_original === false, `${candidate.question_id} supersedes original before authority amendment`)
}

assert(contentSchema.properties?.candidate_set_hash?.const === candidateSetHash, 'content Schema candidate_set_hash drift')
assert(safetySchema.properties?.candidate_set_hash?.const === candidateSetHash, 'safety Schema candidate_set_hash drift')
assert(contentSchema.properties?.questions?.minItems === contentIds.length, 'content Schema scope count drift')
assert(safetySchema.properties?.questions?.maxItems === safetyIds.length, 'safety Schema scope count drift')
assertExactSet(contentSchema.properties.questions.items.properties.question_id.enum, contentIds, 'content Schema question scope')
assertExactSet(safetySchema.properties.questions.items.properties.question_id.enum, safetyIds, 'safety Schema question scope')
assert(contentSchema.properties?.authority?.properties?.activation_authority_granted?.const === false, 'content Schema grants authority')
assert(safetySchema.properties?.authority?.properties?.activation_authority_granted?.const === false, 'safety Schema grants authority')
assert(contentSchema.properties?.questions?.items?.properties?.activation_authority?.const === 'NONE', 'content Schema question authority drift')
assert(safetySchema.properties?.questions?.items?.properties?.activation_authority?.const === 'NONE', 'safety Schema question authority drift')

assert(statSync(paths.content).size === 12664, 'Chen Xiaoqing V3 reviewer export byte count changed')
assert(statSync(paths.safety).size === 5676, 'He Dong V3 reviewer export byte count changed')
assert(hashFile(paths.content) === 'sha256:70dd799fdc5071245b4b08e2e6a2540c79d92b95a68124fb39449039b1e69e92', 'Chen Xiaoqing V3 reviewer export bytes changed')
assert(hashFile(paths.safety) === 'sha256:40d2cc0cbb07cc67f02f87a47f27505fb83f85a322274373ff28e89426051923', 'He Dong V3 reviewer export bytes changed')

function effectiveStatus(review, fields) {
  return fields.some((field) => review.review_fields[field] === 'RETURN_FOR_REVISION') ? 'RETURN_FOR_REVISION' : 'PASS'
}

function validateResult(result, config) {
  const { label, expectedIds, schemaVersion, packageId, reviewer, submittedAt, reviewKeys, conclusionFields, kind } = config
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
  const anomalies = []
  for (const questionId of expectedIds) {
    const review = byId.get(questionId)
    const candidate = candidatesById.get(questionId)
    assertExactKeys(review, ['question_id', 'previous_question_id', 'new_semantic_hash', 'candidate_record_hash', 'activation_authority', 'conclusion', 'review_fields'], `${label}/${questionId}`)
    assert(/^M[1-6]_[A-Z]+_\d+_V3$/.test(review.question_id), `${questionId} invalid question_id`)
    assert(review.previous_question_id === candidate.previous_question_id, `${questionId} previous_question_id mismatch`)
    assert(hashPattern.test(review.new_semantic_hash) && review.new_semantic_hash === candidate.new_semantic_hash, `${questionId} new_semantic_hash mismatch`)
    assert(hashPattern.test(review.candidate_record_hash) && review.candidate_record_hash === candidate.candidate_record_hash, `${questionId} candidate_record_hash mismatch`)
    assert(review.activation_authority === 'NONE', `${questionId} result granted activation authority`)
    assert(['PASS', 'RETURN_FOR_REVISION'].includes(review.conclusion), `${questionId} invalid conclusion`)
    assertExactKeys(review.review_fields, reviewKeys, `${label}/${questionId}/review_fields`)
    assert(Object.values(review.review_fields).every((value) => typeof value === 'string' && value.trim().length > 0), `${questionId} has an empty review field`)
    for (const field of conclusionFields) assert(['PASS', 'RETURN_FOR_REVISION'].includes(review.review_fields[field]), `${questionId} invalid ${field}`)
    if (kind === 'safety') assert(['KEEP', 'ADD', 'REMOVE'].includes(review.review_fields.safety_sensitive_decision), `${questionId} invalid safety_sensitive_decision`)
    const effective = effectiveStatus(review, conclusionFields)
    if (review.conclusion !== effective) anomalies.push({ question_id: questionId, source_declared_conclusion: review.conclusion, effective_conclusion: effective })
  }
  const declaredPassed = result.questions.filter((question) => question.conclusion === 'PASS').length
  const declaredReturned = result.questions.length - declaredPassed
  assert(sameValues(result.summary, { total: result.questions.length, pass: declaredPassed, return_for_revision: declaredReturned }), `${label} summary cannot be reconciled`)
  return { byId, anomalies, declaredPassed, declaredReturned }
}

const contentReview = validateResult(content, {
  label: 'V3 content result', expectedIds: contentIds,
  schemaVersion: 'job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-result-v1',
  packageId: 'job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-packet-chen-xiaoqing-v1',
  reviewer: { name: '陈晓青', track: 'CONTENT_REREVIEW', role: '内容定点复审' },
  submittedAt: '2026-07-22T03:23:51.422Z', reviewKeys: contentReviewKeys,
  conclusionFields: ['content_conclusion', 'occupational_authenticity', 'prompt_and_boundary', 'rubric_observability', 'material_feasibility'], kind: 'content'
})
const safetyReview = validateResult(safety, {
  label: 'V3 safety/technical result', expectedIds: safetyIds,
  schemaVersion: 'job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-result-v1',
  packageId: 'job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-packet-he-dong-v1',
  reviewer: { name: '赫东', track: 'SAFETY_TECHNICAL_REREVIEW', role: '安全与技术定点复审' },
  submittedAt: '2026-07-22T03:21:55.761115Z', reviewKeys: safetyReviewKeys,
  conclusionFields: ['safety_conclusion', 'technical_conclusion', 'renderer_feasibility', 'data_contract_integrity'], kind: 'safety'
})
const sourceConsistencyAnomalies = [
  ...contentReview.anomalies.map((item) => ({ track: 'CONTENT', ...item })),
  ...safetyReview.anomalies.map((item) => ({ track: 'SAFETY_TECHNICAL', ...item }))
]
assert(sourceConsistencyAnomalies.length === 0, 'V3 reviewer exports contain top-level/subfield conclusion inconsistencies')

function carriedPass(candidate, track) {
  const pass = candidate.revision_trace.carried_forward_review_passes.find((item) => item.track === track)
  assert(pass?.status === 'PASS' && hashPattern.test(pass.source_record_hash), `${candidate.question_id} missing carried ${track} pass`)
  return pass
}

const mergedQuestions = v3Ids.map((questionId) => {
  const candidate = candidatesById.get(questionId)
  const requiresContent = candidate.required_review_tracks.includes('CONTENT')
  const requiresSafety = candidate.required_review_tracks.includes('SAFETY_TECHNICAL')
  const contentResult = requiresContent ? contentReview.byId.get(questionId) : null
  const safetyResult = requiresSafety ? safetyReview.byId.get(questionId) : null
  const contentStatus = requiresContent
    ? effectiveStatus(contentResult, ['content_conclusion', 'occupational_authenticity', 'prompt_and_boundary', 'rubric_observability', 'material_feasibility'])
    : carriedPass(candidate, 'CONTENT').status
  const safetyStatus = requiresSafety
    ? effectiveStatus(safetyResult, ['safety_conclusion', 'technical_conclusion', 'renderer_feasibility', 'data_contract_integrity'])
    : carriedPass(candidate, 'SAFETY_TECHNICAL').status
  const failedReviewTracks = [contentStatus === 'RETURN_FOR_REVISION' ? 'CONTENT' : null, safetyStatus === 'RETURN_FOR_REVISION' ? 'SAFETY_TECHNICAL' : null].filter(Boolean)
  const passed = failedReviewTracks.length === 0
  const base = {
    question_id: questionId,
    previous_question_id: candidate.previous_question_id,
    source_question_id: candidate.source_question_id,
    question_version: 3,
    candidate_record_hash: candidate.candidate_record_hash,
    semantic_hash: candidate.new_semantic_hash,
    source_pending_gate: { path: rel(paths.pendingGate), gate_hash: pendingGateHash, status: pendingGate.status },
    required_review_tracks: candidate.required_review_tracks,
    review_results: {
      content: requiresContent
        ? { status: contentStatus, source: 'V3_RESULT', review_fields: contentResult.review_fields, source_record_hash: hashRecord(contentResult) }
        : { status: 'PASS', source: 'CARRIED_FROM_V2_REVIEW', source_record_hash: carriedPass(candidate, 'CONTENT').source_record_hash },
      safety_technical: requiresSafety
        ? { status: safetyStatus, source: 'V3_RESULT', review_fields: safetyResult.review_fields, source_record_hash: hashRecord(safetyResult) }
        : { status: 'PASS', source: 'CARRIED_FROM_V2_REVIEW', source_record_hash: carriedPass(candidate, 'SAFETY_TECHNICAL').source_record_hash }
    },
    status: passed ? 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY' : 'RETURN_FOR_REVISION',
    failed_review_tracks: failedReviewTracks,
    next_question_id: passed ? null : questionId.replace(/_V3$/, '_V4'),
    activation_authority: 'NONE',
    original_v1_remains_rejected: true,
    previous_v2_not_activated: true,
    supersedes_original: false
  }
  return { ...base, merged_record_hash: hashRecord(base) }
})

const passedV3 = mergedQuestions.filter((question) => question.status === 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY')
const returnedV3 = mergedQuestions.filter((question) => question.status === 'RETURN_FOR_REVISION')
const cumulativePassed = [
  ...candidates.passed_v2_references.map((item) => ({ question_id: item.question_id, version: 2, semantic_hash: item.semantic_hash, candidate_record_hash: item.candidate_record_hash, activation_authority: 'NONE' })),
  ...passedV3.map((item) => ({ question_id: item.question_id, version: 3, semantic_hash: item.semantic_hash, candidate_record_hash: item.candidate_record_hash, activation_authority: 'NONE' }))
]
const mergedBase = {
  schema_version: 'job-skill-shelver-298-rejected-replacement-targeted-v3-rereview-merged-gate-v1',
  gate_id: 'job-skill-shelver-298-rejected-replacement-targeted-v3-rereview-merged-gate-v1',
  status: returnedV3.length === 0 ? 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY' : 'COMPLETED_WITH_RETURNS_NO_ACTIVATION_AUTHORITY',
  generated_at: '2026-07-22T12:00:00+08:00',
  candidate_set: { path: rel(paths.candidates), candidate_set_hash: candidateSetHash, sha256: hashFile(paths.candidates) },
  pending_gate: { path: rel(paths.pendingGate), gate_hash: pendingGateHash, sha256: hashFile(paths.pendingGate) },
  source_results: {
    content: {
      source_path: 'E:\\Downloads\\job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-packet-chen-xiaoqing-v1-result.json',
      received_path: rel(paths.content), bytes: statSync(paths.content).size, sha256: hashFile(paths.content), reviewer: content.reviewer, submitted_at: content.submitted_at, attachment_byte_match_verified: true
    },
    safety_technical: {
      source_path: 'E:\\Downloads\\job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-packet-he-dong-v1-result.json',
      received_path: rel(paths.safety), bytes: statSync(paths.safety).size, sha256: hashFile(paths.safety), reviewer: safety.reviewer, submitted_at: safety.submitted_at, attachment_byte_match_verified: true
    }
  },
  validation: {
    schema_identity_submitted_at_scope_hash_summary: 'PASSED',
    exact_content_question_set: contentIds,
    exact_safety_technical_question_set: safetyIds,
    carried_forward_pass_hashes: 'PASSED',
    effective_status_policy: 'FAIL_CLOSED_IF_ANY_TRACK_SUBFIELD_RETURNS',
    source_internal_consistency: 'PASSED',
    source_consistency_anomalies: [],
    scope_anomalies: []
  },
  summary: {
    v3_total: 9,
    v3_passed_review_only_no_activation_authority: passedV3.length,
    v3_return_for_revision: returnedV3.length,
    v3_pending: 0,
    content_v3: { total: content.questions.length, passed: contentReview.declaredPassed, return_for_revision: contentReview.declaredReturned },
    safety_technical_v3: { total: safety.questions.length, passed: safetyReview.declaredPassed, return_for_revision: safetyReview.declaredReturned },
    v3_returns_by_failed_tracks: countBy(returnedV3, (question) => question.failed_review_tracks.join('+')),
    cumulative_replacement_review: { total: 11, passed_review_only_no_activation_authority: cumulativePassed.length, return_for_revision: returnedV3.length }
  },
  cumulative_passed_references: cumulativePassed,
  authority: {
    activation_authority_granted: false,
    can_activate_questions: false,
    candidate_set_ready_for_separate_authority_amendment: returnedV3.length === 0,
    authority_amendment_executed: false,
    existing_287_unchanged: true,
    rejected_originals_11_unchanged: true,
    runtime_database_unchanged: true,
    activation_sql_generated: false,
    delivery_lock_unchanged: true,
    next_revision_required: returnedV3.length
  },
  questions: mergedQuestions
}
const merged = { ...mergedBase, gate_hash: hashRecord(mergedBase) }

const passIds = passedV3.map((question) => `\`${question.question_id}\``).join('、') || '无'
const returnIds = returnedV3.map((question) => `\`${question.question_id}\``).join('、') || '无'
const ledger = `# 9道V3定点复审结果接收台账

**状态：** ${merged.status}  
**候选集：** \`${candidateSetHash}\`  
**结论：** 9道V3中${passedV3.length}道通过、${returnedV3.length}道退回；连同此前2道V2通过引用，11道替代题累计${cumulativePassed.length}道通过、${returnedV3.length}道仍需修订。审核通过不等于激活。

## 原件接收

| 审核范围 | 原始路径 | 仓库固化路径 | 字节数 | SHA-256 |
|---|---|---|---:|---|
| 陈晓青：8道内容定点复审 | \`E:\\Downloads\\job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-packet-chen-xiaoqing-v1-result.json\` | \`${rel(paths.content)}\` | ${statSync(paths.content).size} | \`${hashFile(paths.content)}\` |
| 赫东：7道安全技术定点复审 | \`E:\\Downloads\\job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-packet-he-dong-v1-result.json\` | \`${rel(paths.safety)}\` | ${statSync(paths.safety).size} | \`${hashFile(paths.safety)}\` |

两份附件均已逐字节固化，脚本锁定字节数和SHA-256。原件不做格式化或内容改写。

## 校验与合并

- Schema身份、审核包ID、候选集ID/hash、审核人、提交时间、分轨题目精确集合、逐题语义hash、候选记录hash和携带通过记录hash均已通过。
- 陈晓青内容轨：${contentReview.declaredPassed}题通过、${contentReview.declaredReturned}题退回。
- 赫东安全技术轨：${safetyReview.declaredPassed}题通过、${safetyReview.declaredReturned}题退回。
- V3本轮通过：${passIds}。
- 退回复修并指向V4：${returnIds}。
- 累计通过引用：${cumulativePassed.map((item) => `\`${item.question_id}\``).join('、')}。

## 权限边界

- 所有逐题结果继续保持 \`activation_authority=NONE\`；本台账和合并门禁不授予激活权。
- 未修改运行权威、现有287道题、原11道V1淘汰状态、delivery lock或运行数据库。
- 未生成激活SQL；6道退回题完成V4修订和所需复审前，候选集不具备独立权威修订条件。
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

console.log(`Rejected replacement targeted V3 results ${checkOnly ? 'verified' : 'ingested'}: ${passedV3.length} V3 passed, ${returnedV3.length} returned; cumulative ${cumulativePassed.length}/11 passed review only; activation authority NONE.`)
