import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const paths = {
  sourceManifest: resolve(root, 'doc/features/job-skill-shelver-298-source-manifest-v1.json'),
  source: resolve(root, 'doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json'),
  packet: resolve(root, 'doc/features/job-skill-shelver-298-question-content-review-packet-remaining-274-v1.md'),
  contentMarkdown: resolve(root, 'doc/features/job-skill-shelver-298-content-review-result-2026-07-19.md'),
  safetyMarkdown: resolve(root, 'doc/features/job-skill-shelver-298-safety-technical-review-result-2026-07-19.md'),
  conflictResolution: resolve(root, 'doc/features/job-skill-shelver-298-review-conflict-resolution-m5-dg-035-2026-07-20.md'),
  contentJson: resolve(root, 'doc/features/job-skill-shelver-298-content-review-result-2026-07-19.json'),
  safetyJson: resolve(root, 'doc/features/job-skill-shelver-298-safety-technical-review-result-2026-07-19.json'),
  mergedJson: resolve(root, 'doc/features/job-skill-shelver-298-merged-review-decisions-2026-07-19.json'),
  candidatesJson: resolve(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v1.json'),
  ledgerMarkdown: resolve(root, 'doc/features/job-skill-shelver-298-question-revision-ledger-2026-07-19.md')
}

const sourceManifest = JSON.parse(readFileSync(paths.sourceManifest, 'utf8'))
const acceptedArtifacts = new Map(sourceManifest.artifacts.map((artifact) => [artifact.artifact_id, artifact]))

function acceptedHash(artifactId) {
  const artifact = acceptedArtifacts.get(artifactId)
  if (!artifact?.sha256) throw new Error(`Missing accepted source artifact: ${artifactId}`)
  return artifact.sha256
}

const fixed = {
  sourceFileHash: acceptedHash('source_snapshot_298'),
  packetFileHash: acceptedHash('review_scope_packet_274'),
  contentFileHash: acceptedHash('first_content_review_original'),
  safetyFileHash: acceptedHash('first_safety_review_original'),
  conflictResolutionFileHash: acceptedHash('m5_dg_035_conflict_resolution_original'),
  reviewedDate: '2026-07-19',
  generatedAt: '2026-07-20T00:00:00+08:00'
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function hashText(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function hashRecord(value) {
  return hashText(JSON.stringify(canonical(value)))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function readVerified(path, expectedHash) {
  const text = readFileSync(path, 'utf8')
  const actualHash = hashText(text)
  assert(actualHash === expectedHash, `${path} hash mismatch: ${actualHash} != ${expectedHash}`)
  return text
}

function sections(text, heading) {
  const matches = [...text.matchAll(heading)]
  return matches.map((match, index) => ({
    questionId: match[1],
    body: text.slice(match.index, matches[index + 1]?.index ?? text.length)
  }))
}

function assertUnique(records, label) {
  const counts = new Map()
  for (const record of records) counts.set(record.question_id, (counts.get(record.question_id) ?? 0) + 1)
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([questionId]) => questionId)
  assert(duplicates.length === 0, `${label} duplicates: ${duplicates.join(', ')}`)
}

function checkedChoice(line, labels, questionId, field) {
  assert(line, `${questionId} missing ${field}`)
  const selected = [...line.matchAll(/\[([xX ])\]\s*([^/]+)/g)]
    .filter((match) => match[1].toLowerCase() === 'x')
    .map((match) => match[2].trim())
  assert(selected.length === 1 && labels.includes(selected[0]), `${questionId} invalid ${field}: ${selected.join(', ') || 'none'}`)
  return selected[0]
}

function checkboxDecision(line, choices, questionId, field) {
  return checkedChoice(line, choices, questionId, field)
}

function quotedField(body, start, end) {
  const startIndex = body.indexOf(start)
  assert(startIndex >= 0, `Missing field ${start}`)
  const from = startIndex + start.length
  const endIndex = end ? body.indexOf(end, from) : -1
  return body.slice(from, endIndex < 0 ? body.length : endIndex)
    .split('\n')
    .map((line) => line.replace(/^\s*>\s?/, '').trimEnd())
    .join('\n')
    .trim()
}

function countBy(records, key) {
  return Object.fromEntries([...new Set(records.map((record) => record[key]))].sort().map((value) => [value, records.filter((record) => record[key] === value).length]))
}

function moduleSummary(records, conclusionKey) {
  return Object.fromEntries(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map((module) => {
    const moduleRecords = records.filter((record) => record.question_id.startsWith(`${module}_`))
    return [module, { total: moduleRecords.length, ...countBy(moduleRecords, conclusionKey) }]
  }))
}

function parseJsonField(value, questionId, field) {
  if (value === null || value === undefined || value === '') return null
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`${questionId} has invalid ${field}: ${error.message}`)
  }
}

function parseSuggestedAnswer(questionType, text) {
  if (questionType === 'TRUE_FALSE') {
    if (/正确（true）/.test(text)) return true
    if (/错误（false）/.test(text)) return false
  }
  if (questionType === 'SINGLE_CHOICE') {
    return text.match(/建议答案：`([A-Z])`/)?.[1] ?? null
  }
  return null
}

function parseSuggestedPrompt(note) {
  const match = note.match(/(?:题干改为|统一为)[“"]([^”"]+)[”"]/) ?? note.match(/改成[“"]([^”"]+)[”"]/)
  return match?.[1] ?? null
}

function revisedQuestionId(questionId, version) {
  assert(!/_V\d+$/.test(questionId), `${questionId} source ID is unexpectedly version-suffixed`)
  return `${questionId}_V${version + 1}`
}

function detectReviewConflicts(contentReview, source) {
  const conflicts = []
  if (
    source.question_id === 'M5_DG_035' &&
    contentReview.suggested_answer_or_behavior.includes('第1步→i1（用规范话术说明问题）') &&
    contentReview.review_note.includes('应先找到正确负责人')
  ) {
    conflicts.push('内容审核的建议映射要求先说明问题再找负责人，但同题修改意见要求先找负责人再说明问题，步骤顺序相反')
  }
  return conflicts
}

const sourceText = readVerified(paths.source, fixed.sourceFileHash)
const packetText = readVerified(paths.packet, fixed.packetFileHash)
const contentText = readVerified(paths.contentMarkdown, fixed.contentFileHash)
const safetyText = readVerified(paths.safetyMarkdown, fixed.safetyFileHash)
const conflictResolutionText = readVerified(paths.conflictResolution, fixed.conflictResolutionFileHash)
const sourceQuestions = JSON.parse(sourceText)

assert(Array.isArray(sourceQuestions) && sourceQuestions.length === 298, `Expected 298 source questions, received ${sourceQuestions?.length ?? 'invalid'}`)
assert(contentText.includes('- 审核人：陈晓青') && contentText.includes('- 审核人签名：陈晓青'), 'Content reviewer identity mismatch')
assert(contentText.includes('- 审核日期：2026-07-19') && contentText.includes('- 审核日期：2026年07月19日'), 'Content review date mismatch')
assert(safetyText.includes('- 审核人：赫东'), 'Safety/technical reviewer identity mismatch')
assert(safetyText.includes('- 审核日期：2026-07-19'), 'Safety/technical review date mismatch')
assert(conflictResolutionText.includes('第1步→i2（找到正确的负责人）；第2步→i1（用规范话术说明问题）；第3步→i3（复述确认并执行指示）'), 'M5_DG_035 conflict resolution mapping mismatch')
assert(conflictResolutionText.includes('先采取本人权限内的现场控制措施'), 'M5_DG_035 conflict resolution safety boundary missing')

const packetSections = sections(packetText, /^### \d+\. (M[1-6]_[A-Z]+_\d+) \|/gm)
const packetRecords = packetSections.map(({ questionId, body }) => ({
  question_id: questionId,
  question_version: Number(body.match(/\| 原始题目 ID \/ 版本 \| `[^`]+` \/ (\d+) \|/)?.[1]),
  source_record_hash: body.match(/\| 原始记录 hash \| `(sha256:[a-f0-9]{64})` \|/)?.[1]
}))
assert(packetRecords.length === 274, `Expected 274 packet records, received ${packetRecords.length}`)
assertUnique(packetRecords, 'packet')
const packetById = new Map(packetRecords.map((record) => [record.question_id, record]))

const sourceById = new Map(sourceQuestions.map((question) => [question.question_id, question]))
for (const record of packetRecords) {
  const source = sourceById.get(record.question_id)
  assert(source, `${record.question_id} missing from source snapshot`)
  assert(record.source_record_hash === hashRecord(source), `${record.question_id} packet/source hash mismatch`)
  assert(record.question_version === source.version, `${record.question_id} packet/source version mismatch`)
}

const contentConclusionMap = {
  '通过': 'APPROVED',
  '退回修改': 'RETURN_FOR_REVISION',
  '不纳入正式题库': 'REJECTED'
}
const contentSections = sections(contentText, /^### \d+\. (M[1-6]_[A-Z]+_\d+) \|/gm)
const contentQuestions = contentSections.map(({ questionId, body }) => {
  const packet = packetById.get(questionId)
  assert(packet, `${questionId} is outside the 274-question packet`)
  const questionTypeLabel = body.match(/^### \d+\. [^|]+\| (.+)$/m)?.[1]?.trim() ?? ''
  const source = sourceById.get(questionId)
  const conclusionZh = checkedChoice(body.match(/^- 内容结论：(.+)$/m)?.[1], Object.keys(contentConclusionMap), questionId, 'content conclusion')
  const reviewNote = quotedField(body, '- 修改意见或不纳入原因:', '- 素材、工具或施测补充要求:')
  const suggestedAnswerOrBehavior = quotedField(body, '- 建议答案或达标行为:', '- 修改意见或不纳入原因:')
  const materialRequirement = quotedField(body, '- 素材、工具或施测补充要求:', '\n---')
  const sourceRecordHash = body.match(/\| 原始记录 hash \| `(sha256:[a-f0-9]{64})` \|/)?.[1]
  const questionVersion = Number(body.match(/\| 原始题目 ID \/ 版本 \| `[^`]+` \/ (\d+) \|/)?.[1])
  assert(sourceRecordHash === packet.source_record_hash, `${questionId} content review hash mismatch`)
  assert(questionVersion === packet.question_version, `${questionId} content review version mismatch`)
  assert(conclusionZh === '通过' || reviewNote.length > 0, `${questionId} requires a content review note`)

  const promptDecision = checkboxDecision(body.match(/^- 题干：(.+)$/m)?.[1], ['清楚、自然且适合学生', '需要修改'], questionId, 'prompt decision')
  const authenticityDecision = checkboxDecision(body.match(/^- 职业真实性：(.+)$/m)?.[1], ['符合理货员实际工作', '需要修改或补充边界'], questionId, 'authenticity decision')
  const answerDecision = checkboxDecision(body.match(/^- 选项、答案或 rubric：(.+)$/m)?.[1], ['唯一且可判定', '需要修改'], questionId, 'answer/rubric decision')
  const materialDecision = checkboxDecision(body.match(/^- 素材与工具说明：(.+)$/m)?.[1], ['足够制作和施测', '需要补充', '本题不需要'], questionId, 'material decision')
  const safetyMarkerDecisionZh = checkboxDecision(body.match(/^- 安全内容：(.+)$/m)?.[1], ['标记正确', '应增加安全敏感标记', '应取消安全敏感标记'], questionId, 'safety marker decision')

  return {
    question_id: questionId,
    question_version: questionVersion,
    source_record_hash: sourceRecordHash,
    question_type: source.question_type,
    question_type_label: questionTypeLabel,
    content_conclusion: contentConclusionMap[conclusionZh],
    prompt_review: promptDecision === '清楚、自然且适合学生' ? 'PASS' : 'REVISION_REQUIRED',
    occupational_authenticity_review: authenticityDecision === '符合理货员实际工作' ? 'PASS' : 'REVISION_REQUIRED',
    answer_or_rubric_review: answerDecision === '唯一且可判定' ? 'PASS' : 'REVISION_REQUIRED',
    material_tool_review: materialDecision === '足够制作和施测' ? 'PASS' : materialDecision === '需要补充' ? 'REVISION_REQUIRED' : 'NOT_REQUIRED',
    safety_marker_decision: safetyMarkerDecisionZh === '标记正确' ? 'KEEP' : safetyMarkerDecisionZh === '应增加安全敏感标记' ? 'ADD' : 'REMOVE',
    suggested_answer_or_behavior: suggestedAnswerOrBehavior,
    review_note: reviewNote,
    material_tool_requirement: materialRequirement,
    reviewer: '陈晓青',
    reviewed_date: fixed.reviewedDate,
    source_file: 'doc/features/job-skill-shelver-298-content-review-result-2026-07-19.md'
  }
})
assert(contentQuestions.length === 274, `Expected 274 content records, received ${contentQuestions.length}`)
assertUnique(contentQuestions, 'content review')
assert([...packetById.keys()].every((questionId) => contentQuestions.some((record) => record.question_id === questionId)), 'Content review set mismatch')

const contentSummary = {
  total: contentQuestions.length,
  approved: contentQuestions.filter((record) => record.content_conclusion === 'APPROVED').length,
  return_for_revision: contentQuestions.filter((record) => record.content_conclusion === 'RETURN_FOR_REVISION').length,
  rejected: contentQuestions.filter((record) => record.content_conclusion === 'REJECTED').length,
  by_module: moduleSummary(contentQuestions, 'content_conclusion')
}
assert(contentSummary.approved === 33 && contentSummary.return_for_revision === 230 && contentSummary.rejected === 11, 'Content review summary mismatch')

const safetySections = sections(safetyText, /^## \d+\. (M[1-6]_[A-Z]+_\d+) \|/gm)
const safetyQuestions = safetySections.map(({ questionId, body }) => {
  const packet = packetById.get(questionId)
  assert(packet, `${questionId} is outside the 274-question packet`)
  const versionHash = body.match(/^- 原始版本 \/ hash：`v(\d+)` \/ `(sha256:[a-f0-9]{64})`$/m)
  const questionVersion = Number(versionHash?.[1])
  const sourceRecordHash = versionHash?.[2]
  const safetyConclusionZh = body.match(/^- 安全结论：\*\*(通过|不通过)\*\*$/m)?.[1]
  const technicalConclusionZh = body.match(/^- 技术结论：\*\*(通过|不通过)\*\*$/m)?.[1]
  const safetyNote = body.match(/^- 安全审核意见：(.+)$/m)?.[1]?.trim() ?? ''
  const technicalNote = body.match(/^- 技术审核意见：(.+)$/m)?.[1]?.trim() ?? ''
  const activationRecommendationZh = body.match(/^- 激活建议：\*\*(可进入下一门禁|退回修改)\*\*$/m)?.[1]
  const minimumRequirement = body.match(/^- 复审前最低要求：(.+)$/m)?.[1]?.trim() ?? null
  assert(sourceRecordHash === packet.source_record_hash, `${questionId} safety/technical review hash mismatch`)
  assert(questionVersion === packet.question_version, `${questionId} safety/technical review version mismatch`)
  assert(safetyConclusionZh && technicalConclusionZh, `${questionId} missing safety or technical conclusion`)
  assert(safetyConclusionZh === '通过' || safetyNote, `${questionId} safety rejection requires a note`)
  assert(technicalConclusionZh === '通过' || technicalNote, `${questionId} technical rejection requires a note`)
  const expectedActivation = safetyConclusionZh === '通过' && technicalConclusionZh === '通过' ? '可进入下一门禁' : '退回修改'
  assert(activationRecommendationZh === expectedActivation, `${questionId} activation recommendation mismatch`)

  return {
    question_id: questionId,
    question_version: questionVersion,
    source_record_hash: sourceRecordHash,
    safety_conclusion: safetyConclusionZh === '通过' ? 'PASS' : 'RETURN_FOR_REVISION',
    safety_note: safetyNote,
    technical_conclusion: technicalConclusionZh === '通过' ? 'PASS' : 'RETURN_FOR_REVISION',
    technical_note: technicalNote,
    activation_recommendation: expectedActivation === '可进入下一门禁' ? 'NEXT_GATE_ELIGIBLE' : 'RETURN_FOR_REVISION',
    minimum_re_review_requirement: minimumRequirement,
    reviewer: '赫东',
    reviewed_date: fixed.reviewedDate,
    source_file: 'doc/features/job-skill-shelver-298-safety-technical-review-result-2026-07-19.md'
  }
})
assert(safetyQuestions.length === 274, `Expected 274 safety/technical records, received ${safetyQuestions.length}`)
assertUnique(safetyQuestions, 'safety/technical review')
assert([...packetById.keys()].every((questionId) => safetyQuestions.some((record) => record.question_id === questionId)), 'Safety/technical review set mismatch')

const safetySummary = {
  total: safetyQuestions.length,
  safety_pass: safetyQuestions.filter((record) => record.safety_conclusion === 'PASS').length,
  safety_return_for_revision: safetyQuestions.filter((record) => record.safety_conclusion === 'RETURN_FOR_REVISION').length,
  technical_pass: safetyQuestions.filter((record) => record.technical_conclusion === 'PASS').length,
  technical_return_for_revision: safetyQuestions.filter((record) => record.technical_conclusion === 'RETURN_FOR_REVISION').length,
  both_pass: safetyQuestions.filter((record) => record.safety_conclusion === 'PASS' && record.technical_conclusion === 'PASS').length,
  safety_return_technical_pass: safetyQuestions.filter((record) => record.safety_conclusion === 'RETURN_FOR_REVISION' && record.technical_conclusion === 'PASS').length,
  safety_pass_technical_return: safetyQuestions.filter((record) => record.safety_conclusion === 'PASS' && record.technical_conclusion === 'RETURN_FOR_REVISION').length,
  both_return: safetyQuestions.filter((record) => record.safety_conclusion === 'RETURN_FOR_REVISION' && record.technical_conclusion === 'RETURN_FOR_REVISION').length
}
assert(safetySummary.safety_pass === 236 && safetySummary.safety_return_for_revision === 38, 'Safety summary mismatch')
assert(safetySummary.technical_pass === 203 && safetySummary.technical_return_for_revision === 71, 'Technical summary mismatch')
assert(safetySummary.both_pass === 197 && safetySummary.safety_return_technical_pass === 6 && safetySummary.safety_pass_technical_return === 39 && safetySummary.both_return === 32, 'Safety/technical matrix mismatch')

const contentById = new Map(contentQuestions.map((record) => [record.question_id, record]))
const safetyById = new Map(safetyQuestions.map((record) => [record.question_id, record]))
const mergedQuestions = packetRecords.map((packet) => {
  const content = contentById.get(packet.question_id)
  const safety = safetyById.get(packet.question_id)
  const source = sourceById.get(packet.question_id)
  const detectedConflicts = detectReviewConflicts(content, source)
  const resolvedConflicts = packet.question_id === 'M5_DG_035'
    ? detectedConflicts.map((conflict) => ({
        conflict,
        resolution: '采用 i2 → i1 → i3；将 i3 改为“复述确认并执行指示”；即时安全风险须先采取本人权限内的现场控制措施。',
        resolution_id: 'job-skill-shelver-298-m5-dg-035-conflict-resolution-2026-07-20',
        source_file: 'doc/features/job-skill-shelver-298-review-conflict-resolution-m5-dg-035-2026-07-20.md',
        source_file_hash: fixed.conflictResolutionFileHash
      }))
    : []
  const conflicts = detectedConflicts.filter((conflict) => !resolvedConflicts.some((resolved) => resolved.conflict === conflict))
  if (content.safety_marker_decision === 'REMOVE' && safety.safety_conclusion === 'RETURN_FOR_REVISION') {
    conflicts.push('内容审核建议取消安全敏感标记，但安全审核结论为退回修改')
  }
  let mergedDecision
  if (conflicts.length) mergedDecision = 'BLOCKED_CONFLICT'
  else if (content.content_conclusion === 'REJECTED') mergedDecision = 'REJECTED'
  else if (content.content_conclusion === 'RETURN_FOR_REVISION' || safety.safety_conclusion === 'RETURN_FOR_REVISION' || safety.technical_conclusion === 'RETURN_FOR_REVISION') mergedDecision = 'REVISION_REQUIRED'
  else mergedDecision = 'APPROVED_UNCHANGED'

  return {
    question_id: packet.question_id,
    question_version: packet.question_version,
    source_record_hash: packet.source_record_hash,
    content_conclusion: content.content_conclusion,
    safety_conclusion: safety.safety_conclusion,
    technical_conclusion: safety.technical_conclusion,
    merged_decision: mergedDecision,
    conflicts,
    resolved_conflicts: resolvedConflicts,
    review_result_refs: {
      content_result_id: 'job-skill-shelver-298-content-review-2026-07-19',
      safety_technical_result_id: 'job-skill-shelver-298-safety-technical-review-2026-07-19',
      conflict_resolution_id: resolvedConflicts[0]?.resolution_id ?? null
    }
  }
})

const conflictRecords = mergedQuestions.filter((record) => record.merged_decision === 'BLOCKED_CONFLICT')
const mergedSummary = {
  total: mergedQuestions.length,
  approved_unchanged: mergedQuestions.filter((record) => record.merged_decision === 'APPROVED_UNCHANGED').length,
  revision_required: mergedQuestions.filter((record) => record.merged_decision === 'REVISION_REQUIRED').length,
  rejected: mergedQuestions.filter((record) => record.merged_decision === 'REJECTED').length,
  blocked_conflict: conflictRecords.length
}

const contentResult = {
  schema_version: 'job-skill-shelver-298-content-review-result-v1',
  result_id: 'job-skill-shelver-298-content-review-2026-07-19',
  status: 'VALIDATED_MACHINE_AUTHORITY',
  reviewer: { name: '陈晓青', role: '零售运营督导 / 现场督导（Floor Supervisor）', reviewed_date: fixed.reviewedDate },
  scope: { source_total: 298, excluded_pilot_source_total: 24, reviewed_total: 274 },
  source_files: [
    { path: 'doc/features/job-skill-shelver-298-content-review-result-2026-07-19.md', sha256: fixed.contentFileHash },
    { path: 'doc/features/job-skill-shelver-298-question-content-review-packet-remaining-274-v1.md', sha256: fixed.packetFileHash },
    { path: 'doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json', sha256: fixed.sourceFileHash }
  ],
  generated_at: fixed.generatedAt,
  summary: contentSummary,
  questions: contentQuestions
}

const safetyResult = {
  schema_version: 'job-skill-shelver-298-safety-technical-review-result-v1',
  result_id: 'job-skill-shelver-298-safety-technical-review-2026-07-19',
  status: 'VALIDATED_MACHINE_AUTHORITY',
  reviewer: { name: '赫东', reviewed_date: fixed.reviewedDate },
  scope: { source_total: 298, excluded_pilot_source_total: 24, reviewed_total: 274 },
  source_files: [
    { path: 'doc/features/job-skill-shelver-298-safety-technical-review-result-2026-07-19.md', sha256: fixed.safetyFileHash },
    { path: 'doc/features/job-skill-shelver-298-question-content-review-packet-remaining-274-v1.md', sha256: fixed.packetFileHash },
    { path: 'doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json', sha256: fixed.sourceFileHash }
  ],
  generated_at: fixed.generatedAt,
  summary: safetySummary,
  questions: safetyQuestions
}

const mergedResult = {
  schema_version: 'job-skill-shelver-298-merged-review-decisions-v1',
  decision_set_id: 'job-skill-shelver-298-merged-review-decisions-2026-07-19',
  status: 'DRAFT_DECISIONS_NO_ACTIVATION_AUTHORITY',
  generated_at: fixed.generatedAt,
  source_result_ids: [contentResult.result_id, safetyResult.result_id],
  source_resolution_ids: ['job-skill-shelver-298-m5-dg-035-conflict-resolution-2026-07-20'],
  summary: mergedSummary,
  questions: mergedQuestions
}

function buildCandidate(merged) {
  if (merged.merged_decision === 'REJECTED' || merged.merged_decision === 'BLOCKED_CONFLICT') return null
  const source = sourceById.get(merged.question_id)
  const contentReview = contentById.get(merged.question_id)
  const safetyReview = safetyById.get(merged.question_id)
  const revised = merged.merged_decision === 'REVISION_REQUIRED'
  const content = structuredClone(parseJsonField(source.content_json, source.question_id, 'content_json'))
  const scoring = structuredClone(parseJsonField(source.scoring_rule_json, source.question_id, 'scoring_rule_json'))
  const proposedChanges = []

  if (revised) {
    const suggestedPrompt = parseSuggestedPrompt(contentReview.review_note)
    if (suggestedPrompt && suggestedPrompt !== content.prompt) {
      content.prompt = suggestedPrompt
      proposedChanges.push('PROMPT_FROM_CONTENT_REVIEW')
    }
    if (source.question_type === 'TRUE_FALSE' && /题干写“图中理货员”/.test(contentReview.review_note)) {
      content.prompt = '观看视频，判断该做法是否符合门店规范。'
      proposedChanges.push('TRUE_FALSE_VIDEO_PROMPT_ALIGNED')
    }
    const suggestedAnswer = parseSuggestedAnswer(source.question_type, contentReview.suggested_answer_or_behavior)
    if (suggestedAnswer !== null && suggestedAnswer !== content.expected_answer) {
      content.expected_answer = suggestedAnswer
      proposedChanges.push('EXPECTED_ANSWER_FROM_CONTENT_REVIEW')
    }
    if (source.question_type === 'OFFLINE_OPERATION') {
      scoring.score_0_description = '核心任务未完成、关键对象判断错误，或出现继续危险操作等安全红线。'
      scoring.score_1_description = '完成部分关键指标，存在漏项、错配或需要一次非指向性提示，但未触发安全红线。'
      scoring.score_2_description = '全部关键指标完成且无关键错误或安全红线。'
      proposedChanges.push('OBSERVABLE_0_1_2_ANCHORS_APPLIED')
    }
    if (source.question_id === 'M5_DG_035') {
      content.prompt = '请把向负责人求助的3个步骤按顺序排好'
      const confirmationItem = content.drag_items.find((item) => item.item_id === 'i3')
      assert(confirmationItem, 'M5_DG_035 missing i3')
      confirmationItem.label = '复述确认并执行指示'
      const expectedOrder = { z1: 'i2', z2: 'i1', z3: 'i3' }
      for (const zone of content.drop_zones) {
        assert(expectedOrder[zone.zone_id], `M5_DG_035 unexpected drop zone ${zone.zone_id}`)
        zone.accepts = [expectedOrder[zone.zone_id]]
      }
      proposedChanges.push('MANUAL_CONFLICT_RESOLUTION_I2_I1_I3_APPLIED', 'CONFIRM_AND_EXECUTE_LABEL_APPLIED')
    }
  }

  const safetySensitive = source.question_id === 'M5_DG_035' || contentReview.safety_marker_decision === 'ADD' || safetyReview.safety_conclusion === 'RETURN_FOR_REVISION'
    ? true
    : contentReview.safety_marker_decision === 'REMOVE'
      ? false
      : source.safety_sensitive === 1
  if (safetySensitive !== (source.safety_sensitive === 1)) proposedChanges.push('SAFETY_SENSITIVE_FLAG_REVISED')

  const base = {
    question_id: revised ? revisedQuestionId(source.question_id, source.version) : source.question_id,
    previous_question_id: revised ? source.question_id : null,
    question_version: revised ? source.version + 1 : source.version,
    source_question_id: source.question_id,
    source_record_hash: merged.source_record_hash,
    module: source.question_id.split('_')[0],
    question_type: source.question_type,
    job_code: source.job_code,
    module_type: source.module_type,
    difficulty_level: source.difficulty_level,
    status: 'DRAFT',
    merged_decision: merged.merged_decision,
    proposed_question: {
      content,
      scoring_rule: scoring,
      media_asset_id: source.media_asset_id,
      tool_asset_ids: parseJsonField(source.tool_asset_ids_json, source.question_id, 'tool_asset_ids_json'),
      sensory_tags: parseJsonField(source.sensory_tags_json, source.question_id, 'sensory_tags_json'),
      safety_sensitive: safetySensitive,
      safety_stop_conditions: source.question_id === 'M5_DG_035'
        ? '若求助事项涉及地面水渍、货架松动、碎玻璃等即时安全风险，必须先采取本人权限内的现场控制措施，再执行本题求助顺序；无法控制风险时立即停止作业、隔离现场并紧急上报。'
        : null
    },
    revision_application: {
      automatically_applied_changes: proposedChanges,
      content_review_requirement: contentReview.review_note,
      suggested_answer_or_behavior: contentReview.suggested_answer_or_behavior,
      material_tool_requirement: contentReview.material_tool_requirement,
      safety_requirement: safetyReview.safety_note,
      technical_requirement: safetyReview.technical_note,
      minimum_re_review_requirement: safetyReview.minimum_re_review_requirement,
      conflict_resolution_requirement: merged.resolved_conflicts[0]?.resolution ?? null,
      semantic_change_re_review_required: revised
    },
    review_result_refs: merged.review_result_refs,
    activation_authority: 'NONE'
  }
  return { ...base, candidate_record_hash: hashRecord(base) }
}

const candidates = mergedQuestions.map(buildCandidate).filter(Boolean)
assertUnique(candidates, 'revision candidates')
assert(candidates.every((candidate) => candidate.status === 'DRAFT' && candidate.activation_authority === 'NONE'), 'Candidates must fail closed')
assert(candidates.filter((candidate) => candidate.merged_decision === 'REVISION_REQUIRED').every((candidate) => candidate.previous_question_id && candidate.question_id.endsWith('_V2') && candidate.question_version === 2), 'All revisions must use a new ID and version')

const candidateSetBase = {
  schema_version: 'job-skill-shelver-298-question-revision-candidates-v1',
  candidate_set_id: 'job-skill-shelver-298-question-revision-candidates-v1',
  status: 'DRAFT_REVIEW_REQUIRED_NO_ACTIVATION_AUTHORITY',
  generated_at: fixed.generatedAt,
  authority: {
    source_snapshot_immutable: true,
    historical_review_results_immutable: true,
    pilot_v3_unchanged: true,
    runtime_database_unchanged: true,
    activation_sql_generated: false
  },
  based_on_decision_set_id: mergedResult.decision_set_id,
  source_snapshot: { path: 'doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json', sha256: fixed.sourceFileHash },
  summary: {
    source_reviewed_total: 274,
    candidates_total: candidates.length,
    approved_unchanged: candidates.filter((candidate) => candidate.merged_decision === 'APPROVED_UNCHANGED').length,
    revised_new_versions: candidates.filter((candidate) => candidate.merged_decision === 'REVISION_REQUIRED').length,
    structured_revision_applied: candidates.filter((candidate) => candidate.merged_decision === 'REVISION_REQUIRED' && candidate.revision_application.automatically_applied_changes.length > 0).length,
    requirements_bound_revision_pending: candidates.filter((candidate) => candidate.merged_decision === 'REVISION_REQUIRED' && candidate.revision_application.automatically_applied_changes.length === 0).length,
    rejected_excluded: mergedSummary.rejected,
    blocked_conflict_excluded: mergedSummary.blocked_conflict,
    semantic_change_re_review_pending: candidates.filter((candidate) => candidate.revision_application.semantic_change_re_review_required).length
  },
  hash_canonicalization: 'SHA-256(JSON.stringify(recursively-key-sorted record excluding candidate_record_hash))',
  questions: candidates
}
const candidateSet = { ...candidateSetBase, candidate_set_hash: hashRecord(candidateSetBase) }

const ledgerRows = mergedQuestions.map((merged) => {
  const candidate = candidates.find((item) => item.source_question_id === merged.question_id)
  const content = contentById.get(merged.question_id)
  const safety = safetyById.get(merged.question_id)
  const note = merged.merged_decision === 'REJECTED'
    ? content.review_note
    : merged.merged_decision === 'BLOCKED_CONFLICT'
      ? merged.conflicts.join('；')
      : merged.merged_decision === 'REVISION_REQUIRED'
        ? [content.review_note, ...merged.resolved_conflicts.map((resolved) => resolved.resolution), safety.safety_conclusion === 'RETURN_FOR_REVISION' ? safety.safety_note : null, safety.technical_conclusion === 'RETURN_FOR_REVISION' ? safety.technical_note : null].filter(Boolean).join('；')
        : '三类审核均通过，保留原题语义并保持 DRAFT。'
  return `| \`${merged.question_id}\` | ${merged.content_conclusion} | ${merged.safety_conclusion} | ${merged.technical_conclusion} | ${merged.merged_decision} | ${candidate ? `\`${candidate.question_id}\` / v${candidate.question_version}` : '不进入候选'} | ${note.replaceAll('|', '\\|').replaceAll('\n', '<br>')} |`
})

const ledger = `# 超市理货员剩余274题审核合并与修订台账

**审核日期：** ${fixed.reviewedDate}  
**生成状态：** DRAFT；不具备激活授权  
**来源快照：** \`doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json\`（${fixed.sourceFileHash}）

## 汇总

| 合并状态 | 题数 | 处理 |
|---|---:|---|
| APPROVED_UNCHANGED | ${mergedSummary.approved_unchanged} | 保留原 ID / v1 与原始语义，状态保持 DRAFT |
| REVISION_REQUIRED | ${mergedSummary.revision_required} | 创建 \`_V2\` / v2 修订候选，等待陈晓青与赫东对新 hash 复审 |
| REJECTED | ${mergedSummary.rejected} | 不进入候选，保留原始审核证据 |
| BLOCKED_CONFLICT | ${mergedSummary.blocked_conflict} | 阻断并等待人工裁决 |

候选共 ${candidateSet.summary.candidates_total} 题。未修改298题来源快照、Pilot v3、历史审核结果或运行库，也未生成激活 SQL。

## 逐题台账

| 原始题目 | 内容 | 安全 | 技术 | 合并状态 | 候选题目 / 版本 | 审核依据与修订要求 |
|---|---|---|---|---|---|---|
${ledgerRows.join('\n')}
`

writeFileSync(paths.contentJson, `${JSON.stringify(contentResult, null, 2)}\n`)
writeFileSync(paths.safetyJson, `${JSON.stringify(safetyResult, null, 2)}\n`)
writeFileSync(paths.mergedJson, `${JSON.stringify(mergedResult, null, 2)}\n`)
writeFileSync(paths.candidatesJson, `${JSON.stringify(candidateSet, null, 2)}\n`)
writeFileSync(paths.ledgerMarkdown, ledger)

console.log(`[job-skill-298-revisions] content=${contentSummary.approved}/${contentSummary.return_for_revision}/${contentSummary.rejected}`)
console.log(`[job-skill-298-revisions] safety=${safetySummary.safety_pass}/${safetySummary.safety_return_for_revision} technical=${safetySummary.technical_pass}/${safetySummary.technical_return_for_revision}`)
console.log(`[job-skill-298-revisions] merged=${mergedSummary.approved_unchanged}/${mergedSummary.revision_required}/${mergedSummary.rejected}/${mergedSummary.blocked_conflict}`)
console.log(`[job-skill-298-revisions] candidates=${candidateSet.summary.candidates_total} hash=${candidateSet.candidate_set_hash}`)
for (const conflict of conflictRecords) console.log(`[!] ${conflict.question_id}: ${conflict.conflicts.join('; ')}`)
