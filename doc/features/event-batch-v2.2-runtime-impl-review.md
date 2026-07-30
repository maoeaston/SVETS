# M5B Event Batch Runtime — 独立 R3 实施计划审查

## 1. 审查范围

- 类型：`IMPL`。
- 风险：`R3`。
- 工件：`doc/features/event-batch-v2.2-runtime-impl.md`。
- 对照 PRD：`doc/features/event-batch-v2.2-runtime-prd.md`，SHA-256 `bcf99c10cc7ff3832fd454969ac9aae36517980a798700d0b95acea29655e746`。
- PRD Review：`doc/features/event-batch-v2.2-runtime-prd-review.md`，结论 `PASS`。
- base / branch：`40541c82ef374f28ce300365e0e5cc82423dd99a` / `feat/multi-device-m2-prd`。
- 适用不变量：`INV-EVT-001`～`003`、`INV-SAFE-001`～`004`、`INV-RES-001`～`002`、`INV-AUTH-001`～`002`、`INV-IPC-001`～`002`、`INV-DATA-001`～`003`；目标新增 `INV-EVT-004`～`006`。
- 独立性：Reviewer 不把计划自述、PRD 状态或起草过程当作计划正确性证据；重新对照权威架构、当前 Schema、M5A final scanner、现有 writer/reducer/service/report/auth/runtime 代码。
- 未审查内容：尚未实现的 M5B 代码、native migration、Electron crash/E2E 不能在计划审查中判定通过。
- 数据边界：未定位、打开、读取、hash、初始化或修改默认运行数据库。

## 2. 最终结论

结论：`PASS`

- Round 1：`CONDITIONAL_PASS`，P0=0、P1=6、P2=1。
- Round 2：修订版 SHA-256 `08955cb1efcdb35bd09b540fe2ab06a8c8883d6eccc2e4f8fb6f441761c613cd`；P0=0、未关闭P1=0、未关闭P2=0。
- 编码资格：`GRANTED`，可按 M5B-1～15 逐步实施并执行每步 `/vibe-accept`。

## 3. 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| 权威/工作流/不变量读取 | PASS | 已核对 `AGENTS.md`、baseline、project invariants、workflow contract、v2.2 架构 §7.2/10/11/12、PRD 与 PRD review。 |
| 当前 M5A final inventory | PASS | `npm run contract:m5a:command-boundary:check`：74 channels（28/46）、28 direct files、13 roots、pending 0、exceptions 76、digest `f97ef382...9527`。 |
| 计划步骤/依赖机械检查 | PASS | 15 个 Step，均具前置、完成、测试、回滚、停止条件；36 batch/10 gate-only channel 分类可复算。 |
| Round 2 定向复核 | PASS | 逐项核对 differential oracle、prepared-only effect/result、projection source、mixed replay、activation rollback、deterministic rejection和segment临界规则；7项均已形成步骤+测试+最终门禁。 |
| 文档索引 | PASS | `npm run docs:index:update` 后 `npm run docs:index:check` current。 |
| whitespace | PASS | impl/PRD/review/index `git diff --check` 无错误。 |
| typecheck/lint/unit/build/native/Electron | NOT_RUN | 本轮只审查计划；不能把既有或未实现代码检查外推为 M5B 通过。 |

## 4. P0

NONE。

## 5. Round 1 P1（均已关闭）

### [M5B-IMPL-P1-01] 36 个领域命令缺少 legacy→v2 可观察行为差分 oracle

