// 实操评分（Operation Scoring）共享类型
// 对应 doc/features/operation-scoring-prd.md v1.0.1

// ---------------------------------------------------------------------------
// 9 个实操评分项枚举
// ---------------------------------------------------------------------------

export const TASK_OPERATION_CODES = [
  'IDENTIFY_BOX',
  'CHECK_BOX_DAMAGE',
  'OPEN_PACKAGE_SAFELY',
  'TAKE_OUT_GOODS',
  'CHECK_GOODS_APPEARANCE',
  'IDENTIFY_SHELF_POSITION',
  'PLACE_BY_RULE',
  'TIDY_SHELF_FACE',
  'CONFIRM_COMPLETION'
] as const

export type TaskOperationCode = typeof TASK_OPERATION_CODES[number]

// ---------------------------------------------------------------------------
// 评分标准（Rubric）— MVP 硬编码，覆盖"拆箱与上架"9 项操作
// ---------------------------------------------------------------------------

export interface RubricLevel {
  score: 0 | 1 | 2
  description: string
}

export interface OperationRubric {
  code: TaskOperationCode
  name: string
  rubric: RubricLevel[]
}

export const OPERATION_RUBRICS: OperationRubric[] = [
  {
    code: 'IDENTIFY_BOX',
    name: '识别箱子',
    rubric: [
      { score: 0, description: '无法识别箱子信息（货品名称、数量、保质期等），需全程指导' },
      { score: 1, description: '能识别部分箱子信息，但存在遗漏或需要提示' },
      { score: 2, description: '独立准确识别箱子上的全部关键信息（货品名称、数量、批次/保质期）' }
    ]
  },
  {
    code: 'CHECK_BOX_DAMAGE',
    name: '检查箱子破损',
    rubric: [
      { score: 0, description: '未检查箱子破损或检查后未作记录/报告' },
      { score: 1, description: '进行了基本检查，但遗漏了局部破损或未按流程处理异常' },
      { score: 2, description: '系统检查箱体四面及底部，发现破损时按流程暂停上架并上报' }
    ]
  },
  {
    code: 'OPEN_PACKAGE_SAFELY',
    name: '安全开包',
    rubric: [
      { score: 0, description: '开包方式不安全（如用尖锐物品乱割），存在商品损坏或人身安全风险' },
      { score: 1, description: '开包方式基本安全，但切割位置不准确或用力过猛导致商品轻微受损' },
      { score: 2, description: '使用安全工具、沿预切线准确开包，商品完好，无安全隐患' }
    ]
  },
  {
    code: 'TAKE_OUT_GOODS',
    name: '取出商品',
    rubric: [
      { score: 0, description: '取出商品时拖拽、翻倒，导致商品损坏或散落' },
      { score: 1, description: '取出动作基本规范，但速度过快或姿势不当，偶有碰撞' },
      { score: 2, description: '双手稳持商品，按序逐件取出，无商品损坏或跌落' }
    ]
  },
  {
    code: 'CHECK_GOODS_APPEARANCE',
    name: '检查商品外观',
    rubric: [
      { score: 0, description: '未检查商品外观，或将破损/过期商品直接上架' },
      { score: 1, description: '进行了外观检查，但遗漏了部分破损或保质期核查' },
      { score: 2, description: '逐件检查外观完整性及保质期，破损/临期/过期商品单独隔离处理' }
    ]
  },
  {
    code: 'IDENTIFY_SHELF_POSITION',
    name: '识别货架位置',
    rubric: [
      { score: 0, description: '无法对应货品与货架位置，需教师全程指导才能找到位置' },
      { score: 1, description: '能找到大致区域，但需要提示才能确认具体货位' },
      { score: 2, description: '独立根据箱标信息（品类、品牌、规格）准确定位对应货架层位' }
    ]
  },
  {
    code: 'PLACE_BY_RULE',
    name: '按规则上架',
    rubric: [
      { score: 0, description: '未遵守先进先出原则，或摆放方向/间距明显错误' },
      { score: 1, description: '基本遵守先进先出，但摆放整齐度或标签朝向存在问题' },
      { score: 2, description: '严格先进先出，标签朝外，间距均匀，新货补充到旧货后方' }
    ]
  },
  {
    code: 'TIDY_SHELF_FACE',
    name: '整理货架面',
    rubric: [
      { score: 0, description: '上架后货架面凌乱，未进行整理' },
      { score: 1, description: '进行了基本整理，但货架面仍有明显不整齐' },
      { score: 2, description: '上架后主动拉前排、对齐标签，货架面整洁美观' }
    ]
  },
  {
    code: 'CONFIRM_COMPLETION',
    name: '确认完成',
    rubric: [
      { score: 0, description: '未确认任务完成，遗留箱体/废料未处理，直接离开' },
      { score: 1, description: '进行了部分确认，但遗留废料处理或未向教师报告完成' },
      { score: 2, description: '清点剩余商品、收拣废料/空箱、向教师报告任务完成' }
    ]
  }
]

// ---------------------------------------------------------------------------
// OPERATION_PASS_RATE result_payload_json 结构
// ---------------------------------------------------------------------------

export interface OperationPassRatePayload {
  result_type: 'OPERATION_PASS_RATE'
  items: { task_operation_code: TaskOperationCode; score: 0 | 1 | 2 }[]
  raw_score: number
  max_score: 18
  total_items: 9
}

// ---------------------------------------------------------------------------
// 错误码
// ---------------------------------------------------------------------------

export type OperationScoringErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'BLOCKED_BY_SAFETY_INCIDENT'
  | 'ASSESSMENT_SYSTEM_ERROR'
  | 'SESSION_NOT_OFFLINE_PENDING'
  | 'ALREADY_SCORED'
  | 'TOOL_CHECKLIST_NOT_CONFIRMED'

// ---------------------------------------------------------------------------
// IPC 参数与返回类型
// ---------------------------------------------------------------------------

export interface ScoreItem {
  taskOperationCode: TaskOperationCode
  score: 0 | 1 | 2
  observationNote?: string
}

export interface SubmitOperationScoresParams {
  callerUserId: string
  callerRole: string
  sessionId: string
  toolChecklistConfirmed: boolean
  scores: ScoreItem[]
}

export interface SubmitOperationScoresSuccess {
  success: true
  resultId: string
  normalizedScore: number
  levelResult: string
}

export type SubmitOperationScoresResult =
  | SubmitOperationScoresSuccess
  | { success: false; errorCode: OperationScoringErrorCode }

export interface GetOperationScoresParams {
  callerUserId: string
  callerRole: string
  sessionId: string
}

export interface OperationScoreItem {
  taskOperationCode: TaskOperationCode
  score: 0 | 1 | 2
  observationNote: string | null
  scoredAt: string
}

export interface GetOperationScoresSuccess {
  success: true
  items: OperationScoreItem[]
  resultId?: string
  normalizedScore?: number
  levelResult?: string
}

export type GetOperationScoresResult =
  | GetOperationScoresSuccess
  | { success: false; errorCode: OperationScoringErrorCode }
