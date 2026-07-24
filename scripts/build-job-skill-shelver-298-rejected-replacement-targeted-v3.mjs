import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { hashFile, hashRecord, questionSemanticHash, questionSemanticHashContract } from './lib/job-skill-contract-hash.mjs'

const rootArg = process.argv.find((argument) => argument.startsWith('--root='))
const root = rootArg ? resolve(rootArg.slice('--root='.length)) : resolve(import.meta.dirname, '..')
const checkOnly = process.argv.includes('--check')
const feature = (name) => resolve(root, 'doc/features', name)
const paths = {
  candidatesV2: feature('job-skill-shelver-298-rejected-replacement-candidates-v2.json'),
  mergedGate: feature('job-skill-shelver-298-rejected-replacement-review-merged-gate-v1.json'),
  contentResult: feature('job-skill-shelver-298-rejected-replacement-content-confirmation-result-chen-xiaoqing-2026-07-22.json'),
  safetyResult: feature('job-skill-shelver-298-rejected-replacement-safety-technical-review-result-he-dong-2026-07-22.json'),
  candidatesV3: feature('job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.json'),
  markdown: feature('job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.md'),
  gate: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-review-gate-v1.json'),
  contentPacket: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-packet-chen-xiaoqing-v1.html'),
  safetyPacket: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-packet-he-dong-v1.html'),
  contentSchema: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-result-v1.schema.json'),
  safetySchema: feature('job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-result-v1.schema.json')
}
const generatedAt = '2026-07-22T15:00:00+08:00'
const returnedV2Ids = [
  'M1_OB_048_V2', 'M1_OP_042_V2', 'M3_OP_056_V2', 'M4_OP_045_V2', 'M4_OP_046_V2',
  'M4_OP_047_V2', 'M4_OP_048_V2', 'M5_OP_048_V2', 'M5_OP_055_V2'
]
const passedV2Ids = ['M4_OP_043_V2', 'M4_OP_044_V2']
const rel = (path) => path.slice(root.length + 1)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

function indexBy(records, label) {
  const map = new Map()
  for (const record of records) {
    assert(record && typeof record.question_id === 'string', `${label} contains invalid record`)
    assert(!map.has(record.question_id), `${label} duplicate ${record.question_id}`)
    map.set(record.question_id, record)
  }
  return map
}

function exactSet(actual, expected, label) {
  assert(actual.length === expected.length, `${label} count mismatch`)
  assert(new Set(actual).size === actual.length, `${label} contains duplicate IDs`)
  assert([...actual].sort().join('\n') === [...expected].sort().join('\n'), `${label} coverage mismatch`)
}

function score(score0, score1, score2) {
  return { score_0: score0, score_1: score1, score_2: score2 }
}