- 位置：实施计划 §4.3、Steps M5B-6～13、§6 Compatibility。
- 证据：计划要求 golden plan 和既有 regression，但没有规定在同一初始事实的两份临时库上分别运行当前已验收 legacy service 与新 planner/projector，再比较 public result 与业务投影。现有 services 含大量隐式 query、随机 ID/time、child automation，单独的 planner golden 和旧 handler test 都可能同时通过而语义已经漂移。
- 触发条件：新 planner 漏掉一个旧 DML、改变错误/no-op、child 顺序或结果字段，而 golden fixture按新实现生成。
- 影响：36 个命令可能在切换时改变业务行为，尤其 scoring/report/safety/assignment，违反 PRD“业务响应/语义不变”。
- 违反依据：`/vibe-impl` R3 compatibility 要求；PRD EBR-02/08/09/11。
- 最小修复：新增逐 command differential harness：克隆同一显式 `/tmp` pre-state，A 跑冻结 legacy oracle，B 跑 v2 plan+projector；注入相同 clock/ID 或做有审计的 semantic normalization；比较 public result、业务投影、event meaning及预期文件变化。golden不能由被测实现自更新。
- 回归测试：46 row registry中36 row必须各绑定至少一个 differential test ID；关键多事件/错误/no-op均覆盖。

### [M5B-IMPL-P1-02] operational effect 与 result recipe 在 PONR 后的持久来源不够机械

- 位置：实施计划 §4.4、M5B-5 完成状态/伪代码。
- 证据：`CommandPlanV1` 同时返回 events、result recipe和operational effects，但永久record只允许三类；计划虽说 EVENT 自足，却没有禁止 plan-only effect参数，也没有定义“每个 EVENT 的 root recipe/version一致性”与 recovery registry如何从prepared bytes选择effect/recipe。
- 触发条件：PREPARE fsync后进程退出，plan对象丢失；recovery只剩command row与EVENT。
- 影响：恢复可能漏auth/runtime/report effect、重读可变状态或无法生成原result，迫使重跑planner，违反PONR。
- 违反依据：PRD §7.2、§7.5、EBR-04/09。
- 最小修复：规定 plan中的operational effect只是由EVENT payload/version机械派生的编译期视图，不得含未持久参数；每条EVENT的 `batch_context` 必须携带相同root command/result recipe/version并互相校验；projector/effect/result registry只能以prepared EVENT + command row stable fields dispatch，unknown/conflict进入corruption。增加“删除plan内存后恢复”的测试。
- 回归测试：序列化后丢弃plan对象、重启新composition，只给command row+segments，仍得到相同effects/result；篡改任一recipe/version失败关闭。

### [M5B-IMPL-P1-03] `domain_event_projection` 的 v2 source定位与 `processed_event` 对账未冻结

- 位置：实施计划 §4.5、§4.9 projector row、M5B-5。
- 证据：当前 Schema 强制 `domain_event_projection.source_log_path`，并有line/byte offset；PRD §7.8要求它与 `processed_event` 的event ID/source segment对账。计划只写“插入domain projection”，未规定v2 segment相对路径、record line/byte offset、schema version及逐字段一致性。
- 触发条件：APPLY或rebuild写入v2 event projection。
- 影响：查询投影无法可靠追到事实byte，或同event在两个表的type/aggregate/batch归属漂移；tamper/rebuild门禁无法判定。
- 违反依据：PRD §7.8、EBR-02/05；`INV-EVT-001/004/006`。
- 最小修复：冻结source mapping：只存data-root相对segment路径、EVENT起始byte/line、payload version；`processed_event`与projection的event/type/aggregate和batch→segment必须严格JOIN一致；normal APPLY、recovery、rebuild共用一个插入/断言函数。
- 回归测试：source offset round-trip、绝对路径拒绝、两表字段tamper、同event不同batch/segment、mixed replay对账。

### [M5B-IMPL-P1-04] 缺少显式 mixed legacy + v2 rebuild pipeline 和不可重建基础设施 fixture

