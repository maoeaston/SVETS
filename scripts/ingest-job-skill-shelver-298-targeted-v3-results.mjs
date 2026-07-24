import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { hashFile, hashRecord } from './lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '..')
const feature = (name) => resolve(root, `doc/features/${name}`)
const paths = {
  candidates: feature('job-skill-shelver-298-question-revision-candidates-v3.json'),
  pendingGate: feature('job-skill-shelver-298-targeted-v3-rereview-gate-v1.json'),
  content: feature('job-skill-shelver-298-targeted-v3-content-rereview-result-chen-xiaoqing-v2.json'),
  safety: feature('job-skill-shelver-298-targeted-v3-safety-technical-rereview-result-he-dong-type-scoped-v2.json'),
  merged: feature('job-skill-shelver-298-targeted-v3-rereview-merged-gate-v1.json'),
  ledger: feature('job-skill-shelver-298-targeted-v3-rereview-ledger-v1.md')
}

const checkOnly = process.argv.includes('--check')
const rel = (path) => path.slice(root.length + 1)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

function indexBy(records, label) {
  const result = new Map()
  for (const record of records) {
    assert(record && typeof record.question_id === 'string', `${label} has a record without question_id`)
    assert(!result.has(record.question_id), `${label} duplicate question_id: ${record.question_id}`)
    result.set(record.question_id, record)
  }
  return result
}

const sameValues = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)

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
const content = readJson(paths.content)
const safety = readJson(paths.safety)
const { candidate_set_hash: candidateSetHash, ...candidateSetBody } = candidates

assert(hashRecord(candidateSetBody) === candidateSetHash, 'V3 candidate_set_hash drift')
assert(pendingGate.candidate_set_hash === candidateSetHash, 'Pending gate and V3 candidate set do not match')

const candidatesById = indexBy(candidates.questions, 'V3 candidates')
const contentById = indexBy(content.results, 'content result')
const safetyById = indexBy(safety.questions, 'safety/technical result')
const expectedContent = candidates.questions.filter((question) => question.required_review_tracks.includes('CONTENT'))
const expectedSafety = candidates.questions.filter((question) => question.required_review_tracks.includes('SAFETY_TECHNICAL'))

assert(content.result_package_id === 'job-skill-shelver-298-targeted-v3-content-rereview-result-chen-xiaoqing-v2', 'Unexpected content result_package_id')
assert(content.source_package_id === 'job-skill-shelver-298-targeted-v3-content-rereview-packet-v1', 'Unexpected content source_package_id')
assert(content.candidate_set_hash === candidateSetHash, 'Content result candidate_set_hash mismatch')
assert(content.reviewer === '陈晓青', 'Unexpected content reviewer')
assert(/^\d{4}-\d{2}-\d{2}$/.test(content.review_date), 'Content review_date must be YYYY-MM-DD')
assert(content.review_track === 'CONTENT', 'Unexpected content review_track')
assert(sameValues(content.allowed_conclusions, ['通过', '退回复修']), 'Unexpected content conclusions')
assert(content.results.length === expectedContent.length, `Expected ${expectedContent.length} content results, received ${content.results.length}`)

for (const question of expectedContent) {
  const result = contentById.get(question.question_id)
  assert(result, `Content result missing ${question.question_id}`)
  assert(result.previous_question_id === question.previous_question_id, `${question.question_id} content previous_question_id mismatch`)
  assert(result.source_question_id === question.source_question_id, `${question.question_id} content source_question_id mismatch`)
  assert(result.question_type === question.question_type, `${question.question_id} content question_type mismatch`)
  assert(result.candidate_record_hash === question.candidate_record_hash, `${question.question_id} content candidate_record_hash mismatch`)
  assert(content.allowed_conclusions.includes(result.review_conclusion), `${question.question_id} invalid content conclusion`)
  assert(result.review_conclusion !== '退回复修' || result.review_note.trim().length > 0, `${question.question_id} content return is missing a note`)
}
assert([...contentById].every(([id]) => candidatesById.get(id)?.required_review_tracks.includes('CONTENT')), 'Content result contains an out-of-scope question')

const contentPassed = content.results.filter((result) => result.review_conclusion === '通过').length
const contentReturned = content.results.length - contentPassed
assert(sameValues(content.summary, {
  total: content.results.length,
  passed: contentPassed,
  returned_for_revision: contentReturned,
  by_question_type: Object.fromEntries(['SINGLE_CHOICE', 'TRUE_FALSE', 'DRAG', 'OFFLINE_OPERATION'].map((type) => {
    const records = content.results.filter((result) => result.question_type === type)
    const passed = records.filter((result) => result.review_conclusion === '通过').length
    return [type, { total: records.length, passed, returned_for_revision: records.length - passed }]
  }))
}), 'Content summary cannot be reconciled from question results')

