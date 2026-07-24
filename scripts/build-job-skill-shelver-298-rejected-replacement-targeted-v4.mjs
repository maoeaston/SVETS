import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { hashFile, hashRecord, questionSemanticHash, questionSemanticHashContract } from './lib/job-skill-contract-hash.mjs'

const rootArg = process.argv.find((argument) => argument.startsWith('--root='))
const root = rootArg ? resolve(rootArg.slice('--root='.length)) : resolve(import.meta.dirname, '..')
const checkOnly = process.argv.includes('--check')
const feature = (name) => resolve(root, 'doc/features', name)
const paths = {
  candidatesV3: feature('job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.json'),
  mergedV3: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-rereview-merged-gate-v1.json'),
  candidatesV4: feature('job-skill-shelver-298-rejected-replacement-targeted-candidates-v4.json'),
  markdown: feature('job-skill-shelver-298-rejected-replacement-targeted-candidates-v4.md'),
  gate: feature('job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-gate-v1.json'),
  contentPacket: feature('job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-packet-chen-xiaoqing-v1.html'),
  contentSchema: feature('job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-result-v1.schema.json')
}
const generatedAt = '2026-07-22T17:00:00+08:00'
const returnedV3Ids = ['M1_OP_042_V3', 'M3_OP_056_V3', 'M4_OP_045_V3', 'M4_OP_046_V3', 'M4_OP_048_V3', 'M5_OP_048_V3']
const cumulativePassIds = ['M4_OP_043_V2', 'M4_OP_044_V2', 'M1_OB_048_V3', 'M4_OP_047_V3', 'M5_OP_055_V3']
const rel = (path) => path.slice(root.length + 1)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

function exactSet(actual, expected, label) {
  assert(actual.length === expected.length, `${label} count mismatch`)
  assert(new Set(actual).size === actual.length, `${label} contains duplicate IDs`)
  assert([...actual].sort().join('\n') === [...expected].sort().join('\n'), `${label} coverage mismatch`)
}

function indexBy(records, label) {
  const map = new Map()
  for (const record of records) {
    assert(record && typeof record.question_id === 'string', `${label} contains invalid record`)
    assert(!map.has(record.question_id), `${label} duplicate ${record.question_id}`)
    map.set(record.question_id, record)
  }
  return map
}

function score(score0, score1, score2) {
  return { score_0: score0, score_1: score1, score_2: score2 }
}

