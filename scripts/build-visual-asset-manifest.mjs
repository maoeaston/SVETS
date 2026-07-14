#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapImportRow } from './lib/question-bank-import.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const planPath = join(projectRoot, 'doc', 'reference', 'visual-asset-master-plan.md')
const manifestPath = join(projectRoot, 'doc', 'assets', 'asset-manifest.json')
const force = process.argv.slice(2).includes('--force')
if (process.argv.slice(2).some((arg) => arg !== '--force')) {
  throw new Error('[manifest-build] supported arguments: --force')
}
if (existsSync(manifestPath) && !force) {
  const existing = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const hasProductionState = existing.assets?.some((item) =>
    item.lifecycle_status !== 'planned' || item.source_path || item.file_hash || item.prompt_text
  )
  if (hasProductionState) {
    throw new Error('[manifest-build] manifest contains production state; refusing to overwrite without --force')
  }
}
const planText = readFileSync(planPath, 'utf8')
const sourceRows = JSON.parse(
  readFileSync(
    join(projectRoot, 'doc', 'reference', '专业岗位能力测评题库-M1-M6-数据库导出-298条.json'),
    'utf8'
  )
)
const jobQuestions = new Map(sourceRows.map((row) => {
  const mapped = mapImportRow(row)
  return [mapped.question_id, mapped]
}))

const REF = {
  character: 'asset_ref_r1_character_sheet',
  vest: 'asset_ref_r2_vest_standard',
  shelf: 'asset_ref_r3_shelf_standard',
  product: 'asset_ref_r4_product_masters',
  lighting: 'asset_ref_r5_lighting_camera',
  icon: 'asset_ref_r6_icon_style_board'
}

const IMAGE_MODEL = 'gpt-image-2'
const IMAGE_FALLBACK_MODEL = 'gpt-image-2-official'
const IMAGE_ROUTE = '/v1/images/generations'
const VIDEO_MODEL = 'doubao-seedance-2.0'
const VIDEO_ROUTE = '/v1/videos/generations'
const IMAGE_FALLBACK_REASONS = ['primary_unavailable', 'manual_override']

const gateNames = ['technical', 'visual', 'vocational', 'special_education', 'assessment']
const aiParams = (size, resolution = '2k') => ({
  size,
  resolution,
  n: 1
})
const videoParams = (duration = 5) => ({
  size: '16:9',
  resolution: '720p',
  duration,
  generate_audio: false
})

const promptVersions = new Map()
function promptVersion(templateId) {
  if (!templateId) return null
  if (!promptVersions.has(templateId)) {
    const template = readFileSync(
      join(projectRoot, 'doc', 'assets', 'prompt-templates', `${templateId}.txt`),
      'utf8'
    )
    const match = template.match(/^\[VERSION:\s*([^\]]+)\]$/m)
    if (!match) throw new Error(`[manifest-build] prompt template has no VERSION: ${templateId}`)
    promptVersions.set(templateId, match[1])
  }
  return promptVersions.get(templateId)
}

function reviews(requiredGates) {
  return Object.fromEntries(gateNames.map((name) => {
    const required = requiredGates.includes(name)
    return [name, {
      required,
      status: required ? 'pending' : 'waived',
      reviewer_kind: name === 'technical' ? 'script' : 'human',
      reviewer_name: null,
      reviewed_at: null,
      report_path: null,
      notes: null
    }]
  }))
}

function runtimePath(category, key, format) {
  const folders = {
    A: 'videos',
    B: 'scenes',
    C: 'products',
    D: 'damaged',
    E: 'software-task',
    F: 'ui',
    G: 'offline-video',
    REFERENCE: 'reference'
  }
  return `resources/assets/${folders[category]}/${key}.${format}`
}

