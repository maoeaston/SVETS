# JOB_SKILL 298 全量预览持久化与权限数据合同 R3 复审报告

## 审查结论

**PASS**

P0：0；P1：0；P2：2。

目标 Mini-PRD 已将上一轮关注的核心缺口收口为可验证合同，满足“仅 P0/P1 均为零才 PASS”的规则。这里的 PASS 只表示该数据合同可以进入下一步独立 `/vibe-impl`；不表示 Schema、migration、运行时、vault 或 UI 已实现。

## 审查范围

- 类型：PRD / R3 数据合同
- 风险：R3
- 工件：`doc/features/job-skill-298-full-preview-persistence-contract-prd.md`
- 已读取：`AGENTS.md`、`doc/specs/baseline.yaml`、`doc/specs/project-invariants.md`、`doc/ai/vibe-workflow-contract.md`、`vibe-coding-skills-v2/commands/vibe-review.md`、`vibe-review` skill、目标 Mini-PRD 全文、原权威 PRD、Step 1 feasibility 材料、`src/main/db/schema.sql` 相关定义。
- 未读取/未依赖：前两轮 persistence-contract review 报告。
- 未访问：默认 `xc-career-guide.db`。

## 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| 权威入口和工作流规则读取 | PASS | 上述文件已读取；适用规则为 R3、证据化、失败关闭和 P0/P1 结论门槛 |
| 目标 Mini-PRD 全文结构核对 | PASS | §1-18；覆盖范围、合同、矩阵、AC、停止条件和 verifier drift |
| bootstrap chain / 防替换 / 错误边界 / SOD | PASS | 目标 §6.3.3、§6.4.3-6.4.4、AC-R3-04/05 |
| feedback collision / canonical proof / repair | PASS | 目标 §6.7.5-6.7.6、AC-R3-11/13/17 |
| preview/formal 投影边界和 migration | PASS | 目标 §6.6、§6.9-6.9.1、§10、AC-R3-08/10/14/15 |
| 当前 Schema 边界对账 | PASS | `schema.sql` 中旧 `domain_event_projection`、`assessment_session`、`strategy_config`、`command_log` 与正式 18+6 seed；未把缺失目标结构误写成已实现 |
| 工作树保护和空白检查 | PASS | `git status --short --branch` 仅观察现场；`git diff --check` 退出 0；未修改既有文件 |
| 默认数据库保护 | PASS | 本轮未以默认数据库路径执行任何命令 |
| 实现级 AC、migration、全量测试、Electron、默认库 verifier | NOT_RUN | 本轮明确禁止或不属于 PRD review 的实现验收；目标文档也将对应 AC 标为 `NOT_RUN` |

## P0

无。

## P1

无。

## P2

### [P2-01] 文档存在重复标题

- 位置：目标 §8.3 附近及 §13 附近，重复出现相同 `Given`/章节标题。
- 触发条件：生成目录、锚点或人工引用时使用重复标题。
- 影响：可读性和锚点稳定性轻微下降，不改变合同语义。
- 权威依据：文档质量建议；不构成 R3 数据或权限缺陷。
- 最小修复：后续文档整理时删除重复行并复跑 `git diff --check`。
- 回归：文档标题/锚点检查。

### [P2-02] 目标文档的实现验证仍全部待执行

- 位置：目标 §17、AC-R3-01 至 AC-R3-17。
- 触发条件：后续实现直接把逻辑合同当作已验证事实。
- 影响：不能由本 PRD 单独证明 SQLite 唯一约束、vault 故障恢复、migration rollback 或结果抑制已经工作。
- 权威依据：`vibe-workflow-contract.md` §6-7；目标 §17.2 明确未执行项不得写成通过。
- 最小修复：进入 `/vibe-impl` 后逐项实现并执行 AC；在实现验收前保持功能状态为未实现/受阻，不提前修改交接状态。
- 回归：隔离 SQLite fixture、vault fault matrix、旧 v1/v2 replay、migration pre/in/post/rollback 和 verifier parity 测试。

## 已核验通过的关键项

1. **Bootstrap chain 与 SOD**：目标 §6.4.4 固定了“已签名应用发行物 -> 编译进固定 trust anchor -> installation identity certificate -> PoP -> signed authority registry -> signed enrollment package -> 独立 enrollment executor/approver”的顺序；替换 anchor、证书、registry、nonce 或 scope 时有稳定错误和只读修复边界。§6.3.3、§6.4.3 还明确 signer、approver、executor 与责任集合的互斥关系。AC-R3-04/05 覆盖替换和 spoof 负向场景。