const specs = {
  M1_OP_042_V3: {
    scoring: score(
      '未达到1分最低条件，或少于6件处于唯一正确货位，或任一已完成SKU出现新批次在前、旧批次在后，或中断后未按标记接续或大范围重做，或接受指向性提示，或累计2次及以上提示。已完成SKU指同一SKU的新旧两件均已摆放。',
      '0次提示并满足以下任一情况：①6至7件处于唯一正确货位，所有已完成SKU均为旧批次在前、新批次在后，且中断标记和接续正确；②8件货位、4个SKU先进先出及中断标记和接续均正确，但遗漏最终复查。已完成SKU指同一SKU的新旧两件均已摆放。恰好1次非指向性提示后完成全部要求也计1分。',
      '8件全部处于唯一正确货位，4个SKU均为旧批次在前、新批次在后，正确完成中断标记、接续和最终复查，且0次提示。'
    ),
    changedFields: ['scoring_rule']
  },
  M3_OP_056_V3: {
    scoring: score(
      '未达到1分最低条件，或正确记录少于6件商品的到期日，或最早到期2件均未正确前置，或错误前置其他商品，或检查后未恢复正面朝外且价签可见，或接受指向性提示，或累计2次及以上提示。',
      '0次提示，正确记录至少6件商品的编号和到期日，最早到期2件中至少1件正确前置，未错误前置其他商品，并恢复正面朝外且价签可见，但未达到2分全部要求；或恰好1次非指向性提示后完成全部要求。',
      '独立正确记录8件商品的编号和到期日，最早到期2件正确前置，其余商品按日期顺序后置，恢复正面朝外且价签可见，且0次提示。'
    ),
    changedFields: ['scoring_rule']
  },
  M4_OP_045_V3: {
    scoring: score(
      '未达到1分最低条件，或未找到唯一错区商品、移动了任一正确商品、将错区商品归入错误区域，或接受指向性提示，或累计2次及以上提示。',
      '独立正确识别唯一错区商品且未误动其余8件，但未完成正确归位，或正确归位但遗漏最终复查；或恰好1次非指向性提示后完成全部要求。',
      '独立完成唯一错区商品的识别、正确归位和最终复查，未误动其余8件，且0次提示。'
    ),
    changedFields: ['scoring_rule']
  },
  M4_OP_046_V3: {
    prompt: '核对补货清单与6件轻质商品。6件实物中有且仅有1件商品的条码与补货清单不符，其余5件的品名、规格和条码均与清单一致。请找出该商品，停止其上架，贴上问题标识并报告负责人。',
    materials: '6件轻质商品、补货清单1份；其中1件使用固定条码不符标签，其余5件的品名、规格和条码均与清单一致；问题标识贴、负责人角色牌、唯一答案卡。',
    outcome: '逐件核对商品条码与补货清单；指出唯一条码不符商品；停止该商品上架；贴上问题标识并报告负责人。',
    assessmentPoint: '补货清单与实物条码差错核对和上报',
    rubric: ['逐件核对商品条码与补货清单', '指出唯一条码不符商品', '停止不符商品上架', '贴上问题标识并报告负责人'],
    boundary: '清单存在多处差错、实物数量异常、任一条码标签无法识别、其余5件商品与清单不一致或唯一答案无法成立时暂停计分，由评估员复位。',
    scoring: score(
      '未达到1分最低条件，或未发现唯一条码不符商品、指出错误对象、将不符商品上架、同时标记正常商品，或接受指向性提示，或累计2次及以上提示。',
      '独立发现唯一条码不符商品并停止其上架，但遗漏贴问题标识或报告负责人中的1项；或恰好1次非指向性提示后完成全部要求。',
      '独立完成逐件核对、正确识别、停止不符商品上架、贴问题标识和上报，且0次提示。'
    ),
    changedFields: ['prompt', 'offline_tool_brief', 'assessment_point', 'rubric_criteria', 'scoring_rule', 'note']
  },
  M4_OP_048_V3: {
    scoring: score(
      '未达到1分最低条件，或少于7件合格品进入唯一正确货位，或仿真异常品被上架或未进入问题暂存区，或中断后未按标记接续或大范围重做，或接受指向性提示，或累计2次及以上提示。',
      '0次提示并满足以下任一情况：①7至8件合格品进入唯一正确货位，1件仿真异常品进入问题暂存区，且中断标记和接续正确；②9件合格品和1件仿真异常品均处置正确，中断标记和接续正确，但遗漏最终复查。恰好1次非指向性提示后完成全部要求也计1分。',
      '9件合格品全部进入唯一正确货位，1件仿真异常品进入问题暂存区，正确完成中断标记、接续和最终复查，且0次提示。'
    ),
    changedFields: ['scoring_rule']
  },
  M5_OP_048_V3: {
    outcome: '停止推车或搬运；提醒人员绕行并放置警示；目视检查并向评估员口头确认材料无尖锐、污染或重压风险；安全移除全部4件散落物并分类；复查通道完全畅通后才恢复通行。前述停止作业、警示隔离、风险确认、安全移除和复查后恢复均为关键安全动作，分类准确性为非关键评分项。',
    rubric: [
      '关键安全动作：停止推车或搬运',
      '关键安全动作：提醒人员绕行并放置警示',
      '关键安全动作：目视检查并向评估员口头确认材料无尖锐、污染或重压风险',
      '关键安全动作：安全移除全部4件散落物；非关键评分项：按纸箱和塑料膜正确分类',
      '关键安全动作：复查通道完全畅通后才恢复通行'
    ],
    scoring: score(
      '未达到1分最低条件，或任一关键安全动作缺失，包括未停止推车或搬运、未提醒绕行并放置警示、未目视检查并口头确认尖锐/污染/重压风险、任一散落物未安全移出通道、未经复查恢复通行；或出现2件及以上分类错误、用脚踢或抛掷材料、接受指向性提示、累计2次及以上提示。',
      '0次提示，全部关键安全动作完成且保持警示，4件散落物均安全移出通道，但恰好1件分类错误；或恰好1次非指向性提示后完成全部要求。',
      '独立完成全部5项关键安全动作，4件散落物全部正确分类，且0次提示。'
    ),
    changedFields: ['rubric_criteria', 'scoring_rule']
  }
}