- 位置：实施计划 M5B-3 legacy reader、M5B-5 recovery、M5B-14 cutover、§6 Startup/Compatibility。
- 证据：计划分别实现legacy parse与v2 startupRecovery，但没有一个明确owner按 `legacy anchor -> legacy replay -> v2 verified batches` 重建领域投影，也没有要求提供user/student/strategy/question/auth等不可重建基础设施fixture。
- 触发条件：rebuild测试、SQLite可重建投影缺失或验证两代事实连续性。
- 影响：可能只验证启动协调而未验证mixed replay，或错误声称空DB可由JSONL完整恢复。
- 违反依据：PRD §7.6、§7.8、EBR-07。
- 最小修复：在M5B-5/14增加 `mixed-domain-replay` owner；输入必须显式提供非事件基础设施fixture，先byte-exact legacy reducer，再按verified batch sequence运行v2 projector；明确不重建command完整历史。
- 回归测试：legacy v1/F7 + 多个v2 segment重建业务表，与正常投影semantic一致；缺基础设施fixture稳定拒绝。

### [M5B-IMPL-P1-05] “首个PREPARE前可回退应用”忽略legacy seal与gate-only已提交状态

- 位置：实施计划 §4.7 第216行、M5B-14回滚方式。
- 证据：M5B-14会先发布legacy anchor/逻辑seal再OPEN；即使尚无v2 PREPARE，auth/student/strategy gate-only也可能已有command_log和业务DML。直接恢复M5A应用会继续向已seal的legacy文件append并丢失durable idempotency语义。
- 触发条件：M5B已完成seal或OPEN，尚未出现batch PREPARE，但已有或没有gate-only调用，然后尝试应用回退。
- 影响：历史边界被破坏，或command/DML状态与旧应用不一致。
- 违反依据：PRD §7.6、§9.5、§13.2；`INV-EVT-006`。
- 最小修复：定义切换激活边界。只有runtime从未OPEN、无command claim、无v2 record、T11–T14空且可从paired backup恢复legacy/index前态时，才允许经人工批准回退；seal发布/OPEN/任一claim后只前滚或恢复整对backup，禁止单独换回M5A binary。
- 回归测试：seal前失败可成对恢复；seal后、OPEN后、gate-only后、partial PREPARE后均拒绝直接rollback。

### [M5B-IMPL-P1-06] deterministic business rejection 的持久状态未固定

- 位置：实施计划 M5B-4/M5B-5/M5B-7 result描述。
- 证据：计划区分completed rejection与system `FAILED`，但没有明确T11只有 `SUCCEEDED/FAILED` 时，public `{success:false}` 的确定性业务拒绝必须用哪个status。若实现写`FAILED`，同key会按attempt policy重跑业务拒绝。
- 触发条件：权限后业务状态冲突、already-scored/no-op以外的确定性public failure。
- 影响：同key不再是不可变结果，attempt增加并可能在后续状态变化后成功，破坏幂等。
- 违反依据：PRD §7.2、S9、EBR-03/11。
- 最小修复：明确所有确定性public result（包括`success:false`）都以`status=SUCCEEDED`+versioned result envelope完成；`FAILED`只用于registry允许重试的pre-PONR系统失败，PONR后永不FAILED。
- 回归测试：同key deterministic rejection跨状态变化仍返回原result且attempt不变；new key重新求值。

## 6. Round 2 关闭证据

