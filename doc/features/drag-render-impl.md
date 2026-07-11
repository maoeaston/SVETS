# DRAG题拖拽渲染组件 — 实现文档

功能代号：drag-render  
对应 PRD：doc/features/drag-render-prd.md v0.1  
生成日期：2026-07-11

---

## 实现目标

将 AssessmentView.vue 中 DRAG 题的 select-per-item 占位替换为真正的 HTML5 拖拽组件，同时修复 score 类型声明不兼容问题并激活两道 DRAG 题。

---

## 前置条件

- `src/shared/types/assessment.ts` 存在（`SubmitAnswerSuccess` 在 :204）
- `src/shared/types/event-payloads.ts` 存在（`AnswerSubmittedPayload` 在 :115）
- `src/renderer/src/views/student/AssessmentView.vue` 存在（DRAG fallback 在 :187–220）
- `app://asset/<id>` 协议已在主进程注册（无需改动）
- `dragMap ref<Record<string,string>>` 已在父组件声明（无需新增）
- 无新增 IPC 通道、无新增 DB 表

---

## ~~Step 1（已取消）：修复 score 类型声明~~

> **[!] PRD 误描述**：PRD v0.1 称"DRAG_PARTIAL 可返回 1 分"，但实际实现中
> `validate-scoring-rule-json.ts:49` 强制 `partial_correct_score = 0`，
> `assessment.ts:785` 评分逻辑为 `allCorrect ? 2 : 0`，无 1 分路径。
> 当前 `score: 0 | 2` 类型声明与实现一致，**不需要修改**。
> PRD 描述错误待后续修订，本次跳过此步。

---

## 实现步骤

### Step 1：新增 DragDropQuestion.vue 组件

**改动文件：**
- 新增 `src/renderer/src/components/DragDropQuestion.vue`

**Props / Emits 接口：**
```ts
interface Props {
  dragItems: { itemId: string; label: string; imageAssetId?: string | null }[]
  dropZones: { zoneId: string; label: string }[]
  backgroundAssetId?: string | null
  modelValue: Record<string, string>   // dragMap：item_id → zone_id
}
emit('update:modelValue', newMap: Record<string, string>)
```

**布局：**
```
┌─────────────────────────────────────────────────────┐
│  货架底图区（backgroundAssetId 存在时作背景）         │
│  ┌──────┐  ┌──────┐  ┌──────┐  …  ← drop zones    │
│  │zone A│  │zone B│  │zone C│                       │
│  │(空)  │  │[img] │  │(空)  │                       │
│  └──────┘  └──────┘  └──────┘                       │
└─────────────────────────────────────────────────────┘
  商品出发区（未被放置的 dragItems）
  ┌──────┐  ┌──────┐  …
  │商品1 │  │商品3 │
  └──────┘  └──────┘
```

**拖拽状态：**
- `unplaced: ComputedRef<DragItem[]>`：modelValue 中未出现的 item
- `draggingId: ref<string | null>`：当前被拖拽的 item_id
  - 商品卡片绑定 `:class="{ 'is-dragging': draggingId === item.itemId }"`（透明度降低）
  - drop zone 绑定 `:class="{ 'is-over': overZoneId === zoneId }"`（需额外 `overZoneId ref`，在 `dragenter`/`dragleave` 更新，`drop`/`dragend` 清空）

**drag 事件处理（必须遵守 Electron DnD 约束）：**
```
dragstart(item):
  e.dataTransfer.setData('text/plain', item.itemId)
  e.dataTransfer.effectAllowed = 'move'
  draggingId.value = item.itemId

dragover(zone | unplaced-area):
  e.preventDefault()          // 必须，否则 drop 不触发
  e.dataTransfer.dropEffect = 'move'

drop(onto zone zoneId):
  const itemId = e.dataTransfer.getData('text/plain')
  const newMap = { ...props.modelValue }
  // swap 逻辑：若 zoneId 已被占用，退回原占用 item
  const prevItemInZone = Object.entries(newMap).find(([, z]) => z === zoneId)?.[0]
  const prevZoneOfItem  = newMap[itemId]   // item 原来的 zone（可能 undefined）
  if (prevItemInZone && prevItemInZone !== itemId) {
    if (prevZoneOfItem) {
      newMap[prevItemInZone] = prevZoneOfItem   // 被挤出的 item → item 原 zone
    } else {
      delete newMap[prevItemInZone]              // 被挤出的 item 回到出发区
    }
  }
  newMap[itemId] = zoneId
  emit('update:modelValue', newMap)              // 单次 emit，不产生中间状态
  draggingId.value = null

drop(onto unplaced-area):
  const itemId = e.dataTransfer.getData('text/plain')
  const newMap = { ...props.modelValue }
  delete newMap[itemId]
  emit('update:modelValue', newMap)
  draggingId.value = null

dragend:
  draggingId.value = null     // 防止拖拽取消后 draggingId 残留
```

**CSS 绑定策略（draggingId）：**
- 商品卡片：`:class="{ 'is-dragging': draggingId === item.itemId }"` → 拖动中降低不透明度
- drop zone：`:class="{ 'drag-over': dragOverZone === zoneId }"` → 需同时维护 `dragOverZone ref<string|null>`，在 `dragenter` 置为 zoneId，`dragleave`/`drop` 清空

**图片加载异常：**
- `<img @error="onImgError(item.itemId)">`，onerror 设一个 flag，改为显示 label 文字

**dragItems 为空：**
- 渲染 `<p class="empty-hint">题目配置错误，无商品数据</p>`
- 组件内部不处理 canSubmit（父组件计算）