for (const path of [paths.candidatesV3, paths.mergedV3]) assert(existsSync(path), `missing source: ${rel(path)}`)
const candidatesV3 = readJson(paths.candidatesV3)
const mergedV3 = readJson(paths.mergedV3)
const candidateById = indexBy(candidatesV3.questions, 'V3 candidates')
const mergedById = indexBy(mergedV3.questions, 'V3 merged gate')
exactSet(Object.keys(specs), returnedV3Ids, 'V4 revision spec')
exactSet(mergedV3.questions.filter((item) => item.status === 'RETURN_FOR_REVISION').map((item) => item.question_id), returnedV3Ids, 'V3 merged returns')
exactSet(mergedV3.cumulative_passed_references.map((item) => item.question_id), cumulativePassIds, 'cumulative passed references')

const questionsV4 = returnedV3Ids.map((previousId) => {
  const previous = candidateById.get(previousId)
  const review = mergedById.get(previousId)
  const spec = specs[previousId]
  assert(previous && review, `${previousId} source evidence missing`)
  assert(previous.candidate_record_hash === review.candidate_record_hash, `${previousId} candidate hash mismatch`)
  assert(previous.new_semantic_hash === review.semantic_hash, `${previousId} semantic hash mismatch`)
  assert(review.status === 'RETURN_FOR_REVISION', `${previousId} must be returned`)
  exactSet(review.failed_review_tracks, ['CONTENT'], `${previousId} failed tracks`)
  assert(review.review_results.content.status === 'RETURN_FOR_REVISION', `${previousId} content must be returned`)
  assert(review.review_results.safety_technical.status === 'PASS', `${previousId} safety technical pass missing`)
  assert(/^sha256:[a-f0-9]{64}$/.test(review.review_results.safety_technical.source_record_hash), `${previousId} safety technical source hash invalid`)

  const questionId = previousId.replace(/_V3$/, '_V4')
  const plan = structuredClone(previous.structured_replacement_plan)
  plan.question_id = questionId
  if (spec.prompt) plan.prompt = spec.prompt
  if (spec.materials) plan.materials = spec.materials
  if (spec.outcome) plan.unique_outcome = spec.outcome
  if (spec.boundary) plan.boundary = spec.boundary
  plan.scoring_thresholds = spec.scoring

  const proposedQuestion = structuredClone(previous.proposed_question)
  if (spec.prompt) proposedQuestion.content.prompt = spec.prompt
  if (spec.materials) proposedQuestion.content.offline_tool_brief = spec.materials
  if (spec.assessmentPoint) proposedQuestion.content.assessment_point = spec.assessmentPoint
  if (spec.rubric) proposedQuestion.content.rubric_criteria = spec.rubric.map((description, index) => ({ criterion_id: `r${index + 1}`, description }))
  if (spec.boundary) {
    proposedQuestion.content.note = `${plan.boundary_label}：${spec.boundary}`
    proposedQuestion.safety_stop_conditions = proposedQuestion.safety_sensitive ? `${plan.boundary_label}：${spec.boundary}` : null
  }
  proposedQuestion.content.professional_review = { required: true, status: 'PENDING', tracks: ['CONTENT'] }
  proposedQuestion.scoring_rule = {
    scoring_type: 'RUBRIC_BASED',
    max_score: 2,
    score_0_description: `0分：${spec.scoring.score_0}`,
    score_1_description: `1分：${spec.scoring.score_1}`,
    score_2_description: `2分：${spec.scoring.score_2}`
  }
  const newSemanticHash = questionSemanticHash(proposedQuestion)
  assert(newSemanticHash !== previous.new_semantic_hash, `${questionId} semantic hash must change from V3`)
  const base = {
    question_id: questionId,
    previous_question_id: previousId,
    source_question_id: previous.source_question_id,
    question_version: 4,
    module: previous.module,
    question_type: previous.question_type,
    status: 'DRAFT_TARGETED_CONTENT_REREVIEW_REQUIRED',
    replacement_relationship: {
      rejected_original_remains_rejected: true,
      previous_v3_not_activated: true,
      supersedes_original: false
    },
    structured_replacement_plan: plan,
    proposed_question: proposedQuestion,
    revision_trace: {
      source_merged_record_hash: review.merged_record_hash,
      failed_review_tracks: ['CONTENT'],
      carried_forward_review_passes: [{
        track: 'SAFETY_TECHNICAL',
        status: 'PASS',
        source_record_hash: review.review_results.safety_technical.source_record_hash
      }],
      content_review_note: review.review_results.content.review_fields.content_note,
      content_required_revision: review.review_results.content.review_fields.required_revision,
      changed_fields: spec.changedFields
    },
    old_semantic_hash: previous.new_semantic_hash,
    new_semantic_hash: newSemanticHash,
    source_candidate_record_hash: previous.candidate_record_hash,
    required_review_tracks: ['CONTENT'],
    activation_authority: 'NONE'
  }
  return { ...base, candidate_record_hash: hashRecord(base) }
}).sort((left, right) => left.question_id.localeCompare(right.question_id))

