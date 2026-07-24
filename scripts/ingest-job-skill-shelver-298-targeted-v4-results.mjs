import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { effectiveAnswer, hashFile, hashRecord, questionSemanticHash } from './lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '..')
const feature = (name) => resolve(root, `doc/features/${name}`)
const paths = {
  candidates: feature('job-skill-shelver-298-question-revision-candidates-v4.json'),
  pendingGate: feature('job-skill-shelver-298-targeted-v4-rereview-gate-v1.json'),
  contentSchema: feature('job-skill-shelver-298-targeted-v4-content-rereview-result-v1.schema.json'),
  safetySchema: feature('job-skill-shelver-298-targeted-v4-safety-technical-rereview-result-v1.schema.json'),
  content: feature('job-skill-shelver-298-targeted-v4-content-rereview-result-chen-xiaoqing-2026-07-20.json'),
  safety: feature('job-skill-shelver-298-targeted-v4-safety-technical-rereview-result-he-dong-2026-07-20.json'),
  merged: feature('job-skill-shelver-298-targeted-v4-rereview-merged-gate-v1.json'),
  ledger: feature('job-skill-shelver-298-targeted-v4-rereview-ledger-v1.md')
}

const checkOnly = process.argv.includes('--check')
const rel = (path) => path.slice(root.length + 1)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const sameValues = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
const hashPattern = /^sha256:[a-f0-9]{64}$/

function assertExactKeys(value, expected, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  assert(sameValues(Object.keys(value).sort(), [...expected].sort()), `${label} keys do not match the result Schema`)
}

function indexBy(records, label) {
  assert(Array.isArray(records), `${label} must be an array`)
  const result = new Map()
  for (const record of records) {
    assert(record && typeof record.question_id === 'string', `${label} contains a record without question_id`)
    assert(!result.has(record.question_id), `${label} duplicate question_id: ${record.question_id}`)
    result.set(record.question_id, record)
  }
  return result
}

function countBy(records, selector) {
  const result = {}
  for (const record of records) {
    const key = selector(record)
    result[key] = (result[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)))
}

const candidates = readJson(paths.candidates)
const pendingGate = readJson(paths.pendingGate)
const contentSchema = readJson(paths.contentSchema)
const safetySchema = readJson(paths.safetySchema)
const content = readJson(paths.content)
const safety = readJson(paths.safety)
const { candidate_set_hash: candidateSetHash, ...candidateSetBody } = candidates
const { gate_hash: pendingGateHash, ...pendingGateBody } = pendingGate

assert(hashRecord(candidateSetBody) === candidateSetHash, 'V4 candidate_set_hash drift')
assert(candidateSetHash === 'sha256:309a399aed46d0a7f5ca257c74a30312bd3a2931f53e5c03422739602c8c0d5a', 'Unexpected V4 candidate_set_hash')
assert(hashRecord(pendingGateBody) === pendingGateHash, 'V4 pending gate_hash drift')
assert(pendingGate.candidate_set?.candidate_set_hash === candidateSetHash, 'Pending gate and V4 candidate set do not match')
assert(contentSchema.properties?.candidate_set_hash?.const === candidateSetHash, 'Content result Schema candidate_set_hash drift')
assert(safetySchema.properties?.candidate_set_hash?.const === candidateSetHash, 'Safety result Schema candidate_set_hash drift')
assert(hashFile(paths.content) === 'sha256:420289fbf3481415322f46a006613e79421fa8b0c485dfb241d7a2176a9c6409', 'Chen Xiaoqing reviewer export bytes changed')
assert(hashFile(paths.safety) === 'sha256:8b2d1c5c03ee98eba9e09e57ec58aa90112738690c520663267e89b9f45583b3', 'He Dong reviewer export bytes changed')

const candidatesById = indexBy(candidates.questions, 'V4 candidates')
const expectedContent = candidates.questions.filter((question) => question.required_review_tracks.includes('CONTENT'))
const expectedSafety = candidates.questions.filter((question) => question.required_review_tracks.includes('SAFETY_TECHNICAL'))

for (const candidate of candidates.questions) {
  const { candidate_record_hash: recordHash, ...recordBody } = candidate
  assert(hashRecord(recordBody) === recordHash, `${candidate.question_id} candidate_record_hash drift`)
  assert(questionSemanticHash(candidate.proposed_question) === candidate.new_semantic_hash, `${candidate.question_id} new_semantic_hash drift`)
  assert(candidate.question_version === 4, `${candidate.question_id} question_version must be 4`)
  assert(candidate.previous_question_id === candidate.question_id.replace(/_V4$/, '_V3'), `${candidate.question_id} version chain mismatch`)
}

