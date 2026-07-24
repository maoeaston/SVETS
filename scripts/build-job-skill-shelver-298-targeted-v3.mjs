import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  hashFile,
  hashRecord,
  questionSemanticHash,
  questionSemanticHashContract
} from './lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '..')
const paths = {
  candidatesV2: resolve(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v1.json'),
  mergedGate: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-rereview-merged-gate-2026-07-20.json'),
  contentResult: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-result-chen-xiaoqing-2026-07-20.json'),
  safetyResult: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-he-dong-2026-07-20.json'),
  deliveryLock: resolve(root, 'doc/features/job-skill-shelver-question-delivery-lock-v1.json'),
  patchesSchema: resolve(root, 'doc/features/job-skill-shelver-298-revision-patches-v2.schema.json'),
  patches: resolve(root, 'doc/features/job-skill-shelver-298-revision-patches-v2.json'),
  candidatesSchema: resolve(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v3.schema.json'),
  candidatesV3: resolve(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v3.json'),
  contentHtml: resolve(root, 'doc/features/job-skill-shelver-298-targeted-v3-content-rereview-packet-chen-xiaoqing-v1.html'),
  safetyHtml: resolve(root, 'doc/features/job-skill-shelver-298-targeted-v3-safety-technical-rereview-packet-he-dong-v1.html'),
  contentResultSchema: resolve(root, 'doc/features/job-skill-shelver-298-targeted-v3-content-rereview-result-v1.schema.json'),
  safetyResultSchema: resolve(root, 'doc/features/job-skill-shelver-298-targeted-v3-safety-technical-rereview-result-v1.schema.json'),
  gateSchema: resolve(root, 'doc/features/job-skill-shelver-298-targeted-v3-rereview-gate-v1.schema.json'),
  gate: resolve(root, 'doc/features/job-skill-shelver-298-targeted-v3-rereview-gate-v1.json')
}

const rel = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, path.slice(root.length + 1)]))
const generatedAt = '2026-07-20T00:00:00+08:00'
const refreshPatches = process.argv.includes('--refresh-patches')
const checkOnly = process.argv.includes('--check')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function indexBy(records, key = 'question_id') {
  const result = new Map()
  for (const record of records) {
    assert(!result.has(record[key]), `Duplicate ${key}: ${record[key]}`)
    result.set(record[key], record)
  }
  return result
}