const cumulativePassedReferences = mergedV3.cumulative_passed_references.map((item) => ({
  question_id: item.question_id,
  version: item.version,
  semantic_hash: item.semantic_hash,
  candidate_record_hash: item.candidate_record_hash,
  activation_authority: 'NONE',
  treatment: 'PRESERVE_PASSED_REVIEW_ONLY_REFERENCE_NO_V4_NO_ACTIVATION'
}))

assert(questionsV4.length === 6, 'V4 candidate count must be 6')
assert(questionsV4.every((item) => item.required_review_tracks.join(',') === 'CONTENT'), 'V4 scope must be content only')
assert(cumulativePassedReferences.length === 5, 'cumulative passed reference count must be 5')

const candidateSetBody = {
  schema_version: 'job-skill-shelver-298-rejected-replacement-targeted-candidates-v4',
  candidate_set_id: 'job-skill-shelver-298-rejected-replacement-targeted-candidates-v4',
  status: 'DRAFT_TARGETED_CONTENT_REREVIEW_REQUIRED_NO_ACTIVATION_AUTHORITY',
  generated_at: generatedAt,
  sources: [paths.candidatesV3, paths.mergedV3].map((path) => ({ path: rel(path), sha256: hashFile(path) })),
  semantic_hash_contract: questionSemanticHashContract,
  summary: {
    replacement_review_total: 11,
    cumulative_passed_references_unchanged: 5,
    v3_returned_for_content_revision: 6,
    v4_candidates: 6,
    content_rereview_required: 6,
    safety_technical_rereview_required: 0,
    by_module: Object.fromEntries(['M1', 'M3', 'M4', 'M5'].map((module) => [module, questionsV4.filter((item) => item.module === module).length]))
  },
  authority: {
    activation_authority_granted: false,
    can_activate_questions: false,
    changes_current_authority: false,
    existing_287_unchanged: true,
    rejected_originals_11_unchanged: true,
    runtime_database_unchanged: true,
    activation_sql_generated: false,
    delivery_lock_unchanged: true
  },
  cumulative_passed_references: cumulativePassedReferences,
  questions: questionsV4
}
const candidateSet = { ...candidateSetBody, candidate_set_hash: hashRecord(candidateSetBody) }