const specs = {
  M1_OB_048_V2: {
    assessmentPoint: '不明液体发现、隔离、上报与恢复条件确认',
    abilityTags: ['SAFETY_OPERATION', 'RULE_EXECUTION'],
    prompt: '补货时发现通道中央有一处不明液体（使用蓝色防滑仿真水渍标识片模拟）。请按门店流程处置。',
    materials: '干燥防滑的蓝色仿真水渍标识片1张、警示牌1个、隔离带或路障2个、负责人角色牌；不得使用真实液体。',
    outcome: '立即停止周边补货；提醒人员绕行；放置警示牌并隔离区域；不徒手接触或自行判断不明液体；通知负责人和清洁责任人员；得到“已清除且地面干燥”的确认后才恢复作业。',
    scoring: score(
      '停止周边补货、提醒绕行、警示隔离、不接触不明液体、通知负责人和清洁责任人员中的任一关键安全动作缺失，或允许人员通行、触碰或跨越不明液体、未经确认恢复作业，或接受指向性提示，或累计2次及以上提示。',
      '独立完成5项关键安全动作并保持隔离，但未主动说明恢复作业前的确认条件；或恰好1次非指向性提示后完成全部6项。',
      '独立完成全部6项且0次提示。'
    ),
    boundaryLabel: '停止条件',
    boundary: '出现真实液体、标识片翘起或隔离空间不足时立即终止施测，保持警示隔离且不得接触，通知负责人和清洁责任人员处理；确认现场安全后另行重测。',
    safetySensitive: true,
    rubric: [
      '立即停止周边补货', '提醒人员绕行', '放置警示牌并隔离区域', '不徒手接触或自行判断不明液体',
      '通知负责人和清洁责任人员', '得到“已清除且地面干燥”的确认后才恢复作业'
    ],
    changedFields: ['assessment_point', 'ability_tags', 'scoring_rule', 'note', 'safety_stop_conditions']
  },
  M1_OP_042_V2: {
    assessmentPoint: '中断情境下按货位与先进先出规则完成补货',
    abilityTags: ['RULE_EXECUTION', 'COGNITION'],
    prompt: '依据补货任务单、唯一排面图、价签和批次标签，将8件轻质商品补入4个指定货位。每个SKU各有1件旧批次和1件新批次。完成第4件后，评估员按固定脚本中断20秒；中断前放置进度标记，恢复后从未完成项继续，最后复查。',
    materials: '固定货架1组；4个SKU各2件轻质空包装，每个SKU分别标注1件旧批次和1件新批次；固定批次标签、补货任务单、唯一排面图、价签、进度标记牌、固定中断脚本、唯一答案卡。',
    outcome: '逐件核对SKU、规格、价签和批次标签；8件全部进入唯一正确货位；每个SKU旧批次在前、新批次在后；中断时标记当前位置并停止；恢复后从标记处接续，不重复移动已完成商品；最后复查。',
    scoring: score(
      '少于6件处于唯一正确货位，或任一已完成SKU出现新批次在前、旧批次在后，或中断后未按标记接续或大范围重做，或接受指向性提示，或累计2次及以上提示。',
      '独立使6至7件处于唯一正确货位，已完成SKU均为旧批次在前、新批次在后，并正确完成中断标记、接续和复查；或恰好1次非指向性提示后完成全部要求。',
      '8件全部处于唯一正确货位，4个SKU均为旧批次在前、新批次在后，正确完成中断标记、接续和复查，且0次提示。'
    ),
    boundaryLabel: '设置异常',
    boundary: '商品、批次标签、价签、排面图、任务单或中断脚本不一致，或唯一答案无法成立时暂停计分，由评估员复位后重测。',
    safetySensitive: false,
    rubric: [
      '逐件核对SKU、规格、价签和批次标签', '8件全部进入唯一正确货位', '每个SKU旧批次在前、新批次在后',
      '中断时标记当前位置并停止', '恢复后从标记处接续且不重复移动已完成商品', '完成最终复查'
    ],
    changedFields: ['prompt', 'offline_tool_brief', 'assessment_point', 'rubric_criteria', 'scoring_rule', 'safety_sensitive', 'safety_stop_conditions']
  },
  M3_OP_056_V2: {
    assessmentPoint: '到期日逐件核验记录与先进先出排面恢复',
    abilityTags: ['COGNITION', 'FINE_MOTOR'],
    prompt: '逐件翻看8件同SKU商品底部或背面的到期日，将每件商品编号和到期日写入8行核验记录表；找出最早到期的2件并前置，其余按日期顺序后置；最后把8件商品恢复正面朝外，并保持价签可见。',
    materials: '8件带编号的轻质商品、固定到期日标签、8行到期日核验记录表、书写笔、唯一答案卡、货架价签；8件均为合格且非临期商品。',
    outcome: '在核验记录表中正确记录8件商品的编号和到期日；准确找出最早到期2件并前置；其余商品按日期顺序后置；所有商品恢复正面朝外且价签可见。',
    scoring: score(
      '正确记录少于6件商品的到期日，或最早到期2件均未正确前置，或错误前置其他商品，或检查后未恢复排面，或接受指向性提示，或累计2次及以上提示。',
      '独立正确记录6至7件商品的到期日，最早到期2件中正确前置1件且未错误前置其他商品，并恢复排面；或恰好1次非指向性提示后完成全部要求。',
      '独立正确记录8件商品的到期日，正确完成前置、后置和排面恢复，且0次提示。'
    ),
    boundaryLabel: '设置异常',
    boundary: '日期标签缺失或无法识别、商品编号重复、商品数量或状态不符、记录表行数不足或答案不唯一时，本次施测无效，由评估员复位。',
    safetySensitive: false,
    rubric: ['正确记录8件商品的编号和到期日', '准确找出最早到期2件并前置', '其余商品按日期顺序后置', '所有商品恢复正面朝外且价签可见'],
    changedFields: ['prompt', 'offline_tool_brief', 'assessment_point', 'rubric_criteria', 'scoring_rule', 'note']
  },
  M4_OP_045_V2: {
    assessmentPoint: '周转箱错区商品识别、归位与复查',
    abilityTags: ['RULE_EXECUTION'],
    prompt: '三个周转箱分别标注“零食区”“常温饮品区”“洗护清洁区”。其中有1件商品放错箱，请核对商品和区域标签，找出并移入正确周转箱，随后复查其余商品。',
    materials: '三个标识明确的周转箱、共9件常温轻质商品，其中仅1件错区、唯一答案卡。',
    outcome: '识别唯一错区商品；移动到唯一正确区域；复查后其余8件不被误动。',
    scoring: score(
      '未找到错区商品、移动了任一正确商品、将错区商品归入错误区域，或接受指向性提示，或累计2次及以上提示。',
      '独立识别唯一错区商品但未完成正确归位，且未误动其余8件；或恰好1次非指向性提示后完成全部要求。',
      '独立完成识别、正确归位和复查，未误动其余8件，且0次提示。'
    ),
    boundaryLabel: '设置异常',
    boundary: '存在两件及以上错区商品、商品区域信息不唯一、区域标签缺失或唯一答案无法成立时暂停计分，由评估员复位。',
    safetySensitive: false,
    rubric: ['识别唯一错区商品', '将错区商品移动到唯一正确区域', '复查并确认其余8件未被误动'],
    changedFields: ['assessment_point', 'rubric_criteria', 'scoring_rule', 'note']
  },
  M4_OP_046_V2: {
    assessmentPoint: '补货清单与实物条码规格差错核对和上报',
    abilityTags: ['RULE_EXECUTION', 'COGNITION'],
    prompt: '核对补货清单与6件轻质商品。6件实物中有且仅有1件的规格或条码与清单不符。请找出该商品，暂停该项补货，贴上问题标识并报告负责人。',
    materials: '6件轻质商品、补货清单1份；其中1件使用固定规格或条码不符标签，其余5件与清单一致；问题标识贴、负责人角色牌、唯一答案卡。',
    outcome: '逐件核对品名、规格、条码和清单；指出唯一不符商品；该商品不进入货架；贴上问题标识并报告负责人。',
    scoring: score(
      '未发现唯一不符商品、指出错误对象、将不符商品上架、同时标记正常商品，或接受指向性提示，或累计2次及以上提示。',
      '独立发现并隔离唯一不符商品，但遗漏“贴问题标识”或“报告负责人”中的1项；或恰好1次非指向性提示后完成全部要求。',
      '独立完成逐件核对、正确识别、停止该项补货、标识和上报，且0次提示。'
    ),
    boundaryLabel: '设置异常',
    boundary: '清单存在多处差错、实物数量异常、规格或条码标签无法识别、正常商品与清单不一致或唯一答案无法成立时暂停计分，由评估员复位。',
    safetySensitive: false,
    rubric: ['逐件核对品名、规格、条码和清单', '指出唯一不符商品', '不符商品不进入货架', '贴上问题标识并报告负责人'],
    changedFields: ['prompt', 'offline_tool_brief', 'assessment_point', 'rubric_criteria', 'scoring_rule', 'note']
  },
  M4_OP_047_V2: {
    assessmentPoint: '按统一到期日和门店锁定批次规则完成商品排序',
    abilityTags: ['COGNITION'],
    prompt: '将8件同SKU合格商品按到期日由早到晚排列。日期统一采用YYYY-MM-DD格式；到期日相同的商品按本题锁定的门店次级规则，将4位纯数字批次号由小到大排列。',
    materials: '8件轻质商品；统一YYYY-MM-DD格式的固定到期日标签；等长4位纯数字批次号；模拟工作日卡“2026-07-22”；门店次级排序规则卡；唯一答案卡。所有商品均包装完好、未过期且非临期。',
    outcome: '8件商品按统一到期日由早到晚排列；到期日相同的商品按本题锁定规则，将4位纯数字批次号由小到大排列。',
    scoring: score(
      '正确位置少于5个，或改写日期或批次标签，或未按锁定次级规则处理相同到期日商品，或接受指向性提示，或累计2次及以上提示。',
      '独立形成5至7个正确位置；或恰好1次非指向性提示后全部正确。',
      '8件全部处于唯一正确位置且0次提示。'
    ),
    boundaryLabel: '停止条件',
    boundary: '日期标签缺失或格式无法识别、批次号不是4位纯数字或无法比较、模拟工作日卡缺失、发现过期或临期商品、答案不唯一时立即暂停计分，由评估员更换材料后重测。',
    safetySensitive: true,
    rubric: ['按YYYY-MM-DD格式正确读取8个到期日', '按到期日由早到晚排列', '相同到期日按门店锁定规则比较4位纯数字批次号', '形成唯一正确的8个位置'],
    changedFields: ['prompt', 'offline_tool_brief', 'assessment_point', 'rubric_criteria', 'scoring_rule', 'note', 'safety_sensitive', 'safety_stop_conditions']
  },
  M4_OP_048_V2: {
    assessmentPoint: '中断情境下完成正常品上架与唯一异常品隔离',
    abilityTags: ['RULE_EXECUTION', 'COGNITION'],
    prompt: '按补货任务单处理10件轻质商品，其中9件为合格补货品，1件为条码与任务单不符的安全仿真异常品。将9件合格品补入唯一正确货位，将异常品放入问题暂存区。完成第5件时，评估员按固定脚本中断20秒；中断时放置进度标记，恢复后从标记处接续，最后复查。',
    materials: '固定货架、9件合格轻质商品、1件使用无液体、无尖锐、无污染空包装制作的条码不符仿真异常品、补货任务单、价签、带明确标识的问题暂存区、进度标记牌、固定中断脚本、唯一答案卡。',
    outcome: '逐件核对SKU、规格和条码；9件合格品进入唯一正确货位；1件仿真异常品进入问题暂存区；中断时正确标记并停止；恢复后从标记处接续而非重做；完成最终复查。',
    scoring: score(
      '少于7件合格品进入唯一正确货位，或仿真异常品被上架或未进入问题暂存区，或中断后未按标记接续，或接受指向性提示，或累计2次及以上提示。',
      '独立使7至8件合格品进入唯一正确货位，仿真异常品正确进入问题暂存区，并正确完成中断标记、接续和复查；或恰好1次非指向性提示后完成全部要求。',
      '9件合格品全部进入唯一正确货位，1件仿真异常品进入问题暂存区，正确完成中断标记、接续和复查，且0次提示。'
    ),
    boundaryLabel: '停止条件',
    boundary: '发现真实泄漏、尖锐破损、异味、污染或货架不稳时立即停止施测，保持隔离警示并通知评估员或负责人处理，确认现场安全前不得继续；商品构成、任务单或中断脚本不一致时暂停计分并复位。',
    safetySensitive: true,
    rubric: ['逐件核对SKU、规格和条码', '9件合格品进入唯一正确货位', '1件仿真异常品进入问题暂存区', '中断时正确标记并停止', '恢复后从标记处接续而非重做', '完成最终复查'],
    changedFields: ['prompt', 'offline_tool_brief', 'assessment_point', 'rubric_criteria', 'scoring_rule', 'note', 'safety_stop_conditions']
  },
  M5_OP_048_V2: {
    assessmentPoint: '通道散落物的警示隔离、安全移除、分类与复查',
    abilityTags: ['SAFETY_OPERATION', 'RULE_EXECUTION'],
    prompt: '补货时发现通道内散落3个轻质空纸箱和1段塑料包装膜。请按门店安全流程恢复通道。',
    materials: '在划定模拟区内放置3个折叠轻质空纸箱、1段短塑料膜、警示牌、纸箱回收区和塑料膜回收区；不得形成真实绊倒路径。',
    outcome: '停止推车或搬运；提醒人员绕行并放置警示；确认材料无尖锐、污染或重压风险；安全移除全部4件散落物并分类；复查通道完全畅通后才恢复通行。',
    scoring: score(
      '任一散落物仍处于通道且未被路障完全隔离，或用脚踢或抛掷材料，或未警示即让人员进入，或未经复查恢复通行，或接受指向性提示，或累计2次及以上提示。',
      '独立将4件散落物全部移出通道并保持警示，但恰好有1件分类错误；或恰好1次非指向性提示后完成全部要求。',
      '独立完成停止作业、提醒绕行和警示、安全确认、移除并正确分类全部4件散落物、复查并恢复通行，且0次提示。'
    ),
    boundaryLabel: '停止条件',
    boundary: '发现真实尖锐物、泄漏、污染、异味、过重物或模拟区无法隔离时立即停止操作，保持警示隔离并报告负责人，由负责人安排处理；确认现场安全前不得恢复通行。',
    safetySensitive: true,
    rubric: ['停止推车或搬运', '提醒人员绕行并放置警示', '确认材料无尖锐、污染或重压风险', '安全移除并分类全部4件散落物', '复查通道完全畅通后才恢复通行'],
    changedFields: ['assessment_point', 'ability_tags', 'rubric_criteria', 'scoring_rule', 'note', 'safety_stop_conditions']
  },
  M5_OP_055_V2: {
    assessmentPoint: '模糊补货指令的四维澄清、复述与确认',
    abilityTags: ['BASIC_SOCIAL', 'RULE_EXECUTION'],
    prompt: '负责人说：“把那边的货补一下。”现场有两个货架、三种SKU和两个优先级标识，指令不能唯一确定任务。请在移动商品前澄清四个维度：目标位置、商品身份、数量和优先级；随后复述完整任务并等待负责人确认。确认后本题结束，不开始补货。',
    materials: '两个货架、三种轻质SKU、普通或优先任务标识、负责人角色卡；至少提供6瓶500毫升无糖茶及其他干扰SKU。角色卡锁定答案为“B货架第二层，500毫升无糖茶6瓶，优先补货”。',
    outcome: '在移动商品前完成四维澄清：目标位置同时包含货架和层位；商品身份同时包含品名或SKU和规格；数量明确；优先级明确；准确复述完整任务并等待负责人确认后结束。',
    scoring: score(
      '完整澄清少于3个维度、凭猜测移动商品、复述内容与角色卡不一致、未等待负责人确认，或接受指向性提示，或累计2次及以上提示。',
      '独立完整澄清四个维度中的3个，未移动商品，并准确复述已确认信息；或恰好1次非指向性提示后完成全部要求。',
      '独立完整澄清四个维度，准确复述并等待负责人确认，0次提示。'
    ),
    boundaryLabel: '异常分支',
    boundary: '负责人仍无法给出唯一任务，或指令涉及无权限或不安全操作时，学员应暂停并请求更高层负责人确认，不得自行猜测执行。',
    safetySensitive: true,
    rubric: ['目标位置包含明确货架和层位', '商品身份包含明确品名或SKU和规格', '数量明确为6瓶', '优先级明确为优先补货', '准确复述完整任务并等待负责人确认后结束'],
    changedFields: ['prompt', 'offline_tool_brief', 'assessment_point', 'ability_tags', 'rubric_criteria', 'scoring_rule']
  }
}

