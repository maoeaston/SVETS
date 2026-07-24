import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { hashRecord } from './job-skill-contract-hash.mjs'

export const DELIVERY_GENERATED_AT = '2026-07-22T14:50:00+08:00'
export const DELIVERY_IMAGE_REQUIREMENT = '绑定唯一图片/示例图资产'
export const DATE_REQUIREMENT = '固定模拟工作日'
export const SCRIPT_REQUIREMENT = '提供逐字脚本'

export const OFFLINE_EXAMPLE_SOURCE_IDS = [
  'M1_OP_043',
  'M4_OP_034',
  'M6_OP_040',
  'M6_OP_047'
]

export const AUDIO_CONTRACTS = [
  {
    source_question_id: 'M4_OP_041',
    plan_key: 'delivery_audio_inventory_interruption',
    description: '库存盘点中断提示音，固定 2 秒、65-70 dBA、播放一次',
    duration_ms: 2000
  },
  {
    source_question_id: 'M5_OP_045',
    plan_key: 'delivery_audio_evacuation_signal',
    description: '紧急疏散信号，固定 8 秒、70-75 dBA、播放一次',
    duration_ms: 8000
  },
  {
    source_question_id: 'M5_OP_053',
    plan_key: 'delivery_audio_abnormal_equipment_noise',
    description: '断电设备异常噪声模拟，固定 5 秒、65-70 dBA、播放一次',
    duration_ms: 5000
  }
]

const TOOL_ASSET_BY_TOKEN = [
  ['开箱', 'asset_offline_tool_01'],
  ['手套', 'asset_offline_tool_02'],
  ['纸箱', 'asset_offline_tool_04'],
  ['价签', 'asset_offline_tool_05'],
  ['扫码', 'asset_offline_tool_06'],
  ['送货单', 'asset_offline_tool_07'],
  ['盘点', 'asset_offline_tool_08'],
  ['警示', 'asset_offline_tool_09'],
  ['清洁', 'asset_offline_tool_10'],
  ['踏脚', 'asset_offline_tool_11'],
  ['问题商品', 'asset_offline_tool_12']
]

function readJson(root, path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'))
}

export function sourceQuestionId(questionId) {
  return questionId.replace(/_V\d+$/, '')
}

