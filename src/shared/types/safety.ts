// 安全事件枚举共享单一来源。
//
// schema.sql `safety_incident.reason_code` / `context_phase` 的 CHECK 约束是兜底，
// 本常量是应用层 + 渲染层的权威枚举定义。schema 改动时同步：
//   1. 本文件（枚举值 + label）
//   2. schema.sql CHECK 约束
//   3. doc/xc-career-guide-event-payload-schema-v1.0.0.md（事件规范，如涉及）
//
// 消费方：
// - 主进程 triggerRedline 等 handler：转 Set 做存在性校验
// - 渲染层 AssessmentListView：直接渲染下拉选项
//
// [!] 字段语义参见 PRD §13 安全红线优先级 + doc/xc-career-guide-json-field-schema-v1.0.0.md。

/** safety_incident.reason_code 枚举（schema.sql:812 CHECK 约束）。 */
export const SAFETY_REASON_CODES = [
  { value: 'BLADE_TOWARD_SELF', label: '刀具朝向自己' },
  { value: 'BLADE_TOWARD_OTHERS', label: '刀具朝向他人' },
  { value: 'DANGEROUS_CLIMBING', label: '危险攀爬' },
  { value: 'THROWING_OBJECT', label: '抛掷物品' },
  { value: 'AGGRESSIVE_BEHAVIOR', label: '攻击性行为' },
  { value: 'OTHER_SAFETY_RISK', label: '其他安全风险' }
] as const

/** safety_incident.context_phase 枚举（schema.sql:826 CHECK 约束）。
 *  [!] 不含 BASELINE_ASSESSMENT（那属于 strategy_type，schema CHECK 会拦截）。 */
export const SAFETY_CONTEXT_PHASES = [
  { value: 'ONLINE_ASSESSMENT', label: '线上测评' },
  { value: 'TRAINING_WATCH', label: '训练-观察' },
  { value: 'TRAINING_LEARN', label: '训练-学习' },
  { value: 'TRAINING_PRACTICE', label: '训练-练习' },
  { value: 'TRAINING_DO', label: '训练-实操' },
  { value: 'OFFLINE_SCORING', label: '线下评分' },
  { value: 'TOOL_PREPARATION', label: '工具准备' },
  { value: 'BREAK_OR_TRANSITION', label: '休息/过渡' },
  { value: 'OTHER', label: '其他' }
] as const

export type SafetyReasonCode = (typeof SAFETY_REASON_CODES)[number]['value']
export type SafetyContextPhase = (typeof SAFETY_CONTEXT_PHASES)[number]['value']
