# JOB_SKILL 298 全量预览持久化合同独立实现 R3 复核

- 复核对象：`doc/features/job-skill-298-full-preview-persistence-contract-impl.md` 及其实现 diff
- 复核方式：上一轮另一上下文 reviewer `Ampere`/`Plato` 只读复核；中间修复后由 `Arendt`、当前固定状态由 `Gauss` 进行独立增量安全复核；均未访问默认数据库、未修改工作树
- 复核结论：`CONDITIONAL_PASS`（历史完整 R3 + Arendt 历史增量 + Gauss 当前固定状态独立增量复核）
- 最新问题计数：历史报告为 `P0=0 / P1=3 / P2=2 / P3=0`；修复后独立增量复核为 `P0=0 / P1=0 / P2=0 / NOTE=1`

## 结论

此前返回的独立 R3 复核指出 3 个 P1：目标 enrollment user 未强制 DB ACTIVE ADMIN、PoP replay 仅进程内、学生 account/profile ID 边界不一致；另有 2 个 P2，涉及 preview 专属故障点覆盖和 native migration fixture 与真实安装环境的证据边界。父会话随后已补充 DB-backed resolver/chain factory、持久 replay marker、安装范围 target+nonce 唯一冲突约束、ACTIVE profile 映射，并完成这些修复的定向回归。随后父会话审计又发现四个权限/完整性 P1：TEACHER 没有可用的 canonical 目录/责任读取范围、反馈读取没有明确拒绝过期 delegated grant、feedback source reference 查询没有重新校验 canonical/source binding，以及 principal enrollment/rotation 没有把 sender-bound executor 与签名包绑定；当前已分别补上 release projection scope + assignment/grant ACL、反馈的精确 assignment/grant/session/student 绑定及 `grant_expires_at > now` 校验、feedback canonical source/ref 校验、trust-context executor resolver + domain comparison，并由定向和全量测试验证。Arendt 的历史修复后独立增量复核确认其范围内权限链 P0/P1/P2=0、NOTE=1。Arendt 之后父会话又补上 preview session canonical source 必须为 `preview_publish_set/PREVIEW_ONLY`、feedback source scope 必须与实际 session 的 job/task 对齐，并由 199 files/1597 tests、typecheck、lint、build 验证；Gauss 当前固定状态独立复核确认这两个增量及相关权限链 P0/P1/P2=0、NOTE=1，但未运行自动化、migration 或真实人工门。原始 `CONDITIONAL_PASS` 仍表示 preview 专属 UI/renderer 业务走查、真实签名与安装信任链、真实 `userData` vault、多设备业务流、真实安装环境 migration upgrade/rollback 和默认库 promotion 等人工门禁尚未执行；隔离 harness 不替代这些真实环境门禁，也不授权发布。

## 已复核的实现边界

- feedback vault purge 先写非敏感 marker，再清理 staged、revision、journal 和匿名导出文件；重复执行保持幂等，数据库状态为 `PURGED` 时 planner 才生成 `ALREADY_PURGED` no-op。
- export 只接受已提交且 proof 在有效时间窗内的 journal，并重新验证 artifact tuple；recovery assert 复用同一发布校验，不能只凭正文 hash 恢复。
- purge planner 覆盖无 marker、marker 但数据库引用仍为旧状态、marker 且数据库已 `PURGED` 三种状态；marker 已存在时不重新读取已清理的 commit journal。
- reconcile 只有在 vault marker 和数据库 `PURGED` 状态同时成立时才返回 `PURGED`，缺任一侧都保持 `RECONCILE_REQUIRED`。

## 父会话验证证据

以下门禁由实现会话实际执行，Ampere/Plato/Arendt reviewer 本身未重复执行这些命令；Arendt 的独立增量报告明确将父会话测试作为外部证据，未把它们写成 reviewer 自行执行：

- `npm test`：`PASS`，199 test files / 1597 tests；包含 teacher preview scope、责任 grant 过期拒绝、学生 session formal namespace 拒绝、feedback canonical source 与岗位/任务 scope 漂移拒绝、sender-bound executor principal、principal ACTIVE ADMIN/replay/profile scope、preview release、event ownership、result/report suppression 和 feedback vault 重启恢复回归
- `npm run typecheck`：`PASS`
- `npm run lint`：`PASS`，0 errors / 663 warnings
- `npm run build`：`PASS`
- `npm run e2e:m5b:ui`：`PASS`，隔离临时 `userData` 的基础 Electron health/login/student-create/logout 冒烟；reviewer 未重复执行
- `npm run contract:m5b:event-batch:check`：`PASS`
- `npm run contract:preview:ipc:check`：`PASS`
- `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs`：`PASS`，38/38，M5B-14/15 frozen digest 未漂移
- `git diff --check`：`PASS`
- `npm run db:preview:native:verify`：`PASS`，父会话使用 Electron ABI + `better-sqlite3` 的显式 `/tmp` 隔离库完成 v0.1.18-style `assessment_session` 缺列重建、正式 session 数据保留、外部触发器恢复、preview migration、DB/action-log 备份、隔离 READY/reopen、注入式 DDL rollback 和 integrity/FK；reviewer 未重复执行
- `src/main/domain/authority/__tests__/bootstrap-trust-chain.test.ts`、`src/main/domain/event-batch/__tests__/preview-principal-recovery.test.ts`、`src/main/ipc/__tests__/handler-registry.test.ts`：`PASS`，父会话定向测试覆盖 DB ACTIVE ADMIN、跨实例 replay/冲突、enrollment payload recovery 和关联 ACTIVE student profile；最新 bootstrap/migration 定向组为 15/15
- `src/main/application/query/__tests__/preview-read-scope.test.ts`、`src/main/ipc/handlers/__tests__/preview.test.ts`、`src/main/ipc/handlers/__tests__/feedback.test.ts`、`src/main/domain/authority/__tests__/principal-binding.test.ts`、`src/main/application/planners/__tests__/preview-principal-planner.test.ts`：`PASS`，父会话验证教师 canonical 目录、责任 assignment/grant 过滤、executor principal mismatch 和 planner fail-closed wiring