const gateBody = {
  schema_version: 'job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-gate-v1',
  gate_id: 'job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-gate-v1',
  status: 'PENDING_TARGETED_V4_CONTENT_REREVIEW_NO_ACTIVATION_AUTHORITY',
  generated_at: generatedAt,
  candidate_set: { path: rel(paths.candidatesV4), candidate_set_id: candidateSet.candidate_set_id, candidate_set_hash: candidateSet.candidate_set_hash },
  review_routing: {
    content: questionsV4.map((item) => item.question_id),
    safety_technical: [],
    carried_forward_safety_technical_passes: questionsV4.map((item) => ({
      question_id: item.question_id,
      ...item.revision_trace.carried_forward_review_passes[0]
    }))
  },
  cumulative_passed_references: cumulativePassedReferences,
  merge_rule: 'Each V4 candidate must pass content rereview. Safety and technical passes remain carried by source record hash. No review result grants activation authority.',
  summary: { total_v4: 6, pending_v4: 6, content_pending: 6, safety_technical_pending: 0, cumulative_passed_reference_only: 5 },
  boundaries: {
    activation_authority_granted: false,
    can_activate_questions: false,
    existing_287_unchanged: true,
    rejected_originals_11_unchanged: true,
    runtime_database_unchanged: true,
    activation_sql_not_generated: true,
    delivery_lock_unchanged: true
  }
}
const gate = { ...gateBody, gate_hash: hashRecord(gateBody) }

function zhTypography(value) {
  return value
    .replace(/([\p{Script=Han}])([A-Za-z0-9])/gu, '$1 $2')
    .replace(/([A-Za-z0-9])([\p{Script=Han}])/gu, '$1 $2')
}

function markdown() {
  const sections = questionsV4.map((item, index) => {
    const plan = item.structured_replacement_plan
    return `## ${index + 1}. ${item.question_id}\n\n- 上一版：\`${item.previous_question_id}\`\n- 本轮复审轨道：CONTENT\n- 携带通过轨道：SAFETY_TECHNICAL（绑定来源审核 hash）\n- 激活权：\`NONE\`\n- 新 semantic hash：\`${item.new_semantic_hash}\`\n\n**上轮内容退回要求**\n\n${item.revision_trace.content_required_revision}\n\n**题干**\n\n${plan.prompt}\n\n**现场材料**\n\n${plan.materials}\n\n**唯一达标行为或结果**\n\n${plan.unique_outcome}\n\n**评分**\n\n- 2分：${plan.scoring_thresholds.score_2}\n- 1分：${plan.scoring_thresholds.score_1}\n- 0分：${plan.scoring_thresholds.score_0}\n\n**异常或安全边界**\n\n${plan.boundary_label}：${plan.boundary}\n\n**定点修订字段**\n\n${item.revision_trace.changed_fields.join('、')}\n`
  })
  return zhTypography(`# 6道内容退回题的V4定点修订候选\n\n- 当前状态：6道V4均为待内容复审候选，不进入运行题库。\n- 复审范围：仅陈晓青内容复审6道；赫东已通过的安全技术记录按来源 hash 携带，不生成新的安全技术复审包。\n- 累计保留：此前5道审核通过题仅保留引用，不生成V4。\n- 权限边界：所有候选均无激活权，原11道V1继续淘汰，现有287道题、数据库、激活SQL和delivery lock均未修改。\n\n${sections.join('\n---\n\n')}\n`)
}

function scriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