function asset(input) {
  const isAi = ['ai_direct', 'ai_plus_overlay', 'composite'].includes(input.production_method)
  const isVideo = input.asset_type === 'video'
  const format = input.delivery_format ?? (input.asset_type === 'video' ? 'mp4' : 'png')
  const key = input.plan_key
  return {
    asset_id: `asset_${key}`,
    plan_key: key,
    category: input.category,
    priority: input.priority,
    description: input.description,
    question_ids: input.question_ids ?? [],
    asset_type: input.asset_type,
    asset_role: input.asset_role ?? (input.usage_mode === 'system' ? 'UI_ASSET' : 'QUESTION_MEDIA'),
    usage_mode: input.usage_mode,
    delivery_format: format,
    production_method: input.production_method,
    review_level: input.review_level ?? 'standard',
    lifecycle_status: 'planned',
    complexity_level: input.complexity_level ?? null,
    reference_pack: 'core',
    reference_asset_ids: input.reference_asset_ids ?? [],
    prompt_template_id: input.prompt_template_id ?? null,
    prompt_version: promptVersion(input.prompt_template_id),
    prompt_text: null,
    provider: input.provider ?? (isAi ? 'apimart' : 'codegen'),
    model: input.model ?? (isAi ? (isVideo ? VIDEO_MODEL : IMAGE_MODEL) : null),
    route: input.route ?? (isAi ? (isVideo ? VIDEO_ROUTE : IMAGE_ROUTE) : null),
    fallback_model: input.fallback_model ?? (isAi && !isVideo ? IMAGE_FALLBACK_MODEL : null),
    fallback_route: input.fallback_route ?? (isAi && !isVideo ? IMAGE_ROUTE : null),
    fallback_allowed_when: input.fallback_allowed_when ?? (isAi && !isVideo ? IMAGE_FALLBACK_REASONS : []),
    fallback_used: input.fallback_used ?? false,
    fallback_reason: input.fallback_reason ?? null,
    generation_params: input.generation_params ?? (isAi ? (isVideo ? videoParams() : aiParams('1:1')) : null),
    generation_date: null,
    source_path: null,
    runtime_path: input.runtime_path ?? runtimePath(input.category, key, format),
    file_hash: null,
    width_px: input.width_px ?? null,
    height_px: input.height_px ?? null,
    duration_ms: input.duration_ms ?? null,
    expected_answer: input.expected_answer ?? null,
    text_handling: input.text_handling ?? 'none',
    construct: input.construct ?? null,
    target_cue: input.target_cue ?? null,
    distractors: input.distractors ?? [],
    policy_basis: input.policy_basis ?? null,
    forbidden_visual_cues: input.forbidden_visual_cues ?? [],
    required_overlay: input.required_overlay ?? [],
    overlay_spec: input.overlay_spec ?? null,
    gate_reviews: reviews(input.required_gates ?? ['technical', 'visual']),
    ai_pre_review: null,
    rights: {
      source_type: input.rights_source ?? (isAi ? 'ai_generated' : 'original'),
      license: null,
      attribution_required: false,
      source_reference: null,
      commercial_use_cleared: input.commercial_use_cleared ?? !isAi
    },
    qa_record_paths: []
  }
}

function parseVideoRows() {
  const rows = []
  const pattern = /^\|\s*(VID_[A-F]\d{2})\s*\|\s*([A-Z0-9_]+)\s*\|\s*(.*?)\s*\|\s*(正确|错误)\s*\|$/gm
  for (const match of planText.matchAll(pattern)) {
    rows.push({ videoId: match[1], questionId: match[2], action: match[3], planAnswer: match[4] === '正确' })
  }
  if (rows.length !== 68) throw new Error(`[manifest-build] expected 68 video rows, found ${rows.length}`)
  return rows
}

function questionAnswer(questionId) {
  const question = jobQuestions.get(questionId)
  if (!question) throw new Error(`[manifest-build] question not found: ${questionId}`)
  return question.scoring_rule_json.correct_answer ?? null
}