function cleanRequirement(note) {
  return note
    .replace(/^退回复修。[“"]?/, '')
    .replace(/^V2 未关闭安全边界：/, '')
    .replace(/[”"]?$/, '')
    .replace(/；本题若最终退回，原因仅为素材、Renderer 或数据绑定未完成。?$/, '')
    .trim()
}

function actionableRequirement(note) {
  const cleaned = cleanRequirement(note)
  const businessRequirement = cleaned.match(/业务问题：(.+)$/)?.[1]
  const value = businessRequirement ?? cleaned
  const requiredAction = value.match(/(?:；|。)应(.+)$/)?.[1]
  return (requiredAction ? `应${requiredAction}` : value)
    .replace(/；同时 tool_asset_ids 为空。?$/, '')
    .trim()
}

function positiveRequirement(note) {
  const value = actionableRequirement(note)
  if (value.includes('缺少')) {
    const missing = value.split('缺少').slice(1).join('缺少').split(/，现有|，当前|，无法/)[0]
    return `应完整执行并核验：${missing}`
  }
  return value
}

function contentSpecificRequirement(note) {
  const value = note.match(/另外，当前任务仍存在：(.+?) 退回复修。?$/)?.[1]
  return value
    ? positiveRequirement(value).replace(/rubric.*$/i, '').trim()
    : null
}

function removeLeakingPromptText(prompt) {
  return prompt
    .replace(/（[^）]+）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, '')
    .replace(/，+$/g, '')
}

function deliveryTypes(record) {
  return new Set(record?.delivery?.types ?? [])
}

const deliveryOnlyImageQuestionIds = new Set([
  'M1_DG_031_V2',
  'M1_SC_014_V2',
  'M2_DG_025_V2',
  'M6_DG_028_V2',
  'M6_DG_029_V2',
  'M6_DG_031_V2',
  'M6_DG_032_V2',
  'M6_SC_007_V2',
  'M6_SC_008_V2',
  'M6_SC_011_V2'
])

function isPureDeliveryReturn(gate, content, safety, delivery) {
  const technicalAndSafetyPass = safety.technical_conclusion === 'PASS' && safety.safety_conclusion === 'PASS'
  if (!technicalAndSafetyPass) return false
  if (deliveryOnlyImageQuestionIds.has(gate.question_id)) {
    return gate.question_id === 'M2_DG_025_V2' || deliveryTypes(delivery).has('IMAGE_REQUIREMENT')
  }
  return gate.question_type === 'TRUE_FALSE' &&
    !content.review_note.includes('同时仍需解决') &&
    deliveryTypes(delivery).has('VIDEO_ANSWER') &&
    delivery.delivery.expected_answer !== null
}

function jsonPointerGet(target, pointer) {
  return pointer.split('/').slice(1).reduce((value, token) => value[token.replaceAll('~1', '/').replaceAll('~0', '~')], target)
}

function jsonPointerSet(target, pointer, value) {
  const tokens = pointer.split('/').slice(1).map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
  const key = tokens.pop()
  const parent = tokens.reduce((current, token) => current[token], target)
  assert(parent && Object.hasOwn(parent, key), `replace path does not exist: ${pointer}`)
  parent[key] = structuredClone(value)
}

function operation(path, before, value, rationale) {
  return { op: 'replace', path, before, value, rationale }
}

function deriveOperations(candidate, contentReview, safetyReview) {
  const proposed = candidate.proposed_question
  const content = proposed.content
  const operations = []
  const technicalRequirement = positiveRequirement(safetyReview.technical_note)
  const safetyRequirement = actionableRequirement(safetyReview.safety_note)

  if (candidate.question_type === 'SINGLE_CHOICE') {
    const exactPrompt = contentReview.review_note.match(/题干[^。]*应改为[“"]([^”"]+)[”"]/)?.[1]
    if (exactPrompt) {
      operations.push(operation('/content/prompt', content.prompt, exactPrompt, '修正文案并保持原答案'))
    } else if (safetyReview.technical_conclusion === 'PASS') {
      const prompt = removeLeakingPromptText(content.prompt)
      assert(prompt !== content.prompt, `${candidate.question_id} content-only correction did not change prompt`)
      operations.push(operation('/content/prompt', content.prompt, prompt, '删除题干中的泄题文字或异常引号'))
    } else {
      const prompt = '根据题目情境和门店岗位流程，以下哪项做法最符合规范？'
      operations.push(operation('/content/prompt', content.prompt, prompt, '移除不通用或含糊的原题口径'))
      const answerKey = content.expected_answer
      const optionIndex = content.options.findIndex((option) => option.key === answerKey)
      assert(optionIndex >= 0, `${candidate.question_id} expected option missing`)
      operations.push(operation(
        `/content/options/${optionIndex}/text`,
        content.options[optionIndex].text,
        technicalRequirement,
        '把正确选项改为复审确认的岗位边界'
      ))
    }
  } else if (candidate.question_type === 'TRUE_FALSE') {
    const requirement = safetyReview.technical_conclusion === 'RETURN_FOR_REVISION'
      ? technicalRequirement
      : contentReview.review_note.match(/同时仍需解决：(.+?)。 退回复修/)?.[1] ?? cleanRequirement(contentReview.review_note)
    const prompt = `观看视频，判断其中做法是否完整符合以下门店岗位要求：${requirement}`
    operations.push(operation('/content/prompt', content.prompt, prompt, '把需修订的岗位或安全边界写入判断标准'))
  } else if (candidate.question_type === 'DRAG') {
    const prompt = '请把两种做法分别拖到“符合规范”和“不符合规范”区域。'
    const dragItems = [
      { item_id: 'i_correct', label: technicalRequirement },
      { item_id: 'i_incorrect', label: '忽略上述岗位要求，直接沿用原题指出的不规范做法' }
    ]
    const dropZones = [
      { zone_id: 'z_correct', label: '符合规范', accepts: ['i_correct'] },
      { zone_id: 'z_incorrect', label: '不符合规范', accepts: ['i_incorrect'] }
    ]
    operations.push(
      operation('/content/prompt', content.prompt, prompt, '将含糊排序或归类改成唯一可判定的规范识别任务'),
      operation('/content/drag_items', content.drag_items, dragItems, '使用复审确认的岗位行为作为唯一正确项'),
      operation('/content/drop_zones', content.drop_zones, dropZones, '同步重建唯一答案映射')
    )
  } else if (candidate.question_type === 'OFFLINE_OPERATION') {
    const specificRequirement = contentSpecificRequirement(contentReview.review_note)
    const revisedCriteria = specificRequirement
      ? [...content.rubric_criteria, { criterion_id: 'r_review_boundary', description: specificRequirement }]
      : content.rubric_criteria
    const criteria = revisedCriteria.map((criterion) => criterion.description)
    const allCriteria = criteria.join('；')
    operations.push(
      ...(specificRequirement ? [operation(
          '/content/rubric_criteria',
          content.rubric_criteria,
          revisedCriteria,
          '把复审指出的本题业务边界加入逐题rubric'
        )] : []),
      operation(
        '/scoring_rule/score_0_description',
        proposed.scoring_rule.score_0_description,
        `0分：核心任务未完成、关键对象判断错误，或出现与本题要求相反的关键行为。关键指标：${allCriteria}`,
        '把本题关键指标写入0分锚点'
      ),
      operation(
        '/scoring_rule/score_1_description',
        proposed.scoring_rule.score_1_description,
        `1分：仅完成部分关键指标，存在至少一项漏项、错配或需一次非指向性提示。对照指标：${allCriteria}`,
        '把本题关键指标和提示边界写入1分锚点'
      ),
      operation(
        '/scoring_rule/score_2_description',
        proposed.scoring_rule.score_2_description,
        `2分：独立完成全部关键指标且无关键错误：${allCriteria}`,
        '把本题全部达标行为写入2分锚点'
      )
    )
    if (safetyReview.safety_conclusion === 'RETURN_FOR_REVISION') {
      operations.push(operation(
        '/safety_stop_conditions',
        proposed.safety_stop_conditions,
        `出现或即将出现以下风险时立即停止操作、隔离现场并报告负责人：${safetyRequirement}`,
        '固化安全停止边界'
      ))
    }
  }

  if (safetyReview.safety_conclusion === 'RETURN_FOR_REVISION' && !proposed.safety_sensitive) {
    operations.push(operation('/safety_sensitive', false, true, '安全复审要求纳入安全敏感题'))
  }
  assert(operations.length > 0, `${candidate.question_id} has no semantic operations`)
  return operations
}

function patchReasonCodes(content, safety) {
  return [
    content.prompt_review === 'RETURN_FOR_REVISION' ? 'QUESTION_MEANING' : null,
    content.occupational_authenticity_review === 'RETURN_FOR_REVISION' || safety.technical_conclusion === 'RETURN_FOR_REVISION' ? 'OCCUPATIONAL_BOUNDARY' : null,
    content.answer_or_rubric_review === 'RETURN_FOR_REVISION' ? 'ANSWER_OR_SCORING' : null,
    safety.safety_conclusion === 'RETURN_FOR_REVISION' ? 'SAFETY_BOUNDARY' : null
  ].filter(Boolean)
}

const candidatesV2 = readJson(paths.candidatesV2)
const mergedGate = readJson(paths.mergedGate)
const contentResult = readJson(paths.contentResult)
const safetyResult = readJson(paths.safetyResult)
const deliveryLock = readJson(paths.deliveryLock)
const candidateById = indexBy(candidatesV2.questions)
const contentById = indexBy(contentResult.questions)
const safetyById = indexBy(safetyResult.questions)
const deliveryById = indexBy(deliveryLock.questions, 'current_question_id')
const returned = mergedGate.questions.filter((question) => question.rereview_gate_status === 'RETURN_FOR_REVISION')
const priorPatchSet = readJson(paths.patches)

function lockedInputHash(path) {
  if (refreshPatches) return hashFile(resolve(root, path))
  return priorPatchSet.sources?.find((source) => source.path === path)?.sha256 ?? hashFile(resolve(root, path))
}

const pureDelivery = []
const semanticReturns = []
for (const gate of returned) {
  const content = contentById.get(gate.question_id)
  const safety = safetyById.get(gate.question_id)
  const delivery = deliveryById.get(gate.question_id)
  assert(content && safety, `${gate.question_id} missing re-review source`)
  if (isPureDeliveryReturn(gate, content, safety, delivery)) pureDelivery.push({ gate, content, safety, delivery })
  else semanticReturns.push({ gate, content, safety, delivery })
}

assert(returned.length === 211, `Expected 211 returned questions, received ${returned.length}`)
assert(pureDelivery.length === 66, `Expected 66 delivery-only returns, received ${pureDelivery.length}`)
assert(semanticReturns.length === 145, `Expected 145 semantic returns, received ${semanticReturns.length}`)
assert(pureDelivery.filter(({ gate }) => gate.question_type === 'TRUE_FALSE').length === 56, 'Expected 56 delivery-only videos')
assert(pureDelivery.filter(({ gate }) => gate.question_type === 'DRAG').length === 6, 'Expected 6 delivery-only image drag questions')
assert(pureDelivery.filter(({ gate }) => gate.question_type === 'SINGLE_CHOICE').length === 4, 'Expected 4 delivery-only image choice questions')

function derivePatchSet() {
  const patches = semanticReturns.map(({ gate, content, safety }) => {
    const candidate = candidateById.get(gate.question_id)
    assert(candidate, `${gate.question_id} missing V2 candidate`)
    const operations = deriveOperations(candidate, content, safety)
    const oldSemanticHash = questionSemanticHash(candidate.proposed_question)
    for (const item of operations) {
      assert(JSON.stringify(jsonPointerGet(candidate.proposed_question, item.path)) === JSON.stringify(item.before), `${gate.question_id} patch before mismatch at ${item.path}`)
    }
    const requiredReviewTracks = [
      content.content_conclusion === 'RETURN_FOR_REVISION' ? 'CONTENT' : null,
      safety.safety_conclusion === 'RETURN_FOR_REVISION' || safety.technical_conclusion === 'RETURN_FOR_REVISION' ? 'SAFETY_TECHNICAL' : null
    ].filter(Boolean)
    const base = {
      patch_id: `patch_${gate.question_id.toLowerCase()}_to_v3`,
      base_question_id: gate.question_id,
      base_question_version: 2,
      base_candidate_record_hash: candidate.candidate_record_hash,
      old_semantic_hash: oldSemanticHash,
      reason_codes: patchReasonCodes(content, safety),
      required_review_tracks: requiredReviewTracks,
      source_requirement_refs: {
        content_result_id: contentResult.result_id,
        safety_technical_result_id: safetyResult.result_id
      },
      operations
    }
    return { ...base, patch_record_hash: hashRecord(base) }
  })
  const base = {
    schema_version: 'job-skill-shelver-298-revision-patches-v2',
    patch_set_id: 'job-skill-shelver-298-targeted-semantic-revision-patches-v2',
    status: 'LOCKED_INPUT_TO_V3_GENERATION',
    generated_at: generatedAt,
    sources: [rel.candidatesV2, rel.mergedGate, rel.contentResult, rel.safetyResult, rel.deliveryLock].map((path) => ({ path, sha256: lockedInputHash(path) })),
    summary: {
      returned_total: 211,
      semantic_patch_total: patches.length,
      preserved_v2_without_semantic_change_total: pureDelivery.length,
      by_type: Object.fromEntries(['SINGLE_CHOICE', 'TRUE_FALSE', 'DRAG', 'OFFLINE_OPERATION'].map((type) => [type, semanticReturns.filter(({ gate }) => gate.question_type === type).length])),
      review_routing: {
        content: patches.filter((patch) => patch.required_review_tracks.includes('CONTENT')).length,
        safety_technical: patches.filter((patch) => patch.required_review_tracks.includes('SAFETY_TECHNICAL')).length
      }
    },
    preserved_v2_without_semantic_change: pureDelivery.map(({ gate, delivery }) => ({
      question_id: gate.question_id,
      reason: gate.question_id === 'M2_DG_025_V2'
        ? 'REVIEW_MARKER_FALSE_POSITIVE_NO_SEMANTIC_CHANGE'
        : gate.question_type === 'TRUE_FALSE'
          ? 'LOCKED_VIDEO_ANSWER_AND_ASSET_BINDING_ONLY'
          : 'LOCKED_IMAGE_BINDING_ONLY',
      delivery_types: delivery?.delivery?.types ?? [],
      asset_ids: delivery?.delivery?.asset_ids ?? [],
      semantic_hash: delivery?.semantic_hash ?? questionSemanticHash(candidateById.get(gate.question_id).proposed_question)
    })),
    patches
  }
  return { ...base, patch_set_hash: hashRecord(base) }
}

const derivedPatchSet = derivePatchSet()
if (refreshPatches) writeFileSync(paths.patches, `${JSON.stringify(derivedPatchSet, null, 2)}\n`)
const patchSet = refreshPatches ? derivedPatchSet : priorPatchSet
const { patch_set_hash: patchSetHash, ...patchSetWithoutHash } = patchSet
assert(hashRecord(patchSetWithoutHash) === patchSetHash, 'Patch set hash mismatch')
assert(JSON.stringify(patchSet) === JSON.stringify(derivedPatchSet), 'Patch set drifted from current locked review inputs; run with --refresh-patches after reviewing the source change')

const v3Questions = patchSet.patches.map((patch) => {
  const previous = candidateById.get(patch.base_question_id)
  assert(previous.candidate_record_hash === patch.base_candidate_record_hash, `${patch.base_question_id} base candidate hash mismatch`)
  assert(questionSemanticHash(previous.proposed_question) === patch.old_semantic_hash, `${patch.base_question_id} old semantic hash mismatch`)
  const proposedQuestion = structuredClone(previous.proposed_question)
  for (const item of patch.operations) {
    assert(item.op === 'replace', `${patch.patch_id} unsupported operation ${item.op}`)
    assert(JSON.stringify(jsonPointerGet(proposedQuestion, item.path)) === JSON.stringify(item.before), `${patch.patch_id} stale before value at ${item.path}`)
    jsonPointerSet(proposedQuestion, item.path, item.value)
  }
  const newSemanticHash = questionSemanticHash(proposedQuestion)
  assert(newSemanticHash !== patch.old_semantic_hash, `${patch.patch_id} does not change question semantics`)
  const base = {
    question_id: patch.base_question_id.replace(/_V2$/, '_V3'),
    previous_question_id: patch.base_question_id,
    question_version: 3,
    source_question_id: previous.source_question_id,
    module: previous.module,
    question_type: previous.question_type,
    status: 'DRAFT_TARGETED_REREVIEW_REQUIRED',
    proposed_question: proposedQuestion,
    old_semantic_hash: patch.old_semantic_hash,
    new_semantic_hash: newSemanticHash,
    applied_patch_id: patch.patch_id,
    patch_record_hash: patch.patch_record_hash,
    required_review_tracks: patch.required_review_tracks,
    activation_authority: 'NONE'
  }
  return { ...base, candidate_record_hash: hashRecord(base) }
})

assert(new Set(v3Questions.map((question) => question.question_id)).size === 145, 'V3 IDs must be unique')
const candidateSetBase = {
  schema_version: 'job-skill-shelver-298-question-revision-candidates-v3',
  candidate_set_id: 'job-skill-shelver-298-targeted-question-revision-candidates-v3',
  status: 'DRAFT_TARGETED_REREVIEW_REQUIRED_NO_ACTIVATION_AUTHORITY',
  generated_at: generatedAt,
  patch_set: { path: rel.patches, patch_set_id: patchSet.patch_set_id, patch_set_hash: patchSet.patch_set_hash, sha256: hashFile(paths.patches) },
  semantic_hash_contract: questionSemanticHashContract,
  summary: {
    v3_total: v3Questions.length,
    preserved_v2_without_semantic_change_total: pureDelivery.length,
    content_rereview_total: v3Questions.filter((question) => question.required_review_tracks.includes('CONTENT')).length,
    safety_technical_rereview_total: v3Questions.filter((question) => question.required_review_tracks.includes('SAFETY_TECHNICAL')).length,
    by_type: patchSet.summary.by_type
  },
  authority: {
    releaseable: false,
    runtime_database_unchanged: true,
    activation_sql_generated: false,
    delivery_lock_unchanged: true
  },
  questions: v3Questions
}
const candidateSet = { ...candidateSetBase, candidate_set_hash: hashRecord(candidateSetBase) }

function resultSchema(track, count) {
  const contentTrack = track === 'CONTENT'
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `Job Skill Targeted V3 ${contentTrack ? 'Content' : 'Safety Technical'} Re-review Result`,
    type: 'object',
    additionalProperties: false,
    required: ['schema_version', 'package_id', 'candidate_set_hash', 'reviewer', 'submitted_at', 'summary', 'questions'],
    properties: {
      schema_version: { const: `job-skill-shelver-298-targeted-v3-${contentTrack ? 'content' : 'safety-technical'}-rereview-result-v1` },
      package_id: { const: `job-skill-shelver-298-targeted-v3-${contentTrack ? 'content' : 'safety-technical'}-rereview-packet-v1` },
      candidate_set_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
      reviewer: { type: 'string', const: contentTrack ? '陈晓青' : '赫东' },
      submitted_at: { type: 'string', format: 'date-time' },
      summary: { type: 'object', required: ['total', 'pass', 'return_for_revision'], properties: { total: { const: count }, pass: { type: 'integer', minimum: 0 }, return_for_revision: { type: 'integer', minimum: 0 } } },
      questions: {
        type: 'array', minItems: count, maxItems: count,
        items: {
          type: 'object', additionalProperties: false,
          required: ['question_id', 'previous_question_id', 'old_semantic_hash', 'new_semantic_hash', 'patch_id', 'conclusion', 'review_note'],
          properties: {
            question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+_V3$' },
            previous_question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+_V2$' },
            old_semantic_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
            new_semantic_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
            patch_id: { type: 'string', minLength: 1 },
            conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
            review_note: { type: 'string' }
          }
        }
      }
    }
  }
}

function packetHtml(track, reviewer) {
  const questions = v3Questions.filter((question) => question.required_review_tracks.includes(track))
  const packageId = `job-skill-shelver-298-targeted-v3-${track === 'CONTENT' ? 'content' : 'safety-technical'}-rereview-packet-v1`
  const packageData = { package_id: packageId, reviewer, track, candidate_set_hash: candidateSet.candidate_set_hash, questions }
  const cards = questions.map((question, index) => {
    const patch = patchSet.patches.find((item) => item.patch_id === question.applied_patch_id)
    return `<article class="question" data-id="${question.question_id}"><h2>${index + 1}. ${question.question_id}</h2><p><b>上一版：</b>${question.previous_question_id}</p><p><b>修订原因：</b>${patch.reason_codes.join(' / ')}</p><details><summary>查看结构化修改与新题</summary><pre>${escapeHtml(JSON.stringify({ operations: patch.operations, proposed_question: question.proposed_question }, null, 2))}</pre></details><fieldset><legend>复审结论 *</legend><label><input type="radio" name="${question.question_id}" value="PASS"> 通过</label><label><input type="radio" name="${question.question_id}" value="RETURN_FOR_REVISION"> 退回复修</label></fieldset><label>审核意见<textarea data-note="${question.question_id}" rows="3"></textarea></label></article>`
  }).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>定点V3复审包 - ${reviewer}</title><style>body{font-family:system-ui,sans-serif;margin:0;color:#17202a;background:#f4f6f7}header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ccd1d1;padding:16px;z-index:2}main{max-width:960px;margin:auto;padding:16px}.question{background:#fff;border:1px solid #d5dbdb;border-radius:6px;padding:18px;margin:0 0 14px}h1{font-size:22px;margin:0 0 6px}h2{font-size:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f8f9f9;padding:12px}fieldset{border:0;padding:10px 0;display:flex;gap:24px}textarea{box-sizing:border-box;width:100%;margin-top:6px}button{padding:9px 14px;margin-right:8px}.error{color:#a93226}</style></head><body><header><h1>${questions.length}道定点V3${track === 'CONTENT' ? '内容' : '安全技术'}复审</h1><div>审核人：${reviewer}。仅审核语义变化题，纯素材和工具绑定已排除。</div><button id="export">校验并导出JSON</button><span id="status"></span></header><main>${cards}</main><script id="package-data" type="application/json">${JSON.stringify(packageData)}</script><script>(()=>{const p=JSON.parse(document.getElementById('package-data').textContent);const key=p.package_id+':draft';const saved=JSON.parse(localStorage.getItem(key)||'{}');for(const q of p.questions){const v=saved[q.question_id];if(v?.conclusion)document.querySelector('input[name="'+q.question_id+'"][value="'+v.conclusion+'"]').checked=true;document.querySelector('[data-note="'+q.question_id+'"]').value=v?.review_note||''}function collect(){return p.questions.map(q=>({question_id:q.question_id,previous_question_id:q.previous_question_id,old_semantic_hash:q.old_semantic_hash,new_semantic_hash:q.new_semantic_hash,patch_id:q.applied_patch_id,conclusion:document.querySelector('input[name="'+q.question_id+'"]:checked')?.value||'',review_note:document.querySelector('[data-note="'+q.question_id+'"]').value.trim()}))}document.addEventListener('input',()=>localStorage.setItem(key,JSON.stringify(Object.fromEntries(collect().map(x=>[x.question_id,x])))));document.getElementById('export').onclick=()=>{const questions=collect();const missing=questions.filter(x=>!x.conclusion||(x.conclusion==='RETURN_FOR_REVISION'&&!x.review_note));const status=document.getElementById('status');if(missing.length){status.className='error';status.textContent=' 尚有'+missing.length+'题未完成';return}const pass=questions.filter(x=>x.conclusion==='PASS').length;const result={schema_version:'job-skill-shelver-298-targeted-v3-${track === 'CONTENT' ? 'content' : 'safety-technical'}-rereview-result-v1',package_id:p.package_id,candidate_set_hash:p.candidate_set_hash,reviewer:p.reviewer,submitted_at:new Date().toISOString(),summary:{total:questions.length,pass,return_for_revision:questions.length-pass},questions};const blob=new Blob([JSON.stringify(result,null,2)+'\\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=p.package_id+'-result.json';a.click();URL.revokeObjectURL(a.href);status.className='';status.textContent=' 已导出'};})();</script></body></html>`
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

const patchesSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Job Skill Shelver 298 Targeted Revision Patches V2', type: 'object',
  required: ['schema_version', 'patch_set_id', 'status', 'summary', 'preserved_v2_without_semantic_change', 'patches', 'patch_set_hash'],
  properties: {
    schema_version: { const: 'job-skill-shelver-298-revision-patches-v2' },
    patch_set_id: { type: 'string' }, status: { const: 'LOCKED_INPUT_TO_V3_GENERATION' }, summary: { type: 'object' },
    preserved_v2_without_semantic_change: { type: 'array', minItems: 66, maxItems: 66 },
    patches: { type: 'array', minItems: 145, maxItems: 145, items: { type: 'object', required: ['patch_id', 'base_question_id', 'old_semantic_hash', 'operations', 'patch_record_hash'] } },
    patch_set_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }
  }
}
const candidatesSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Job Skill Shelver 298 Targeted V3 Candidates', type: 'object',
  required: ['schema_version', 'candidate_set_id', 'status', 'summary', 'authority', 'questions', 'candidate_set_hash'],
  properties: {
    schema_version: { const: 'job-skill-shelver-298-question-revision-candidates-v3' },
    status: { const: 'DRAFT_TARGETED_REREVIEW_REQUIRED_NO_ACTIVATION_AUTHORITY' },
    questions: { type: 'array', minItems: 145, maxItems: 145, items: { type: 'object', required: ['question_id', 'previous_question_id', 'old_semantic_hash', 'new_semantic_hash', 'applied_patch_id', 'required_review_tracks'] } }
  }
}
const pendingGateBase = {
  schema_version: 'job-skill-shelver-298-targeted-v3-rereview-gate-v1', gate_id: 'job-skill-shelver-298-targeted-v3-rereview-gate-v1',
  status: 'PENDING_REVIEW', generated_at: generatedAt, candidate_set_hash: candidateSet.candidate_set_hash,
  summary: { total: 145, pending: 145, passed: 0, return_for_revision: 0, preserved_v2_without_semantic_change: 66 },
  releaseable: false,
  questions: v3Questions.map((question) => ({ question_id: question.question_id, old_semantic_hash: question.old_semantic_hash, new_semantic_hash: question.new_semantic_hash, required_review_tracks: question.required_review_tracks, status: 'PENDING' }))
}
const pendingGate = { ...pendingGateBase, gate_hash: hashRecord(pendingGateBase) }
const gateSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Job Skill Targeted V3 Pending Gate', type: 'object', required: ['schema_version', 'status', 'summary', 'releaseable', 'questions', 'gate_hash'], properties: { schema_version: { const: pendingGate.schema_version }, status: { const: 'PENDING_REVIEW' }, releaseable: { const: false }, questions: { type: 'array', minItems: 145, maxItems: 145 } } }

const outputs = new Map([
  [paths.patchesSchema, `${JSON.stringify(patchesSchema, null, 2)}\n`],
  [paths.candidatesSchema, `${JSON.stringify(candidatesSchema, null, 2)}\n`],
  [paths.candidatesV3, `${JSON.stringify(candidateSet, null, 2)}\n`],
  [paths.contentHtml, packetHtml('CONTENT', '陈晓青')],
  [paths.safetyHtml, packetHtml('SAFETY_TECHNICAL', '赫东')],
  [paths.contentResultSchema, `${JSON.stringify(resultSchema('CONTENT', candidateSet.summary.content_rereview_total), null, 2)}\n`],
  [paths.safetyResultSchema, `${JSON.stringify(resultSchema('SAFETY_TECHNICAL', candidateSet.summary.safety_technical_rereview_total), null, 2)}\n`],
  [paths.gateSchema, `${JSON.stringify(gateSchema, null, 2)}\n`],
  [paths.gate, `${JSON.stringify(pendingGate, null, 2)}\n`]
])

for (const [path, value] of outputs) {
  if (checkOnly) assert(readFileSync(path, 'utf8') === value, `${path.slice(root.length + 1)} is stale`)
  else writeFileSync(path, value)
}

console.log(`Targeted V3 contract ${checkOnly ? 'verified' : 'built'}: 145 semantic revisions, 66 V2 questions preserved without semantic change, ${candidateSet.summary.content_rereview_total} content reviews, ${candidateSet.summary.safety_technical_rereview_total} safety/technical reviews.`)
