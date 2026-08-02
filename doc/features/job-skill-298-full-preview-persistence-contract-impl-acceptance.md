# JOB_SKILL 298 全量预览持久化合同 Step 10 验收记录

- 验收状态：`AUTOMATION_PASS_MANUAL_PENDING`
- 验收范围：`doc/features/job-skill-298-full-preview-persistence-contract-impl.md` Step 0–10
- 当前 Schema：`0.1.19-job-skill-preview-contract-v1`
- migration：`2026-08-01_job_skill_preview_contract_v1`
- 默认数据库：未访问、未初始化、未修复、未 promotion

## 结论

Step 0–10 的代码合同和自动化验证已闭合。隔离数据库可以证明 readiness gate 在 `INSTALLING` 时拒绝、在 registry 状态和五个 digest 全部匹配后通过，并在 tamper 后再次拒绝。该结果不表示默认数据库或生产安装已 `READY`。

人工门仍未全部完成：本轮已用隔离临时 `userData` 执行基础 Electron 启动、健康检查、登录、学生档案创建和退出冒烟并通过；preview 专属教师/学生业务流和 renderer 交互走查、真实签名与安装信任链、真实 `userData` vault、多设备业务流，以及真实安装环境的升级迁移/backup pair/旧应用 fail-closed 验证尚未执行。新增的原生 preview 隔离 harness 已通过 Electron ABI 下的 v0.1.18-style `assessment_session` 缺列重建、正式 session 数据保留、外部触发器恢复、备份、READY、重开和注入式回滚验证；它仍只使用显式隔离 fixture，不替代真实安装环境验收。此前独立 R3 发现的 3 个 P1 已由父会话补上数据库账号复核、持久 replay marker 和 student profile 映射回归；本轮父会话又修复并验证教师 canonical 目录/责任 session/feedback scope、反馈 grant 过期拒绝、canonical source reference 漂移拒绝和 sender-bound executor principal。修复后独立增量 R3 已返回 `CONDITIONAL_PASS`（P0/P1/P2=0，NOTE=1），但不等于完整实现级 PASS，也不替代真实环境人工门。详见 `doc/features/job-skill-298-full-preview-persistence-contract-impl-independent-r3-review.md`。

## 自动化证据

| 检查 | 结果 | 说明 |
|---|---|---|
| `npm test -- scripts/__tests__/preview-contract-parity.test.mjs` | `PASS` | 6/6 隔离 parity cases；版本、ledger、object digest 与 0.1.19 目标一致，默认库未访问 |
| `npm run contract:preview:ipc:check` | `PASS` | 精确闭集合 17 个通道：6 READ、11 MUTATION；source digest 与 fixture 一致 |
| `preview-contract-ready.test.mjs` | `PASS` | 先执行 Step 0 parity；fresh/current isolated DB 为 `INSTALLING`；显式 promotion 后通过；篡改 query digest 后失败 |
| `npm run contract:preview:ready -- --db /tmp/.../fresh.sqlite` | `PASS`（负向） | 显式 fresh isolated DB 返回 exit 1 和 `PREVIEW_CONTRACT_NOT_READY`，并列出 `PARITY_REQUIRED`、registry `INSTALLING` 与 digest 未满足项；没有 promotion 默认库 |
| `npm run contract:m5b:event-batch:check` | `PASS` | M5B baseline 75 channels；领域 36、gate-only 10 |
| `npm run db:m5b:isolated:verify -- --stage full` | `PASS` | 7 个显式 `/tmp` 临时根目录完成 M5B artifact/command/coordinator/gate-only/safety/schema/storage 验证；每个成功根目录均已清理；未访问默认数据库 |
| `npm run db:m5b:native:verify` | `PASS` | Electron ABI 下显式临时 native SQLite 从 exact M4 完成 M5B 迁移、配对备份、重开和 integrity 检查；预览表/索引/触发器/ledger 已从 predecessor fixture 隔离 |
| `npm run db:preview:native:verify` | `PASS` | Electron ABI + `better-sqlite3` 显式 `/tmp` 隔离库完成 v0.1.18-style `assessment_session` 缺列重建、正式 session 数据保留、外部触发器恢复、预览迁移、DB/action-log 备份、隔离 registry promotion/reopen、DDL 故障注入回滚和 integrity/FK 检查；fixture 仍不替代真实安装环境 |
| `npm run contract:job-skill:check` / `npm run contract:job-skill:delivery:check` | `PASS` | 当前合同链与 delivery lock 一致，runtime SQL 保持受阻边界 |
| `npm test` | `PASS` | 199 test files，1597 tests；含教师目录/责任 session/feedback scope、学生 session formal namespace 拒绝、反馈 grant 过期拒绝、canonical source reference 与岗位/任务 scope 漂移拒绝、sender-bound executor principal、preview release M5B、principal replay/权限边界、formal/preview event ownership、result/report suppression 和 feedback vault 重启恢复回归 |
| `npm run typecheck` | `PASS` | TypeScript 类型检查通过 |
| `npm run lint` | `PASS` | 0 errors，663 warnings |
| `npm run build` | `PASS` | Electron main/preload/renderer 构建通过 |
| `npm run e2e:m5b:ui` | `PASS` | 隔离临时 `userData`；health/login/student-create/logout 基础桌面冒烟通过；不覆盖 preview 专属 UI |
| `git diff --check` | `PASS` | 无 whitespace error |
| `npm run docs:index:update` / `npm run docs:index:check` | `PASS` | 文档自动清单已更新并与工作树一致 |
| `npm test -- scripts/__tests__/doc-index.test.mjs` | `PASS` | 3/3 文档索引测试通过 |
| 独立实现 R3 review | `CONDITIONAL_PASS` | 历史完整 R3 发现的问题已由父会话修复；Gauss 当前固定状态独立复核确认权限链 P0/P1/P2=0、NOTE=1，但未运行自动化或真实环境门；真实人工门仍未完成 |
| `npm run contract:m5b:scope:check -- --step M5B-15` | `BLOCKED` | dirty worktree 混有既有用户改动和本任务改动，无法作单一提交范围判断 |