function videoAssets() {
  const overlayIds = new Set([
    'VID_A05', 'VID_A10', 'VID_A13', 'VID_A18', 'VID_A19',
    'VID_C01', 'VID_C02', 'VID_C03', 'VID_C05', 'VID_C06', 'VID_C07', 'VID_C08', 'VID_C09',
    'VID_D01', 'VID_D02', 'VID_D03', 'VID_D04', 'VID_D05', 'VID_D06', 'VID_D07', 'VID_D08',
    'VID_F01', 'VID_F02', 'VID_F03', 'VID_F04', 'VID_F05', 'VID_F07', 'VID_F09'
  ])
  return parseVideoRows().map(({ videoId, questionId, action, planAnswer }) => {
    const [, templateCode, sequence] = videoId.match(/^VID_([A-F])(\d{2})$/)
    const expectedAnswer = questionAnswer(questionId)
    if (expectedAnswer !== planAnswer) {
      throw new Error(`[manifest-build] answer mismatch for ${questionId}: plan=${planAnswer}, question=${expectedAnswer}`)
    }
    const isSafety = videoId.startsWith('VID_E')
    const isComposite = videoId === 'VID_C04'
    const isOverlay = overlayIds.has(videoId)
    const method = isComposite ? 'composite' : isOverlay ? 'ai_plus_overlay' : 'ai_direct'
    const reviewLevel = isSafety ? 'safety_critical' :
      (isOverlay || isComposite || videoId === 'VID_A17') ? 'assessment_critical' : 'standard'
    const overlays = isOverlay ? ['题目要求的数据关键文字或界面证据'] : []
    return asset({
      plan_key: `vid_${templateCode.toLowerCase()}_${sequence}_${questionId.toLowerCase()}`,
      category: 'A',
      priority: 'P1',
      description: action,
      question_ids: [questionId],
      asset_type: 'video',
      usage_mode: 'assessment',
      production_method: method,
      review_level: reviewLevel,
      complexity_level: 'L2',
      delivery_format: 'mp4',
      reference_asset_ids: [REF.character, REF.vest, REF.shelf, REF.lighting],
      prompt_template_id: 'video-action',
      generation_params: videoParams(),
      expected_answer: expectedAnswer,
      text_handling: isOverlay ? 'programmatic' : 'none',
      construct: jobQuestions.get(questionId).content_json.target_construct,
      target_cue: action,
      policy_basis: '题库 scoring_rule_json.correct_answer 与岗位操作规范',
      forbidden_visual_cues: ['高亮正确动作', '正确/错误文字', '勾叉符号', '答案暗示音效'],
      required_overlay: overlays,
      overlay_spec: isOverlay || isComposite ? { mode: 'programmatic', source: '题库与场景叠加规格' } : null,
      required_gates: isSafety || reviewLevel !== 'standard'
        ? gateNames
        : ['technical', 'visual', 'vocational', 'special_education']
    })
  })
}

const scenes = [
  ['scene_shelf_correct_01', ['M1_DG_031'], '货架整齐、无杂物且价签对应'],
  ['scene_shelf_wrong_tilt', ['M1_DG_031'], '货架商品歪斜'],
  ['scene_shelf_wrong_sign', ['M1_DG_031'], '价签被商品遮挡'],
  ['scene_shelf_wrong_box', ['M1_DG_031'], '通道遗留空纸箱'],
  ['scene_shelf_mixed_zones', ['M1_SC_014'], '五件商品货架中的错放场景'],
  ['scene_shelf_layers', ['M2_DG_025'], '三层货架上中下层场景'],
  ['scene_shelf_m6_wrong', ['M6_DG_031'], '四件商品的部分错位场景'],
  ['scene_shelf_m6_single', ['M6_SC_011'], '单件错放商品货架场景'],
  ['scene_shelf_ref_neat', [], '整齐货架示范图'],
  ['scene_shelf_ref_messy', [], '凌乱货架示例图'],
  ['scene_warehouse', ['M4_OP_034'], '库房货架场景'],
  ['scene_barcode_label', ['M6_SC_006'], '程序生成的条形码标签特写'],
  ['scene_chips_vs_shrimp', ['M6_SC_007'], '薯片与虾片外包装对比'],
  ['scene_tea_compare', ['M6_SC_008'], '两瓶茶饮料及日期标签对比']
]