function packageData() {
  return {
    package_id: 'job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-packet-chen-xiaoqing-v1',
    package_version: 1,
    result_schema_version: 'job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-result-v1',
    reviewer: { name: '陈晓青', track: 'CONTENT_REREVIEW', role: '内容定点复审' },
    source: {
      candidate_set_id: candidateSet.candidate_set_id,
      candidate_set_hash: candidateSet.candidate_set_hash,
      candidate_set_file: rel(paths.candidatesV4),
      generated_at: generatedAt,
      scoped_total: questionsV4.length,
      cumulative_passed_reference_total: cumulativePassedReferences.length
    },
    authority: {
      activation_authority_granted: false,
      can_activate_questions: false,
      runtime_database_change_allowed: false,
      activation_sql_generated: false,
      existing_287_unchanged: true,
      rejected_originals_11_unchanged: true,
      cumulative_passed_references_unchanged: true
    },
    questions: questionsV4.map((item) => ({
      question_id: item.question_id,
      previous_question_id: item.previous_question_id,
      source_question_id: item.source_question_id,
      activation_authority: item.activation_authority,
      candidate_record_hash: item.candidate_record_hash,
      old_semantic_hash: item.old_semantic_hash,
      new_semantic_hash: item.new_semantic_hash,
      required_review_tracks: item.required_review_tracks,
      carried_forward_review_passes: item.revision_trace.carried_forward_review_passes,
      prior_review_issue: item.revision_trace.content_review_note,
      required_revision: item.revision_trace.content_required_revision,
      changed_fields: item.revision_trace.changed_fields,
      structured_replacement_plan: item.structured_replacement_plan,
      proposed_question: item.proposed_question
    }))
  }
}

