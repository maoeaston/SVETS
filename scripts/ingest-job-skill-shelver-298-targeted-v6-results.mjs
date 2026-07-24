import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { hashFile, hashRecord, questionSemanticHash } from './lib/job-skill-contract-hash.mjs'

const root = process.env.SVETS_V6_RESULTS_ROOT
  ? resolve(process.env.SVETS_V6_RESULTS_ROOT)
  : resolve(import.meta.dirname, '..')
const feature = (name) => resolve(root, `doc/features/${name}`)
const paths = {
  candidates: feature('job-skill-shelver-298-question-revision-candidates-v6.json'),
  pendingGate: feature('job-skill-shelver-298-targeted-v6-rereview-gate-v1.json'),
  previousGate: feature('job-skill-shelver-298-targeted-v5-rereview-merged-gate-v1.json'),
  contentSchema: feature('job-skill-shelver-298-targeted-v6-content-rereview-result-v1.schema.json'),
  content: feature('job-skill-shelver-298-targeted-v6-content-rereview-result-chen-xiaoqing-2026-07-20.json'),
  merged: feature('job-skill-shelver-298-targeted-v6-rereview-merged-gate-v1.json'),
  ledger: feature('job-skill-shelver-298-targeted-v6-rereview-ledger-v1.md')
}

const checkOnly = process.argv.includes('--check')
const rel = (path) => path.slice(root.length + 1)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const sameValues = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
const hashPattern = /^sha256:[a-f0-9]{64}$/
const stripVersion = (questionId) => questionId.replace(/_V\d+$/, '')
const expectedIds = ['M2_OP_031_V6', 'M2_OP_038_V6', 'M2_OP_041_V6', 'M5_DG_034_V6']

function assertExactKeys(value, expected, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  assert(sameValues(Object.keys(value).sort(), [...expected].sort()), `${label} keys do not match the result Schema`)
}

function indexBy(records, label) {
  assert(Array.isArray(records), `${label} must be an array`)
  const result = new Map()
  for (const record of records) {
    const key = record?.question_id
    assert(typeof key === 'string' && key.length > 0, `${label} contains a record without an ID`)
    assert(!result.has(key), `${label} duplicate ID: ${key}`)
    result.set(key, record)
  }
  return result
}

