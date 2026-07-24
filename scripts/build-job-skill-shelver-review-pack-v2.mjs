import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const archiveRoot = resolve(root, 'doc/features/archive/job-skill-shelver-pilot-r0-v1-v2')
const contentPacketPath = resolve(archiveRoot, 'job-skill-shelver-pilot-content-review-packet-v1.html')
const contentResultPath = resolve(archiveRoot, 'job-skill-shelver-pilot-content-review-result-2026-07-19.json')
const candidatePath = resolve(archiveRoot, 'job-skill-shelver-pilot-revision-candidates-v2.json')
const manifestPath = resolve(archiveRoot, 'job-skill-shelver-pilot-activation-manifest-v2.json')
const reviewPacketPath = resolve(archiveRoot, 'job-skill-shelver-pilot-safety-technical-review-packet-v2.html')
const reviewSchemaPath = resolve(root, 'doc/features/job-skill-shelver-pilot-safety-technical-review-result-v1.schema.json')

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

function cleanReviewerText(value = '') {
  return value.replaceAll('\u2014', '，').replaceAll('\u2013', '-')
}

function parsePackageData(html) {
  const match = html.match(/<script id="package-data" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error('content review package data not found')
  return JSON.parse(match[1])
}

const originalPackage = parsePackageData(readFileSync(contentPacketPath, 'utf8'))
const contentResult = JSON.parse(readFileSync(contentResultPath, 'utf8'))
const contentReviewById = new Map(contentResult.questions.map((question) => [question.question_id, question]))

const revisions = {
  M1_SC_007: {
    prompt: '核对商品与价签时，以下哪项检查最完整？',
    options: [
      { key: 'A', text: '核对品名、规格或条码是否对应，并确认销售价格及促销有效期' },
      { key: 'B', text: '只核对商品名称和当前价格，不看规格、条码和促销日期' },
      { key: 'C', text: '只核对价签颜色、字体和边角是否整齐' }
    ],
    candidate_answer: 'A',
    media_brief: '价签核对要点 R3，需同时呈现商品标识、价格和促销日期'
  },
  M1_OP_033: {
    prompt: '将5件轻型训练商品摆到货架中层，做到正面朝外、竖直稳定并使同排前沿基本对齐。',
    tool_brief: '稳定的迷你货架1组；5件轻型、无尖锐边角的训练商品',
    rubric_criteria: [
      { criterion_id: 'r1', description: '5件商品全部放在中层' },
      { criterion_id: 'r2', description: '5件商品全部正面朝外' },
      { criterion_id: 'r3', description: '商品竖直稳定，无倾倒风险' },
      { criterion_id: 'r4', description: '同排商品前沿基本对齐' }
    ]
  },
  M2_SC_002: {
    prompt: '本课程对标有到期日的食品采用“先到期先出（FEFO）”。补货时正确的做法是？',
    options: [
      { key: 'A', text: '较早到期的商品前移，较晚到期的新批次放在后面' },
      { key: 'B', text: '较晚到期的新批次前移，较早到期的商品放在后面' },
      { key: 'C', text: '不核对到期日，把两个批次混合摆放' }
    ],
    candidate_answer: 'A',
    media_brief: 'FEFO 批次轮转规则 R6'
  },
  M2_SC_005: {
    prompt: '同款商品有两个批次：批次A标注“保质期至2026年08月10日”，批次B标注“保质期至2026年09月05日”。上架时应怎样摆放？',
    options: [
      { key: 'A', text: '批次A放在顾客先拿取的位置，批次B放在后面' },
      { key: 'B', text: '批次B放在顾客先拿取的位置，批次A放在后面' },
      { key: 'C', text: '两个批次混放，不区分到期日' }
    ],
    candidate_answer: 'A',
    media_brief: '带明确到期日的 FEFO 双批次应用 R6'
  },
  M2_OP_027: {
    prompt: '在稳定台面上，徒手沿预设易撕开口安全拆开标准训练纸箱，平稳取出全部商品并整理纸箱。',
    tool_brief: '统一规格轻型训练纸箱1箱；纸胶带或预设易撕开口；轻型、无玻璃内装训练商品；稳定台面',
    rubric_criteria: [
      { criterion_id: 'r1', description: '徒手沿胶带端或预设开口安全打开纸箱' },
      { criterion_id: 'r2', description: '商品全部平稳取出，无破损、跌落和遗漏' },
      { criterion_id: 'r3', description: '不抛掷、不踩箱、不朝身体方向猛拉' },
      { criterion_id: 'r4', description: '完成后整理纸箱和商品' }
    ]
  },
  M3_SC_001: {
    prompt: '某商品包装明确标注“保质期至2026年06月01日”。施测日期为2026年06月02日，正确判断是？',
    options: [
      { key: 'A', text: '商品已超过包装标注日期，应停止正常销售并按门店流程隔离处理' },
      { key: 'B', text: '商品还可以正常销售到2026年06月30日' },
      { key: 'C', text: '只要包装完好，就不需要核对日期' }
    ],
    candidate_answer: 'A',
    media_brief: '明确到期日识别 R7'
  },
  M3_SC_019: {
    prompt: '发现达到门店临期标准的商品后，以下哪项处理最合适？',
    options: [
      { key: 'A', text: '停止正常补货，隔离或醒目标识，登记并按门店流程报告处理' },
      { key: 'B', text: '直接丢弃，不登记也不报告' },
      { key: 'C', text: '继续留在正常货架，等下次补货时再处理' }
    ],
    candidate_answer: 'A',
    media_brief: '临期商品识别、隔离、登记和报告流程 R7'
  },
  M3_OP_043: {
    prompt: '以模拟工作日2026年09月10日为准，从5件训练商品中找出1件当天到期品和1件已过期品，分别放入临期待处理区和报损隔离区。',
    tool_brief: '稳定迷你货架1组；5件标明“教具/不可食用”的训练商品；清晰的“保质期至”标签；临期待处理区标识；报损隔离区标识；密封标准答案卡',
    rubric_criteria: [
      { criterion_id: 'r1', description: '独立识别保质期至2026年09月10日的当天到期训练品' },
      { criterion_id: 'r2', description: '独立识别保质期至2026年09月09日的已过期训练品' },
      { criterion_id: 'r3', description: '当天到期品放入临期待处理区，已过期品放入报损隔离区' },
      { criterion_id: 'r4', description: '其余3件训练品不误判' }
    ],
    sealed_admin_config: {
      simulated_date: '2026-09-10',
      standard_mapping: {
        '训练品A（保质期至2026-09-10）': '临期待处理区',
        '训练品B（保质期至2026-09-09）': '报损隔离区',
        '训练品C（保质期至2026-09-25）': '保持原位',
        '训练品D（保质期至2026-10-10）': '保持原位',
        '训练品E（保质期至2026-12-31）': '保持原位'
      }
    }
  },
  M4_SC_005: {
    prompt: '收货时发现送货单写10箱，但某品项实际只到9箱，正确做法是？',
    options: [
      { key: 'A', text: '暂停该品项核验并复点，在单据记录差异、报告负责人，再按授权处理' },
      { key: 'B', text: '不记录差异，先签收9箱，月底再统一核对' },
      { key: 'C', text: '默认停止整批所有品项收货，不再核验其他货物' }
    ],
    candidate_answer: 'A',
    media_brief: '收货数量差异复核、留痕和授权处理 R12'
  },
  M4_OP_029: {
    prompt: '按固定库位顺序清点货架上的12件目标商品，并把品类和总数量清楚地写在记录表上。',
    tool_brief: '稳定迷你货架1组；分散在固定库位的同类轻型训练商品12件；记录表；笔；密封标准答案卡',
    rubric_criteria: [
      { criterion_id: 'r1', description: '按固定库位顺序逐件清点' },
      { criterion_id: 'r2', description: '无漏数、无重复计数' },
      { criterion_id: 'r3', description: '记录表中的品类和数量清楚可识别' },
      { criterion_id: 'r4', description: '记录总数与标准答案12件一致' }
    ],
    sealed_admin_config: { expected_count: 12, count_scope: '全部固定库位中的目标训练商品' }
  },
  M5_OP_039: {
    prompt: '发现模拟水渍后，依次完成警示隔离、通知指定人员、确认清洁干燥和复检撤牌。',
    tool_brief: '防滑仿真水渍垫1张；小心地滑警示牌1个；可封闭的小型施测区域；通知对象卡；清洁完成确认卡',
    rubric_criteria: [
      { criterion_id: 'r1', description: '立即警示并隔离模拟危险区域' },
      { criterion_id: 'r2', description: '准确通知施测者指定的清洁人员或负责人' },
      { criterion_id: 'r3', description: '保持警示直至收到清洁完成确认' },
      { criterion_id: 'r4', description: '复检确认区域安全后撤牌' }
    ],
    sealed_admin_config: { notification_target: '由施测者扮演的清洁人员或负责人', real_water_forbidden: true }
  },
  M6_SC_012: {
    prompt: '零售商品上的常见条形码主要起什么作用？',
    options: [
      { key: 'A', text: '承载商品编码，扫描后由系统调取对应商品资料' },
      { key: 'B', text: '直接把商品的全部品名、规格、厂家和价格文字存进条纹中' },
      { key: 'C', text: '只用于表示包装材料和外观颜色' }
    ],
    candidate_answer: 'A',
    media_brief: '条形码、商品编码和系统资料关联关系'
  },
  M6_OP_035: {
    prompt: '依据货架区域标识和标准映射，将6件轻型训练商品放回正确区域，并做到正面朝外、放置稳定。',
    tool_brief: '稳定迷你货架1组；饮料、零食、日化3个清晰区域标识；6件轻型训练商品；密封标准映射卡',
    rubric_criteria: [
      { criterion_id: 'r1', description: '6件训练商品全部放入标准映射指定区域' },
      { criterion_id: 'r2', description: '无错放和遗漏' },
      { criterion_id: 'r3', description: '商品正面朝外' },
      { criterion_id: 'r4', description: '商品放置稳定，重物不在高位' }
    ],
    sealed_admin_config: {
      standard_mapping: {
        '训练瓶装水、训练盒装饮料': '饮料区',
        '训练饼干、训练薯片': '零食区',
        '训练洗衣液、训练纸巾': '日化区'
      }
    }
  }
}

const officialSources = [
  {
    source_id: 'GS1_GTIN',
    title: 'GS1 System Architecture Document',
    url: 'https://www.gs1.org/standards/gs1-system-architecture-document/current-standard',
    applies_to: ['M6_SC_012_V2'],
    note: 'GTIN用于识别贸易项目，扫描后关联和调取商品信息。'
  },
  {
    source_id: 'OSHA_WALKING_SURFACES',
    title: 'OSHA 29 CFR 1910.22 General requirements',
    url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.22',
    applies_to: ['M5_SC_001', 'M5_OP_039_V2'],
    note: '湿滑或有溢洒的行走表面应及时纠正，无法立即纠正时应防止人员进入。'
  },
  {
    source_id: 'HSE_RETAIL_SLIPS',
    title: 'HSE Slips and trips in retail',
    url: 'https://www.hse.gov.uk/retail/slips-and-trips.htm',
    applies_to: ['M5_SC_001', 'M5_OP_039_V2'],
    note: '标志只能警告，必要时还应使用屏障或分区阻止人员进入湿滑区域。'
  },
  {
    source_id: 'OSHA_GROCERY_PACKAGING',
    title: 'OSHA Grocery Warehousing Packaging',
    url: 'https://www.osha.gov/etools/grocery-warehousing/packaging',
    applies_to: ['M2_SC_003', 'M2_OP_027_V2'],
    note: '开箱刀具和包装操作存在割伤及人体工学风险，工具与箱体条件需受控。'
  },
  {
    source_id: 'OSHA_GROCERY_STORAGE',
    title: 'OSHA Grocery Warehousing Storage',
    url: 'https://www.osha.gov/etools/grocery-warehousing/storage',
    applies_to: ['M1_OP_033_V2', 'M4_OP_029_V2', 'M6_OP_035_V2'],
    note: '货架取放应控制触达高度、稳定性和搬运姿势。'
  }
]

function anchorsFor(questionId) {
  const review = contentReviewById.get(questionId)
  if (!review?.proposed_anchors) return null
  return {
    0: review.proposed_anchors.score_0.replaceAll('\u2014', '至').replaceAll('\u2013', '-'),
    1: review.proposed_anchors.score_1.replaceAll('\u2014', '至').replaceAll('\u2013', '-'),
    2: review.proposed_anchors.score_2.replaceAll('\u2014', '至').replaceAll('\u2013', '-')
  }
}

const candidates = originalPackage.questions.map((original) => {
  const review = contentReviewById.get(original.question_id)
  const revision = revisions[original.question_id]
  const revised = Boolean(revision)
  const questionId = revised ? `${original.question_id}_V2` : original.question_id
  const recommendationSensitive = ['M2_SC_003', 'M5_SC_001', 'M5_SC_002', 'M5_SC_009'].includes(original.question_id)
  const record = {
    question_id: questionId,
    previous_question_id: revised ? original.question_id : null,
    question_version: revised ? 2 : original.question_version,
    module: original.module,
    question_type: original.question_type,
    source_status: 'DRAFT',
    revision_status: revised ? 'REVISION_APPLIED_AWAITING_CONTENT_RECONFIRMATION' : 'CONTENT_APPROVED_V1_REUSED',
    prompt: revision?.prompt ?? original.prompt,
    target_construct: original.target_construct,
    options: revision?.options ?? original.options,
    candidate_answer: revision?.candidate_answer ?? original.candidate_answer,
    presentation: {
      type: original.presentation_type,
      media_brief: revision?.media_brief ?? original.media_brief,
      asset_ids: original.asset_ids
    },
    tools: {
      brief: revision?.tool_brief ?? original.tool_brief
    },
    rubric: {
      criteria: revision?.rubric_criteria ?? original.rubric_criteria,
      anchors: revised && original.question_type === 'OFFLINE_OPERATION' ? anchorsFor(original.question_id) : original.current_anchors,
      sealed_admin_config: revision?.sealed_admin_config ?? null
    },
    safety: {
      source_sensitive: original.safety_sensitive,
      content_reviewer_recommendation: recommendationSensitive ? 'SENSITIVE' : 'REVIEW_REQUIRED',
      content_reviewer_note: cleanReviewerText(review?.safety_note ?? review?.review_note ?? ''),
      proposed_stop_conditions: cleanReviewerText(review?.safety_note ?? '')
    },
    content_review: {
      reviewer: contentResult.reviewer.name,
      reviewed_date: contentResult.reviewer.reviewed_date,
      prior_conclusion: review.content_conclusion,
      current_status: revised ? 'AWAITING_RECONFIRMATION' : 'APPROVED',
      review_note: cleanReviewerText(review.review_note)
    },
    provenance: {
      source_file: original.source_file,
      source_row: original.source_row,
      source_ref: original.source_ref,
      based_on_question_id: original.question_id,
      based_on_candidate_record_hash: original.candidate_record_hash,
      content_review_result_id: contentResult.result_id
    },
    known_technical_gap: original.renderer_gap
  }
  return { ...record, candidate_record_hash: hash(record) }
})

const fixedIds = candidates.map((candidate) => candidate.question_id)
const strategyCandidate = {
  strategy_id: 'strategy_job_skill_shelver_v1',
  strategy_version: 2,
  strategy_name: '理货员专业岗位示范测评 v2 候选',
  strategy_type: 'JOB_SKILL_ASSESSMENT',
  job_code: 'SUPERMARKET_SHELVER',
  online_question_count: 18,
  offline_question_count: 6,
  max_score: 48,
  competent_threshold: 80,
  conditional_threshold: 60,
  module_veto_threshold: 0.5,
  question_policy: {
    schema_version: 'question-policy-v1.2',
    bank_domain: 'JOB_SPECIFIC',
    selection_mode: 'FIXED_SET',
    job_module_quotas: Object.fromEntries(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map((module) => [module, { online: 3, offline: 1 }])),
    fixed_scored_question_ids: fixedIds,
    embedded_observation_question_ids: [],
    fallback_strategy: 'BLOCK'
  },
  scoring_policy: {
    schema_version: 'scoring-policy-v1.2',
    assessment_scope: 'JOB_SKILL',
    online_score_values: [0, 2],
    offline_score_values: [0, 1, 2],
    normalization: 'raw_score/max_score*100',
    module_veto_mode: 'DISABLED_RECORD_ONLY',
    training_focus_threshold: 0.6,
    safety_override_enabled: true,
    placement_advice_enabled: false
  },
  supports_redline_halt: true,
  allows_emotion_interrupt: true,
  requires_offline_scoring: true,
  runtime_seed_status: 'NOT_INSERTED',
  activation_authorized: false
}

const candidateSet = {
  schema_version: 'job-skill-shelver-revision-candidates-v2',
  candidate_set_id: 'strategy_job_skill_shelver_v1@2-pilot-r1-candidates',
  generated_at: '2026-07-19T10:30:00+08:00',
  based_on_manifest_id: 'strategy_job_skill_shelver_v1@1-pilot-r0',
  based_on_content_result_id: contentResult.result_id,
  strategy_candidate: strategyCandidate,
  strategy_contract_hash: hash(strategyCandidate),
  summary: {
    total: 24,
    reused_content_approved_v1: candidates.filter((candidate) => candidate.question_version === 1).length,
    revised_v2_awaiting_content_reconfirmation: candidates.filter((candidate) => candidate.question_version === 2).length,
    online_total: candidates.filter((candidate) => candidate.question_type === 'SINGLE_CHOICE').length,
    offline_total: candidates.filter((candidate) => candidate.question_type === 'OFFLINE_OPERATION').length
  },
  hash_canonicalization: 'UTF-8 JSON; object keys sorted recursively; arrays retain source order; candidate_record_hash excludes itself',
  official_review_sources: officialSources,
  questions: candidates
}

const candidateSetHash = hash(candidates.map(({ question_id, question_version, candidate_record_hash }) => ({ question_id, question_version, candidate_record_hash })))
const manifest = {
  manifest_schema_version: 'pilot-fixed-set-activation-manifest-v2.0',
  manifest_id: 'strategy_job_skill_shelver_v1@2-pilot-r1',
  manifest_version: 2,
  manifest_status: 'PENDING',
  activation_authorized: false,
  review_assignment: {
    content_vocational_reviewer: '陈晓青',
    safety_reviewer: '赫东',
    technical_reviewer: '赫东',
    content_review_status: 'PARTIAL_RECONFIRMATION_REQUIRED',
    safety_review_status: 'NOT_REVIEWED',
    technical_review_status: 'NOT_REVIEWED'
  },
  scope: {
    job_code: 'SUPERMARKET_SHELVER',
    bank_domain: 'JOB_SPECIFIC',
    online_count: 18,
    offline_count: 6,
    candidate_count: 24
  },
  strategy_binding: {
    strategy_id: strategyCandidate.strategy_id,
    strategy_version: strategyCandidate.strategy_version,
    strategy_contract_hash: candidateSet.strategy_contract_hash,
    candidate_set_hash: candidateSetHash,
    candidate_source: 'doc/features/archive/job-skill-shelver-pilot-r0-v1-v2/job-skill-shelver-pilot-revision-candidates-v2.json'
  },
  gate: {
    status: 'PENDING',
    fail_closed: true,
    blocking_reasons: [
      '13 revised v2 questions await content reviewer reconfirmation',
      '24 safety reviews are not completed',
      '24 technical reviews are not completed',
      '6 offline renderer gaps remain open',
      'release commit and content-pack binding are not recorded',
      'strategy v2 and revised question records are not inserted into runtime seed'
    ]
  },
  questions: candidates.map((candidate) => ({
    question_id: candidate.question_id,
    previous_question_id: candidate.previous_question_id,
    question_version: candidate.question_version,
    module: candidate.module,
    question_type: candidate.question_type,
    source_status: candidate.source_status,
    overall_status: 'PENDING',
    candidate_record_hash: candidate.candidate_record_hash,
    content_review_status: candidate.content_review.current_status,
    safety_review_status: 'NOT_REVIEWED',
    technical_review_status: 'NOT_REVIEWED'
  }))
}

const reviewSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://xuancan.example/schemas/job-skill-shelver-pilot-safety-technical-review-result-v1.schema.json',
  title: '超市理货员 Pilot 安全与技术审核结果 v1',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'result_id', 'status', 'package', 'strategy', 'reviewer', 'summary', 'questions'],
  properties: {
    schema_version: { const: 'job-skill-safety-technical-review-result-v1' },
    result_id: { type: 'string', minLength: 1 },
    status: { const: 'SUBMITTED' },
    package: {
      type: 'object', additionalProperties: false,
      required: ['package_id', 'package_version', 'manifest_id', 'manifest_version'],
      properties: {
        package_id: { const: 'job-skill-shelver-pilot-safety-technical-review-packet-v2' },
        package_version: { const: 2 },
        manifest_id: { const: manifest.manifest_id },
        manifest_version: { const: 2 }
      }
    },
    strategy: {
      type: 'object', additionalProperties: false, required: ['strategy_id', 'strategy_version'],
      properties: { strategy_id: { const: strategyCandidate.strategy_id }, strategy_version: { const: 2 } }
    },
    reviewer: {
      type: 'object', additionalProperties: false, required: ['name', 'roles', 'reviewed_date', 'submitted_at'],
      properties: {
        name: { const: '赫东' },
        roles: { type: 'array', const: ['SAFETY_REVIEWER', 'TECHNICAL_REVIEWER'] },
        reviewed_date: { type: 'string', format: 'date' },
        submitted_at: { type: 'string', format: 'date-time' }
      }
    },
    summary: {
      type: 'object', additionalProperties: false,
      required: ['total', 'technical_pass', 'technical_return', 'safety_pass', 'safety_return', 'sensitive', 'not_sensitive', 'content_reconfirmation_pending'],
      properties: {
        total: { const: 24 },
        technical_pass: { type: 'integer', minimum: 0, maximum: 24 },
        technical_return: { type: 'integer', minimum: 0, maximum: 24 },
        safety_pass: { type: 'integer', minimum: 0, maximum: 24 },
        safety_return: { type: 'integer', minimum: 0, maximum: 24 },
        sensitive: { type: 'integer', minimum: 0, maximum: 24 },
        not_sensitive: { type: 'integer', minimum: 0, maximum: 24 },
        content_reconfirmation_pending: { const: 13 }
      }
    },
    questions: {
      type: 'array', minItems: 24, maxItems: 24,
      items: {
        type: 'object', additionalProperties: false,
        required: ['question_id', 'question_version', 'candidate_record_hash', 'renderer_review', 'data_contract_review', 'material_tool_review', 'technical_conclusion', 'safety_sensitive_decision', 'safety_review', 'safety_conclusion', 'stop_conditions', 'technical_note', 'safety_note'],
        properties: {
          question_id: { type: 'string', pattern: '^M[1-6]_(SC|OP)_[0-9]{3}(_V[2-9][0-9]*)?$' },
          question_version: { type: 'integer', enum: [1, 2] },
          candidate_record_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
          renderer_review: { enum: ['PASS', 'RETURN'] },
          data_contract_review: { enum: ['PASS', 'RETURN'] },
          material_tool_review: { enum: ['PASS', 'RETURN'] },
          technical_conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
          safety_sensitive_decision: { enum: ['SENSITIVE', 'NOT_SENSITIVE'] },
          safety_review: { enum: ['PASS', 'RETURN'] },
          safety_conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
          stop_conditions: { type: 'string', minLength: 1 },
          technical_note: { type: 'string', minLength: 1 },
          safety_note: { type: 'string', minLength: 1 }
        }
      }
    }
  }
}