for (const path of [paths.candidatesV2, paths.mergedGate, paths.contentResult, paths.safetyResult]) {
  assert(existsSync(path), `missing source: ${rel(path)}`)
}
const candidatesV2 = readJson(paths.candidatesV2)
const mergedGate = readJson(paths.mergedGate)
const contentResult = readJson(paths.contentResult)
const safetyResult = readJson(paths.safetyResult)
const candidateById = indexBy(candidatesV2.questions, 'V2 candidates')
const mergedById = indexBy(mergedGate.questions, 'merged gate')
exactSet(Object.keys(specs), returnedV2Ids, 'V3 revision spec')
exactSet(mergedGate.questions.filter((item) => item.status === 'RETURN_FOR_REVISION').map((item) => item.question_id), returnedV2Ids, 'merged returns')
exactSet(mergedGate.questions.filter((item) => item.status === 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY').map((item) => item.question_id), passedV2Ids, 'merged passes')

function carriedPasses(review) {
  const passes = []
  if (review.review_results.content.status === 'PASS') {
    passes.push({ track: 'CONTENT', status: 'PASS', source_record_hash: review.review_results.content.source_record_hash })
  }
  if (review.review_results.safety_technical.status === 'PASS') {
    passes.push({ track: 'SAFETY_TECHNICAL', status: 'PASS', source_record_hash: review.review_results.safety_technical.source_record_hash })
  }
  return passes
}

const questionsV3 = returnedV2Ids.map((previousId) => {
  const previous = candidateById.get(previousId)
  const review = mergedById.get(previousId)
  const spec = specs[previousId]
  assert(previous && review, `${previousId} source evidence missing`)
  assert(previous.candidate_record_hash === review.candidate_record_hash, `${previousId} candidate hash mismatch`)
  assert(review.status === 'RETURN_FOR_REVISION', `${previousId} must be returned`)
  exactSet(review.failed_review_tracks, review.failed_review_tracks, `${previousId} failed tracks`)
  const questionId = previousId.replace(/_V2$/, '_V3')
  const plan = {
    question_id: questionId,
    question_type: 'OFFLINE_OPERATION',
    prompt: spec.prompt,
    materials: spec.materials,
    unique_outcome_label: previous.structured_replacement_plan.unique_outcome_label,
    unique_outcome: spec.outcome,
    scoring_thresholds: spec.scoring,
    boundary_label: spec.boundaryLabel,
    boundary: spec.boundary
  }
  const proposedQuestion = structuredClone(previous.proposed_question)
  proposedQuestion.content.prompt = spec.prompt
  proposedQuestion.content.assessment_point = spec.assessmentPoint
  proposedQuestion.content.ability_tags = spec.abilityTags
  proposedQuestion.content.note = `${spec.boundaryLabel}：${spec.boundary}`
  proposedQuestion.content.offline_tool_brief = spec.materials
  proposedQuestion.content.rubric_criteria = spec.rubric.map((description, index) => ({ criterion_id: `r${index + 1}`, description }))
  proposedQuestion.content.professional_review = { required: true, status: 'PENDING', tracks: review.failed_review_tracks }
  proposedQuestion.scoring_rule = {
    scoring_type: 'RUBRIC_BASED',
    max_score: 2,
    score_0_description: `0分：${spec.scoring.score_0}`,
    score_1_description: `1分：${spec.scoring.score_1}`,
    score_2_description: `2分：${spec.scoring.score_2}`
  }
  proposedQuestion.safety_sensitive = spec.safetySensitive
  proposedQuestion.safety_stop_conditions = spec.safetySensitive ? `${spec.boundaryLabel}：${spec.boundary}` : null
  const newSemanticHash = questionSemanticHash(proposedQuestion)
  assert(newSemanticHash !== previous.new_semantic_hash, `${questionId} semantic hash must change from V2`)
  const base = {
    question_id: questionId,
    previous_question_id: previousId,
    source_question_id: previous.source_question_id,
    question_version: 3,
    module: previous.module,
    question_type: 'OFFLINE_OPERATION',
    status: 'DRAFT_TARGETED_REREVIEW_REQUIRED',
    replacement_relationship: {
      rejected_original_remains_rejected: true,
      previous_v2_not_activated: true,
      supersedes_original: false
    },
    structured_replacement_plan: plan,
    proposed_question: proposedQuestion,
    revision_trace: {
      source_merged_record_hash: review.merged_record_hash,
      failed_review_tracks: review.failed_review_tracks,
      carried_forward_review_passes: carriedPasses(review),
      content_required_revision: review.review_results.content.review_fields.required_revision,
      safety_stop_condition_note: review.review_results.safety_technical.review_fields.stop_condition_note,
      safety_technical_note: review.review_results.safety_technical.review_fields.technical_note,
      changed_fields: spec.changedFields
    },
    old_semantic_hash: previous.new_semantic_hash,
    new_semantic_hash: newSemanticHash,
    source_candidate_record_hash: previous.candidate_record_hash,
    required_review_tracks: review.failed_review_tracks,
    activation_authority: 'NONE'
  }
  return { ...base, candidate_record_hash: hashRecord(base) }
}).sort((left, right) => left.question_id.localeCompare(right.question_id))

const passedV2References = passedV2Ids.map((questionId) => {
  const candidate = candidateById.get(questionId)
  const review = mergedById.get(questionId)
  assert(candidate && review, `${questionId} passed reference missing`)
  return {
    question_id: questionId,
    candidate_record_hash: candidate.candidate_record_hash,
    semantic_hash: candidate.new_semantic_hash,
    review_status: review.status,
    merged_record_hash: review.merged_record_hash,
    activation_authority: 'NONE',
    treatment: 'PRESERVE_V2_AS_REVIEW_ONLY_REFERENCE_NO_V3_NO_ACTIVATION'
  }
})
const contentQuestions = questionsV3.filter((item) => item.required_review_tracks.includes('CONTENT'))
const safetyQuestions = questionsV3.filter((item) => item.required_review_tracks.includes('SAFETY_TECHNICAL'))
assert(questionsV3.length === 9, 'V3 candidate count must be 9')
assert(contentQuestions.length === 8, 'content rereview count must be 8')
assert(safetyQuestions.length === 7, 'safety technical rereview count must be 7')

const candidateSetBody = {
  schema_version: 'job-skill-shelver-298-rejected-replacement-targeted-candidates-v3',
  candidate_set_id: 'job-skill-shelver-298-rejected-replacement-targeted-candidates-v3',
  status: 'DRAFT_TARGETED_REREVIEW_REQUIRED_NO_ACTIVATION_AUTHORITY',
  generated_at: generatedAt,
  sources: [paths.candidatesV2, paths.mergedGate, paths.contentResult, paths.safetyResult].map((path) => ({ path: rel(path), sha256: hashFile(path) })),
  semantic_hash_contract: questionSemanticHashContract,
  summary: {
    v2_reviewed_total: 11,
    v2_passed_references_unchanged: 2,
    v2_returned_for_targeted_revision: 9,
    v3_candidates: 9,
    content_rereview_required: 8,
    safety_technical_rereview_required: 7,
    by_module: Object.fromEntries(['M1', 'M3', 'M4', 'M5'].map((module) => [module, questionsV3.filter((item) => item.module === module).length]))
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
  passed_v2_references: passedV2References,
  questions: questionsV3
}
const candidateSet = { ...candidateSetBody, candidate_set_hash: hashRecord(candidateSetBody) }

const gateBody = {
  schema_version: 'job-skill-shelver-298-rejected-replacement-targeted-v3-review-gate-v1',
  gate_id: 'job-skill-shelver-298-rejected-replacement-targeted-v3-review-gate-v1',
  status: 'PENDING_TARGETED_V3_REREVIEW_NO_ACTIVATION_AUTHORITY',
  generated_at: generatedAt,
  candidate_set: { path: rel(paths.candidatesV3), candidate_set_id: candidateSet.candidate_set_id, candidate_set_hash: candidateSet.candidate_set_hash },
  review_routing: {
    content: contentQuestions.map((item) => item.question_id),
    safety_technical: safetyQuestions.map((item) => item.question_id),
    carried_forward_passes: questionsV3.flatMap((item) => item.revision_trace.carried_forward_review_passes.map((pass) => ({ question_id: item.question_id, ...pass })))
  },
  passed_v2_references: passedV2References,
  merge_rule: 'Each V3 candidate must pass every required targeted rereview track. Carried-forward passes remain bound to their source hashes. No review result grants activation authority.',
  summary: { total_v3: 9, pending_v3: 9, content_pending: 8, safety_technical_pending: 7, passed_v2_reference_only: 2 },
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

function markdown() {
  const sections = questionsV3.map((item, index) => {
    const plan = item.structured_replacement_plan
    const carried = item.revision_trace.carried_forward_review_passes.length
      ? item.revision_trace.carried_forward_review_passes.map((pass) => `${pass.track}（绑定原审核hash）`).join('、')
      : '无'
    return `## ${index + 1}. ${item.question_id}\n\n- 上一版：\`${item.previous_question_id}\`\n- 本轮复审轨道：${item.required_review_tracks.join('、')}\n- 携带通过轨道：${carried}\n- 激活权：\`NONE\`\n- 新 semantic hash：\`${item.new_semantic_hash}\`\n\n**题干**\n\n${plan.prompt}\n\n**现场材料**\n\n${plan.materials}\n\n**唯一达标行为或结果**\n\n${plan.unique_outcome}\n\n**评分**\n\n- 2分：${plan.scoring_thresholds.score_2}\n- 1分：${plan.scoring_thresholds.score_1}\n- 0分：${plan.scoring_thresholds.score_0}\n\n**异常或安全边界**\n\n${plan.boundary_label}：${plan.boundary}\n\n**定点修订字段**\n\n${item.revision_trace.changed_fields.join('、')}\n`
  })
  return `# 9道退回题的V3定点修订候选\n\n- 当前状态：9道V3均为待复审候选，不进入运行题库。\n- 复审范围：内容复审8道，安全技术复审7道；未失败轨道按原审核记录携带通过。\n- 保留参考：M4_OP_043_V2、M4_OP_044_V2保持V2审核通过引用，不生成V3。\n- 权限边界：所有V2和V3均无激活权，原11道V1继续淘汰，现有287道题、数据库、激活SQL和delivery lock均未修改。\n\n${sections.join('\n---\n\n')}\n`
}

function scriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

function packageData(kind) {
  const content = kind === 'CONTENT'
  const scoped = content ? contentQuestions : safetyQuestions
  return {
    package_id: content
      ? 'job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-packet-chen-xiaoqing-v1'
      : 'job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-packet-he-dong-v1',
    package_version: 1,
    result_schema_version: content
      ? 'job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-result-v1'
      : 'job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-result-v1',
    reviewer: content
      ? { name: '陈晓青', track: 'CONTENT_REREVIEW', role: '内容定点复审' }
      : { name: '赫东', track: 'SAFETY_TECHNICAL_REREVIEW', role: '安全与技术定点复审' },
    source: {
      candidate_set_id: candidateSet.candidate_set_id,
      candidate_set_hash: candidateSet.candidate_set_hash,
      candidate_set_file: rel(paths.candidatesV3),
      generated_at: generatedAt,
      scoped_total: scoped.length,
      all_v3_total: questionsV3.length
    },
    authority: {
      activation_authority_granted: false,
      can_activate_questions: false,
      runtime_database_change_allowed: false,
      activation_sql_generated: false,
      existing_287_unchanged: true,
      rejected_originals_11_unchanged: true,
      passed_v2_references_unchanged: true
    },
    questions: scoped.map((item) => ({
      question_id: item.question_id,
      previous_question_id: item.previous_question_id,
      source_question_id: item.source_question_id,
      activation_authority: item.activation_authority,
      candidate_record_hash: item.candidate_record_hash,
      old_semantic_hash: item.old_semantic_hash,
      new_semantic_hash: item.new_semantic_hash,
      required_review_tracks: item.required_review_tracks,
      prior_review_issue: content
        ? item.revision_trace.content_required_revision
        : `${item.revision_trace.safety_stop_condition_note}\n${item.revision_trace.safety_technical_note}`,
      changed_fields: item.revision_trace.changed_fields,
      structured_replacement_plan: item.structured_replacement_plan,
      proposed_question: item.proposed_question
    }))
  }
}

function packetHtml(kind) {
  const data = packageData(kind)
  const content = kind === 'CONTENT'
  const title = content ? '9道退回题 V3 内容定点复审包' : '9道退回题 V3 安全技术定点复审包'
  const subtitle = content ? '陈晓青 · 仅含需内容复审的8道V3' : '赫东 · 仅含需安全技术复审的7道V3'
  const fields = content
    ? [
        ['content_conclusion', '内容结论', ['PASS', 'RETURN_FOR_REVISION']],
        ['occupational_authenticity', '岗位真实性', ['PASS', 'RETURN_FOR_REVISION']],
        ['prompt_and_boundary', '题干与边界', ['PASS', 'RETURN_FOR_REVISION']],
        ['rubric_observability', '评分可观察性', ['PASS', 'RETURN_FOR_REVISION']],
        ['material_feasibility', '材料可执行性', ['PASS', 'RETURN_FOR_REVISION']]
      ]
    : [
        ['safety_conclusion', '安全结论', ['PASS', 'RETURN_FOR_REVISION']],
        ['technical_conclusion', '技术结论', ['PASS', 'RETURN_FOR_REVISION']],
        ['renderer_feasibility', '渲染与现场可执行性', ['PASS', 'RETURN_FOR_REVISION']],
        ['data_contract_integrity', '数据合同完整性', ['PASS', 'RETURN_FOR_REVISION']],
        ['safety_sensitive_decision', '安全敏感标记', ['KEEP', 'ADD', 'REMOVE']]
      ]
  return String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:light;--ink:#17221b;--muted:#657167;--line:#cfd9d1;--paper:#f6f4ee;--card:#fff;--accent:#315f46;--warn:#8b3e2f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.65 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}.wrap{max-width:1120px;margin:auto;padding:28px 20px 80px}header{padding:28px;border:1px solid var(--line);background:#edf3ee;border-radius:16px}h1{margin:0 0 6px;font-size:30px}h2{margin:0;font-size:21px}p{margin:7px 0}.muted{color:var(--muted)}.lock{margin-top:16px;padding:12px 14px;border-left:4px solid var(--warn);background:#fff5f1;color:#622b21}.card{margin-top:20px;padding:22px;border:1px solid var(--line);background:var(--card);border-radius:14px;box-shadow:0 4px 18px #24362a0c}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.block{padding:12px;background:#f7faf7;border-radius:9px;white-space:pre-wrap}.full{grid-column:1/-1}label{display:block;font-weight:700;margin:14px 0 5px}select,textarea{width:100%;border:1px solid #aebdb1;border-radius:8px;padding:9px;background:#fff;font:inherit}textarea{min-height:88px;resize:vertical}.actions{position:sticky;bottom:0;margin-top:24px;padding:14px;border:1px solid var(--line);background:#ffffffee;backdrop-filter:blur(8px);border-radius:12px;display:flex;gap:12px;align-items:center}button{border:0;border-radius:8px;padding:10px 16px;background:var(--accent);color:#fff;font-weight:700;cursor:pointer}.status{color:var(--muted)}code{font-size:12px;word-break:break-all}@media(max-width:720px){.grid{grid-template-columns:1fr}.wrap{padding:14px 10px 70px}header,.card{padding:16px}}
</style></head><body><main class="wrap"><header><h1>${title}</h1><p>${subtitle}</p><p class="muted">逐题填写，页面自动保存在当前浏览器。提交按钮只导出JSON，不激活题目，不修改策略，不覆盖历史记录。</p><div class="lock">权限边界：本包及导出的JSON均无激活权。9道V3仍是待复审候选；2道已通过V2仅保留引用；现有287道运行题不变。</div></header><section id="cards"></section><div class="actions"><button id="export" type="button">校验并导出JSON</button><span id="status" class="status">尚未导出</span></div></main>
<script id="package-data" type="application/json">${scriptJson(data)}</script>
<script>(()=>{const pkg=JSON.parse(document.getElementById('package-data').textContent);const fields=${scriptJson(fields)};const key='svets-review:'+pkg.package_id;const saved=JSON.parse(localStorage.getItem(key)||'{}');const cards=document.getElementById('cards');const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const select=(qid,name,label,values)=>'<label>'+esc(label)+'</label><select data-qid="'+esc(qid)+'" data-field="'+esc(name)+'" required><option value="">请选择</option>'+values.map(v=>'<option value="'+v+'">'+v+'</option>').join('')+'</select>';for(const q of pkg.questions){const p=q.structured_replacement_plan;const div=document.createElement('article');div.className='card';div.innerHTML='<h2>'+esc(q.question_id)+'</h2><p class="muted">上一版 '+esc(q.previous_question_id)+' · 激活权 NONE</p><div class="grid"><div class="block full"><b>上轮退回点</b>\n'+esc(q.prior_review_issue)+'</div><div class="block full"><b>V3定点修改字段</b>\n'+esc(q.changed_fields.join('、'))+'</div><div class="block full"><b>题干</b>\n'+esc(p.prompt)+'</div><div class="block full"><b>现场材料</b>\n'+esc(p.materials)+'</div><div class="block"><b>唯一结果</b>\n'+esc(p.unique_outcome)+'</div><div class="block"><b>边界</b>\n'+esc(p.boundary_label+'：'+p.boundary)+'</div><div class="block full"><b>评分</b>\n2分：'+esc(p.scoring_thresholds.score_2)+'\n1分：'+esc(p.scoring_thresholds.score_1)+'\n0分：'+esc(p.scoring_thresholds.score_0)+'</div></div>'+fields.map(f=>select(q.question_id,f[0],f[1],f[2])).join('')+'<label>${content ? '内容复审说明' : '停止条件说明'}</label><textarea data-qid="'+esc(q.question_id)+'" data-field="${content ? 'content_note' : 'stop_condition_note'}" required></textarea><label>${content ? '仍需修订（通过时填“无”）' : '技术复审说明'}</label><textarea data-qid="'+esc(q.question_id)+'" data-field="${content ? 'required_revision' : 'technical_note'}" required></textarea>';cards.appendChild(div)}for(const el of document.querySelectorAll('[data-qid]')){const v=saved[el.dataset.qid]?.[el.dataset.field];if(v)el.value=v;el.addEventListener('input',save);el.addEventListener('change',save)}function collect(){const out={};for(const el of document.querySelectorAll('[data-qid]')){(out[el.dataset.qid]??={})[el.dataset.field]=el.value.trim()}return out}function save(){localStorage.setItem(key,JSON.stringify(collect()));document.getElementById('status').textContent='已自动保存'}document.getElementById('export').addEventListener('click',()=>{const values=collect();for(const q of pkg.questions){for(const [name] of fields){if(!values[q.question_id]?.[name])return alert(q.question_id+' 尚未填写 '+name)}const notes=${content ? "['content_note','required_revision']" : "['stop_condition_note','technical_note']"};for(const name of notes){if(!values[q.question_id]?.[name])return alert(q.question_id+' 尚未填写 '+name)}}const questions=pkg.questions.map(q=>{const review_fields=values[q.question_id];const failed=${content ? "['content_conclusion','occupational_authenticity','prompt_and_boundary','rubric_observability','material_feasibility']" : "['safety_conclusion','technical_conclusion','renderer_feasibility','data_contract_integrity']"}.some(name=>review_fields[name]==='RETURN_FOR_REVISION');return{question_id:q.question_id,previous_question_id:q.previous_question_id,new_semantic_hash:q.new_semantic_hash,candidate_record_hash:q.candidate_record_hash,activation_authority:'NONE',conclusion:failed?'RETURN_FOR_REVISION':'PASS',review_fields}});const pass=questions.filter(q=>q.conclusion==='PASS').length;const result={schema_version:pkg.result_schema_version,package_id:pkg.package_id,candidate_set_id:pkg.source.candidate_set_id,candidate_set_hash:pkg.source.candidate_set_hash,reviewer:pkg.reviewer,submitted_at:new Date().toISOString(),summary:{total:questions.length,pass,return_for_revision:questions.length-pass},authority:{activation_authority_granted:false,can_activate_questions:false,runtime_database_change_allowed:false,activation_sql_generated:false},questions};const blob=new Blob([JSON.stringify(result,null,2)+'\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=pkg.package_id+'-result.json';a.click();URL.revokeObjectURL(a.href);document.getElementById('status').textContent='已导出JSON；未授予激活权'})})();</script></body></html>\n`
}

function resultSchema(kind) {
  const content = kind === 'CONTENT'
  const scoped = content ? contentQuestions : safetyQuestions
  const packageId = content
    ? 'job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-packet-chen-xiaoqing-v1'
    : 'job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-packet-he-dong-v1'
  const schemaVersion = content
    ? 'job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-result-v1'
    : 'job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-result-v1'
  const reviewProperties = content
    ? {
        content_conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
        occupational_authenticity: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
        prompt_and_boundary: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
        rubric_observability: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
        material_feasibility: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
        content_note: { type: 'string', minLength: 1 },
        required_revision: { type: 'string', minLength: 1 }
      }
    : {
        safety_conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
        technical_conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
        renderer_feasibility: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
        data_contract_integrity: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
        safety_sensitive_decision: { enum: ['KEEP', 'ADD', 'REMOVE'] },
        stop_condition_note: { type: 'string', minLength: 1 },
        technical_note: { type: 'string', minLength: 1 }
      }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: schemaVersion,
    type: 'object',
    additionalProperties: false,
    required: ['schema_version', 'package_id', 'candidate_set_id', 'candidate_set_hash', 'reviewer', 'submitted_at', 'summary', 'authority', 'questions'],
    properties: {
      schema_version: { const: schemaVersion },
      package_id: { const: packageId },
      candidate_set_id: { const: candidateSet.candidate_set_id },
      candidate_set_hash: { const: candidateSet.candidate_set_hash },
      reviewer: {
        type: 'object', additionalProperties: false, required: ['name', 'track', 'role'],
        properties: content
          ? { name: { const: '陈晓青' }, track: { const: 'CONTENT_REREVIEW' }, role: { const: '内容定点复审' } }
          : { name: { const: '赫东' }, track: { const: 'SAFETY_TECHNICAL_REREVIEW' }, role: { const: '安全与技术定点复审' } }
      },
      submitted_at: { type: 'string', format: 'date-time' },
      summary: {
        type: 'object', additionalProperties: false, required: ['total', 'pass', 'return_for_revision'],
        properties: { total: { const: scoped.length }, pass: { type: 'integer', minimum: 0, maximum: scoped.length }, return_for_revision: { type: 'integer', minimum: 0, maximum: scoped.length } }
      },
      authority: {
        type: 'object', additionalProperties: false, required: ['activation_authority_granted', 'can_activate_questions', 'runtime_database_change_allowed', 'activation_sql_generated'],
        properties: { activation_authority_granted: { const: false }, can_activate_questions: { const: false }, runtime_database_change_allowed: { const: false }, activation_sql_generated: { const: false } }
      },
      questions: {
        type: 'array', minItems: scoped.length, maxItems: scoped.length,
        items: {
          type: 'object', additionalProperties: false,
          required: ['question_id', 'previous_question_id', 'new_semantic_hash', 'candidate_record_hash', 'activation_authority', 'conclusion', 'review_fields'],
          properties: {
            question_id: { enum: scoped.map((item) => item.question_id) },
            previous_question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+_V2$' },
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
  [paths.candidatesV3, `${JSON.stringify(candidateSet, null, 2)}\n`],
  [paths.markdown, markdown()],
  [paths.gate, `${JSON.stringify(gate, null, 2)}\n`],
  [paths.contentPacket, packetHtml('CONTENT')],
  [paths.safetyPacket, packetHtml('SAFETY_TECHNICAL')],
  [paths.contentSchema, `${JSON.stringify(resultSchema('CONTENT'), null, 2)}\n`],
  [paths.safetySchema, `${JSON.stringify(resultSchema('SAFETY_TECHNICAL'), null, 2)}\n`]
]
for (const [path, expected] of outputs) {
  if (checkOnly) {
    assert(existsSync(path), `missing generated artifact: ${rel(path)}`)
    assert(readFileSync(path, 'utf8') === expected, `generated artifact drift: ${rel(path)}`)
  } else writeFileSync(path, expected)
}

console.log(`Rejected replacement targeted V3 ${checkOnly ? 'verified' : 'built'}: 9 candidates, content 8, safety-technical 7, passed V2 references 2, activation authority NONE.`)