function assertExactSet(actual, expected, label) {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  assert(actualSet.size === actual.length, `${label} contains duplicate IDs`)
  assert(actualSet.size === expectedSet.size && [...actualSet].every((id) => expectedSet.has(id)), `${label} has missing or out-of-scope IDs`)
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
const previousGate = readJson(paths.previousGate)
const contentSchema = readJson(paths.contentSchema)
const content = readJson(paths.content)
const { candidate_set_hash: candidateSetHash, ...candidateSetBody } = candidates
const { gate_hash: pendingGateHash, ...pendingGateBody } = pendingGate
const { gate_hash: previousGateHash, ...previousGateBody } = previousGate

assert(hashRecord(candidateSetBody) === candidateSetHash, 'V6 candidate_set_hash drift')
assert(candidateSetHash === 'sha256:2c0f5d1a32414c8ad323f19ba72aba2e418f75e9b94bf1f1f61b150a525f211c', 'Unexpected V6 candidate_set_hash')
assert(hashRecord(pendingGateBody) === pendingGateHash, 'V6 pending gate_hash drift')
assert(hashRecord(previousGateBody) === previousGateHash, 'V5 merged gate_hash drift')
assert(pendingGate.candidate_set?.candidate_set_hash === candidateSetHash, 'Pending gate and V6 candidate set do not match')
assert(pendingGate.previous_merged_gate?.gate_hash === previousGateHash, 'Pending gate and V5 merged gate do not match')
assert(contentSchema.properties?.candidate_set_hash?.const === candidateSetHash, 'Content result Schema candidate_set_hash drift')
assert(contentSchema.properties?.reviewer?.const === '陈晓青', 'Content result Schema reviewer drift')
assert(statSync(paths.content).size === 1864, 'Chen Xiaoqing V6 reviewer export byte count changed')
assert(hashFile(paths.content) === 'sha256:1595eee1bb27847d72126c7b52e10b32838a54f93db4caaa6d2f826b59d375d5', 'Chen Xiaoqing V6 reviewer export bytes changed')

assert(candidates.summary?.source_total === 145, 'V6 source total must be 145')
assert(candidates.passed_question_references?.length === 141, 'V6 must retain exactly 141 passed references')
assertExactSet(candidates.questions.map((question) => question.question_id), expectedIds, 'V6 candidate set')
assert(pendingGate.questions.length === 145, 'V6 pending gate must cover 145 questions')

const candidatesById = indexBy(candidates.questions, 'V6 candidates')
const previousById = indexBy(previousGate.questions, 'V5 merged questions')
const pendingById = indexBy(pendingGate.questions, 'V6 pending questions')
assert(previousById.size === 145, 'V5 merged gate must cover 145 questions')

for (const candidate of candidates.questions) {
  const { candidate_record_hash: recordHash, ...recordBody } = candidate
  assert(hashRecord(recordBody) === recordHash, `${candidate.question_id} candidate_record_hash drift`)
  assert(questionSemanticHash(candidate.proposed_question) === candidate.new_semantic_hash, `${candidate.question_id} new_semantic_hash drift`)
  assert(candidate.question_version === 6, `${candidate.question_id} question_version must be 6`)
  assert(candidate.previous_question_id === candidate.question_id.replace(/_V6$/, '_V5'), `${candidate.question_id} version chain mismatch`)
  assert(sameValues(candidate.required_review_tracks, ['CONTENT']), `${candidate.question_id} failed review tracks drift`)
  const previous = previousById.get(candidate.previous_question_id)
  assert(previous?.status === 'RETURN_FOR_REVISION', `${candidate.question_id} previous V5 result was not returned`)
  assert(previous.merged_record_hash === candidate.source_merged_record_hash, `${candidate.question_id} source merged record hash drift`)
  assert(previous.candidate_record_hash === candidate.source_candidate_record_hash, `${candidate.question_id} source candidate record hash drift`)
  assert(previous.semantic_hash === candidate.old_semantic_hash, `${candidate.question_id} old semantic hash drift`)
  assert(previous.next_question_id === candidate.question_id, `${candidate.question_id} does not match the V5 next_question_id`)
  assert(sameValues(previous.failed_review_tracks, candidate.required_review_tracks), `${candidate.question_id} review track chain mismatch`)
  const pending = pendingById.get(candidate.question_id)
  assert(pending?.status === 'PENDING', `${candidate.question_id} is not pending review`)
  assert(pending.previous_question_id === candidate.previous_question_id, `${candidate.question_id} pending previous_question_id drift`)
  assert(pending.semantic_hash === candidate.new_semantic_hash, `${candidate.question_id} pending semantic hash drift`)
  assert(pending.candidate_record_hash === candidate.candidate_record_hash, `${candidate.question_id} pending candidate hash drift`)
  assert(sameValues(pending.required_review_tracks, candidate.required_review_tracks), `${candidate.question_id} pending review tracks drift`)
}

for (const reference of candidates.passed_question_references) {
  const previous = previousById.get(reference.question_id)
  assert(previous, `${reference.question_id} passed reference is missing from the V5 merged gate`)
  assert(['PASSED', 'PASSED_REFERENCE'].includes(previous.status), `${reference.question_id} is not a passed V5 reference`)
  assert(reference.question_version === previous.question_version, `${reference.question_id} referenced version drift`)
  assert(reference.semantic_hash === previous.semantic_hash, `${reference.question_id} referenced semantic hash drift`)
  assert(reference.candidate_record_hash === previous.candidate_record_hash, `${reference.question_id} referenced candidate hash drift`)
  assert(reference.merged_record_hash === previous.merged_record_hash, `${reference.question_id} referenced merged result hash drift`)
}

const logicalIds = [
  ...candidates.passed_question_references.map((reference) => stripVersion(reference.question_id)),
  ...candidates.questions.map((question) => stripVersion(question.question_id))
]
assert(new Set(logicalIds).size === 145, 'V6 references and candidates do not uniquely cover 145 logical questions')
assertExactSet(pendingGate.questions.map((question) => stripVersion(question.question_id)), logicalIds, 'V6 pending gate logical question set')

assertExactKeys(content, ['schema_version', 'package_id', 'candidate_set_hash', 'reviewer', 'submitted_at', 'summary', 'questions'], 'content result')
assert(content.schema_version === 'job-skill-shelver-298-targeted-v6-content-rereview-result-v1', 'content result schema_version mismatch')
assert(content.package_id === 'job-skill-shelver-298-targeted-v6-content-rereview-packet-v1', 'content result package_id mismatch')
assert(content.candidate_set_hash === candidateSetHash, 'content result candidate_set_hash mismatch')
assert(content.reviewer === '陈晓青', 'content result reviewer mismatch')
assert(content.submitted_at === '2026-07-20T10:47:08.396Z', 'content result submitted_at mismatch')
assert(!Number.isNaN(Date.parse(content.submitted_at)), 'content result submitted_at must be a valid date-time')
assertExactKeys(content.summary, ['total', 'pass', 'return_for_revision'], 'content result summary')
assertExactSet(content.questions.map((question) => question.question_id), expectedIds, 'content result question set')

const contentById = indexBy(content.questions, 'content result questions')
for (const questionId of expectedIds) {
  const review = contentById.get(questionId)
  const candidate = candidatesById.get(questionId)
  assertExactKeys(review, ['question_id', 'previous_question_id', 'new_semantic_hash', 'candidate_record_hash', 'conclusion', 'review_note'], `content result/${questionId}`)
  assert(/^M[1-6]_[A-Z]+_\d+_V6$/.test(review.question_id), `${questionId} invalid question_id`)
  assert(/^M[1-6]_[A-Z]+_\d+_V5$/.test(review.previous_question_id), `${questionId} invalid previous_question_id`)
  assert(hashPattern.test(review.new_semantic_hash), `${questionId} invalid new_semantic_hash`)
  assert(hashPattern.test(review.candidate_record_hash), `${questionId} invalid candidate_record_hash`)
  assert(review.previous_question_id === candidate.previous_question_id, `${questionId} previous_question_id mismatch`)
  assert(review.new_semantic_hash === candidate.new_semantic_hash, `${questionId} new_semantic_hash mismatch`)
  assert(review.candidate_record_hash === candidate.candidate_record_hash, `${questionId} candidate_record_hash mismatch`)
  assert(['PASS', 'RETURN_FOR_REVISION'].includes(review.conclusion), `${questionId} invalid conclusion`)
  assert(typeof review.review_note === 'string', `${questionId} review_note must be a string`)
  assert(review.conclusion !== 'RETURN_FOR_REVISION' || review.review_note.trim().length > 0, `${questionId} return is missing a concrete review note`)
}

const contentPassed = content.questions.filter((question) => question.conclusion === 'PASS').length
const contentReturned = content.questions.length - contentPassed
assert(sameValues(content.summary, { total: content.questions.length, pass: contentPassed, return_for_revision: contentReturned }), 'content result summary cannot be reconciled from question results')

const passedReferences = candidates.passed_question_references.map((reference) => {
  const source = previousById.get(reference.question_id)
  const base = {
    question_id: reference.question_id,
    question_version: reference.question_version,
    version_chain: source.version_chain,
    candidate_record_hash: reference.candidate_record_hash,
    semantic_hash: reference.semantic_hash,
    source_result: {
      gate_path: rel(paths.previousGate),
      gate_hash: previousGateHash,
      merged_record_hash: reference.merged_record_hash,
      status: source.status
    },
    review_results: source.review_results,
    status: 'PASSED_REFERENCE',
    failed_review_tracks: [],
    next_question_id: null
  }
  return { ...base, merged_record_hash: hashRecord(base) }
})

const mergedV6Questions = candidates.questions.map((candidate) => {
  const review = contentById.get(candidate.question_id)
  const status = review.conclusion === 'PASS' ? 'PASSED' : 'RETURN_FOR_REVISION'
  const failedReviewTracks = status === 'PASSED' ? [] : ['CONTENT']
  const base = {
    question_id: candidate.question_id,
    question_version: 6,
    version_chain: {
      previous_question_id: candidate.previous_question_id,
      current_question_id: candidate.question_id
    },
    candidate_record_hash: candidate.candidate_record_hash,
    semantic_hash: candidate.new_semantic_hash,
    source_result: {
      gate_path: rel(paths.previousGate),
      gate_hash: previousGateHash,
      merged_record_hash: candidate.source_merged_record_hash,
      status: 'RETURN_FOR_REVISION'
    },
    required_review_tracks: candidate.required_review_tracks,
    review_results: {
      content: { status: review.conclusion, review_note: review.review_note, source_record_hash: hashRecord(review) },
      safety_technical: { status: 'NOT_REQUIRED' }
    },
    status,
    failed_review_tracks: failedReviewTracks,
    next_question_id: status === 'PASSED' ? null : candidate.question_id.replace(/_V6$/, '_V7')
  }
  return { ...base, merged_record_hash: hashRecord(base) }
})

const returned = mergedV6Questions.filter((question) => question.status === 'RETURN_FOR_REVISION')
const passedV6 = mergedV6Questions.filter((question) => question.status === 'PASSED')
const allQuestions = [...passedReferences, ...mergedV6Questions].sort((left, right) => stripVersion(left.question_id).localeCompare(stripVersion(right.question_id)))
assert(allQuestions.length === 145 && new Set(allQuestions.map((question) => stripVersion(question.question_id))).size === 145, 'Merged V6 gate must uniquely cover 145 questions')

const mergedBase = {
  schema_version: 'job-skill-shelver-298-targeted-v6-rereview-merged-gate-v1',
  gate_id: 'job-skill-shelver-298-targeted-v6-rereview-merged-gate-v1',
  status: returned.length === 0 ? 'PASSED' : 'COMPLETED_WITH_RETURNS',
  generated_at: '2026-07-20T18:55:00+08:00',
  candidate_set: { path: rel(paths.candidates), candidate_set_hash: candidateSetHash, sha256: hashFile(paths.candidates) },
  pending_gate: { path: rel(paths.pendingGate), gate_hash: pendingGateHash, sha256: hashFile(paths.pendingGate) },
  previous_merged_gate: { path: rel(paths.previousGate), gate_hash: previousGateHash, sha256: hashFile(paths.previousGate) },
  source_results: {
    content: {
      source_path: 'E:\\Downloads\\job-skill-shelver-298-targeted-v6-content-rereview-packet-v1-result.json',
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
    exact_content_question_set: expectedIds,
    preserved_passed_reference_count: passedReferences.length,
    scope_anomalies: []
  },
  summary: {
    total: allQuestions.length,
    passed: passedReferences.length + passedV6.length,
    passed_references: passedReferences.length,
    passed_v6: passedV6.length,
    return_for_revision: returned.length,
    pending: 0,
    content: { total: content.questions.length, passed: contentPassed, return_for_revision: contentReturned },
    returns_by_question_type: countBy(returned, (question) => candidatesById.get(question.question_id).question_type),
    returns_by_failed_tracks: countBy(returned, (question) => question.failed_review_tracks.join('+'))
  },
  authority: {
    releaseable: returned.length === 0,
    phase_4_allowed: returned.length === 0,
    phase_4_executed: false,
    runtime_database_unchanged: true,
    activation_sql_generated: false,
    delivery_lock_unchanged: true,
    next_revision_required: returned.length
  },
  questions: allQuestions
}
const merged = { ...mergedBase, gate_hash: hashRecord(mergedBase) }

const returnIds = returned.map((question) => `\`${question.question_id}\``).join('、') || '无'
const phaseConclusion = returned.length === 0
  ? '145道全部通过，阶段四可以作为下一步开始，但本轮未执行阶段四。'
  : `${returned.length}道仍需定点复修，阶段四继续关闭。`
const ledger = `# 超市理货员298题定点V6复审接收台账

**状态：** ${merged.status}  
**候选集：** \`${candidateSetHash}\`  
**结论：** 完整145道题中，${merged.summary.passed}道通过、${returned.length}道退回复修；${phaseConclusion}

## 原件接收

| 审核范围 | 原始路径 | 仓库固化路径 | 字节数 | SHA-256 |
|---|---|---|---:|---|
| 陈晓青：内容 | \`E:\\Downloads\\job-skill-shelver-298-targeted-v6-content-rereview-packet-v1-result.json\` | \`${rel(paths.content)}\` | ${statSync(paths.content).size} | \`${hashFile(paths.content)}\` |

接收时已对原始附件与仓库固化文件执行逐字节比较；脚本同时固定字节数和SHA-256，后续任何字节变化都会使检查失败。审核JSON是权威原件，本台账仅由合并JSON的同一确定性输入生成。

## 校验结果

- 结果的Schema版本、审核包ID、候选集hash、审核人和submitted_at均精确匹配。
- 内容结果精确覆盖4道V6；无重复、漏题或越界题。
- 4道V6的版本链、previous_question_id、语义hash、候选记录hash均与候选集一致。
- 汇总可由逐题结论复算；141道既有通过题仍以V5合并结果hash引用，没有复制候选、升版或重新审核。
- 完整145道题逐题保留来源结果、审核意见、版本链、候选hash、语义hash、失败轨道、下一版题号和本次合并记录hash。

## 审核汇总

| 审核范围 | 应审 | 通过 | 退回复修 |
|---|---:|---:|---:|
| 陈晓青：内容 | ${content.questions.length} | ${contentPassed} | ${contentReturned} |

## 合并处置

- 141道既有通过引用继续有效；4道V6中${passedV6.length}道通过，因此完整145题中共${merged.summary.passed}道通过。
- 仍退回${returned.length}道：${returnIds}。
- \`releaseable=${merged.authority.releaseable}\`、\`phase_4_allowed=${merged.authority.phase_4_allowed}\`、\`phase_4_executed=false\`。
- 本轮未写运行库、未生成激活SQL，阶段二交付锁与所有历史题目保持不变。
`

for (const [path, value] of new Map([[paths.merged, `${JSON.stringify(merged, null, 2)}\n`], [paths.ledger, ledger]])) {
  if (checkOnly) assert(readFileSync(path, 'utf8') === value, `${rel(path)} is stale`)
  else writeFileSync(path, value)
}

console.log(`Targeted V6 review results ${checkOnly ? 'verified' : 'ingested'}: ${merged.summary.passed} passed, ${returned.length} returned; phase 4 ${merged.authority.phase_4_allowed ? 'may start next' : 'remains closed'}.`)