export function loadRetainedQuestions(root) {
  const authority = readJson(root, 'doc/features/job-skill-shelver-298-disposition-authority-v1.json')
  const nonPilot = readJson(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v1.json')
  const targetedV3 = readJson(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v3.json')
  const targetedV4 = readJson(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v4.json')
  const targetedV5 = readJson(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v5.json')
  const targetedV6 = readJson(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v6.json')
  const targetedV6Gate = readJson(root, 'doc/features/job-skill-shelver-298-targeted-v6-rereview-merged-gate-v1.json')
  const replacementV2 = readJson(root, 'doc/features/job-skill-shelver-298-rejected-replacement-candidates-v2.json')
  const replacementV3 = readJson(root, 'doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.json')
  const replacementV4 = readJson(root, 'doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v4.json')
  const replacementGate = readJson(root, 'doc/features/job-skill-shelver-298-rejected-replacement-targeted-v4-rereview-merged-gate-v1.json')
  const pilot = readJson(root, 'doc/features/job-skill-shelver-pilot-revision-candidates-v3.json')

  const byCurrentId = new Map()
  const bySourceId = new Map()
  for (const candidateSet of [
    nonPilot,
    targetedV3,
    targetedV4,
    targetedV5,
    targetedV6,
    replacementV2,
    replacementV3,
    replacementV4
  ]) {
    for (const question of candidateSet.questions) {
      if (byCurrentId.has(question.question_id)) {
        throw new Error(`[delivery-contract] duplicate current question: ${question.question_id}`)
      }
      const effective = {
        current_question_id: question.question_id,
        current_question_version: question.question_version,
        source_question_id: question.source_question_id,
        semantic_hash: question.new_semantic_hash,
        candidate_record_hash: question.candidate_record_hash,
        module: question.module,
        question_type: question.question_type,
        prompt: question.proposed_question.content.prompt,
        content: question.proposed_question.content,
        scoring_rule: question.proposed_question.scoring_rule,
        material_requirement: question.revision_application?.material_tool_requirement ?? question.proposed_question.content.offline_tool_brief ?? '',
        tool_brief: question.proposed_question.content.offline_tool_brief ?? null
      }
      byCurrentId.set(question.question_id, effective)
      bySourceId.set(question.source_question_id, effective)
    }
  }
  for (const question of pilot.questions) {
    if (byCurrentId.has(question.question_id)) {
      throw new Error(`[delivery-contract] duplicate current question: ${question.question_id}`)
    }
    const effective = {
      current_question_id: question.question_id,
      current_question_version: question.question_version,
      source_question_id: sourceQuestionId(question.question_id),
      semantic_hash: question.new_semantic_hash,
      candidate_record_hash: question.candidate_record_hash,
      module: question.module,
      question_type: question.question_type,
      prompt: question.prompt,
      content: question,
      scoring_rule: question.rubric,
      material_requirement: question.tools?.brief ?? '',
      tool_brief: question.tools?.brief ?? null
    }
    byCurrentId.set(question.question_id, effective)
    bySourceId.set(effective.source_question_id, effective)
  }

  const targetedBySourceId = new Map()
  for (const gateQuestion of targetedV6Gate.questions ?? []) {
    if (gateQuestion.status !== 'PASSED' && gateQuestion.status !== 'PASSED_REFERENCE') continue
    const candidate = byCurrentId.get(gateQuestion.question_id)
    if (!candidate) throw new Error(`[delivery-contract] targeted V6 candidate missing: ${gateQuestion.question_id}`)
    targetedBySourceId.set(candidate.source_question_id, candidate)
  }

  const replacementBySourceId = new Map()
  for (const reference of replacementGate.cumulative_passed_references ?? []) {
    const candidate = byCurrentId.get(reference.question_id)
    if (!candidate) throw new Error(`[delivery-contract] replacement candidate missing: ${reference.question_id}`)
    replacementBySourceId.set(candidate.source_question_id, candidate)
  }

  const retained = authority.questions
    .filter((question) => question.disposition !== 'REJECTED')
    .map((question) => {
      const baseEffective = byCurrentId.get(question.current_question_id)
      const effective = replacementBySourceId.get(question.source_question_id)
        ?? targetedBySourceId.get(question.source_question_id)
        ?? baseEffective
        ?? bySourceId.get(question.source_question_id)
      if (!effective) throw new Error(`[delivery-contract] current question missing: ${question.current_question_id}`)
      if (effective.source_question_id !== question.source_question_id) {
        throw new Error(`[delivery-contract] source/current mismatch: ${question.source_question_id}`)
      }
      return {
        ...effective,
        material_requirement: baseEffective?.material_requirement || effective.material_requirement,
        tool_brief: effective.tool_brief ?? baseEffective?.tool_brief ?? null,
        authority: {
          ...question,
          current_question_id: effective.current_question_id,
          current_question_version: effective.current_question_version,
          semantic_hash: effective.semantic_hash ?? question.semantic_hash,
          candidate_record_hash: effective.candidate_record_hash ?? question.candidate_record_hash
        }
      }
    })

  if (retained.length !== 298) throw new Error(`[delivery-contract] expected 298 retained questions, found ${retained.length}`)
  return { authority, retained }
}

export function loadDeliveryInputs(root) {
  const { authority, retained } = loadRetainedQuestions(root)
  const assetManifest = readJson(root, 'doc/assets/asset-manifest.json')
  return { authority, retained, assetManifest }
}

export function expectedAnswer(question) {
  if (Object.hasOwn(question.content, 'expected_answer')) return question.content.expected_answer
  if (Object.hasOwn(question.scoring_rule ?? {}, 'correct_answer')) return question.scoring_rule.correct_answer
  if (Object.hasOwn(question.content, 'candidate_answer')) return question.content.candidate_answer
  return null
}

export function deliveryGroups(retained) {
  const offline = retained.filter((question) => question.question_type === 'OFFLINE_OPERATION')
  const imageAll = retained.filter((question) => question.material_requirement.startsWith(DELIVERY_IMAGE_REQUIREMENT))
  const offlineExampleIds = new Set(OFFLINE_EXAMPLE_SOURCE_IDS)
  const image = imageAll.filter((question) => !offlineExampleIds.has(question.source_question_id))
  const offlineExamples = imageAll.filter((question) => offlineExampleIds.has(question.source_question_id))
  const date = offline.filter((question) =>
    question.material_requirement.includes(DATE_REQUIREMENT) ||
    /模拟工作日|模拟日期/.test(question.prompt)
  )
  const script = offline.filter((question) => question.material_requirement.includes(SCRIPT_REQUIREMENT))

  const assertions = [
    [offline.length, 100, 'offline'],
    [image.length, 13, 'image'],
    [offlineExamples.length, 4, 'offline example image'],
    [date.length, 20, 'date'],
    [script.length, 13, 'script']
  ]
  for (const [actual, expected, name] of assertions) {
    if (actual !== expected) throw new Error(`[delivery-contract] expected ${expected} ${name} questions, found ${actual}`)
  }
  return { offline, image, offlineExamples, date, script }
}

function setupItems(question) {
  const text = `${question.prompt} ${question.material_requirement} ${question.tool_brief ?? ''}`
  const ids = new Set(['station_stable_work_surface', 'kit_reset_checklist'])
  if (/货架|上架|商品|价签|库存|库房/.test(text)) ids.add('shelf_three_tier')
  if (/商品|货物|货架|库存|上架|品类|扫码|召回/.test(text)) ids.add('products_general_set')
  if (/日期|到期|临期|先进先出|FIFO|保质期/.test(text)) {
    ids.add('products_fixed_date_set_g01_g12_g15_g16')
    ids.add('simulated_work_date_sign')
    ids.add('zone_expiry_handling')
  }
  if (/破损|问题商品|报损|玻璃|安全隐患/.test(text)) {
    ids.add('boundary_samples_d01_d05')
    ids.add('zone_problem_goods')
    ids.add('ppe_cut_resistant_gloves')
  }
  if (/拆箱|纸箱|收货|入库|搬运/.test(text)) ids.add('cartons_b01_b03')
  if (/开箱/.test(text)) ids.add('safe_box_cutter')
  if (/送货单|收货|入库|拣货/.test(text)) ids.add('delivery_document_set')
  if (/盘点|记录|写|登记|清点/.test(text)) ids.add('recording_stationery_set')
  if (/扫码|条形码/.test(text)) ids.add('offline_scanner_with_sku_json')
  if (/冷链|冷冻|冷藏/.test(text)) ids.add('cold_chain_samples_and_zone_labels')
  if (/角色|顾客|同事|负责人|求助|投诉|中断|上报|疏散/.test(text)) ids.add('role_play_badges')
  if (/清洁|水渍|碎片/.test(text)) ids.add('safe_cleanup_set')
  if (/召回/.test(text)) ids.add('recall_marker_set')
  if (/计时|分钟|限时/.test(text)) ids.add('software_visible_timer')
  if (/设备|噪声/.test(text)) ids.add('powered_off_equipment_prop')
  if (/踏脚|高处|超高/.test(text)) ids.add('folding_step_stool')
  return [...ids].sort()
}

function setupAssets(question, groups) {
  const assets = new Set()
  const text = `${question.prompt} ${question.material_requirement}`
  for (const [token, assetId] of TOOL_ASSET_BY_TOKEN) if (text.includes(token)) assets.add(assetId)
  if (groups.script.some((item) => item.source_question_id === question.source_question_id)) {
    assets.add(`asset_delivery_script_${question.source_question_id.toLowerCase()}`)
  }
  if (OFFLINE_EXAMPLE_SOURCE_IDS.includes(question.source_question_id)) {
    assets.add(`asset_delivery_answer_image_${question.source_question_id.toLowerCase()}`)
  }
  for (const audio of AUDIO_CONTRACTS) {
    if (audio.source_question_id === question.source_question_id) assets.add(`asset_${audio.plan_key}`)
  }
  return [...assets].sort()
}

export function buildOfflineSetups(retained) {
  const groups = deliveryGroups(retained)
  return groups.offline.map((question) => {
    const itemIds = setupItems(question)
    const assetIds = setupAssets(question, groups)
    return {
      setup_id: `setup_${question.current_question_id.toLowerCase()}`,
      source_question_id: question.source_question_id,
      current_question_id: question.current_question_id,
      module: question.module,
      status: 'LOCKED_FOR_PRODUCTION',
      item_ids: itemIds,
      asset_ids: assetIds,
      public_instruction: `按清单布置“${question.prompt}”所需材料；开始前确认数量、位置和安全状态。`,
      reset_instruction: '按 item_ids 逐项复位并核对数量；一次性耗材按 v2.2 补充规则更换。',
      answer_contract_hash: hashRecord({
        prompt: question.prompt,
        scoring_rule: question.scoring_rule,
        item_ids: itemIds,
        asset_ids: assetIds
      })
    }
  }).sort((a, b) => a.current_question_id.localeCompare(b.current_question_id))
}

export function deliveryAssetSpecs(retained) {
  const groups = deliveryGroups(retained)
  const bySource = currentBySource(retained)
  const imageQuestions = [...groups.image, ...groups.offlineExamples]
  const images = imageQuestions.map((question) => ({
    source_question_id: question.source_question_id,
    current_question_id: question.current_question_id,
    plan_key: `delivery_answer_image_${question.source_question_id.toLowerCase()}`,
    description: `唯一答案图：${question.prompt}`,
    expected_answer: expectedAnswer(question),
    answer_contract_hash: hashRecord({ content: question.content, scoring_rule: question.scoring_rule })
  }))
  const scripts = groups.script.map((question) => ({
    source_question_id: question.source_question_id,
    current_question_id: question.current_question_id,
    plan_key: `delivery_script_${question.source_question_id.toLowerCase()}`,
    description: `唯一施测脚本：${question.prompt}`,
    answer_contract_hash: hashRecord({ prompt: question.prompt, scoring_rule: question.scoring_rule })
  }))
  const audios = AUDIO_CONTRACTS.map((audio) => ({
    ...audio,
    current_question_id: bySource.get(audio.source_question_id)?.current_question_id ?? null
  }))
  return { images, scripts, audios }
}

export function currentBySource(retained) {
  return new Map(retained.map((question) => [question.source_question_id, question]))
}