const products = [
  ['fruit_apple_01', '红富士苹果'], ['fruit_banana_01', '香蕉'], ['fruit_orange_01', '脐橙'],
  ['fruit_grape_01', '紫葡萄'], ['fruit_watermelon_01', '西瓜'], ['fruit_strawberry_01', '草莓'],
  ['drink_milk_01', '纯牛奶'], ['drink_cola_01', '可乐'], ['drink_orange_juice_01', '橙汁'],
  ['drink_water_01', '矿泉水'], ['drink_yogurt_01', '酸奶杯'], ['drink_soy_milk_01', '豆奶'],
  ['drink_soy_sauce_01', '酱油'], ['snack_chips_01', '薯片'], ['snack_cookie_01', '饼干'],
  ['snack_chocolate_01', '巧克力'], ['snack_candy_01', '糖果'], ['snack_nuts_01', '坚果'],
  ['daily_toothpaste_01', '牙膏'], ['daily_shampoo_01', '洗发水'], ['daily_tissue_01', '纸巾'],
  ['daily_soap_01', '香皂'], ['daily_laundry_01', '洗衣液'], ['drink_whole_milk_01', '全脂牛奶'],
  ['drink_skim_milk_01', '脱脂牛奶'], ['drink_soy_milk_02', '同规格豆奶'],
  ['drink_oj_pure_01', '鲜橙汁'], ['drink_orange_soda_01', '橙味汽水'],
  ['daily_dishwash_01', '洗洁精', ['M1_SC_014']], ['product_frozen_dumpling', '速冻水饺', ['M6_TF_020']],
  ['snack_shrimp_chips_01', '虾片', ['M6_SC_007']], ['drink_tea_green_01', '绿茶饮料', ['M6_SC_008']]
]

const damaged = [
  ['damaged_milk_leak_01', '牛奶盒底角破损并明显渗漏', 'both', 'ai_direct'],
  ['damaged_box_crushed_01', '饼干盒严重压瘪变形', 'both', 'ai_direct'],
  ['damaged_bag_torn_01', '薯片袋大面积撕裂并漏出内容物', 'both', 'ai_direct'],
  ['damaged_milk_expired_01_train', '过期牛奶训练版', 'training', 'ai_plus_overlay'],
  ['damaged_milk_expired_01_assess', '过期牛奶测评版', 'assessment', 'ai_plus_overlay'],
  ['damaged_bread_expired_01_train', '过期面包训练版', 'training', 'ai_plus_overlay'],
  ['damaged_bread_expired_01_assess', '过期面包测评版', 'assessment', 'ai_plus_overlay'],
  ['damaged_bread_mold_01', '面包表面中等面积霉斑', 'both', 'ai_direct'],
  ['damaged_can_dent_01', '易拉罐细微凹陷', 'both', 'ai_direct'],
  ['damaged_label_off_01', '洗发水标签边缘翘起', 'both', 'ai_direct'],
  ['damaged_discolor_01', '苹果表面轻微碰伤变色', 'both', 'ai_direct']
]

const softwareTasks = [
  ['GA-FM-010', '固定区与目标区背景'], ['GA-FM-011', '货架插槽与商品拖拽背景'],
  ['GA-FM-013', '包装盒易撕条路径'], ['GA-FM-014', '持续拖拽路径背景'],
  ['GA-FM-015', '多点触控任务背景'], ['GA-COG-013', '复杂认知交互场景'],
  ['GA-RULE-013', '带边界标记的工作区'], ['GA-RULE-016', '三步流程执行背景'],
  ['GA-EMO-001', '情绪状态选择界面背景'], ['GA-EMO-003', '错误恢复与撤销反馈背景'],
  ['GA-EMO-004', '视觉计时器背景'], ['GA-EMO-005', '任务切换提示背景'],
  ['GA-EMO-010', '情绪调节交互背景'], ['GA-SOC-001', '回应呼唤与 AAC 背景'],
  ['GA-SOC-009', '虚拟同伴社交场景'], ['GA-SAFE-014', '安全隐患交互场景']
]

