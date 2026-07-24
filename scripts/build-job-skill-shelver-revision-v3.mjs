import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const v2Path = resolve(root, 'doc/features/archive/job-skill-shelver-pilot-r0-v1-v2/job-skill-shelver-pilot-revision-candidates-v2.json')
const resultPath = resolve(root, 'doc/features/archive/job-skill-shelver-pilot-r0-v1-v2/job-skill-shelver-pilot-safety-technical-review-result-2026-07-19.json')
const candidatesPath = resolve(root, 'doc/features/job-skill-shelver-pilot-revision-candidates-v3.json')
const manifestPath = resolve(root, 'doc/features/job-skill-shelver-pilot-activation-manifest-v3.json')

const v2 = JSON.parse(readFileSync(v2Path, 'utf8'))
const safetyTechnicalResult = JSON.parse(readFileSync(resultPath, 'utf8'))

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function hash(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`
}

const onlineRevisions = {
  M2_SC_003: {
    question_id: 'M2_SC_003_V2', question_version: 2,
    prompt: '使用安全开箱刀拆纸箱时，最优先要避免的是什么？',
    target_construct: 'FINE_MOTOR | SAFETY_OPERATION',
    options: [
      { key: 'A', text: '刀刃伤到自己或旁边的人' },
      { key: 'B', text: '下刀太深划伤箱内商品' },
      { key: 'C', text: '拆箱速度较慢影响补货进度' }
    ],
    candidate_answer: 'A', review_level: 'safety_critical', safety_sensitive: true,
    media_brief: '安全开箱刀、刀路与手部位置规范场景；刀具结构和安全动作必须清晰可核验',
    asset_requirements: [
      '实拍或可信3D场景加程序化标注，禁止只靠AI生成模糊刀具结构',
      '显示安全开箱刀、刀刃朝身体外侧、非持刀手不在刀路、纸箱位于稳定台面',
      '不得显示朝身体切割、手压切割线、刀刃过度伸出或儿童接触刀具'
    ],
    stop_conditions: '发现刀具破损/松动、刀刃无法回缩、受试者朝身体或他人方向切割、非持刀手进入刀路时立即停止。'
  },
  M2_SC_005_V2: {
    question_id: 'M2_SC_005_V3', question_version: 3,
    prompt: '模拟工作日是2026年09月10日。同款商品有两个仍可正常销售的批次：批次A标注“保质期至2026年09月25日”，批次B标注“保质期至2026年10月10日”。上架时应怎样摆放？',
    target_construct: 'RULE_EXECUTION',
    options: [
      { key: 'A', text: '批次A放在顾客先拿取的位置，批次B放在后面' },
      { key: 'B', text: '批次B放在顾客先拿取的位置，批次A放在后面' },
      { key: 'C', text: '两个批次混在一起，不核对到期日' }
    ],
    candidate_answer: 'A', review_level: 'safety_critical', safety_sensitive: true,
    media_brief: '固定模拟工作日、同款商品双批次日期标签和顾客取货前后关系',
    asset_requirements: [
      '程序化叠加模拟工作日与两件同款商品的“保质期至”日期',
      '两个批次外观相同、日期清楚、均无过期或报损标记',
      '明确顾客正常取货方向的前排和后排，不用含糊的上下或左右代替'
    ],
    stop_conditions: '模拟工作日与题干不一致、任一日期标签模糊、或任一批次在模拟工作日已过期时停止施测并更换候选数据/素材。'
  },
  M5_SC_001: {
    question_id: 'M5_SC_001_V2', question_version: 2,
    prompt: '发现货架旁地面有水渍，暂时不能马上清除，正确的完整做法是？',
    target_construct: 'RULE_EXECUTION | SAFETY_OPERATION',
    options: [
      { key: 'A', text: '先守护并隔离水渍区域，阻止人员进入；再设置警示并通知清洁，确认地面干燥后复检撤除隔离' },
      { key: 'B', text: '放一块“小心地滑”警示牌后离开，等清洁人员自己发现' },
      { key: 'C', text: '自己绕开水渍继续理货，不处理也不报告' }
    ],
    candidate_answer: 'A', review_level: 'safety_critical', safety_sensitive: true,
    media_brief: '水渍区域守护、顾客绕行、警示牌和隔离设施共同控制场景',
    asset_requirements: ['显示工作人员在水渍外侧守护、顾客绕行、警示牌和隔离带或围挡', '不得把只放警示牌后离开表现为正确操作', '清楚显示水渍位置和人物动线'],
    stop_conditions: '危险区域无法隔离、有人即将进入湿滑区、或清洁后仍未干燥时不得撤除警示和隔离。'
  },
  M5_SC_002: {
    question_id: 'M5_SC_002_V2', question_version: 2,
    prompt: '发现货架支架松动，货架可能倒塌，正确的完整做法是？',
    target_construct: 'SAFETY_OPERATION',
    options: [
      { key: 'A', text: '立即停止作业，疏离周围人员并封控危险区域，禁止自行扶正或取货，通知负责人处理' },
      { key: 'B', text: '自己停止理货并通知负责人，但不阻止顾客进入该区域' },
      { key: 'C', text: '先把货架上的商品取下来，再找东西临时支撑货架' }
    ],
    candidate_answer: 'A', review_level: 'safety_critical', safety_sensitive: true,
    media_brief: '松动货架安全距离外封控、顾客绕行与通知负责人场景',
    asset_requirements: ['显示人员在安全距离外封控通道、引导顾客绕行并通知负责人', '只表现支架松动或明显倾斜风险，不制作真实倒塌', '错误图不得成为可模仿的危险动作教程'],
    stop_conditions: '真实货架存在晃动或倾斜时不得用于施测；任何人试图进入危险区、扶正货架或取下商品时立即停止。'
  },
  M5_SC_009: {
    question_id: 'M5_SC_009_V2', question_version: 2,
    prompt: '独自工作时发现玻璃瓶打碎在顾客通道上，正确的完整做法是？',
    target_construct: 'SAFETY_OPERATION',
    options: [
      { key: 'A', text: '先守护并封控区域、通知支援；按要求佩戴防护，用扫帚簸箕或夹具清理，放入防穿刺容器，检查无残片和泄漏后再解封' },
      { key: 'B', text: '放一块警示牌后，用普通垃圾袋装碎玻璃并马上离开' },
      { key: 'C', text: '徒手捡起大块玻璃，小碎片踢到货架下面' }
    ],
    candidate_answer: 'A', review_level: 'safety_critical', safety_sensitive: true,
    media_brief: '仿真碎片封控、工具清理、防穿刺容器和清场复检场景',
    asset_requirements: ['使用仿真透明塑料碎片，不使用真实碎玻璃', '显示封控、扫帚簸箕或夹具、防穿刺硬质容器、防护用品和清场复检', '错误图不出现血液、伤口或刺激性细节'],
    stop_conditions: '施测不得使用真实玻璃；受试者徒手接触仿真碎片、进入未封控区域，或现场出现真实破碎/泄漏时立即停止。'
  },
  M6_SC_003: {
    question_id: 'M6_SC_003_V2', question_version: 2,
    prompt: '查看包装上的储存条件，以下哪件商品必须放入冷藏区？',
    target_construct: 'COGNITION',
    options: [
      { key: 'A', text: '包装标注“2℃—6℃冷藏”的低温酸奶' },
      { key: 'B', text: '包装标注“阴凉干燥处常温保存”的薯片' },
      { key: 'C', text: '包装标注“常温保存”的洗衣液' }
    ],
    candidate_answer: 'A', review_level: 'assessment_critical', safety_sensitive: true,
    media_brief: '三张同时显示品名和储存条件的商品卡，低温酸奶明确标注2℃—6℃冷藏',
    asset_requirements: ['三张商品卡同时显示品名和储存条件', '储存文字与温度使用程序化文字叠加', '不得使用常温酸奶包装冒充低温酸奶'],
    stop_conditions: '酸奶素材未清楚显示冷藏条件、温度文字不可辨认、或素材实际为常温酸奶时停止上线并更换素材。'
  },
  M6_SC_009: {
    question_id: 'M6_SC_009_V2', question_version: 2,
    prompt: '两件商品的外包装非常相似，归位前最可靠的核对方法是？',
    target_construct: 'COGNITION | RULE_EXECUTION',
    options: [
      { key: 'A', text: '核对品名、规格和口味等文字信息，再用条码或商品编码与价签/系统记录确认' },
      { key: 'B', text: '看包装颜色和原来摆放的位置判断' },
      { key: 'C', text: '只看品牌名称，相同品牌就当作同一件商品' }
    ],
    candidate_answer: 'A', review_level: 'assessment_critical', safety_sensitive: false,
    media_brief: '同品牌相近配色、规格或口味不同的商品卡及可核对条码或商品编码',
    asset_requirements: ['品名、规格、口味、条码或商品编码清晰可见', '结构化文字与条码使用程序化生成或叠加', '不能仅靠明显颜色差异分辨'],
    stop_conditions: '无现场安全停止条件；素材缺少条码/商品编码、关键文字不可读或两件商品差异过于明显时不得上线。'
  }
}

const priorReview = new Map(safetyTechnicalResult.questions.map((question) => [question.question_id, question]))
const replacedIds = new Map(Object.entries(onlineRevisions).map(([oldId, revision]) => [oldId, revision.question_id]))

const questions = v2.questions.map((oldQuestion) => {
  const revision = onlineRevisions[oldQuestion.question_id]
  if (!revision) {
    return oldQuestion
  }

  const record = {
    ...oldQuestion,
    question_id: revision.question_id,
    previous_question_id: oldQuestion.question_id,
    question_version: revision.question_version,
    revision_status: 'SAFETY_TECHNICAL_REVISION_APPLIED_AWAITING_FULL_REVIEW',
    prompt: revision.prompt,
    target_construct: revision.target_construct,
    options: revision.options,
    candidate_answer: revision.candidate_answer,
    review_level: revision.review_level,
    presentation: {
      ...oldQuestion.presentation,
      media_brief: revision.media_brief,
      asset_ids: [],
      asset_status: 'ASSET_REQUIRED',
      asset_requirements: revision.asset_requirements
    },
    safety: {
      source_sensitive: revision.safety_sensitive,
      content_reviewer_recommendation: revision.safety_sensitive ? 'SENSITIVE' : 'NOT_SENSITIVE',
      content_reviewer_note: oldQuestion.safety.content_reviewer_note,
      proposed_stop_conditions: revision.stop_conditions
    },
    content_review: {
      ...oldQuestion.content_review,
      prior_conclusion: oldQuestion.content_review.current_status,
      current_status: 'AWAITING_RECONFIRMATION',
      review_note: '题目已按赫东安全与技术审核结论及修复稿 v1.0 重写，须重新完成内容审核。'
    },
    provenance: {
      ...oldQuestion.provenance,
      based_on_question_id: oldQuestion.question_id,
      based_on_candidate_record_hash: oldQuestion.candidate_record_hash,
      safety_technical_review_result_id: safetyTechnicalResult.result_id,
      revision_spec: 'doc/features/job-skill-shelver-pilot-13-question-revision-and-renderer-fix-v1.0.md'
    },
    known_technical_gap: 'required visual asset is not produced or bound; full content, safety and technical re-review required'
  }
  delete record.candidate_record_hash
  return { ...record, candidate_record_hash: hash(record) }
})

const fixedIds = questions.map((question) => question.question_id)
const strategyCandidate = {
  ...v2.strategy_candidate,
  strategy_version: 3,
  strategy_name: '理货员专业岗位示范测评 v3 修复候选',
  question_policy: { ...v2.strategy_candidate.question_policy, fixed_scored_question_ids: fixedIds },
  runtime_seed_status: 'NOT_INSERTED',
  activation_authorized: false
}

const candidateSet = {
  schema_version: 'job-skill-shelver-revision-candidates-v3',
  candidate_set_id: 'strategy_job_skill_shelver_v1@3-pilot-r2-candidates',
  generated_at: '2026-07-19T12:00:00+08:00',
  based_on_manifest_id: 'strategy_job_skill_shelver_v1@2-pilot-r1',
  based_on_safety_technical_result_id: safetyTechnicalResult.result_id,
  revision_spec: 'doc/features/job-skill-shelver-pilot-13-question-revision-and-renderer-fix-v1.0.md',
  authority: {
    status: 'CURRENT_PILOT_CANDIDATE',
    usage: '题目内容、图片和视频素材生产均以本文件为当前唯一候选输入；历史审核文件仅作追溯。'
  },
  strategy_candidate: strategyCandidate,
  strategy_contract_hash: hash(strategyCandidate),
  summary: {
    total: 24,
    unchanged_from_v2: 17,
    revised_online_new_versions: 7,
    offline_content_hash_preserved: 6,
    content_reconfirmation_pending: 19,
    online_total: 18,
    offline_total: 6
  },
  hash_canonicalization: v2.hash_canonicalization,
  supersession_map: Object.fromEntries(replacedIds),
  official_review_sources: v2.official_review_sources.map((source) => ({
    ...source,
    applies_to: source.applies_to.map((id) => replacedIds.get(id) ?? id)
  })),
  questions
}

const manifestQuestions = questions.map((question) => {
  const prior = priorReview.get(question.question_id) ?? priorReview.get(question.previous_question_id ?? '')
  const changed = Boolean(onlineRevisions[question.previous_question_id ?? ''])
  const offline = question.question_type === 'OFFLINE_OPERATION'
  return {
    question_id: question.question_id,
    previous_question_id: question.previous_question_id,
    question_version: question.question_version,
    module: question.module,
    question_type: question.question_type,
    source_status: question.source_status,
    overall_status: 'PENDING',
    candidate_record_hash: question.candidate_record_hash,
    content_review_status: question.content_review.current_status,
    safety_review_status: changed ? 'NOT_REVIEWED' : prior?.safety_conclusion ?? 'NOT_REVIEWED',
    technical_review_status: changed || offline ? 'NOT_REVIEWED' : prior?.technical_conclusion ?? 'NOT_REVIEWED'
  }
})

const manifest = {
  manifest_schema_version: 'pilot-fixed-set-activation-manifest-v3.0',
  manifest_id: 'strategy_job_skill_shelver_v1@3-pilot-r2',
  manifest_version: 3,
  manifest_status: 'PENDING',
  activation_authorized: false,
  review_assignment: {
    content_vocational_reviewer: '陈晓青',
    safety_reviewer: '赫东',
    technical_reviewer: '赫东',
    content_review_status: 'RECONFIRMATION_REQUIRED',
    safety_review_status: 'PARTIAL_REVIEW_REQUIRED',
    technical_review_status: 'PARTIAL_REVIEW_REQUIRED'
  },
  scope: { job_code: 'SUPERMARKET_SHELVER', bank_domain: 'JOB_SPECIFIC', online_count: 18, offline_count: 6, candidate_count: 24 },
  strategy_binding: {
    strategy_id: strategyCandidate.strategy_id,
    strategy_version: 3,
    strategy_contract_hash: candidateSet.strategy_contract_hash,
    candidate_set_hash: hash(questions.map(({ question_id, question_version, candidate_record_hash }) => ({ question_id, question_version, candidate_record_hash }))),
    candidate_source: 'doc/features/job-skill-shelver-pilot-revision-candidates-v3.json'
  },
  gate: {
    status: 'PENDING',
    fail_closed: true,
    blocking_reasons: [
      '19 candidate questions require content reviewer confirmation',
      '7 revised online questions require safety and technical re-review',
      '6 unchanged offline questions require real Electron renderer witness and technical re-review',
      'required visual assets for 7 revised online questions are not produced or bound',
      'release commit and content-pack binding are not recorded',
      'strategy v3 and revised question records are not inserted into runtime seed'
    ]
  },
  renderer_fix: {
    status: 'IMPLEMENTED_AWAITING_REAL_ELECTRON_WITNESS',
    unchanged_question_ids: questions.filter((question) => question.question_type === 'OFFLINE_OPERATION').map((question) => question.question_id),
    note: '题目候选记录保持不变；渲染修复状态只记录在 manifest，避免改变 candidate hash。'
  },
  questions: manifestQuestions,
  supersedes_manifest_id: 'strategy_job_skill_shelver_v1@2-pilot-r1',
  runtime_seed: { status: 'NOT_INSERTED', activation_sql_generated: false }
}

writeFileSync(candidatesPath, `${JSON.stringify(candidateSet, null, 2)}\n`)
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`[job-skill-v3] wrote ${candidatesPath}`)
console.log(`[job-skill-v3] wrote ${manifestPath}`)
