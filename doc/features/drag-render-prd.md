# DRAG题拖拽渲染组件 — Mini-PRD

版本：v0.1  
功能代号：drag-render  
关联 PRD：PRD v1.0.6 §2.4（线上 42 题含拖拽题）  
日期：2026-07-10

---

## 功能名称

DRAG题拖拽渲染组件（DragDropQuestion.vue）

---

## 解决的问题

`AssessmentView.vue` 中当前 DRAG 题的渲染是 select-per-item 的下拉选择（MVP 占位），无法传达"把商品拖到货架格位"的空间意图，导致：

1. 精细动作/认知能力评估失效——学生读下拉列表而非做空间判断
2. 图像资产（货架底图 + 商品图）未展示，题目无意义
3. 两道已完成设计的 DRAG 题（`Q_BASE_FINE_MOTOR_DRAG_002`、`Q_BASE_FINE_MOTOR_DRAG_005`）卡在 DRAFT 状态无法激活

---

## 用户角色

- **STUDENT**：拖拽操作的执行者（主要）
- **TEACHER**：旁观施测，不直接操作拖拽。TEACHER 不通过 AssessmentView.vue 观看实时题目，`DragDropQuestion.vue` 不需要实现只读/禁用模式

---

## 核心使用场景

1. 学生进入测评，遇到 DRAG 类题目
2. 屏幕上显示货架底图（背景）+ 右侧/下方可拖拽商品卡片区
3. 学生将商品卡片拖入对应货架格位（drop zone）
4. 商品卡片吸附到 drop zone，视觉上显示已放置（高亮/缩略图）
5. 可将商品从 drop zone 拖回出发区，重新分配（可撤销）
6. 所有商品均放置后，提交按钮变为可用（canSubmit 已在父组件计算）
7. 提交时调用现有 `submitAnswer`，payload 格式 `{ question_type: 'DRAG', placements: [{ item_id, zone_id }] }`

---

## 功能范围

### 本次做

- 新增 `src/renderer/src/components/DragDropQuestion.vue`
  - Props：`dragItems`（来自 `SessionQuestionContent.dragItems`）、`dropZones`（来自 `SessionQuestionContent.dropZones`）、`backgroundAssetId?`（来自 `mediaAssetId`）、`modelValue: Record<string, string>`（dragMap，v-model）
  - Emit：`update:modelValue`（更新 dragMap）
  - 使用 HTML5 原生 Drag and Drop API（`draggable` + `dragstart`/`dragover`/`drop`）
  - 背景图通过 `app://asset/<backgroundAssetId>` 显示（与现有 img 协议一致）
  - 商品图通过 `app://asset/<image_asset_id>` 显示
  - Drop zone 显示 label；商品放入后显示商品缩略图
  - 允许从已放置的 zone 拖回出发区重新分配

- 修改 `AssessmentView.vue`：将 DRAG 分支的 select fallback（当前 lines 187-220）替换为 `<DragDropQuestion>`，传入 v-model dragMap

- 激活 DRAG 题：用 `sqlite3 CLI` 直接对生产 DB 执行 `UPDATE question_bank SET status='ACTIVE' WHERE question_id IN (...)` ——沿用 BASE_ABILITY 导入的 ABI 隔离约定（见 AGENTS.md）。执行前须确认 `asset_resource` 中所有 10 个资产（9 商品图 + 1 背景图）均为 `status='ACTIVE'`，否则先导入资产再激活题目

- **类型修订（必须随本次一同交付）**：`shared/types/assessment.ts` 中 `SubmitAnswerSuccess.score` 从 `0 | 2` 改为 `0 | 1 | 2`；`shared/types/event-payloads.ts` 中 `AnswerSubmittedPayload.score` 同步改为 `0 | 1 | 2`（DRAG_PARTIAL 可返回 1 分，现有类型声明不兼容，会导致 tsc 报错）

### 本次不做

- 触屏/触控板拖拽优化（MVP 桌面端，鼠标操作）
- 动画过渡效果（基础视觉反馈足够）
- 无障碍键盘拖拽替代方案（MVP 范围外）
- 后端新增任何表/字段/IPC handler（现有链路已覆盖）
- 评分逻辑变更（`DRAG_PARTIAL` 已实现）