const states = [
  ['state_calm', '平静'], ['state_happy', '开心'], ['state_tired', '疲惫'],
  ['state_worried', '担心'], ['state_confused', '困惑'], ['state_proud', '自豪']
]
const aac = [
  ['aac_yes', '是/好的'], ['aac_no', '不/拒绝'], ['aac_help', '需要帮助'], ['aac_wait', '请等一下'],
  ['aac_again', '请再说一次'], ['aac_done', '我完成了'], ['aac_sorry', '抱歉'], ['aac_thankyou', '谢谢']
]
const avatars = [
  ['avatar_bear', '熊'], ['avatar_rabbit', '兔子'], ['avatar_panda', '熊猫'], ['avatar_fox', '狐狸'],
  ['avatar_koala', '考拉'], ['avatar_lion', '狮子'], ['avatar_frog', '青蛙'], ['avatar_cat', '猫'],
  ['avatar_dog', '狗'], ['avatar_dolphin', '海豚']
]
const emotions = [['emotion_happy', '开心'], ['emotion_neutral', '平静'], ['emotion_sad', '轻微低落']]
const statusIcons = [
  ['icon_sos_heart', '求助入口'], ['icon_star', '得分与进度'], ['icon_medal_bronze', '铜牌成就'],
  ['icon_medal_silver', '银牌成就'], ['icon_medal_gold', '金牌成就'], ['icon_correct', '正确反馈'],
  ['icon_retry', '重试提示'], ['icon_rest', '休息提示']
]
const modules = [
  ['module_shelf_stocking', '超市理货'], ['module_packaging', '包装分拣'],
  ['module_annotation', '数据标注'], ['module_handicraft', '手工制作']
]
const zones = [
  ['zone_fruit', '水果区'], ['zone_drink', '饮品区'], ['zone_snack', '零食区'],
  ['zone_daily', '日用区'], ['zone_dairy', '乳品区'], ['zone_damaged', '报损区']
]
const shelfBackgrounds = [
  ['shelf_empty_2row', '空两层货架'], ['shelf_empty_3row', '空三层货架'],
  ['shelf_reference_neat', '整齐示范货架'], ['shelf_reference_messy', '凌乱初态货架']
]
const steps = [
  ['step_check_empty', '检查空位'], ['step_get_from_cart', '从手推车取货'],
  ['step_inspect_item', '检查商品'], ['step_place_item', '商品上架'], ['step_align_items', '规整商品']
]
const operationIcons = [
  ['icon_video_play', '视频播放'], ['icon_timer_ring', '倒计时环'], ['icon_drag_hint', '拖拽提示'],
  ['icon_touch_hint', '触控提示'], ['icon_swipe_hint', '滑动提示']
]
const backgrounds = [
  ['bg_assessment_header', '测评顶部背景', 'bg'], ['bg_report_header', '报告顶部背景', 'bg'],
  ['app_icon', '应用图标', 'app_icon'], ['splash_screen', '启动画面', 'bg']
]
const characters = [
  ['character_worker', '理货员全身像'], ['character_colleague', '虚拟同事'], ['character_supervisor', '虚拟负责人']
]
const offlineGroups = [
  ['a', '货架整理'], ['b', '日期检查'], ['c', '品质检查'],
  ['d', '拆箱补货'], ['e', '库房与收货'], ['f', '安全与社交']
]
const toolCards = [
  '安全开箱刀', '防割手套', '补货手推车', '纸箱', '价签', '扫码设备',
  '送货单', '盘点表', '警示牌', '专用清理工具', '踏台', '问题商品周转箱'
]