## 本轮 R3 修复证据

- preview migration 现在同时校验 schema 结构、列/索引/外键/触发器语义、`PRAGMA foreign_key_check` 和 `PRAGMA integrity_check`；READY promotion 通过领域入口重新计算当前进程 registry 摘要，不接受调用方直接拼接摘要。
- `preview_session_projection` 的冻结触发器覆盖身份、题包、策略、三类内容根哈希、snapshot root、assignment/grant 和创建事实；M5B 隔离运行时测试实际尝试改写代表字段并确认被拒绝。
- principal planner 要求 migration CURRENT、registry READY 和五项摘要全部匹配；反馈 delete/reconcile/repair/purge 必须有 capability，反馈引用还必须绑定 preview session/release/source/org/job/task，export 必须是 `RECONCILED_SUBMITTED` 且 proof 与 vault 一致。
- Application runtime/index 显式安装完整 fail-closed trust context；仓库没有真实 compiled trust anchors 时，预览身份、发布和反馈信任写入拒绝关闭，不将缺失材料伪装为 READY。
- native M5B verifier 现在在构造 exact M4 predecessor 时同步移除 preview objects 和 migration ledger，避免当前 v0.1.19 schema 的预览 ledger 污染 M5B ABI migration 证据；该 verifier 已在 Electron ABI 下重新通过。
- native preview verifier 使用 Electron ABI 的 `better-sqlite3` 在显式隔离库验证 v0.1.18-style `assessment_session` 缺列 rebuild、正式 session 数据保留、外部触发器恢复、verified DB/action-log pair、`INSTALLING -> READY` 的隔离 promotion、重开一致性和 DDL 失败回滚；真实安装环境仍未验收。
- `BootstrapTrustChain` 通过只接受 `DBAdapter` 的 SQLite chain factory 和 `user_account` resolver 复核 signed package 的目标账号必须为当前 ACTIVE ADMIN；`preview_bootstrap_replay_projection` 以 `BEGIN IMMEDIATE`、target+enrollment 与安装范围 target+nonce 唯一约束提供跨实例幂等/冲突，禁止 nonce 跨 certificate/challenge 重用；新增非 ADMIN、状态变更、跨实例和 nonce/package 冲突回归。
- 学生 preview read 不再把 sender 的 `user_id` 当作 profile id，而是从 `student_profile.user_id` 解析 ACTIVE `student_id`；关联档案和档案失效回归已通过。bootstrap replay 源文件同时登记进 PREVIEW 合同排除集合，M5B-14/15 冻结 digest 未改变。
- 教师 preview read 不再依赖不存在的 teacher principal mapping：安装范围由同组织、canonical `preview_publish_set` release projection 推导；session 与 feedback read 额外要求 sender-bound teacher 是对应 ACTIVE assignment/grant 的 `teacher_user_id`，跨责任范围返回空/`PREVIEW_SCOPE_INVALID`。新增教师目录、责任 session/问题和反馈越权回归已通过。
- preview session read 会重新校验 source canonical reference 的 namespace/delivery 必须为 `preview_publish_set`/`PREVIEW_ONLY`；即使学生路径不带安装范围，也不会接受漂移到 formal namespace 的 release reference。新增 `getSession`/`listSessionQuestions` 失败关闭回归已通过。
- 教师 feedback read 还要求 `delegated_access_grant.expires_at` 严格晚于可信当前时间，并校验 assignment、grant、session、student 的精确绑定；过期或绑定不完整时 list/get 均失败关闭。新增过期 grant 回归已通过。
- feedback list/get 会重新解析并校验 `references_json` 的完整 canonical reference set，并确认其 `source_ref_id`、组织、安装、岗位和任务与 release/session projection 一致；malformed JSON、source ID drift 或岗位/任务 scope drift 均失败关闭。新增 canonical source reference 回归已通过。
- principal enrollment/rotation planner 必须由 trust context 解析 sender-bound executor principal，并将其传入签名包校验；无法解析时生成 `INSTALLATION_TRUST_UNAVAILABLE` no-op，包内 executor 不匹配时分别返回 enrollment/rotation invalid。新增领域服务与 planner wiring 回归已通过。