assert(safety.schema_version === 'job-skill-shelver-298-targeted-v3-safety-technical-rereview-result-v1', 'Unexpected safety result schema_version')
assert(safety.package_id === 'job-skill-shelver-298-targeted-v3-safety-technical-rereview-packet-v1', 'Unexpected safety package_id')
assert(safety.candidate_set_hash === candidateSetHash, 'Safety result candidate_set_hash mismatch')
assert(safety.reviewer === '赫东', 'Unexpected safety reviewer')
assert(!Number.isNaN(Date.parse(safety.submitted_at)), 'Safety submitted_at must be a date-time')
assert(safety.questions.length === expectedSafety.length, `Expected ${expectedSafety.length} safety results, received ${safety.questions.length}`)

for (const question of expectedSafety) {
  const result = safetyById.get(question.question_id)
  assert(result, `Safety result missing ${question.question_id}`)
  assert(result.previous_question_id === question.previous_question_id, `${question.question_id} safety previous_question_id mismatch`)
  assert(result.old_semantic_hash === question.old_semantic_hash, `${question.question_id} safety old_semantic_hash mismatch`)
  assert(result.new_semantic_hash === question.new_semantic_hash, `${question.question_id} safety new_semantic_hash mismatch`)
  assert(result.patch_id === question.applied_patch_id, `${question.question_id} safety patch_id mismatch`)
  assert(['PASS', 'RETURN_FOR_REVISION'].includes(result.conclusion), `${question.question_id} invalid safety conclusion`)
  assert(result.conclusion !== 'RETURN_FOR_REVISION' || result.review_note.trim().length > 0, `${question.question_id} safety return is missing a note`)
}
assert([...safetyById].every(([id]) => candidatesById.get(id)?.required_review_tracks.includes('SAFETY_TECHNICAL')), 'Safety result contains an out-of-scope question')

const safetyPassed = safety.questions.filter((result) => result.conclusion === 'PASS').length
assert(sameValues(safety.summary, {
  total: safety.questions.length,
  pass: safetyPassed,
  return_for_revision: safety.questions.length - safetyPassed
}), 'Safety summary cannot be reconciled from question results')

// These content-only V3 revisions changed the technical rule but kept a video and
// positive answer that demonstrate the prohibited or incomplete behavior.
const contractConflicts = new Map([
  ['M3_TF_030_V3', '题干要求使用批准设备，视频使用个人手机，expected_answer仍为true'],
  ['M3_TF_033_V3', '题干禁止仅凭封口完好判定可售，视频正是直接判定上架，expected_answer仍为true'],
  ['M3_TF_034_V3', '题干要求完成记录或移区流程，视频未呈现该闭环，expected_answer仍为true'],
  ['M4_TF_022_V3', '题干要求标注后报告，视频只标注后继续，expected_answer仍为true']
])

const mergedQuestions = candidates.questions.map((question) => {
  const contentResult = contentById.get(question.question_id)
  const safetyResult = safetyById.get(question.question_id)
  const contentStatus = contentResult ? (contentResult.review_conclusion === '通过' ? 'PASS' : 'RETURN_FOR_REVISION') : 'NOT_REQUIRED'
  const safetyStatus = safetyResult?.conclusion ?? 'NOT_REQUIRED'
  const failedReviewTracks = [
    contentStatus === 'RETURN_FOR_REVISION' ? 'CONTENT' : null,
    safetyStatus === 'RETURN_FOR_REVISION' ? 'SAFETY_TECHNICAL' : null
  ].filter(Boolean)
  const conflict = contractConflicts.get(question.question_id) ?? null
  const status = conflict
    ? 'BLOCKED_CONTRACT_CONFLICT'
    : failedReviewTracks.length === 0 ? 'PASSED' : 'RETURN_FOR_REVISION'
  const nextReviewTracks = conflict ? ['CONTENT', 'SAFETY_TECHNICAL'] : failedReviewTracks
  const base = {
    question_id: question.question_id,
    candidate_record_hash: question.candidate_record_hash,
    new_semantic_hash: question.new_semantic_hash,
    required_review_tracks: question.required_review_tracks,
    review_results: {
      content: contentResult ? { status: contentStatus, review_note: contentResult.review_note, source_record_hash: hashRecord(contentResult) } : { status: 'NOT_REQUIRED' },
      safety_technical: safetyResult ? { status: safetyStatus, review_note: safetyResult.review_note, source_record_hash: hashRecord(safetyResult) } : { status: 'NOT_REQUIRED' }
    },
    status,
    failed_review_tracks: failedReviewTracks,
    contract_conflict: conflict,
    next_review_tracks: nextReviewTracks,
    next_question_id: status === 'PASSED' ? null : question.question_id.replace(/_V3$/, '_V4')
  }
  return { ...base, merged_record_hash: hashRecord(base) }
})