2. **双来源与四态**：§6.2 明确 `official_publish_set` 和 `preview_publish_set` 是两个不可互推的 authority namespace；正式先、预览先、双方均有、双方均无在 AC-R3-01/02 和 §8.1/8.2 中分别失败关闭。`ACTIVE` 不再被当作发布授权。

3. **feedback collision authority**：§6.7.5 明确 vault manifest 对 `feedback_commit_id` 具有 collision authority，vault、DB reference、tombstone 均检查 `(feedback_commit_id)` 和 `(feedback_id, revision_no, operation)`；canonical proof 覆盖 operation、revision/hash、scope、request hash、contract version、actor/auth reference 和 manifest root。相同 proof 重放幂等，异 hash/异 commit/revision 冲突拒绝。

4. **修复权限分离**：§6.7.6 独立定义 `FEEDBACK_REFERENCE_REPAIR`、`FEEDBACK_TOMBSTONE`、`FEEDBACK_PURGE`、`IDENTITY_MAP_READ`，分别绑定安装/组织、目标 commit/revision、签发 authority、期限、scope、签名和 SOD。普通 ADMIN、TEACHER、owner 或可读取 identity-map 均不自动获得 repair 权限；`IDENTITY_MAP_READ` 不被 repair/purge 反向授予。

5. **preview 物理边界**：§6.9.1 将旧正式 `domain_event_projection`、`assessment_session`、`strategy_config` 与新增 `preview_event_projection`、`preview_release_projection`、`preview_session_projection`、`preview_feedback_reference_projection` 分开；共享 `assessment_session_id` 只能是 identity/assignment shell，preview projection 才是 mode、source、hash、状态和 suppression 的 canonical owner。新 preview aggregate 不得伪装为旧正式 aggregate/status/strategy。

6. **migration 与历史 replay**：§6.9.1 固定 `PREVIEW_CONTRACT_V1` 的 pre/in/post/rollback 行为：迁移前拒绝 preview mutation，迁移中暂停并从冻结 migration facts 恢复，迁移后先验证旧 formal replay 再启用 preview registry；旧应用只读识别新事实，不把 preview 解码成 formal。§10 同时把 0.1.17/0.1.18 verifier parity、成对备份、完整性检查和禁止自动从 `ACTIVE` 回填列为硬门禁。

7. **18+6 与 suppression**：§6.6、AC-R3-09/10 明确 PREVIEW 的正常完成、作废、技术中断和红线终止都不得写四类正式 result、正式 task report 或等级；红线仍按 `student_id + job_code + task_code` 先熔断。旧正式路径继续固定 18 online + 6 offline、最大分 48，并按 legacy v1/v2 registry 读取且不回写历史。

8. **双来源、方案矩阵、AC、stop conditions、verifier drift**：§7 的四方案矩阵给出能力断言和加权分；§13 的 AC 覆盖正常、异常、并发/重放、隐私、migration 和历史兼容；§15 明确 P0/P1、parity、默认库和实现前置条件的停止规则。目标没有把“后续实现决定”作为当前已实现事实。

## NOTE / 待验证

- `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、Electron smoke、migration 实跑、vault fault injection、legacy replay 和默认库 verifier：本轮均未执行或明确禁止访问，不能据此扩张 PASS 含义。
- 当前工作树已有用户 dirty 修改；本轮仅做只读检查并新增本报告，未清理、回滚或覆盖这些修改。

## 残余风险

进入实现后，最重要的风险是实现者把 §6.9.1 的“目标物理边界”弱化为旧表字段、把 vault proof 变成普通 DB reference、或把 capability authority 合并回普通 ADMIN/RBAC。任何此类变更都改变 canonical owner 或权限语义，必须退回新的 R3 review。

## 规则沉淀候选

- 为 `PREVIEW_CONTRACT_V1` 建立跨文件 inventory，强制检查 EventType、validator、projector、recovery、query、migration registry 和错误码全链登记。
- 为 `feedback_commit_id` 建立 vault-first/DB-first 双向故障矩阵，并把 collision、repair capability 和 tombstone/purge SOD 纳入自动门禁。
- 为旧 formal v1/v2 replay 与 preview unknown-version fail-closed 建立固定隔离 fixture。

## 置信度

HIGH。已读取指定权威资料、目标全文和相关 Schema 定义，结论基于文档条款和当前文件结构；实现级行为未执行，因此本报告不对未实现合同提供运行时保证。