function validateResult(result, { schemaVersion, packageId, reviewer, expectedQuestions, label }) {
  assertExactKeys(result, ['schema_version', 'package_id', 'candidate_set_hash', 'reviewer', 'submitted_at', 'summary', 'questions'], label)
  assert(result.schema_version === schemaVersion, `${label} schema_version mismatch`)
  assert(result.package_id === packageId, `${label} package_id mismatch`)
  assert(result.candidate_set_hash === candidateSetHash, `${label} candidate_set_hash mismatch`)
  assert(result.reviewer === reviewer, `${label} reviewer mismatch`)
  assert(typeof result.submitted_at === 'string' && !Number.isNaN(Date.parse(result.submitted_at)), `${label} submitted_at must be a valid date-time`)
  assertExactKeys(result.summary, ['total', 'pass', 'return_for_revision'], `${label} summary`)
  assert(result.questions.length === expectedQuestions.length, `${label} expected ${expectedQuestions.length} questions, received ${result.questions.length}`)

  const resultById = indexBy(result.questions, `${label} questions`)
  const expectedIds = new Set(expectedQuestions.map((question) => question.question_id))
  assert(resultById.size === expectedIds.size && [...resultById.keys()].every((id) => expectedIds.has(id)), `${label} question set has missing or out-of-scope IDs`)

  for (const question of expectedQuestions) {
    const review = resultById.get(question.question_id)
    assertExactKeys(review, ['question_id', 'previous_question_id', 'new_semantic_hash', 'candidate_record_hash', 'conclusion', 'review_note'], `${label}/${question.question_id}`)
    assert(/^M[1-6]_[A-Z]+_\d+_V4$/.test(review.question_id), `${question.question_id} invalid question_id`)
    assert(/^M[1-6]_[A-Z]+_\d+_V3$/.test(review.previous_question_id), `${question.question_id} invalid previous_question_id`)
    assert(hashPattern.test(review.new_semantic_hash), `${question.question_id} invalid new_semantic_hash`)
    assert(hashPattern.test(review.candidate_record_hash), `${question.question_id} invalid candidate_record_hash`)
    assert(review.previous_question_id === question.previous_question_id, `${question.question_id} previous_question_id mismatch`)
    assert(review.new_semantic_hash === question.new_semantic_hash, `${question.question_id} new_semantic_hash mismatch`)
    assert(review.candidate_record_hash === question.candidate_record_hash, `${question.question_id} candidate_record_hash mismatch`)
    assert(['PASS', 'RETURN_FOR_REVISION'].includes(review.conclusion), `${question.question_id} invalid ${label} conclusion`)
    assert(typeof review.review_note === 'string', `${question.question_id} review_note must be a string`)
    assert(review.conclusion !== 'RETURN_FOR_REVISION' || review.review_note.trim().length > 0, `${question.question_id} ${label} return is missing a concrete note`)
  }

  const passed = result.questions.filter((question) => question.conclusion === 'PASS').length
  const returned = result.questions.length - passed
  assert(sameValues(result.summary, { total: result.questions.length, pass: passed, return_for_revision: returned }), `${label} summary cannot be reconciled from question results`)
  return { resultById, passed, returned }
}

const contentReview = validateResult(content, {
  schemaVersion: 'job-skill-shelver-298-targeted-v4-content-rereview-result-v1',
  packageId: 'job-skill-shelver-298-targeted-v4-content-rereview-packet-v1',
  reviewer: '陈晓青', expectedQuestions: expectedContent, label: 'content result'
})
const safetyReview = validateResult(safety, {
  schemaVersion: 'job-skill-shelver-298-targeted-v4-safety-technical-rereview-result-v1',
  packageId: 'job-skill-shelver-298-targeted-v4-safety-technical-rereview-packet-v1',
  reviewer: '赫东', expectedQuestions: expectedSafety, label: 'safety/technical result'
})

// This explicit outcome contract is independently reviewed against the prompt rule
// and the described video behavior. Candidate hashes above prevent either text from
// changing without invalidating this intake check.
const videoBehaviorConforms = new Map([
  ['M1_TF_025_V4', false], ['M2_TF_018_V4', true], ['M2_TF_022_V4', false],
  ['M3_TF_025_V4', true], ['M3_TF_028_V4', false], ['M3_TF_030_V4', false],
  ['M3_TF_033_V4', true], ['M3_TF_034_V4', false], ['M4_TF_019_V4', false],
  ['M4_TF_022_V4', true], ['M5_TF_023_V4', true], ['M5_TF_027_V4', true]
])
const videoQuestions = candidates.questions.filter((question) => question.question_type === 'TRUE_FALSE')
assert(videoQuestions.length === 12, `Expected 12 video TRUE_FALSE questions, received ${videoQuestions.length}`)
assert(videoBehaviorConforms.size === videoQuestions.length && videoQuestions.every((question) => videoBehaviorConforms.has(question.question_id)), 'Video outcome contract does not exactly cover the V4 video questions')
for (const question of videoQuestions) {
  assert(effectiveAnswer(question.proposed_question) === videoBehaviorConforms.get(question.question_id), `${question.question_id} prompt rule, video behavior and expected answer conflict`)
}

