# 暂停恢复与安全红线两级处理实现

对应需求：`pause-recovery-safety-prd.md`  
状态：`IMPLEMENTED_VERIFIED_2026-07-23`

## 坐次投影与迁移

- `assessment_sitting` 保存测评内的连续施测记录，并以 `(session_id, sitting_no)` 保证顺序唯一。
- 部分唯一索引保证每个测评最多一个未结束坐次。
- F4 迁移 `2026-07-23_f4_assessment_sitting` 是增量迁移，基线 schema 也写入相同迁移记录，避免新库在启动检查时出现遗漏。
- `SITTING_STARTED` 和 `SITTING_ENDED` 经 `assessment-reducer` 写投影。计划暂停结束后进入 `SUSPENDED_REVIEW_REQUIRED`，开始下一坐次后回到 `ACTIVE`。
- 既有 ACTIVE 测评若缺少坐次，学生首次继续时补建首个坐次，确保老数据也能进入新流程。
- 教师可将情绪中断中的坐次结束为 `ENDED_BY_COLLAPSE`。未达阈值时测评保持待复核；达到阈值时写崩溃阈值和测评完成事件，并将等级投影强制为 `LEVEL_NOT_COMPETENT`。

## 情绪恢复

- `assessment:emotionResume` 接受学生本人或教师。学生路径复用 session 所有权校验，教师路径保留跨学生恢复能力。
- 学生答题页显示“我可以继续答题”，恢复后仍使用原题目指针。
- 教师测评列表提供“暂停到下一坐次”和“开始下一坐次”入口。

## 安全两级处理

- 新增 `src/main/ipc/handlers/safety.ts` 与 `src/shared/types/safety-incident.ts`。
- 教师仅能确认 `PENDING_DETAIL` 事件，确认时写 `SAFETY_INCIDENT_DETAIL_CONFIRMED`。
- 管理员仅能处理安全终态。解除确认事件写 `SAFETY_INCIDENT_RESOLVED`，允许原因的作废写 `SAFETY_INCIDENT_VOIDED`。
- 事实更正走替代事件路径：先创建新的待补录事件，再将旧事件作为有替代记录的作废事件保存，历史事实不被覆盖。
- `recovery.ts` 已识别上述安全事件，恢复时按同一状态机补投影。

## 验证

- `assessment-emotion.test.ts` 覆盖学生本人恢复、越权拒绝、旧会话补坐次、计划暂停和下一坐次。
- `safety.test.ts` 覆盖教师确认、管理员解除、管理员作废和事实更正替代。
- `assessment-reducer.test.ts` 覆盖坐次投影状态转换。
- `migrations.test.ts` 覆盖 F4 迁移与新库迁移记录。