const assets = []
assets.push(...videoAssets())
assets.push(...scenes.map(([key, questionIds, description], index) => asset({
  plan_key: key, category: 'B', priority: index < 2 ? 'P0' : 'P1', description,
  question_ids: questionIds, asset_type: 'scene', usage_mode: questionIds.length ? 'assessment' : 'training',
  production_method: key === 'scene_barcode_label' ? 'programmatic' :
    ['scene_shelf_mixed_zones', 'scene_shelf_m6_wrong', 'scene_shelf_m6_single', 'scene_tea_compare'].includes(key)
      ? 'composite' : 'ai_direct',
  review_level: questionIds.length ? 'assessment_critical' : 'standard', complexity_level: questionIds.length ? 'L2' : 'L1',
  reference_asset_ids: [REF.shelf, REF.product, REF.lighting], prompt_template_id: key === 'scene_barcode_label' ? null : 'scene-shelf',
  generation_params: key === 'scene_barcode_label' ? null : aiParams('3:2'), text_handling: key.includes('barcode') || key.includes('tea') ? 'programmatic' : 'none',
  target_cue: description, required_overlay: key.includes('barcode') || key.includes('tea') ? ['数据关键标签'] : [],
  overlay_spec: ['scene_shelf_mixed_zones', 'scene_shelf_m6_wrong', 'scene_shelf_m6_single', 'scene_tea_compare'].includes(key)
    ? { mode: 'component-layout', source_assets: 'C 类已审核商品母版' } : null,
  forbidden_visual_cues: questionIds.length ? ['高亮正确项', '勾叉符号', '颜色答案暗示'] : [],
  required_gates: questionIds.length ? gateNames : ['technical', 'visual', 'vocational', 'special_education']
})))
assets.push(...products.map(([key, description, questionIds = []]) => asset({
  plan_key: key, category: 'C', priority: 'P0', description, question_ids: questionIds,
  asset_type: 'product_photo', usage_mode: 'both', production_method: 'ai_direct', review_level: 'assessment_critical',
  complexity_level: 'L0', reference_asset_ids: [REF.product, REF.lighting], prompt_template_id: 'product-photo',
  generation_params: aiParams('1:1'), text_handling: 'ai_reviewed', construct: '商品外观识别', target_cue: description,
  forbidden_visual_cues: ['真实品牌或商标', '日期、价格、数量、条形码或二维码'],
  required_gates: ['technical', 'visual', 'special_education', 'assessment']
})))
assets.push(...damaged.map(([key, description, usageMode, method]) => {
  const needsOverlay = method === 'ai_plus_overlay'
  return asset({
    plan_key: key, category: 'D', priority: 'P0', description, asset_type: 'damaged', usage_mode: usageMode,
    production_method: method, review_level: 'assessment_critical', complexity_level: usageMode === 'training' ? 'L1' : 'L2',
    reference_asset_ids: [REF.product, REF.lighting], prompt_template_id: 'damaged-product', generation_params: aiParams('1:1'),
    text_handling: needsOverlay ? 'programmatic' : 'none', construct: '商品品质与临期判断', target_cue: description,
    forbidden_visual_cues: usageMode === 'training' ? [] : ['已过期文字', '红叉或绿勾', '箭头', '高亮答案'],
    required_overlay: needsOverlay ? ['生产日期', '到期日期'] : [],
    overlay_spec: needsOverlay ? { mode: 'svg-canvas', source: '模拟工作日与题目日期合同' } : null,
    required_gates: gateNames
  })
}))
assets.push(...softwareTasks.map(([questionId, description]) => asset({
  plan_key: `sw_${questionId.toLowerCase().replace(/-/g, '_')}`, category: 'E', priority: 'P1', description,
  question_ids: [questionId], asset_type: 'software_task', usage_mode: 'assessment', production_method: 'composite',
  review_level: questionId.startsWith('GA-SAFE') ? 'safety_critical' : 'assessment_critical', complexity_level: 'L1',
  reference_asset_ids: [REF.icon, REF.shelf], prompt_template_id: 'software-task', generation_params: aiParams('3:2'),
  text_handling: 'programmatic', construct: '软件行为任务交互', target_cue: description,
  forbidden_visual_cues: ['答案高亮', '颜色作为唯一信息通道'], required_overlay: ['交互控件与文字标签'],
  overlay_spec: { mode: 'frontend-component', source: '题库 content_json.interaction' }, required_gates: gateNames
})))
assets.push(...states.map(([key, description]) => asset({
  plan_key: key, category: 'E', priority: 'P0', description, question_ids: ['GA-EMO-001', 'GA-EMO-003', 'GA-EMO-005'],
  asset_type: 'emotion_svg', usage_mode: 'system', delivery_format: 'svg', production_method: 'programmatic',
  reference_asset_ids: [REF.icon], target_cue: description, required_gates: ['technical', 'visual', 'special_education']
})))
assets.push(...aac.map(([key, description]) => asset({
  plan_key: key, category: 'E', priority: 'P0', description,
  question_ids: ['GA-SOC-001', 'GA-SOC-002', 'GA-SOC-003', 'GA-SOC-004', 'GA-SOC-005', 'GA-SOC-006', 'GA-SOC-007'],
  asset_type: 'aac_svg', usage_mode: 'system', delivery_format: 'svg', production_method: 'programmatic',
  reference_asset_ids: [REF.icon], target_cue: description, commercial_use_cleared: false,
  required_gates: ['technical', 'visual', 'special_education']
})))
assets.push(...avatars.map(([key, description]) => asset({
  plan_key: key, category: 'F', priority: 'P0', description: `${description}学生头像`, asset_type: 'avatar', usage_mode: 'system',
  production_method: 'ai_direct', reference_asset_ids: [REF.icon], prompt_template_id: 'avatar', generation_params: aiParams('1:1'),
  target_cue: description, required_gates: ['technical', 'visual', 'special_education']
})))
assets.push(...emotions.map(([key, description]) => asset({
  plan_key: key, category: 'F', priority: 'P0', description, asset_type: 'emotion_svg', usage_mode: 'system',
  delivery_format: 'svg', production_method: 'programmatic', reference_asset_ids: [REF.icon], target_cue: description,
  required_gates: ['technical', 'visual', 'special_education']
})))
for (const [key, description] of [...statusIcons, ...modules, ...zones]) {
  assets.push(asset({
    plan_key: key, category: 'F', priority: 'P0', description, asset_type: 'icon_svg', usage_mode: 'system',
    delivery_format: 'svg', production_method: 'programmatic', reference_asset_ids: [REF.icon], target_cue: description,
    required_gates: ['technical', 'visual', 'special_education']
  }))
}
assets.push(...shelfBackgrounds.map(([key, description]) => asset({
  plan_key: key, category: 'F', priority: 'P0', description, asset_type: 'bg', usage_mode: 'system',
  production_method: 'ai_direct', reference_asset_ids: [REF.shelf, REF.product, REF.lighting], prompt_template_id: 'scene-shelf',
  generation_params: aiParams('3:2'), target_cue: description, required_gates: ['technical', 'visual', 'special_education']
})))
assets.push(...steps.map(([key, description]) => asset({
  plan_key: key, category: 'F', priority: 'P2', description, asset_type: 'step_illustration', usage_mode: 'training',
  production_method: 'ai_direct', reference_asset_ids: [REF.character, REF.vest, REF.shelf, REF.lighting], prompt_template_id: 'character',
  generation_params: aiParams('1:1'), target_cue: description, required_gates: ['technical', 'visual', 'vocational', 'special_education']
})))
assets.push(...operationIcons.map(([key, description]) => asset({
  plan_key: key, category: 'F', priority: 'P1', description, asset_type: 'icon_svg', usage_mode: 'system',
  delivery_format: 'svg', production_method: 'programmatic', reference_asset_ids: [REF.icon], target_cue: description,
  required_gates: ['technical', 'visual', 'special_education']
})))
assets.push(...characters.map(([key, description]) => asset({
  plan_key: key, category: 'F', priority: 'P1', description, asset_type: 'character', usage_mode: 'system',
  production_method: 'ai_direct', reference_asset_ids: [REF.character, REF.vest, REF.lighting], prompt_template_id: 'character',
  generation_params: aiParams('1:1'), target_cue: description, required_gates: ['technical', 'visual', 'vocational', 'special_education']
})))
assets.push(...backgrounds.map(([key, description, type]) => asset({
  plan_key: key, category: 'F', priority: 'P1', description, asset_type: type, usage_mode: 'system',
  production_method: 'ai_direct', reference_asset_ids: [REF.shelf, REF.icon, REF.lighting],
  prompt_template_id: type === 'app_icon' ? 'icon-flat' : 'scene-shelf', generation_params: aiParams(type === 'app_icon' ? '1:1' : '16:9'),
  target_cue: description, required_gates: ['technical', 'visual', 'special_education']
})))
for (const [code, name] of offlineGroups) {
  assets.push(asset({
    plan_key: `offline_demo_${code}_video`, category: 'G', priority: 'P2', description: `${name}操作示范视频`,
    asset_type: 'video', asset_role: 'TOOL_CHECKLIST', usage_mode: 'training', delivery_format: 'mp4', production_method: 'ai_direct',
    review_level: code === 'f' ? 'safety_critical' : 'standard', reference_asset_ids: [REF.character, REF.vest, REF.shelf, REF.lighting],
    prompt_template_id: 'offline-video', generation_params: videoParams(8),
    target_cue: `${name}规范流程`, required_gates: gateNames
  }))
  assets.push(asset({
    plan_key: `offline_process_${code}`, category: 'G', priority: 'P2', description: `${name}流程步骤条`,
    asset_type: 'process_strip', asset_role: 'TOOL_CHECKLIST', usage_mode: 'training', production_method: 'composite',
    reference_asset_ids: [REF.character, REF.shelf, REF.icon], prompt_template_id: 'offline-demo', generation_params: aiParams('3:2'),
    text_handling: 'programmatic', target_cue: `${name}的 2-4 步操作流程`, required_overlay: ['步骤编号', '动作短句'],
    overlay_spec: { mode: 'svg-canvas', source: '线下施测操作合同' }, required_gates: gateNames
  }))
}
assets.push(...toolCards.map((description, index) => asset({
  plan_key: `offline_tool_${String(index + 1).padStart(2, '0')}`, category: 'G', priority: 'P2', description,
  asset_type: 'tool_card', asset_role: 'TOOL_CHECKLIST', usage_mode: 'training', production_method: 'ai_direct',
  reference_asset_ids: [REF.product, REF.lighting], prompt_template_id: 'product-photo', generation_params: aiParams('1:1'),
  target_cue: description, required_gates: ['technical', 'visual', 'vocational', 'special_education']
})))