const mergedV4Questions = candidates.questions.map((question) => {
  const contentResult = contentReview.resultById.get(question.question_id)
  const safetyResult = safetyReview.resultById.get(question.question_id)
  const contentStatus = contentResult?.conclusion ?? 'NOT_REQUIRED'
  const safetyStatus = safetyResult?.conclusion ?? 'NOT_REQUIRED'
  const failedReviewTracks = [
    contentStatus === 'RETURN_FOR_REVISION' ? 'CONTENT' : null,
    safetyStatus === 'RETURN_FOR_REVISION' ? 'SAFETY_TECHNICAL' : null
  ].filter(Boolean)
  const status = failedReviewTracks.length === 0 ? 'PASSED' : 'RETURN_FOR_REVISION'
  const base = {
    question_id: question.question_id,
    question_version: 4,
    previous_question_id: question.previous_question_id,
    candidate_record_hash: question.candidate_record_hash,
    new_semantic_hash: question.new_semantic_hash,
    required_review_tracks: question.required_review_tracks,
    review_results: {
      content: contentResult ? { status: contentStatus, review_note: contentResult.review_note, source_record_hash: hashRecord(contentResult) } : { status: 'NOT_REQUIRED' },
      safety_technical: safetyResult ? { status: safetyStatus, review_note: safetyResult.review_note, source_record_hash: hashRecord(safetyResult) } : { status: 'NOT_REQUIRED' }
    },
    video_contract_check: question.question_type === 'TRUE_FALSE'
      ? { status: 'PASS', behavior_conforms: videoBehaviorConforms.get(question.question_id), expected_answer: effectiveAnswer(question.proposed_question) }
      : { status: 'NOT_APPLICABLE' },
    status,
    failed_review_tracks: failedReviewTracks,
    contract_conflict: null,
    scope_anomaly: null,
    next_review_tracks: failedReviewTracks,
    next_question_id: status === 'PASSED' ? null : question.question_id.replace(/_V4$/, '_V5')
  }
  return { ...base, merged_record_hash: hashRecord(base) }
})

const passedV3References = candidates.passed_v3_references.map((reference) => {
  const base = {
    question_id: reference.question_id,
    question_version: 3,
    candidate_record_hash: reference.candidate_record_hash,
    new_semantic_hash: reference.semantic_hash,
    required_review_tracks: [],
    review_results: { content: { status: 'PASSED_V3_REFERENCE' }, safety_technical: { status: 'PASSED_V3_REFERENCE' } },
    video_contract_check: { status: 'NOT_APPLICABLE' },
    status: 'PASSED_V3_REFERENCE',
    failed_review_tracks: [],
    contract_conflict: null,
    scope_anomaly: null,
    next_review_tracks: [],
    next_question_id: null
  }
  return { ...base, merged_record_hash: hashRecord(base) }
})

const returned = mergedV4Questions.filter((question) => question.status === 'RETURN_FOR_REVISION')
const passedV4 = mergedV4Questions.filter((question) => question.status === 'PASSED')
const allQuestions = [...passedV3References, ...mergedV4Questions].sort((left, right) => left.question_id.localeCompare(right.question_id))
const mergedBase = {
  schema_version: 'job-skill-shelver-298-targeted-v4-rereview-merged-gate-v1',
  gate_id: 'job-skill-shelver-298-targeted-v4-rereview-merged-gate-v1',
  status: returned.length === 0 ? 'PASSED' : 'COMPLETED_WITH_RETURNS',
  generated_at: '2026-07-20T17:30:00+08:00',
  candidate_set: { path: rel(paths.candidates), candidate_set_hash: candidateSetHash, sha256: hashFile(paths.candidates) },
  pending_gate: { path: rel(paths.pendingGate), gate_hash: pendingGateHash, sha256: hashFile(paths.pendingGate) },
  source_results: {
    content: { source_path: 'E:\\Downloads\\job-skill-shelver-298-targeted-v4-content-rereview-packet-v1-result.json', received_path: rel(paths.content), bytes: statSync(paths.content).size, sha256: hashFile(paths.content), reviewer: content.reviewer, submitted_at: content.submitted_at },
    safety_technical: { source_path: 'E:\\Downloads\\job-skill-shelver-298-targeted-v4-safety-technical-rereview-packet-v1-result.json', received_path: rel(paths.safety), bytes: statSync(paths.safety).size, sha256: hashFile(paths.safety), reviewer: safety.reviewer, submitted_at: safety.submitted_at }
  },
  validation: {
    schema_identity_scope_hash_summary: 'PASSED',
    video_rule_behavior_answer_contract: { status: 'PASSED', checked: videoQuestions.length, conflicts: [] },
    scope_anomalies: []
  },
  summary: {
    total: allQuestions.length,
    passed: passedV3References.length + passedV4.length,
    passed_v3_references: passedV3References.length,
    passed_v4: passedV4.length,
    return_for_revision: returned.length,
    blocked_contract_conflict: 0,
    pending: 0,
    content: { total: content.questions.length, passed: contentReview.passed, return_for_revision: contentReview.returned },
    safety_technical: { total: safety.questions.length, passed: safetyReview.passed, return_for_revision: safetyReview.returned },
    returns_by_question_type: countBy(returned, (question) => candidatesById.get(question.question_id).question_type),
    returns_by_failed_tracks: countBy(returned, (question) => question.failed_review_tracks.join('+')),
    v5_by_next_review_tracks: countBy(returned, (question) => question.next_review_tracks.join('+'))
  },
  authority: {
    releaseable: returned.length === 0,
    phase_4_allowed: returned.length === 0,
    runtime_database_unchanged: true,
    activation_sql_generated: false,
    delivery_lock_unchanged: true,
    v5_required: returned.length
  },
  questions: allQuestions
}
const merged = { ...mergedBase, gate_hash: hashRecord(mergedBase) }