---

## 边界条件和异常处理

| 场景 | 处理方式 |
|---|---|
| `backgroundAssetId` 为 null | 不渲染背景图，使用纯色背景占位 |
| 商品图资产不存在 / 加载失败 | `<img>` onerror 显示商品 label 文字替代 |
| `dragItems` 为空数组 | 渲染空状态提示（题目配置问题，不崩溃）；`canSubmit` 强制为 false，不允许提交 |
| 拖拽进行中途 `status` 变为 `REDLINE_HALTED` / `EMOTION_INTERRUPTED` | 父组件模板切换到对应 state，`dragMap` 中未提交数据视为废弃，属预期行为；`DragDropQuestion.vue` 无需感知 session 状态 |
| 同一商品拖入已有商品的 zone | 原 zone 的商品退回出发区，新商品入驻（swap 逻辑） |
| 用户刷新/返回（session 恢复） | dragMap 初始化为空，需重新操作（现有 session 恢复不还原答题中间状态） |
| DRAG 题混在其他题型中（多题 session）| 父组件 beforeEach 已 reset dragMap，无副作用 |

---

## 与现有功能的接口关系

- **父组件 AssessmentView.vue**：
  - `dragMap: ref<Record<string, string>>` 保持不变（v-model 传入 DragDropQuestion）
  - swap 时须浅拷贝整个 Record、同时更新两条映射，单次 emit `update:modelValue`（不得两次 emit，避免父组件收到中间状态）
  - `canSubmit` computed 依赖 `dragMap` keys 覆盖所有 `dragItems`，不变
  - `buildPayload()` 的 DRAG 分支不变（从 dragMap 构建 placements）
  - `handleSubmit()` → `submitAnswer` → IPC 链路不变

- **Pinia store (assessment.ts)**：无变更，`submitAnswer` action 已处理 DRAG payload

- **IPC handler (answer.ts)**：无变更，`ANSWER_SUBMITTED` 事件写入逻辑已支持 DRAG

- **评分引擎 (job-skill-scoring.ts / baseline-scoring.ts)**：无变更，`DRAG_PARTIAL` 评分逻辑已实现

- **asset protocol**：复用 `app://asset/<id>` 协议（主进程已注册），无需变更

---

## 成功验收标准

1. **渲染**：DRAG 题显示货架底图 + 商品卡片（含商品图）+ drop zone 标签
2. **拖拽**：商品可拖入 zone，zone 显示商品缩略图；可拖回重新分配
3. **提交解锁**：所有商品均放置后，提交按钮变为可用
4. **payload 正确**：提交后 `answer_record.answer_payload_json` 含 `{ question_type: 'DRAG', placements: [...] }`，每个 item_id 对应一个 zone_id
5. **评分**：`Q_BASE_FINE_MOTOR_DRAG_002` 全对得 2 分，全错得 0 分，部分正确得 1 分
6. **类型检查**：`tsc --noEmit` 无报错
7. **vitest**：587+ 用例全通过（组件无强制单测要求，但不可破坏现有用例）

---

## 风险点

- **[!] `SessionQuestionContent.dropZones` 不含 `accepts` 字段**：accepts 留在主进程评分用，前端仅知道 zone_id 和 label。UI 无法做客户端预校验（如"这个 zone 只接受特定商品"）。这是有意设计——验收在提交时由后端执行。DragDropQuestion.vue 不得假设 zone 接受约束。
- **图像资产未导入生产 DB**：激活 DRAG 题前需确认 `asset_resource` 表中所有 9 个商品图 asset 和 1 个背景图 asset 已 `status='ACTIVE'`。若资产缺失，图片 fallback 到文字，题目仍可答，但视觉体验大幅下降。
- **HTML5 DnD 在 Electron WebContents 的行为**：Electron 默认会拦截 `dragstart` 并尝试文件拖拽，需在 `dragstart` handler 中调用 `event.dataTransfer.setData('text/plain', itemId)` 并设置 `effectAllowed = 'move'` 确保行为正确；`dragover` handler 必须调用 `e.preventDefault()` 才能触发 `drop`；`drop` handler 通过 `e.dataTransfer.getData('text/plain')` 取得 item_id。