const reviewPackageData = {
  package_id: 'job-skill-shelver-pilot-safety-technical-review-packet-v2',
  package_version: 2,
  manifest_id: manifest.manifest_id,
  manifest_version: 2,
  strategy_id: strategyCandidate.strategy_id,
  strategy_version: 2,
  reviewer_name: '赫东',
  generated_at: candidateSet.generated_at,
  official_sources: officialSources,
  questions: candidates
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

function buildHtml(data) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>超市理货员 Pilot 安全与技术审核</title>
<style>
:root{--canvas:oklch(97.5% .009 246);--surface:oklch(100% 0 0);--soft:oklch(95.5% .015 246);--ink:oklch(25% .025 250);--muted:oklch(51% .025 250);--line:oklch(88% .018 246);--brand:oklch(50% .15 250);--brand-soft:oklch(92% .045 250);--ok:oklch(50% .13 155);--ok-soft:oklch(94% .04 155);--warn:oklch(61% .15 62);--warn-soft:oklch(95% .055 75);--bad:oklch(52% .18 27);--bad-soft:oklch(94% .045 27);--r1:6px;--r2:10px;--r3:16px;--shadow:0 12px 32px rgba(28,46,76,.10),0 2px 8px rgba(28,46,76,.06);--head:72px}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-width:320px;background:var(--canvas);color:var(--ink);font-family:-apple-system,"SF Pro Text","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;font-size:15px;line-height:1.72;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}button,input,textarea,select{font:inherit}button,label,input,textarea,select{touch-action:manipulation}button{cursor:pointer;transition-property:transform,background-color,color;transition-duration:130ms}button:active{transform:scale(.96)}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid color-mix(in oklch,var(--brand) 32%,transparent);outline-offset:2px}.skip{position:fixed;top:8px;left:8px;z-index:500;padding:8px 12px;transform:translateY(-150%);background:var(--ink);color:white;border-radius:var(--r1)}.skip:focus{transform:translateY(0)}header{position:sticky;top:0;z-index:100;min-height:var(--head);display:flex;align-items:center;gap:20px;padding:12px 24px;color:white;background:oklch(40% .11 250);box-shadow:0 2px 12px rgba(22,44,82,.18)}header>div:first-child{min-width:0;flex:1}header h1{margin:0;font-size:20px;line-height:1.25;font-weight:760;text-wrap:balance}header p{margin:2px 0 0;color:oklch(88% .035 250);font-size:12px}.mobile-copy{display:none}.progress{width:min(360px,36vw);margin-left:auto}.progress-copy{display:flex;justify-content:space-between;gap:12px;margin-bottom:5px;color:oklch(91% .025 250);font-size:12px;font-variant-numeric:tabular-nums}.track{height:8px;overflow:hidden;background:oklch(32% .07 250);border-radius:999px}.bar{height:100%;background:oklch(79% .14 151);transform:scaleX(0);transform-origin:left;transition:transform 180ms cubic-bezier(.16,1,.3,1)}.shell{display:grid;grid-template-columns:320px minmax(0,1fr);min-height:calc(100vh - var(--head))}aside{position:sticky;top:var(--head);height:calc(100vh - var(--head));overflow:auto;padding:20px 16px calc(24px + env(safe-area-inset-bottom));background:var(--soft);box-shadow:inset -1px 0 0 var(--line)}.reviewer{padding:15px;background:var(--surface);border-radius:var(--r3);box-shadow:0 1px 3px rgba(28,46,76,.11)}.eyebrow{display:block;margin-bottom:4px;color:var(--muted);font-size:11px;font-weight:750;letter-spacing:.08em}.name{font-size:18px;font-weight:760}.label{display:block;margin:13px 0 5px;color:var(--muted);font-size:12px;font-weight:700}input,select,textarea{width:100%;border:1px solid var(--line);border-radius:var(--r2);background:var(--surface);color:var(--ink)}input,select{min-height:42px;padding:8px 11px}textarea{min-height:88px;padding:10px 12px;line-height:1.65;resize:vertical}.save{min-height:22px;margin-top:8px;color:var(--ok);font-size:12px}.filters{display:flex;flex-wrap:wrap;gap:7px;margin:16px 0 10px}.filter{min-height:40px;padding:7px 10px;border:0;border-radius:var(--r1);background:transparent;color:var(--muted);font-size:12px;font-weight:700}.filter.active{background:var(--brand-soft);color:oklch(36% .13 250)}nav{display:grid;gap:7px}.nav{width:100%;min-height:52px;display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:9px;padding:7px 9px;border:0;border-radius:var(--r2);background:transparent;color:var(--ink);text-align:left}.nav.current{background:var(--surface);box-shadow:0 1px 3px rgba(28,46,76,.12)}.num{font-size:12px;font-variant-numeric:tabular-nums}.nav strong{display:block;font-size:12px}.nav small{display:block;color:var(--muted);font-size:10px}.dot{width:9px;height:9px;border-radius:50%;background:var(--line)}.dot.done{background:var(--ok)}.dot.return{background:var(--bad)}main{width:min(1100px,100%);padding:28px clamp(18px,4vw,54px) 150px}.intro{margin-bottom:22px;padding:18px 20px;background:var(--brand-soft);border-radius:var(--r3)}.intro h2{margin:0 0 5px;font-size:18px}.intro p{margin:0;color:oklch(39% .08 250)}.card{margin-bottom:22px;padding:clamp(18px,3vw,30px);background:var(--surface);border-radius:var(--r3);box-shadow:var(--shadow)}.card[hidden]{display:none}.question-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px}.index{min-width:42px;height:42px;display:grid;place-items:center;border-radius:var(--r2);background:var(--brand-soft);color:var(--brand);font-weight:800}.question-head h2{margin:0;font-size:21px;line-height:1.35}.meta{margin-top:3px;color:var(--muted);font-size:12px}.status{margin-left:auto;padding:5px 9px;border-radius:999px;background:var(--warn-soft);color:oklch(43% .12 62);font-size:11px;font-weight:750;white-space:nowrap}.status.approved{background:var(--ok-soft);color:var(--ok)}.status.return{background:var(--bad-soft);color:var(--bad)}.notice{margin:12px 0;padding:12px 14px;border-radius:var(--r2);background:var(--warn-soft);color:oklch(39% .09 62)}.prompt{margin:16px 0 10px;font-size:18px;font-weight:720;text-wrap:pretty}.options,.criteria,.sources{margin:0;padding-left:22px}.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0}.detail{padding:12px 14px;background:var(--soft);border-radius:var(--r2)}.detail b{display:block;margin-bottom:3px;font-size:12px}.detail p{margin:0;color:var(--muted);font-size:13px;white-space:pre-wrap}.review-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:20px}.review-field{padding:14px;background:var(--soft);border-radius:var(--r2)}.review-field.full{grid-column:1/-1}.review-field .label{margin-top:0}.inline-error{min-height:18px;margin-top:4px;color:var(--bad);font-size:11px}.source-links{margin-top:16px;padding:14px;background:oklch(97% .012 155);border-radius:var(--r2)}.source-links a{color:oklch(40% .13 155)}.actions{position:fixed;right:22px;bottom:22px;z-index:120;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;max-width:calc(100vw - 44px);padding:10px;background:rgba(255,255,255,.96);border-radius:var(--r3);box-shadow:var(--shadow)}.btn{min-height:42px;padding:9px 14px;border:0;border-radius:var(--r2);font-weight:750}.secondary{background:var(--soft);color:var(--ink)}.primary{background:var(--brand);color:white}.error-summary{position:fixed;right:22px;bottom:86px;z-index:119;max-width:min(520px,calc(100vw - 44px));padding:12px 15px;background:var(--bad-soft);color:var(--bad);border-radius:var(--r2);box-shadow:var(--shadow)}@media(max-width:820px){:root{--head:86px}header{align-items:flex-start;padding:11px 14px}.desktop-copy{display:none}.mobile-copy{display:inline}.progress{width:128px;min-width:128px}.shell{display:block}aside{position:static;width:auto;height:auto;padding:14px;box-shadow:inset 0 -1px 0 var(--line)}nav{grid-template-columns:repeat(4,minmax(0,1fr));max-height:210px;overflow:auto}.nav{display:flex;min-height:44px;justify-content:center;padding:6px}.nav div:nth-child(2),.nav small{display:none}main{padding:20px 14px 170px}.detail-grid,.review-grid{grid-template-columns:1fr}.question-head{align-items:center}.question-head h2{font-size:17px}.status{display:none}.actions{right:10px;bottom:10px;max-width:calc(100vw - 20px)}.error-summary{right:10px;bottom:110px;max-width:calc(100vw - 20px)}header h1{font-size:18px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}button,.bar{transition:none}}
</style>
</head>
<body>
<a class="skip" href="#main-content">跳到审核内容</a>
<header><div><h1>超市理货员 Pilot 安全与技术审核</h1><p><span class="desktop-copy">strategy v2 候选集，24 题，审核人：赫东</span><span class="mobile-copy">v2 候选集 · 赫东</span></p></div><div class="progress"><div class="progress-copy"><span id="progress-copy">0 / 24 已填写</span><span id="progress-percent">0%</span></div><div class="track"><div class="bar" id="progress-bar"></div></div></div></header>
<div class="shell"><aside><section class="reviewer"><span class="eyebrow">审核责任人</span><div class="name">赫东</div><label class="label" for="review-date">审核日期</label><input id="review-date" type="date"><div class="save" id="save-state">尚未填写</div><label class="label" for="search">搜索题目</label><input id="search" type="search" placeholder="输入题号或题干"><div class="filters" id="filters"><button class="filter active" data-filter="all">全部</button><button class="filter" data-filter="pending">未完成</button><button class="filter" data-filter="return">有退回</button><button class="filter" data-filter="sensitive">安全敏感</button></div></section><nav id="question-nav" aria-label="题目导航"></nav></aside>
<main id="main-content"><section class="intro"><h2>审核边界</h2><p>你负责安全和技术结论。13 道修订题仍需陈晓青复确认内容，本页面不会把你的结论当成内容审核。所有字段填完后才能提交 JSON。</p></section><div id="question-list"></div></main></div>
<div class="error-summary" id="error-summary" hidden></div><div class="actions"><button class="btn secondary" id="import-btn">导入结果</button><input id="import-file" type="file" accept="application/json" hidden><button class="btn secondary" id="download-json">下载 JSON</button><button class="btn secondary" id="download-md">下载 Markdown</button><button class="btn primary" id="submit-btn">提交并生成结论</button></div>
<script id="package-data" type="application/json">${escapeScriptJson(data)}</script>
<script>
const DATA=JSON.parse(document.getElementById('package-data').textContent);const KEY='svets-safety-tech-review:'+DATA.manifest_id;const fields=['renderer_review','data_contract_review','material_tool_review','safety_sensitive_decision','safety_review','stop_conditions','technical_note','safety_note'];let state={reviewed_date:'',answers:{}};let filter='all';let query='';
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function answer(id){return state.answers[id]||(state.answers[id]={})}function techConclusion(a){return a.renderer_review==='PASS'&&a.data_contract_review==='PASS'&&a.material_tool_review==='PASS'?'PASS':'RETURN_FOR_REVISION'}function safetyConclusion(a){return a.safety_review==='PASS'?'PASS':'RETURN_FOR_REVISION'}function complete(a){return fields.every(f=>String(a[f]??'').trim())}function sources(q){return DATA.official_sources.filter(s=>s.applies_to.includes(q.question_id))}
function render(){document.getElementById('review-date').value=state.reviewed_date;const nav=document.getElementById('question-nav');const list=document.getElementById('question-list');nav.innerHTML='';list.innerHTML='';DATA.questions.forEach((q,i)=>{const a=answer(q.question_id);const done=complete(a);const returned=done&&(techConclusion(a)!=='PASS'||safetyConclusion(a)!=='PASS');const hay=(q.question_id+' '+q.prompt).toLowerCase();const visible=hay.includes(query)&&((filter==='all')||(filter==='pending'&&!done)||(filter==='return'&&returned)||(filter==='sensitive'&&a.safety_sensitive_decision==='SENSITIVE'));const n=document.createElement('button');n.className='nav'+(visible?' current':'');n.dataset.id=q.question_id;n.innerHTML='<span class="num">'+String(i+1).padStart(2,'0')+'</span><div><strong>'+esc(q.question_id)+'</strong><small>'+esc(q.module+' · '+q.question_type)+'</small></div><span class="dot '+(returned?'return':done?'done':'')+'"></span>';n.onclick=()=>{document.getElementById('card-'+i)?.scrollIntoView({behavior:'smooth',block:'start'})};nav.appendChild(n);const src=sources(q);const c=document.createElement('section');c.className='card';c.id='card-'+i;c.hidden=!visible;c.innerHTML='<div class="question-head"><div class="index">'+(i+1)+'</div><div><h2>'+esc(q.question_id)+'@'+q.question_version+'</h2><div class="meta">'+esc(q.module+' · '+q.question_type+' · '+q.candidate_record_hash.slice(0,20)+'…')+'</div></div><span class="status '+(returned?'return':done?'approved':'')+'">'+(returned?'需退回':done?'已填写':'待填写')+'</span></div>'+(q.content_review.current_status==='AWAITING_RECONFIRMATION'?'<div class="notice">此题已按陈晓青意见建立 V2 候选，但仍等待陈晓青复确认内容。请只填写安全与技术结论。</div>':'')+'<div class="prompt">'+esc(q.prompt)+'</div>'+(q.options.length?'<ol class="options">'+q.options.map(o=>'<li><b>'+esc(o.key)+'</b> '+esc(o.text)+'</li>').join('')+'</ol>':'')+(q.rubric.criteria.length?'<div class="detail"><b>评分指标</b><ol class="criteria">'+q.rubric.criteria.map(r=>'<li>'+esc(r.description)+'</li>').join('')+'</ol></div>':'')+'<div class="detail-grid"><div class="detail"><b>素材与工具</b><p>'+esc([q.presentation.media_brief,q.tools.brief].filter(Boolean).join('\\n')||'无额外材料')+'</p></div><div class="detail"><b>已知技术缺口</b><p>'+esc(q.known_technical_gap||'未记录，仍需实际渲染确认')+'</p></div><div class="detail"><b>内容审核安全意见</b><p>'+esc(q.safety.content_reviewer_note||'无专项意见')+'</p></div><div class="detail"><b>当前安全标记</b><p>source_sensitive = '+esc(q.safety.source_sensitive)+'；建议 = '+esc(q.safety.content_reviewer_recommendation)+'</p></div></div>'+(src.length?'<div class="source-links"><b>官方复核依据</b><ul class="sources">'+src.map(s=>'<li><a href="'+esc(s.url)+'" target="_blank" rel="noreferrer">'+esc(s.title)+'</a>：'+esc(s.note)+'</li>').join('')+'</ul></div>':'')+'<div class="review-grid">'+selectField(q,'renderer_review','Renderer 实际展示','PASS','通过','RETURN','退回')+selectField(q,'data_contract_review','数据合同与哈希','PASS','通过','RETURN','退回')+selectField(q,'material_tool_review','素材与工具可执行性','PASS','通过','RETURN','退回')+selectField(q,'safety_sensitive_decision','最终安全敏感标记','SENSITIVE','安全敏感','NOT_SENSITIVE','非安全敏感')+selectField(q,'safety_review','安全措施与停止条件','PASS','通过','RETURN','退回')+textField(q,'stop_conditions','停止条件','敏感题和实操题必须写明；其余题填写“无额外停止条件”')+textField(q,'technical_note','技术审核备注','记录实际展示、合同、素材或工具结论')+textField(q,'safety_note','安全审核备注','记录风险、保护措施和裁决依据')+'</div>';list.appendChild(c)});bind();updateProgress()}
function selectField(q,key,label,v1,t1,v2,t2){const value=answer(q.question_id)[key]||'';return '<div class="review-field"><label class="label" for="'+key+'-'+q.question_id+'">'+label+'</label><select id="'+key+'-'+q.question_id+'" data-id="'+q.question_id+'" data-key="'+key+'"><option value="">请选择</option><option value="'+v1+'" '+(value===v1?'selected':'')+'>'+t1+'</option><option value="'+v2+'" '+(value===v2?'selected':'')+'>'+t2+'</option></select><div class="inline-error" data-error="'+q.question_id+':'+key+'"></div></div>'}function textField(q,key,label,placeholder){const value=answer(q.question_id)[key]||'';return '<div class="review-field full"><label class="label" for="'+key+'-'+q.question_id+'">'+label+'</label><textarea id="'+key+'-'+q.question_id+'" data-id="'+q.question_id+'" data-key="'+key+'" placeholder="'+esc(placeholder)+'">'+esc(value)+'</textarea><div class="inline-error" data-error="'+q.question_id+':'+key+'"></div></div>'}
function bind(){document.querySelectorAll('[data-id][data-key]').forEach(el=>{el.oninput=()=>{answer(el.dataset.id)[el.dataset.key]=el.value;save();updateProgress()}})}function save(){state.reviewed_date=document.getElementById('review-date').value;localStorage.setItem(KEY,JSON.stringify(state));document.getElementById('save-state').textContent='已自动保存到本机'}function updateProgress(){const done=DATA.questions.filter(q=>complete(answer(q.question_id))).length;document.getElementById('progress-copy').textContent=done+' / '+DATA.questions.length+' 已填写';document.getElementById('progress-percent').textContent=Math.round(done/DATA.questions.length*100)+'%';document.getElementById('progress-bar').style.transform='scaleX('+(done/DATA.questions.length)+')'}function validate(){let errors=[];document.querySelectorAll('.inline-error').forEach(e=>e.textContent='');if(!state.reviewed_date)errors.push('请填写审核日期');DATA.questions.forEach(q=>fields.forEach(f=>{if(!String(answer(q.question_id)[f]??'').trim()){errors.push(q.question_id+'：'+f+' 未填写');const e=document.querySelector('[data-error="'+q.question_id+':'+f+'"]');if(e)e.textContent='此项必填'}}));const box=document.getElementById('error-summary');box.hidden=!errors.length;box.textContent=errors.length?'还有 '+errors.length+' 项未完成，请按红色提示补齐':'';return errors.length===0}
function result(){const qs=DATA.questions.map(q=>{const a=answer(q.question_id);return{question_id:q.question_id,question_version:q.question_version,candidate_record_hash:q.candidate_record_hash,renderer_review:a.renderer_review,data_contract_review:a.data_contract_review,material_tool_review:a.material_tool_review,technical_conclusion:techConclusion(a),safety_sensitive_decision:a.safety_sensitive_decision,safety_review:a.safety_review,safety_conclusion:safetyConclusion(a),stop_conditions:a.stop_conditions.trim(),technical_note:a.technical_note.trim(),safety_note:a.safety_note.trim()}});return{schema_version:'job-skill-safety-technical-review-result-v1',result_id:'job-skill-safety-tech-review-'+new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14),status:'SUBMITTED',package:{package_id:DATA.package_id,package_version:DATA.package_version,manifest_id:DATA.manifest_id,manifest_version:DATA.manifest_version},strategy:{strategy_id:DATA.strategy_id,strategy_version:DATA.strategy_version},reviewer:{name:DATA.reviewer_name,roles:['SAFETY_REVIEWER','TECHNICAL_REVIEWER'],reviewed_date:state.reviewed_date,submitted_at:new Date().toISOString()},summary:{total:24,technical_pass:qs.filter(q=>q.technical_conclusion==='PASS').length,technical_return:qs.filter(q=>q.technical_conclusion!=='PASS').length,safety_pass:qs.filter(q=>q.safety_conclusion==='PASS').length,safety_return:qs.filter(q=>q.safety_conclusion!=='PASS').length,sensitive:qs.filter(q=>q.safety_sensitive_decision==='SENSITIVE').length,not_sensitive:qs.filter(q=>q.safety_sensitive_decision==='NOT_SENSITIVE').length,content_reconfirmation_pending:13},questions:qs}}
function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},0)}function markdown(r){return '# 超市理货员 Pilot 安全与技术审核结论\\n\\n- 审核人：'+r.reviewer.name+'\\n- 日期：'+r.reviewer.reviewed_date+'\\n- 技术通过：'+r.summary.technical_pass+' / 24\\n- 安全通过：'+r.summary.safety_pass+' / 24\\n- 安全敏感：'+r.summary.sensitive+' / 24\\n- 待内容复确认：13\\n\\n| 题目 | 技术 | 安全 | 安全敏感 |\\n|---|---|---|---|\\n'+r.questions.map(q=>'| '+q.question_id+' | '+q.technical_conclusion+' | '+q.safety_conclusion+' | '+q.safety_sensitive_decision+' |').join('\\n')+'\\n'}
document.getElementById('review-date').onchange=()=>{state.reviewed_date=document.getElementById('review-date').value;save()};document.getElementById('search').oninput=e=>{query=e.target.value.trim().toLowerCase();render()};document.getElementById('filters').onclick=e=>{if(!e.target.dataset.filter)return;filter=e.target.dataset.filter;document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b===e.target));render()};document.getElementById('download-json').onclick=()=>{if(!validate())return;const r=result();download('job-skill-shelver-pilot-safety-technical-review-result-'+state.reviewed_date+'.json',JSON.stringify(r,null,2),'application/json')};document.getElementById('download-md').onclick=()=>{if(!validate())return;const r=result();download('job-skill-shelver-pilot-safety-technical-review-conclusion-'+state.reviewed_date+'.md',markdown(r),'text/markdown')};document.getElementById('submit-btn').onclick=()=>{if(!validate())return;const r=result();download('job-skill-shelver-pilot-safety-technical-review-result-'+state.reviewed_date+'.json',JSON.stringify(r,null,2),'application/json');download('job-skill-shelver-pilot-safety-technical-review-conclusion-'+state.reviewed_date+'.md',markdown(r),'text/markdown')};document.getElementById('import-btn').onclick=()=>document.getElementById('import-file').click();document.getElementById('import-file').onchange=async e=>{try{const imported=JSON.parse(await e.target.files[0].text());if(imported.package?.manifest_id!==DATA.manifest_id)throw new Error('manifest 不匹配');state.reviewed_date=imported.reviewer.reviewed_date;state.answers=Object.fromEntries(imported.questions.map(q=>[q.question_id,q]));render();save()}catch(err){const box=document.getElementById('error-summary');box.hidden=false;box.textContent='导入失败：'+err.message}finally{e.target.value=''}};try{const saved=JSON.parse(localStorage.getItem(KEY));if(saved)state=saved}catch{}render();
</script>
</body></html>`
}

writeFileSync(candidatePath, `${JSON.stringify(candidateSet, null, 2)}\n`)
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(reviewSchemaPath, `${JSON.stringify(reviewSchema, null, 2)}\n`)
writeFileSync(reviewPacketPath, `${buildHtml(reviewPackageData)}\n`)

console.log(`[review-pack-v2] wrote ${candidatePath}`)
console.log(`[review-pack-v2] wrote ${manifestPath}`)
console.log(`[review-pack-v2] wrote ${reviewSchemaPath}`)
console.log(`[review-pack-v2] wrote ${reviewPacketPath}`)