| Finding | 修订位置 | 关闭证据 | 状态 |
|---|---|---|---|
| M5B-IMPL-P1-01 | impl §4.4.1、M5B-1、M5B-5～13、§6 | 46 command row绑定differential ID；36领域row必须用冻结legacy oracle与A/B临时根比较result、业务表、event语义和文件；redline/export允许差异逐项登记，禁止通配normalizer。 | `CLOSED` |
| M5B-IMPL-P1-02 | impl §4.4、M5B-5 | operational effect被定义为EVENT派生视图；全batch recipe/context一致；PREPARE后销毁plan并以新composition仅凭prepared EVENT+command row恢复。 | `CLOSED` |
| M5B-IMPL-P1-03 | impl §4.4、§4.9、M5B-5、§6 | relative segment path、EVENT line/byte、schema mapping、processed/projection/batch→segment严格对账及共用writer均已冻结并有tamper tests。 | `CLOSED` |
| M5B-IMPL-P1-04 | impl M5B-5、M5B-14、§6 | 新增mixed-domain-replay owner，固定legacy anchor→legacy reducer→v2 sequence顺序；缺不可重建基础设施fixture稳定拒绝，明确不重建完整command history。 | `CLOSED` |
| M5B-IMPL-P1-05 | impl §4.7、M5B-14、§6 | 直接M5A回退仅限never-OPEN、pre-seal、无claim/record、空T11–T14；post-seal需整对backup，OPEN/claim/gate/PREPARE后只前滚或整对恢复。 | `CLOSED` |
| M5B-IMPL-P1-06 | impl M5B-4、M5B-7、§6 | 所有确定性public result包括`success:false`固定为SUCCEEDED；FAILED仅pre-PONR系统失败；同key状态漂移负测已登记。 | `CLOSED` |
| M5B-IMPL-P2-01 | impl §4.5、M5B-3 | prospective byte/confirmed-count规则、COMMITTED计入final size和四个临界golden均已唯一化。 | `CLOSED` |

Round 2 未发现新增 P0/P1/P2。计划的单一production cutover仍大，但其所有组件在M5B-14前保持未接线并要求逐步accept；这属于受控R3规模，不再构成未关闭finding。

## 7. Round 1 P2（已关闭）

### [M5B-IMPL-P2-01] segment轮转临界语义仍可有两种实现

- 位置：实施计划 §4.5 `rotate before batch if needed`、M5B-3。
- 证据：未说明按当前大小达到阈值，还是“加入本批后超过阈值”轮转。
- 影响：不同实现会产生不同segment边界和golden index，虽不必然损坏数据但会造成跨版本不一致。
- 最小修复：冻结prospective规则，例如非空active segment在 `current_bytes + prepared_bytes > 10,485,760` 或 `confirmed_count >= 10,000` 时于PREPARE前轮转；空segment必须能容纳受8MiB上限约束的单batch。
- 回归测试：阈值前1 byte、恰好阈值、超过1 byte、9999/10000批。

## 8. NOTE / 待验证

- 目标平台是否支持目录durability barrier、hard-link no-clobber和所需identity API，只能由M5B-3 native/Electron KAT证明；当前不把它判为通过或缺陷。
- 当前巨大dirty worktree下，Step M5B-1 scope fixture是否足够易审计需看实际生成物；计划方向正确，但以实现证据为准。

## 9. 已核验通过的关键项

- 15步依赖顺序总体合理；M5B-14前不接production，避免hybrid legacy/v2事实源。
- 75/29/46与36/10分类完整，health push未误计invoke channel。
- T11–T14与T18/M5C/网络/42+8边界清楚。
- migration、legacy reconcile/seal、batch recovery顺序与PRD一致。
- report dialog不持有writer mutex/SQLite transaction，probe在PONR前，artifact在PONR后可重建。
- login/logout特殊replay、secret-safe hash、read-only corruption/default-data保护均进入步骤和测试。
- new safety单事件与legacy两事件兼容边界清楚。

## 10. 残余风险

- M5B-14仍是大范围原子切换；只有前13步产物均有可执行test composition和target pending账本，才可接受其规模。
- 实现不得把计划中的建议文件名当作架构正确性的替代；实际diff若暴露新的owner/callsite必须更新inventory并复审。

## 11. 规则沉淀候选

- 将“legacy/v2 differential oracle”“prepared-only recovery”“projection source对账”“activation rollback barrier”加入M5B静态fixture和最终INV-EVT-004～006的机器测试。

## 12. 置信度

`HIGH`。计划、权威合同和当前关键代码均已读取，M5A inventory已实际复算。限制是M5B尚未实现，native文件能力与Electron故障矩阵只能在后续accept中验证。