const references = [
  ['ref_r1_character_sheet', '理货员角色设定图', 'character'],
  ['ref_r2_vest_standard', '绿色工作马甲标准图', 'product-photo'],
  ['ref_r3_shelf_standard', '三层货架主场景标准图', 'scene-shelf'],
  ['ref_r4_product_masters', '商品品类标准母版包', 'product-photo'],
  ['ref_r5_lighting_camera', '光照、机位、色温和镜头距离参考板', 'scene-shelf'],
  ['ref_r6_icon_style_board', '图标风格九宫格总览板', 'icon-flat']
]
assets.push(...references.map(([key, description, prompt]) => asset({
  plan_key: key, category: 'REFERENCE', priority: 'REFERENCE', description, asset_type: 'reference', asset_role: 'OTHER',
  usage_mode: 'production', production_method: 'ai_direct', reference_asset_ids: [], prompt_template_id: prompt,
  generation_params: aiParams('1:1'), target_cue: description, required_gates: ['technical', 'visual']
})))

const expectedCounts = { A: 68, B: 14, C: 32, D: 11, E: 30, F: 52, G: 24, REFERENCE: 6 }
for (const [category, expected] of Object.entries(expectedCounts)) {
  const actual = assets.filter((item) => item.category === category).length
  if (actual !== expected) throw new Error(`[manifest-build] ${category} expected ${expected}, found ${actual}`)
}

const ids = assets.map((item) => item.asset_id)
if (new Set(ids).size !== ids.length) throw new Error('[manifest-build] duplicate asset_id generated')

assets.sort((a, b) => a.category.localeCompare(b.category) || a.asset_id.localeCompare(b.asset_id))
const manifest = {
  $schema: './asset-manifest.schema.json',
  version: '0.3.1',
  plan_version: 'v1.2.4-video-sop',
  generated_at: '2026-07-14T16:30:00+08:00',
  assets
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`[manifest-build] wrote ${assets.length} assets to ${manifestPath}`)