**测试用例：**
- 单元测试（Vitest）：swap 逻辑——测 `emitValue` 在五种场景下的正确性
  1. item 拖入空 zone → map 新增一条
  2. item 拖入已占用 zone → 两条映射同时更新，单次 emit
  3. item 从 zone 拖回出发区 → map 删除该条
  4. item A 已在 zone X，再次拖入 zone X → map 不变，不 emit（守卫 `prevItemInZone !== itemId`）
  5. `dragItems = []` → 渲染错误提示元素，不渲染拖拽区域
- 手工验收：
  - 货架底图正确显示（有 backgroundAssetId 时）
  - 商品卡片拖入 zone，缩略图出现在 zone 内
  - 从 zone 拖回出发区，商品重回出发区
  - 两商品互换 zone，无中间状态闪烁
  - 商品图加载失败时 fallback 显示 label 文字
  - dragItems=[] 时显示错误提示

**commit message 建议：**
`feat(drag-render): 新增 DragDropQuestion.vue 拖拽组件`

---

### Step 2：AssessmentView.vue — 替换 DRAG 分支

**改动文件：**
- `src/renderer/src/views/student/AssessmentView.vue`

**改动范围：**
1. `<script setup>` 顶部新增 import：
   ```ts
   import DragDropQuestion from '../../components/DragDropQuestion.vue'
   ```
2. 模板 lines 187–220（`v-else` 的 DRAG 占位块）替换为：
   ```html
   <!-- DRAG：真正的拖拽组件 -->
   <div
     v-else-if="currentQuestion.questionType === 'DRAG'"
     class="answer-area"
   >
     <DragDropQuestion
       v-model="dragMap"
       :drag-items="currentQuestion.dragItems ?? []"
       :drop-zones="currentQuestion.dropZones ?? []"
       :background-asset-id="currentQuestion.mediaAssetId ?? null"
     />
   </div>
   ```
   原来的 `v-else` 兜底块改为 SOFTWARE_TASK 占位：
   ```html
   <!-- SOFTWARE_TASK 占位 -->
   <div
     v-else
     class="answer-area"
   >
     <p class="empty-hint">该题型暂不支持（{{ currentQuestion.questionType }}）</p>
   </div>
   ```

**注意：**
- `v-model="dragMap"` 绑定父组件已有的 `dragMap ref`，DragDropQuestion emit `update:modelValue` 会自动写入
- `backgroundAssetId` 传 `mediaAssetId`（PRD §功能范围 第一项，背景图来自 `mediaAssetId`）
- 删除 `.drag-area`、`.drag-row`、`.drag-label`、`.drag-select`、`.drag-image` 样式（已移入子组件）

**测试用例：**
- 手工验收：
  - DRAG 题渲染 DragDropQuestion 而非下拉框
  - TRUE_FALSE / SINGLE_CHOICE 题不受影响
  - 提交后 answer_payload_json 含 `{ question_type: 'DRAG', placements: [...] }`

**commit message 建议：**
`feat(drag-render): AssessmentView 替换 DRAG 占位为 DragDropQuestion`

---

### Step 3：激活 DRAG 题（sqlite3 CLI，非代码改动）

**操作文件：**
- 生产 DB：`xc-career-guide.db`（路径由启动脚本指定，通常在项目根或 userData）

**执行前验证：**
```bash
sqlite3 xc-career-guide.db \
  "SELECT asset_id, asset_type, status FROM asset_resource \
   WHERE asset_id IN (/* 9 商品图 + 1 背景图 asset_id，从 question_bank content_json 读取 */);"
```
确认所有 10 行均为 `status='ACTIVE'`，否则先将资产插入/更新后再继续。

**激活 SQL：**
```sql
UPDATE question_bank
SET status = 'ACTIVE'
WHERE question_id IN (
  'Q_BASE_FINE_MOTOR_DRAG_002',
  'Q_BASE_FINE_MOTOR_DRAG_005'
)
AND status = 'DRAFT';
```
执行后验证：
```bash
sqlite3 xc-career-guide.db \
  "SELECT question_id, status FROM question_bank \
   WHERE question_id IN ('Q_BASE_FINE_MOTOR_DRAG_002','Q_BASE_FINE_MOTOR_DRAG_005');"
```
预期：两行均为 `ACTIVE`。

**注意：** 此步骤是 DB 运维，不是代码 commit。记录在 `doc/features/drag-render-impl.md` 即可，无需写代码文件。

**手工验收：**
- 新建测评时组卷能选中 DRAG 题
- 进入答题看到拖拽 UI 而非占位报错

---

## 回归验收清单

- [ ] `npm run typecheck`（tsc --noEmit）通过，0 error
- [ ] `npm run build` 通过
- [ ] `npx vitest run` 587+ 用例通过（Step 2 新增 swap 单测后应 ≥590）
- [ ] 手工冒烟：
  - 进入 DRAG 题，拖拽商品到 zone，所有 zone 占满后提交按钮变为可用
  - 提交后进入下一题，dragMap 已重置
  - 查 answer_record 表，`answer_payload_json` 含 `{ "question_type": "DRAG", "placements": [...] }`
  - 全对得 2 分，全错得 0 分，部分正确得 1 分（DRAG_PARTIAL 已实现，验 score 字段）

---

## 项目约束自检

- [x] 无新增 EventType：DRAG 使用 `ANSWER_SUBMITTED`，已有
- [x] 无新增 IPC 通道：答题链路 `assessment:submitAnswer` 已有，无需改 preload
- [x] 无硬编码阈值：评分由 strategy_config 和 baseline-scoring.ts 控制，组件不参与
- [x] FSM 状态迁移：组件不触发状态迁移，父组件现有 `handleSubmit` 链路不变
- [x] 安全红线：组件不感知 session 状态，父组件切换模板时 dragMap 废弃属预期行为（PRD §边界条件）
- [x] JSON 字段写入：buildPayload() DRAG 分支已在父组件验证，不走组件层写入