function packetHtml() {
  const data = packageData()
  const fields = [
    ['content_conclusion', '内容结论', ['PASS', 'RETURN_FOR_REVISION']],
    ['occupational_authenticity', '岗位真实性', ['PASS', 'RETURN_FOR_REVISION']],
    ['prompt_and_boundary', '题干与边界', ['PASS', 'RETURN_FOR_REVISION']],
    ['rubric_observability', '评分可观察性', ['PASS', 'RETURN_FOR_REVISION']],
    ['material_feasibility', '材料可执行性', ['PASS', 'RETURN_FOR_REVISION']]
  ]
  return String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>6道内容退回题 V4 定点复审包</title><style>
:root{color-scheme:light;--ink:#17221b;--muted:#657167;--line:#cfd9d1;--paper:#f6f4ee;--card:#fff;--accent:#315f46;--warn:#8b3e2f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.65 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}.wrap{max-width:1120px;margin:auto;padding:28px 20px 80px}header{padding:28px;border:1px solid var(--line);background:#edf3ee;border-radius:16px}h1{margin:0 0 6px;font-size:30px}h2{margin:0;font-size:21px}p{margin:7px 0}.muted{color:var(--muted)}.lock{margin-top:16px;padding:12px 14px;border-left:4px solid var(--warn);background:#fff5f1;color:#622b21}.card{margin-top:20px;padding:22px;border:1px solid var(--line);background:var(--card);border-radius:14px;box-shadow:0 4px 18px #24362a0c}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.block{padding:12px;background:#f7faf7;border-radius:9px;white-space:pre-wrap}.full{grid-column:1/-1}label{display:block;font-weight:700;margin:14px 0 5px}select,textarea{width:100%;border:1px solid #aebdb1;border-radius:8px;padding:9px;background:#fff;font:inherit}textarea{min-height:88px;resize:vertical}.actions{position:sticky;bottom:0;margin-top:24px;padding:14px;border:1px solid var(--line);background:#ffffffee;backdrop-filter:blur(8px);border-radius:12px;display:flex;gap:12px;align-items:center}button{border:0;border-radius:8px;padding:10px 16px;background:var(--accent);color:#fff;font-weight:700;cursor:pointer}.status{color:var(--muted)}code{font-size:12px;word-break:break-all}@media(max-width:720px){.grid{grid-template-columns:1fr}.wrap{padding:14px 10px 70px}header,.card{padding:16px}}
</style></head><body><main class="wrap"><header><h1>6道内容退回题 V4 定点复审包</h1><p>陈晓青 · 仅含需内容复审的6道V4</p><p class="muted">逐题填写，页面自动保存在当前浏览器。提交按钮只导出JSON，不激活题目，不修改策略，不覆盖历史记录。</p><div class="lock">权限边界：本包及导出的JSON均无激活权。6道V4仍是待内容复审候选；此前5道通过题仅保留引用；现有287道运行题不变。赫东已通过记录按来源hash携带，本包不要求安全技术复审。</div></header><section id="cards"></section><div class="actions"><button id="export" type="button">校验并导出JSON</button><span id="status" class="status">尚未导出</span></div></main>
<script id="package-data" type="application/json">${scriptJson(data)}</script>
<script>(()=>{const pkg=JSON.parse(document.getElementById('package-data').textContent);const fields=${scriptJson(fields)};const key='svets-review:'+pkg.package_id;const saved=JSON.parse(localStorage.getItem(key)||'{}');const cards=document.getElementById('cards');const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const select=(qid,name,label,values)=>'<label>'+esc(label)+'</label><select data-qid="'+esc(qid)+'" data-field="'+esc(name)+'" required><option value="">请选择</option>'+values.map(v=>'<option value="'+v+'">'+v+'</option>').join('')+'</select>';for(const q of pkg.questions){const p=q.structured_replacement_plan;const div=document.createElement('article');div.className='card';div.innerHTML='<h2>'+esc(q.question_id)+'</h2><p class="muted">上一版 '+esc(q.previous_question_id)+' · 复审轨道 CONTENT · 激活权 NONE</p><div class="grid"><div class="block full"><b>上轮退回意见</b>\n'+esc(q.prior_review_issue)+'</div><div class="block full"><b>最低修订要求</b>\n'+esc(q.required_revision)+'</div><div class="block full"><b>V4定点修改字段</b>\n'+esc(q.changed_fields.join('、'))+'</div><div class="block full"><b>题干</b>\n'+esc(p.prompt)+'</div><div class="block full"><b>现场材料</b>\n'+esc(p.materials)+'</div><div class="block"><b>唯一结果</b>\n'+esc(p.unique_outcome)+'</div><div class="block"><b>边界</b>\n'+esc(p.boundary_label+'：'+p.boundary)+'</div><div class="block full"><b>评分</b>\n2分：'+esc(p.scoring_thresholds.score_2)+'\n1分：'+esc(p.scoring_thresholds.score_1)+'\n0分：'+esc(p.scoring_thresholds.score_0)+'</div></div>'+fields.map(f=>select(q.question_id,f[0],f[1],f[2])).join('')+'<label>内容复审说明</label><textarea data-qid="'+esc(q.question_id)+'" data-field="content_note" required></textarea><label>仍需修订（通过时填“无”）</label><textarea data-qid="'+esc(q.question_id)+'" data-field="required_revision" required></textarea>';cards.appendChild(div)}for(const el of document.querySelectorAll('[data-qid]')){const v=saved[el.dataset.qid]?.[el.dataset.field];if(v)el.value=v;el.addEventListener('input',save);el.addEventListener('change',save)}function collect(){const out={};for(const el of document.querySelectorAll('[data-qid]')){(out[el.dataset.qid]??={})[el.dataset.field]=el.value.trim()}return out}function save(){localStorage.setItem(key,JSON.stringify(collect()));document.getElementById('status').textContent='已自动保存'}document.getElementById('export').addEventListener('click',()=>{const values=collect();for(const q of pkg.questions){for(const [name] of fields){if(!values[q.question_id]?.[name])return alert(q.question_id+' 尚未填写 '+name)}for(const name of ['content_note','required_revision']){if(!values[q.question_id]?.[name])return alert(q.question_id+' 尚未填写 '+name)}}const questions=pkg.questions.map(q=>{const review_fields=values[q.question_id];const failed=['content_conclusion','occupational_authenticity','prompt_and_boundary','rubric_observability','material_feasibility'].some(name=>review_fields[name]==='RETURN_FOR_REVISION');return{question_id:q.question_id,previous_question_id:q.previous_question_id,new_semantic_hash:q.new_semantic_hash,candidate_record_hash:q.candidate_record_hash,activation_authority:'NONE',conclusion:failed?'RETURN_FOR_REVISION':'PASS',review_fields}});const pass=questions.filter(q=>q.conclusion==='PASS').length;const result={schema_version:pkg.result_schema_version,package_id:pkg.package_id,candidate_set_id:pkg.source.candidate_set_id,candidate_set_hash:pkg.source.candidate_set_hash,reviewer:pkg.reviewer,submitted_at:new Date().toISOString(),summary:{total:questions.length,pass,return_for_revision:questions.length-pass},authority:{activation_authority_granted:false,can_activate_questions:false,runtime_database_change_allowed:false,activation_sql_generated:false},questions};const blob=new Blob([JSON.stringify(result,null,2)+'\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=pkg.package_id+'-result.json';a.click();URL.revokeObjectURL(a.href);document.getElementById('status').textContent='已导出JSON；未授予激活权'})})();</script></body></html>
`
}

function resultSchema() {
  const reviewProperties = {
    content_conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
    occupational_authenticity: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
    prompt_and_boundary: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
    rubric_observability: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
    material_feasibility: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
    content_note: { type: 'string', minLength: 1 },
    required_revision: { type: 'string', minLength: 1 }
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-result-v1',
    type: 'object',
    additionalProperties: false,
    required: ['schema_version', 'package_id', 'candidate_set_id', 'candidate_set_hash', 'reviewer', 'submitted_at', 'summary', 'authority', 'questions'],
    properties: {
      schema_version: { const: 'job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-result-v1' },
      package_id: { const: 'job-skill-shelver-298-rejected-replacement-targeted-v4-content-rereview-packet-chen-xiaoqing-v1' },
      candidate_set_id: { const: candidateSet.candidate_set_id },
      candidate_set_hash: { const: candidateSet.candidate_set_hash },
      reviewer: {
        type: 'object', additionalProperties: false, required: ['name', 'track', 'role'],
        properties: { name: { const: '陈晓青' }, track: { const: 'CONTENT_REREVIEW' }, role: { const: '内容定点复审' } }
      },
      submitted_at: { type: 'string', format: 'date-time' },
      summary: {
        type: 'object', additionalProperties: false, required: ['total', 'pass', 'return_for_revision'],
        properties: { total: { const: questionsV4.length }, pass: { type: 'integer', minimum: 0, maximum: questionsV4.length }, return_for_revision: { type: 'integer', minimum: 0, maximum: questionsV4.length } }
      },
      authority: {
        type: 'object', additionalProperties: false, required: ['activation_authority_granted', 'can_activate_questions', 'runtime_database_change_allowed', 'activation_sql_generated'],
        properties: { activation_authority_granted: { const: false }, can_activate_questions: { const: false }, runtime_database_change_allowed: { const: false }, activation_sql_generated: { const: false } }
      },
      questions: {
        type: 'array', minItems: questionsV4.length, maxItems: questionsV4.length,
        items: {
          type: 'object', additionalProperties: false,
          required: ['question_id', 'previous_question_id', 'new_semantic_hash', 'candidate_record_hash', 'activation_authority', 'conclusion', 'review_fields'],
          properties: {
            question_id: { enum: questionsV4.map((item) => item.question_id) },
            previous_question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+_V3$' },
            new_semantic_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
            candidate_record_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
            activation_authority: { const: 'NONE' },
            conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
            review_fields: { type: 'object', additionalProperties: false, required: Object.keys(reviewProperties), properties: reviewProperties }
          }
        }
      }
    }
  }
}

const outputs = [
  [paths.candidatesV4, `${JSON.stringify(candidateSet, null, 2)}\n`],
  [paths.markdown, markdown()],
  [paths.gate, `${JSON.stringify(gate, null, 2)}\n`],
  [paths.contentPacket, packetHtml()],
  [paths.contentSchema, `${JSON.stringify(resultSchema(), null, 2)}\n`]
]
for (const [path, expected] of outputs) {
  if (checkOnly) {
    assert(existsSync(path), `missing generated artifact: ${rel(path)}`)
    assert(readFileSync(path, 'utf8') === expected, `generated artifact drift: ${rel(path)}`)
  } else writeFileSync(path, expected)
}

console.log(`Rejected replacement targeted V4 ${checkOnly ? 'verified' : 'built'}: 6 content candidates, safety-technical rereview 0, cumulative passed references 5, activation authority NONE.`)