## 覆盖确认

- preview 与 formal 使用不同 event/projector/aggregate shell；preview 正常结束、作废、技术中断和 redline 不写正式 result/report。
- preview release 的 sender-bound command、完整职责分离、冻结 payload 类型校验、M5B PREPARE/APPLY/recovery 和 `plannerCalls=0` 恢复路径均有隔离测试；formal safety 与 preview safety 的 ownership 交叉绑定会 fail-closed。
- scoring preview shell 在构造正式 result/report facts 前返回 `PREVIEW_RESULT_SUPPRESSED` no-op；ownership registry 拒绝同一 event/version 的跨 shell/aggregate 注册。
- authority、principal、sender-bound caller、organization/install/device/session scope 均有负向测试；请求正文不能改写授权身份；目标账号 ACTIVE ADMIN、跨实例 replay 和关联 student profile scope 均有定向回归。
- feedback 正文留在 vault；SQLite 只保留引用、hash、状态和审计事实；collision、reconcile、delete、purge、repair、export 均经过 command/event/recovery 边界。
- `feedback-vault.test.ts` 现在覆盖同一隔离 `userData` 根目录的 commit/export 重启恢复，以及 purge marker 重启恢复；这证明代码级 durable capability 行为，不替代真实安装环境的权限、用户可见导出和多设备人工门。
- 17 个 IPC 通道由 source set、handler registry、preload 和 fixture digest 共同核对；没有依赖 UI 标签、文件存在或 `ACTIVE` 推导预览权限。
- 新鲜或当前同步数据库的 readiness registry 保持 `INSTALLING`。测试中的 `READY` 仅属于显式隔离 fixture，并且没有写入默认运行库。

## 未完成的人工门

状态为 `NOT_RUN` 的项目：

- preview 专属教师/学生业务流程和 renderer 交互走查；基础 Electron 启动、登录、学生档案创建、退出冒烟已 `PASS`；
- 修复后独立增量 R3 已 `CONDITIONAL_PASS`（P0/P1/P2=0、NOTE=1）；完整真实环境人工门仍未执行，不能把 conditional 记录升级为最终 PASS；
- 真实签名、bootstrap trust chain、安装设备和多设备 assignment 流程；
- 真实安装环境的 `userData` vault 权限、重启恢复和用户可见导出（代码级隔离临时根目录重启恢复已 `PASS`）；
- 真实安装环境的 migration upgrade/rollback、backup pair 恢复和旧应用 fail-closed 验证；原生隔离 harness 的迁移与注入式回滚已 `PASS`，不替代该人工门；
- 在明确发布批准后才可进行的 production/default DB readiness promotion。

在这些项目完成前，预览合同继续只读/失败关闭，不同步任何默认数据库状态。