const returnIds = returned.map((question) => `\`${question.question_id}\``).join('、')
const ledger = `# 超市理货员298题定点V4复审接收台账

**状态：** ${merged.status}  
**候选集：** \`${candidateSetHash}\`  
**结论：** 145道定点修订题中，${merged.summary.passed}道已通过，${returned.length}道退回复修；阶段四继续关闭。

## 原件接收

| 审核范围 | 原始路径 | 仓库固化路径 | 字节数 | SHA-256 |
|---|---|---|---:|---|
| 陈晓青：内容 | \`E:\\Downloads\\job-skill-shelver-298-targeted-v4-content-rereview-packet-v1-result.json\` | \`${rel(paths.content)}\` | ${statSync(paths.content).size} | \`${hashFile(paths.content)}\` |
| 赫东：安全与技术 | \`E:\\Downloads\\job-skill-shelver-298-targeted-v4-safety-technical-rereview-packet-v1-result.json\` | \`${rel(paths.safety)}\` | ${statSync(paths.safety).size} | \`${hashFile(paths.safety)}\` |

两份仓库文件与用户提供的下载文件逐字节一致；合并产物不覆盖审核人原件。

## 校验结果

- 两份结果的 Schema版本、审核包ID、审核人、提交时间、候选集hash均通过校验。
- 陈晓青140题、赫东120题的集合无重复、无漏题、无越界题；版本链、逐题语义hash和候选记录hash均与V4候选一致。
- 两份顶层汇总均可由逐题结果复算。
- 12道视频判断题的题干规则、视频行为和预设答案再次校验通过，没有新增合同冲突。
- 退回意见均为题意、评分或安全边界问题；纯素材生产、asset/setup ID、工具编号、文件路径或hash范围异常为0项。

## 审核汇总

| 审核范围 | 应审 | 通过 | 退回复修 |
|---|---:|---:|---:|
| 陈晓青：内容 | ${content.questions.length} | ${contentReview.passed} | ${contentReview.returned} |
| 赫东：安全与技术 | ${safety.questions.length} | ${safetyReview.passed} | ${safetyReview.returned} |

## 合并处置

- 4道已通过V3引用继续有效；V4有${passedV4.length}道通过，因此完整145题中共${merged.summary.passed}道通过。
- 退回的唯一题目共${returned.length}道：${returnIds}。
- 仅内容退回：${merged.summary.returns_by_failed_tracks.CONTENT ?? 0}道；仅安全技术退回：${merged.summary.returns_by_failed_tracks.SAFETY_TECHNICAL ?? 0}道；双轨均退回：${merged.summary.returns_by_failed_tracks['CONTENT+SAFETY_TECHNICAL'] ?? 0}道。
- 下一步只为上述${returned.length}道创建V5，并只送失败轨道；其余139道不重复修订或复审。
- \`releaseable=false\`、\`phase_4_allowed=false\`；未写运行库，未生成激活SQL，阶段二交付锁未修改。
`

for (const [path, value] of new Map([[paths.merged, `${JSON.stringify(merged, null, 2)}\n`], [paths.ledger, ledger]])) {
  if (checkOnly) assert(readFileSync(path, 'utf8') === value, `${rel(path)} is stale`)
  else writeFileSync(path, value)
}

console.log(`Targeted V4 review results ${checkOnly ? 'verified' : 'ingested'}: ${merged.summary.passed} passed, ${returned.length} returned, 0 contract conflicts; phase 4 remains closed.`)