独立 reviewer 本轮未重复执行全量测试、typecheck、lint、build、parity/readiness 或 M5B verifier；以上结果由父会话实际命令提供，不能写成 reviewer 自行执行。

## 复核后的增量变更

父会话在本复核完成后发现 `scripts/e2e/m5b-native-electron.ts` 的 exact-M4 fixture 没有移除当前 schema 中的 preview migration ledger，导致 native M5B verifier 首次执行为 `M5B_LEDGER_DRIFT`。随后仅对该 fixture 增加了 preview tables/indexes/triggers/ledger 的隔离清理，并重新执行：

- `npm run db:m5b:native:verify`：`PASS`，Electron ABI 下 exact M4、配对备份、M5B 迁移、重开和 integrity 检查通过；
- M5B 定向测试：`PASS`，60/60；
- 历史阶段 `npm test`：`PASS`，198 files / 1588 tests；当时的 typecheck、lint、build 也重新通过；当前父会话全量结果见上方 199/1597 记录。

本轮又将 PoP replay 的唯一性收紧为安装范围内的 `target_installation_id + nonce_hash`，并新增跨 certificate/challenge 重用 nonce 的冲突回归；随后补上教师读取责任、过期 delegated grant、feedback canonical/source binding 拒绝和 sender-bound executor 绑定。最新父会话又补上学生 session formal namespace 和 feedback 岗位/任务 scope 漂移拒绝；上述修复已由定向组和 199/1597 全量测试覆盖，Gauss 当前固定状态独立增量复核确认 P0/P1/P2=0、NOTE=1，因此当前结论为 conditional，而不是新的无条件 `PASS`。

上述 P1 修复没有被 Ampere 原始独立 reviewer 覆盖；Arendt 覆盖中间修复，Gauss 已对当前固定状态的权限增量完成独立核对并返回 `CONDITIONAL_PASS`，因此本文件总体结论为历史完整 R3 与当前增量证据合并后的 `CONDITIONAL_PASS`，仍不能升级为无条件 `PASS`。

## 修复后独立复核尝试

- `Leibniz`：在等待窗口内未返回报告，随后关闭；不能作为结论证据。
- `Mendel`：中断后返回 `BLOCKED`；仅完成局部定位，不能作为结论证据。
- `Helmholtz`：中断后返回 `BLOCKED`；仅完成局部定位，不能作为结论证据。
- `Arendt`：返回 `CONDITIONAL_PASS`，P0/P1/P2=0、NOTE=1；独立核验 `preview-read-scope.ts:14-64`、`preview-query-service.ts:218-228,303-338`、`feedback-query-service.ts:20-115`、`handler-registry.ts:337-382`、`principal-binding-service.ts:426-557`、`preview-principal-planner.ts:141-203` 及对应测试，未运行命令、未访问数据库。
- `Rawls`：在新增 session source namespace 与 feedback job/task scope 修复后启动只读复核，但等待窗口内未返回报告，随后关闭；不能作为结论证据。
- `Gauss`：返回当前固定状态 `CONDITIONAL_PASS`，P0/P1/P2=0、NOTE=1；独立核验 `preview-read-scope.ts:14-39`、`preview-query-service.ts:218-277`、`feedback-query-service.ts:43-95`、`handler-registry.ts:337-374`、`preview-principal-planner.ts:157-190` 及对应回归，未运行命令、未访问数据库。

这些尝试均未修改工作树、未访问默认数据库。Gauss 的报告提供了当前固定代码状态的独立权限增量证据，但未运行全量测试、migration 或真实人工门，因此当前仍是 `CONDITIONAL_PASS`，不能把自动化结果升级为无条件 `PASS`。

## 尚未执行的门禁

- preview 专属教师/学生 UI 与 renderer 业务流程走查；真实签名/bootstrap trust chain、真实 `userData` vault 权限/重启/导出；
- 多设备教师/学生业务流、真实安装环境 migration upgrade/rollback、backup pair 恢复和旧应用 fail-closed 验证；原生隔离 harness 的迁移与注入式 rollback 已由父会话执行通过，但不替代真实环境门禁；
- 明确发布批准前的 production/default DB readiness promotion。

因此 fresh/current 隔离 registry 继续保持 `INSTALLING`，不把测试 fixture 的显式 promotion 写成全局 `READY`。
