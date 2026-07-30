# M5A Command Bus Boundary 独立 R3 审查提示

## 任务

在独立上下文中执行：

```text
/vibe-review prd doc/features/m5a-command-bus-boundary-prd.md
```

这是对 M5A Command Bus Boundary Mini-PRD 的 R3 再审查。目标是确认上一轮 `M5A-R3-01` 至 `M5A-R3-04` 的候选修订是否真正关闭 P1。只审查，不实现，不进入 `/vibe-impl`。

## 独立性与范围

- 你不是本轮 PRD 修订者。必须从当前仓库和目标 PRD 独立得出结论。
- 不得把目标 PRD 第 14 节、上一轮审查结论或本提示当作证据。`m5a-command-bus-boundary-r3-rereview.md` 只能在你完成独立取证后作为待核对的问题清单。
- 目标 PRD 当前为未跟踪文件，普通 `git diff` 不会显示它。必须完整读取该文件，并单独检查格式和内容；不要把 `git diff --check` 的无输出误写成目标 PRD 已通过。
- 本次是 PRD review，不修改 `doc/features/m5a-command-bus-boundary-prd.md`、代码、Schema、migration、默认数据库或历史 JSONL。保留工作区所有既有改动，不执行 `git add`、commit、push、merge、rebase 或默认库操作。
- 如果需要运行测试或数据库检查，只能使用 MemoryAdapter、`os.tmpdir()` 或显式隔离 data root。未执行的检查必须标为 `NOT_RUN`。

## 必读资料

先完整读取以下资料，并按 `vibe-coding-skills-v2/commands/vibe-review.md` 的步骤执行：

1. `AGENTS.md`
2. `doc/specs/baseline.yaml`
3. `doc/specs/project-invariants.md`
4. `doc/ai/vibe-workflow-contract.md`
5. `vibe-coding-skills-v2/commands/vibe-review.md`
6. `doc/features/m5a-command-bus-boundary-prd.md`
7. `doc/specs/MVP_PRD_v1.0.9-authoritative.md` 的事件、IPC、权限、安全、恢复和验收相关章节
8. `doc/specs/architecture-plan-b-multi-device-v2.2-authoritative-baseline.md` §10、§11、§12、§14.5
9. `src/main/db/schema.sql`、`src/shared/types/{ipc-api,event-payloads,json-schemas}.ts`、`src/preload/index.ts`

本次适用不变量：`INV-EVT-001`、`INV-EVT-002`、`INV-EVT-003`、`INV-SAFE-001` 至 `INV-SAFE-004`、`INV-AUTH-001`、`INV-AUTH-002`、`INV-RES-001`、`INV-RES-002`、`INV-IPC-001`、`INV-IPC-002`、`INV-DATA-001`、`INV-DATA-003`。

## 必查实现证据

按问题增量读取实际代码和测试，至少覆盖：

- target 解析：`ability-scoring.ts`、`operation-scoring.ts`、`job-skill-scoring.ts`、相关 assessment/session 查询路径。
- preflight 副作用：`auth-session.ts`、`auth.ts`、`assessment.ts`、`student.ts`、`strategy.ts` 的 auth resolver 和 `ensureSeeded()` 路径。
- writer inventory：`auth.ts`、`student.ts`、`strategy.ts`、`safety-rekey-migration.ts`、`action-log-path.ts`、`src/main/index.ts`、connection/migration/recovery/report/local-runtime 入口。
- JSONL 与恢复：`event-writer.ts`、`operation-scoring.ts`、`recovery.ts`、`legacy-upgrade-recovery.ts`，以及相应测试。

先执行并记录 `git status --short --branch -uall`。对目标 PRD 另做行级读取和 Markdown 格式核验。可用以下静态扫描复核 direct-side-effect 基线，但它只能作为入口，不能代替调用图和行级审查：

```bash
rg -l --glob '*.ts' --glob '!**/__tests__/**' --glob '!**/*.test.ts' '(writeEvent\(|\.run\(|\.exec\(|appendFileSync\(|writeFileSync\(|renameSync\(|unlinkSync\(|mkdirSync\(|copyFileSync\(|truncateSync\(|rmSync\(|rmdirSync\()' src/main | sort
```

## 必须逐项裁决的 P1

| ID | 必须确认的事实 | 至少需要的证据 |
|---|---|---|
| `M5A-R3-01` | 每个 mutation registry 是否强制唯一的纯读 `target_resolver`，既有 aggregate 是否从数据库解析三元键，create 与 bootstrap 是否定义权威来源，客户端 hint 是否在 `request_hash` 前比较并拒绝 mismatch。 | 当前 PRD §5、§6.1.1、§6.2，session/scoring 实际查询路径，伪造 job/task/student、not-found 与冲突场景的验收可执行性。 |
| `M5A-R3-02` | 未接受请求是否在任何 DB/file 副作用前失败，seed 是否移至 boundary ready 前，auth snapshot 是否无写，READ 是否不 heartbeat，accepted mutation 与独立 sweep 的维护边界是否清楚。 | `auth-session.ts`、handler `ensureSeeded()`、PRD preflight 顺序和前后状态验收。区分 preflight 拒绝与已接受后的业务失败。 |
| `M5A-R3-03` | inventory 是否包括 auth/student/strategy DML、M4 safety migration kernel、隐藏 `mkdirSync`、E2E data-root、startup/migration/recovery/report/auth maintenance，并为每项给出 mode、actor、phase、transaction owner、retry 和 test reference。 | 35 个 direct-side-effect 文件、4 个 delegating roots 与当前扫描的逐项对账。确认固定集合没有把 test-only writer 当生产入口，也没有遗漏委派写入。 |
| `M5A-R3-04` | PRD 是否只承诺当前调用内 SQLite projection/reducer 事务原子性，是否明确 JSONL 合法前缀不可回滚、legacy recovery 按单事件处理，且没有把 `correlation_id` 伪装成 batch commit。 | `event-writer.ts` append 顺序、multi-event scoring 事务、`recovery.ts` 的逐事件恢复、真实临时 JSONL 第 N 次故障验收标准。 |

## 输出与结论

按 `/vibe-review` 的标准格式写审查报告，逐项列出范围、风险等级、权威资料、适用不变量、已执行检查、P0/P1/P2/NOTE、已核验通过项、残余风险、规则沉淀候选和置信度。每个 finding 必须包含位置、触发条件、实际影响、违反依据、最小修复和回归测试。

结论规则：存在 P0 时为 `BLOCKED`；无 P0 但存在 P1 时为 `CONDITIONAL_PASS`；只有 P0/P1 清零且必需检查有独立证据时才可为 `PASS`。不得因为本提示要求复审而制造 finding，也不得把未运行的测试写成通过。

审查完成后，把报告保存为 `doc/features/m5a-command-bus-boundary-r4-rereview.md`。这是新文档，必须运行 `npm run docs:index:update` 和 `npm run docs:index:check`。除审查报告和必要的文档索引自动清单外，不修改任何文件。无论结论为何，都不开始 `/vibe-impl`。