const returned = mergedQuestions.filter((question) => question.status === 'RETURN_FOR_REVISION')
const blocked = mergedQuestions.filter((question) => question.status === 'BLOCKED_CONTRACT_CONFLICT')
const passed = mergedQuestions.filter((question) => question.status === 'PASSED')
const mergedBase = {
  schema_version: 'job-skill-shelver-298-targeted-v3-rereview-merged-gate-v1',
  gate_id: 'job-skill-shelver-298-targeted-v3-rereview-merged-gate-v1',
  status: returned.length === 0 && blocked.length === 0 ? 'PASSED' : 'COMPLETED_WITH_RETURNS_AND_CONTRACT_CONFLICTS',
  generated_at: '2026-07-20T16:30:00+08:00',
  candidate_set: { path: rel(paths.candidates), candidate_set_hash: candidateSetHash, sha256: hashFile(paths.candidates) },
  source_results: {
    content: { path: rel(paths.content), sha256: hashFile(paths.content), reviewer: content.reviewer, reviewed_date: content.review_date },
    safety_technical: { path: rel(paths.safety), sha256: hashFile(paths.safety), reviewer: safety.reviewer, submitted_at: safety.submitted_at }
  },
  intake_format: {
    content: 'REVIEWER_TYPE_SCOPED_V2_VALIDATED_WITH_CANDIDATE_RECORD_HASH',
    safety_technical: safety.schema_version,
    note: '审核人原件保持不变；内容结果使用扩展字段，通过接收器按候选记录hash校验，不伪造submitted_at或改写为旧Schema。'
  },
  summary: {
    total: mergedQuestions.length,
    passed: passed.length,
    return_for_revision: returned.length,
    blocked_contract_conflict: blocked.length,
    pending: 0,
    content: { total: content.results.length, passed: contentPassed, return_for_revision: contentReturned },
    safety_technical: { total: safety.questions.length, passed: safetyPassed, return_for_revision: safety.questions.length - safetyPassed },
    returns_by_question_type: countBy(returned, (question) => candidatesById.get(question.question_id).question_type),
    returns_by_failed_tracks: countBy(returned, (question) => question.failed_review_tracks.join('+')),
    v4_by_next_review_tracks: countBy([...returned, ...blocked], (question) => question.next_review_tracks.join('+'))
  },
  authority: { releaseable: false, phase_4_allowed: false, runtime_database_unchanged: true, activation_sql_generated: false, v4_required: returned.length + blocked.length },
  questions: mergedQuestions
}
const merged = { ...mergedBase, gate_hash: hashRecord(mergedBase) }

const ledger = `# 超市理货员298题定点V3复审接收台账

**状态：** ${merged.status}  
**候选集：** \`${candidateSetHash}\`  
**结论：** 145道V3中，${passed.length}道通过，${returned.length}道审核退回，${blocked.length}道发现合同冲突；阶段四继续关闭。

## 审核结果

| 审核范围 | 应审 | 通过 | 退回复修 |
|---|---:|---:|---:|
| 陈晓青：内容 | ${content.results.length} | ${contentPassed} | ${contentReturned} |
| 赫东：安全与技术 | ${safety.questions.length} | ${safetyPassed} | ${safety.questions.length - safetyPassed} |

## 合并处置

- 双轨或所需单轨均通过且合同一致：${passed.length}道，保留V3，不再重复复审。
- 仅内容退回：${merged.summary.returns_by_failed_tracks.CONTENT ?? 0}道。
- 仅安全技术退回：${merged.summary.returns_by_failed_tracks.SAFETY_TECHNICAL ?? 0}道。
- 两轨均退回：${merged.summary.returns_by_failed_tracks['CONTENT+SAFETY_TECHNICAL'] ?? 0}道。
- 合同冲突阻断：${blocked.length}道（${blocked.map((question) => `\`${question.question_id}\``).join('、')}）；这些题的规则、视频行为与预设答案不一致，V4补走内容和安全技术双轨。
- 需要创建V4：${returned.length + blocked.length}道；普通退回题只送退回轨道，合同冲突题补齐双轨。
- 通过题：${passed.map((question) => `\`${question.question_id}\``).join('、')}。

## 原件

- \`${rel(paths.content)}\`，SHA-256：\`${hashFile(paths.content)}\`
- \`${rel(paths.safety)}\`，SHA-256：\`${hashFile(paths.safety)}\`

陈晓青原件采用类型范围扩展格式，没有直接套用旧v1导出Schema。接收器保留原件并按候选题ID、版本链、题型和 \`candidate_record_hash\` 校验；没有伪造缺失的提交时间。
`

for (const [path, value] of new Map([[paths.merged, `${JSON.stringify(merged, null, 2)}\n`], [paths.ledger, ledger]])) {
  if (checkOnly) assert(readFileSync(path, 'utf8') === value, `${rel(path)} is stale`)
  else writeFileSync(path, value)
}

console.log(`Targeted V3 review results ${checkOnly ? 'verified' : 'ingested'}: ${passed.length} passed, ${returned.length} returned, ${blocked.length} contract conflicts; phase 4 remains closed.`)
