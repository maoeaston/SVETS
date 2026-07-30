# M5B Event Batch Runtime 验收记录

## 1. 验收边界

- 里程碑：Step 2C / M5B Event Batch Runtime。
- 风险等级：R3。
- 实施计划：`doc/features/event-batch-v2.2-runtime-impl.md`。
- 计划审查：`doc/features/event-batch-v2.2-runtime-impl-review.md`，最终 `PASS`。
- 规划/工作区基点：`40541c82ef374f28ce300365e0e5cc82423dd99a` / `feat/multi-device-m2-prd`。
- 数据边界：M5B-1只读取源码/fixture或创建自己拥有的临时目录和普通测试文件；M5B-2只在每次唯一的`/tmp/svets-m5b-*`成对路径内创建M4测试库、legacy fixture、迁移库、备份与恢复副本。两个步骤均未定位、打开、读取、hash、初始化或修改默认运行数据库、默认 userData 或默认 action-log。
- 状态词只使用 `PASS / FAIL / NOT_RUN / BLOCKED`；预期失败的负向测试单独标记，不伪装成 required gate PASS。

## 2. Step M5B-1 — inventory、实现起点与隔离范围门禁

### 2.1 结论

状态：`PASS`

完成事实：

- M5A final source重新复算为74 channels（28 READ/46 MUTATION）、28 direct files、13 roots、pending 0、exceptions 76，digest仍为`f97ef382ab9a9678ab20f06310e6906e811cdd765526d69a4fcc11bca6939527`。
- M5B target精确冻结为75 invoke channels（29 READ/46 MUTATION）、36 `BATCH_DOMAIN_MUTATION`、10 `GATE_ONLY_MUTATION`。
- 361个M5A active entry与378个mapping entry全部有唯一M5B disposition；76个exception逐项重裁为29 `TEST_ONLY`和47 `PRE_GATE_MIGRATION_INTERNAL`，没有整体继承allowlist。
- 46个command row均有唯一legacy→v2 differential test ID；只有`assessment:triggerRedline`与`reports:export`登记PRD允许的明确语义差异。
- 初始migration pending精确为46 command、1 health channel、43 legacy event-port callsite、8 request-time report command callsite；target均为0。
- 实现起点fixture保存781个tracked/untracked worktree entry与686个index entry。最终scope gate证明既有基线文件未漂移，只有本步allow-path发生变化，HEAD/branch/index保持冻结状态。
- path guard只接受同一`/tmp/svets-m5b-*`运行根下的成对DB/dataRoot/legacyLog/userData/export/evidence路径；缺失、相对、非规范、不配对、symlink、hardlink与非文件在open callback前拒绝。
- fixture生成器在首次冻结后默认拒绝覆盖；测试验证重跑不会改变两个fixture hash。

### 2.2 真实变更

- 新增：
  - `scripts/fixtures/m5b-implementation-start-v1.json`；
  - `scripts/fixtures/m5b-command-runtime-inventory-v1.json`；
  - `scripts/lib/m5b-runtime-inventory.mjs`；
  - `scripts/lib/m5b-contract-scope.mjs`；
  - `scripts/lib/m5b-isolated-paths.mjs`；
  - `scripts/check-m5b-event-batch.mjs`；
  - `scripts/verify-m5b-contract-scope.mjs`；
  - `scripts/update-m5b-step1-fixtures.mjs`；
  - 三个对应Vitest测试文件。
- 修改：`package.json`只增加M5B inventory/scope命令；`doc/index.md`由自动索引脚本同步。
- 未修改：production runtime、Schema、IPC/shared/preload/renderer业务合同、legacy事件日志逻辑。

### 2.3 已执行命令

| 命令 | 状态 | 证据 |
|---|---|---|
| `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-isolated-paths.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs` | PASS | 最终3 files / 23 tests全部通过。首次运行有1个test assertion文案匹配错误，修正预期regex后重跑通过；无production缺陷被掩盖。 |
| `npm run contract:m5a:command-boundary:check` | PASS | 74/28/46、28 files、13 roots、pending 0、exceptions 76、固定digest匹配。 |
| `npm run contract:m5b:event-batch:check -- --mode baseline` | PASS | target 75/29/46、36/10；source active 361、mapping 378、exceptions 76。 |
| `npm run contract:m5b:event-batch:check -- --mode migration --step M5B-1` | PASS | pending commands=46、health=1、legacy=43、report=8；source digest匹配。 |
| `npm run contract:m5b:scope:check -- --step M5B-1` | PASS | HEAD/branch/index无漂移，既有起点文件保持，M5B变化仅在本步allow-path，violations=0。 |
| `npm run typecheck` | PASS | `vue-tsc --noEmit`与Node TypeScript检查退出码0。 |
| `npm run lint` | PASS | 退出码0；0 errors、661个既有Vue格式warnings，未声称零warning。 |
| `git diff --check` | PASS | 无whitespace error。 |
| `npm run docs:index:check` | PASS | 文档索引current。 |

### 2.4 预期失败的负向证据

| 命令 | 状态 | 说明 |
|---|---|---|
| `npm run contract:m5b:event-batch:check -- --mode target` | FAIL（预期） | 明确报告缺少`runtime:getHealth`；M5B-1尚有46/1/43/8 pending，不能提前宣称target通过。该FAIL不是本步required gate失败。 |

### 2.5 副作用与回滚核对

- production import graph未接入任何M5B runtime模块；M5A target scanner仍PASS。
- path tests只在helper创建的`/tmp/svets-m5b-*`目录内写普通测试文件，结束后定向清理自身run root。
- 未新增依赖、未生成`package-lock.json`、未打开数据库。
- 若回滚本步，删除M5B scripts/tests/fixtures/本记录并移除两个`package.json`命令即可；production行为不变。

### 2.6 首次失败关闭记录

- 定向测试首次结果：`FAIL`，21/22通过；失败原因是负向测试期望错误消息必须先报告gate count，但validator先报告batch count，两者都正确识别同一故意class drift。
- 修复：只放宽测试regex为`/command count/`，未改validator或production代码。
- 最终结果：`PASS`，23/23（另新增fixture拒绝覆盖测试）。

## 3. Step M5B-2 — BEGIN IMMEDIATE 与未接线 T11–T14 迁移核

### 3.1 结论

状态：`PASS`

完成事实：

- `DBAdapter`新增显式`immediateTransaction()`；production `SqliteAdapter`调用better-sqlite3 transaction的`.immediate()`并在已有事务中fail closed，`MemoryAdapter`使用`BEGIN IMMEDIATE`，5个既有test wrapper均显式转发，没有静默退回普通transaction。
- migration ID固定为`2026-07-29_mvp_schema_v0_1_18_event_batch_v2_2`，version固定为`0.1.18-event-batch-v2.2`。
- 迁移核只创建架构§7.2的T11 `command_log`、T12 `applied_event_batch`、T13 `processed_event`、T14 `projector_cursor`及3个命名索引；列顺序/type/not-null/default/PK、table/index SQL、FK、unique与CHECK均由结构断言和约束测试核对，不含T15–T19或T18。
- source preflight只接受真正空库或精确M4：M4 migration ledger逐项精确、当前Schema断言通过、169个显式table/index/trigger名称集合digest匹配。partial、mixed、未知ledger、额外对象、无ledger target均在backup/DDL前拒绝。
- 精确M4路径强制先完成成对backup callback，随后才进入单个`BEGIN IMMEDIATE`执行DDL与ledger；ledger写入故障注入证明4张表和migration row全部回滚。完整target重复调用是无DDL、无backup的成功no-op。
- 隔离验证在唯一`/tmp/svets-m5b-*`路径中加载M4 Schema，逐字节备份legacy fixture，以sql.js执行同一迁移核并导出真实SQLite文件，再用系统SQLite 3.50.6执行`integrity_check`、`foreign_key_check`与query-plan检查；备份恢复后仍是无T11–T14的精确M4，legacy hash不变。PASS后只删除自己拥有的run root；故障测试保留证据再由测试定向清理。
- production `schema.sql`、`migrations.ts`、`migration-startup.ts`与`connection.ts`均未接入M5B migration；正式Schema/启动接线仍留在M5B-14。
- M5B-2 scanner delta精确冻结：M5A 74 channels与72 capability callsites无变化；3个Memory transaction底层callsite因共享transaction kernel移动，新增3个migration-internal DB callsite，direct总数215→218、direct files 28→29，目标digest为`b9d4d98f89c5dde6ed1466c31a75d12a152a990a8337e103eb04e66536e1199f`。6个target delta逐项分类，无未登记新增。

### 3.2 真实变更

- production（尚未接线）：`src/main/db/interface.ts`、`sqlite-adapter.ts`、`memory-adapter.ts`、新增`event-batch-migration.ts`。
- tests：新增`src/main/db/__tests__/event-batch-migration.test.ts`；5个既有DBAdapter wrapper显式转发新端口；既有migration/backup测试保持回归覆盖。
- isolated evidence：新增`m5b-isolated-db.mjs` helper、CLI与测试；`package.json`新增`db:m5b:isolated:verify`。
- gate：新增冻结的`m5b-step2-source-delta-v1.json`及一次性生成器；M5B runtime/scope gate扩展到M5B-2，M5B-3仍fail closed。
- 未修改：production Schema版本、migration注册/启动顺序、业务handler、IPC/shared/preload/renderer合同与legacy writer。

### 3.3 已执行命令

| 命令 | 状态 | 证据 |
|---|---|---|
| `npm test -- src/main/db/__tests__/event-batch-migration.test.ts src/main/db/__tests__/migrations.test.ts src/main/db/__tests__/migration-backup.test.ts scripts/__tests__/m5b-isolated-db.test.mjs` | PASS | 最终4 files / 32 tests全部通过；覆盖fresh/M4/重复/partial/unknown/extra object/FK/CHECK/index/rollback/nesting/backup restore。 |
| `npm run db:m5b:isolated:verify -- --stage schema` | PASS | T11–T14=4、named indexes=3；三个query plan均命中指定索引；DB与legacy成对hash、恢复与完整性检查通过，临时根在PASS后删除。 |
| `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs` | PASS | 2 files / 19 tests；M5B-2 exact source delta及范围fail-closed通过。 |
| `npm run contract:m5b:event-batch:check -- --mode migration --step M5B-2` | PASS | pending仍为46/1/43/8；source digest精确为`b9d4d...1199f`。 |
| `npm run contract:m5b:scope:check -- --step M5B-2` | PASS | HEAD/branch/index无漂移，M5B变化只在累计M5B-1/2 allow-path，violations=0。 |
| `npm run typecheck` | PASS | `vue-tsc --noEmit`与Node TypeScript检查退出码0。 |
| `npm run lint` | PASS | 退出码0；0 errors、661个既有Vue格式warnings，未声称零warning。 |
| `git diff --check` | PASS | 无whitespace error。 |
| `npm run docs:index:check` | PASS | 文档索引current。 |

### 3.4 预期失败与未执行项

| 检查 | 状态 | 说明 |
|---|---|---|
| `npm run contract:m5a:command-boundary:check`（M5B-2工作区） | FAIL（预期） | M5A门禁冻结的是M5B开始前digest；本步刻意新增3个migration-internal DB callsite并重构3个Memory transaction callsite。M5B-2 gate已逐项登记并精确验证这6个delta，channels/capabilities不变。 |
| Electron native ABI migration verifier | NOT_RUN | 计划明确到M5B-15接通；当前Node与Electron原生ABI不同，本步使用sql.js执行同一kernel并由系统SQLite CLI复核真实文件，不冒充native Electron PASS。 |
| production startup migration | NOT_RUN | 本步按计划保持migration未接线；M5B-14前不得运行或宣称通过。 |

### 3.5 首次失败关闭记录

- migration定向测试首次为8/9：测试错误地假设fresh `schema.sql`含seeded `user_account`行；改为核对8条M4 ledger完整保留并新增1条M5B ledger，production代码未改。最终10/10通过。
- M5B scanner测试扩展后的首次运行有2个harness失败：M5B-1历史测试误用已进入M5B-2的当前checkout；fixture拒绝覆盖测试依赖子进程stderr文案。修复为以冻结M5A fixture验证M5B-1，并只核对生成器非零退出与fixture hash不变。未放宽M5B-2 source delta验证。

### 3.6 副作用与回滚核对

- 所有数据库、legacy文件、backup、restore和manifest只存在于helper创建并验证的显式`/tmp/svets-m5b-*`根；默认路径解析器和production connection模块被静态门禁禁止出现在M5B脚本中。
- 未新增依赖、未生成`package-lock.json`、未注册production migration、未改变默认启动行为。
- M5B-2仍在不可逆点前：恢复adapter interface/test wrapper并删除未接线migration/helper/test/fixture/package命令即可回到M5B-1；没有production DB需要down migration。

## 4. Step M5B-3 — canonical record、segment/index 与 legacy 无损原语

### 4.1 结论

状态：`PASS`

完成事实：

- 永久记录只接受`BATCH_PREPARED`、`EVENT`、`BATCH_COMMITTED`三种精确字段集；canonical JSON递归排序、严格UTF-8与单LF规则，以及payload checksum、`events_hash`、`batch_hash`均由冻结golden向量和tamper负向测试验证。
- batch在PREPARE前强制1..1,000个EVENT及canonical EVENT总量不超过8 MiB；segment使用固定12位编号、10,485,760 bytes prospective边界与10,000 confirmed batch边界，完整PREPARED+EVENT一次追加并fsync后才形成PONR，COMMITTED另行追加且计入最终size/hash。
- active segment只可按已验证的byte size、descriptor identity与file hash打开；任何partial append、fsync或seal I/O失败都会poison该handle，禁止在不确定尾部上原地重试。实现后审查进一步将file hash读取固定到已打开descriptor，而不是重新按path读取。
- `segment_index.json`固定`segment-index-v1` schema，保存legacy anchor、active/sealed边界、previous/first/last batch hash、first/last events hash、file hash、size及confirmed/pending状态；缺失或精确byte-prefix落后可重建，metadata、sealed growth、hash、sequence或identity冲突均fail closed。首次发布使用hard-link no-clobber，更新使用同目录临时文件、预期identity/hash与file/directory durability barrier。
- file capability KAT实测exclusive create、same-file identity、file fsync、directory fsync、hard-link no-clobber和atomic replace；symlink、hardlink alias、路径穿越、目标占用和identity替换均拒绝，不做静默降级。
- legacy reader严格识别v1/F7-v2、checksum、event identity/aggregate sequence与事实修正三事件组；合法LF和完整EOF bytes零改写。只有可证明的末尾不完整JSON可修复，且先按原始bytes独占归档并完成barrier，再对同一identity/hash的源文件定点truncate；非末尾损坏、孤立F7成员、非法UTF-8及source race均拒绝。
- M5B-3 source delta冻结为18个新增写入callsite：17个归属唯一file capability内部，1个归属legacy定点truncate；direct总量236、files 31，target digest为`307d39d891ac35075462998b98ab00c59381d244072fcff5f10a705a5841e29f`。同步文件API扫描器补齐`openSync`、`writeSync`、`ftruncateSync`、`rmdirSync`，不存在未登记sink。
- production `schema.sql`、startup、默认DB/path、legacy writer及IPC/shared/preload/renderer合同仍未接入这些模块；正式迁移和事实日志切换继续保留到M5B-14。

### 4.2 真实变更

- storage primitives：新增`src/main/domain/event-batch/`下canonical、record/hash、file capability、segment store/index、legacy reader/anchor共8个模块及6个定向测试文件。
- evidence：新增golden fixture与M5B-3 source-delta fixture/生成器；隔离DB verifier扩展`storage`阶段，真实创建两段segment并原子发布/reconcile index，同时证明合法legacy hash不变。
- gate：M5B runtime inventory和scope allowlist只扩展到M5B-3；共享source scanner增加4类同步文件sink。M5B-4及以后仍fail closed。
- 未修改：production composition、正式Schema版本、migration注册、`action_log.jsonl`写入路径与任何默认用户数据。

### 4.3 已执行命令

| 命令 | 状态 | 证据 |
|---|---|---|
| `npm test -- src/main/domain/event-batch/__tests__/canonical-json.test.ts src/main/domain/event-batch/__tests__/batch-hash.test.ts src/main/domain/event-batch/__tests__/segment-store.test.ts src/main/domain/event-batch/__tests__/segment-index.test.ts src/main/domain/event-batch/__tests__/legacy-reader.test.ts src/main/domain/event-batch/__tests__/file-capability.test.ts` | PASS | 6 files / 47 tests；覆盖golden、8 MiB/1,000上限、rotation临界、partial/fsync/identity fault、index rebuild/conflict、legacy LF/EOF/F7/tail/race及文件能力KAT。 |
| `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs scripts/__tests__/m5b-isolated-db.test.mjs` | PASS | 3 files / 27 tests；冻结向量/增量不可静默重写，scope后续步骤fail closed，隔离schema/storage验证均通过。 |
| `npm run db:m5b:isolated:verify -- --stage storage` | PASS | T11–T14=4、named indexes=3、capability=SUPPORTED、segments=2、index=CURRENT、legal legacy preserved；唯一`/tmp/svets-m5b-*`根在PASS后删除。 |
| `npm run contract:m5b:event-batch:check -- --mode migration --step M5B-3` | PASS | 75 channels（29 READ/46 MUTATION）、36/10 command分类；pending仍为46/1/43/8；76 exceptions与source digest精确匹配。 |
| `npm run contract:m5b:scope:check -- --step M5B-3` | PASS | HEAD/branch/index无漂移；preserved=770、M5B changes=47、violations=0。 |
| `npm run typecheck` | PASS | `vue-tsc --noEmit`与Node TypeScript检查退出码0。 |
| `npm run lint` | PASS | 退出码0；0 errors、661个既有Vue格式warnings，未声称零warning。 |

### 4.4 未执行项

| 检查 | 状态 | 说明 |
|---|---|---|
| Electron native ABI storage/cutover | NOT_RUN | 计划到M5B-15才执行完整Electron native验证；本步只使用Node文件系统、sql.js迁移核与系统SQLite核对显式临时数据。 |
| production startup migration、legacy seal与v2.2 append | NOT_RUN | 按M5B-14唯一切换原则保持未接线，不能把隔离storage PASS冒充production cutover PASS。 |

### 4.5 首次失败与实现后审查关闭记录

- 初始编译发现legacy test未使用变量，segment-index测试的错误文案断言过窄，lint发现未使用type import；均修正后重跑，没有放宽production validator。
- source inventory历史测试最初误扫当前checkout，生成器测试依赖stdout细节；改为冻结M5A/M5B-2历史fixture与hash不变断言，保留exact delta检查。
- 实现后审查补齐：segment I/O失败handle poisoning、legacy截断前稳定identity/hash复核、末尾不完整多字节UTF-8只允许发生在JSON string内、跨平台protocol path、index首尾`events_hash`、active segment精确file hash，以及同步文件API扫描盲区。
- 补扫描器后scope gate首次按设计以`BASELINE_DRIFT`拒绝共享scanner文件；随后仅将该单一路径加入M5B-3 allowlist并增加回归断言。回归测试第一次因漏import helper失败，补齐import后scope tests与真实门禁均PASS。

### 4.6 副作用与回滚核对

- 所有可写验证只作用于helper创建并校验的唯一`/tmp/svets-m5b-*`根；成功仅删除该精确owned root，能力探测失败保留命名证据，不使用通配清理。
- 未新增依赖、未生成`package-lock.json`、未访问默认数据库、未注册production migration或event runtime。
- 本步仍在production PONR前；删除未接线storage模块、tests、fixtures及M5B-3 gate扩展即可回到M5B-2，不存在production数据回滚。

## 5. Step M5B-4 — durable command identity、lease fencing 与 envelope v2

### 5.1 结论

状态：`PASS`

完成事实：

- internal `TransportMetadataV1`只接受精确的`schemaVersion/clientInstanceId/idempotencyKey/deviceId`字段集；两个UUID字段强制UUID v4，metadata未进入renderer `IpcApi`。业务payload在结构校验前拒绝transport、command、batch、lease、actor/session等可信字段覆盖。
- durable pipeline固定为transport/structure → read-only actor policy → secret-safe request hash → existing-key lookup → 仅新命令/需接管命令解析target → command注册与原子lease。`SUCCEEDED`重放直接返回持久化result，不重新解析已变化的target，也不增加attempt或创建第二个command/batch。
- request hash使用canonical JSON和最终SHA-256；三条含password命令按registry声明，以`protocol label + command_type + normalized non-secret identity`稳定domain salt执行PBKDF2-SHA512 100,000次/64 bytes替换秘密。冻结KAT为`9e00e8da5f43d8c101c737da869afc1867d5608429c781ddabaf8b15ec991488`；不同command、identity或password均domain-separated，相同业务输入跨key保持同hash。
- 46个MUTATION registry row均显式登记request/result/retry合同；只有`auth:createTeacherAccount`、`auth:login`、`student:create`声明password和username salt identity。raw password、普通SHA-256 password hash及normalized username均未进入`command_log`；result递归拒绝password/token/credential/secret复合字段名。
- `DurableCommandStore`在短`BEGIN IMMEDIATE`内执行唯一key的`INSERT OR IGNORE + SELECT`，预留稳定command/batch UUID；lease使用单条`UPDATE`及affected-row核对，固定30秒、10秒续约合同、generation单调递增和最多3次pre-PONR attempt。未过期lease拒绝并发，过期lease原子接管；旧generation在assert、renew、result和pre-PONR failure四个写/门禁入口均被fence。
- 同一key会严格比较`command_type/request_hash/actor_id/device_id/auth_session_id`；任一漂移稳定冲突且不解析target。新key即使payload相同也创建新的command/batch identity。
- `CommandEnvelopeV2`的command、batch、client/key、actor/device/session和lease generation全部取自durable row；root `correlationId`固定等于持久command ID。不存在preflight临时ID冒充accepted identity。
- result固定为canonical `{schema_version,public_result}`；解析结果做canonical clone与递归冻结。包括`success:false`在内的确定性public result均写为不可变`SUCCEEDED`；`FAILED`入口只接受显式`PRE_PONR_NO_PREPARE`系统失败并保留同一command/batch。
- M5B-4 source delta精确冻结为`durable-command-store.ts`内3个`DB_RUN` callsite，direct总量239、files 32、capability callsites 72、roots 13，target digest为`dfc966e46f28603e1fa9de15feabd3fe36b088b0e586b6fe43e47b576d899e37`。所有3项逐项归类为`EVENT_BATCH_COMMAND_STORE_INTERNAL`。
- 本步只由显式unit/isolated composition装配；production preload、IPC handler、runtime composition、Schema registration、legacy writer和默认数据路径均未接入。

### 5.2 真实变更

- durable contract：新增`src/shared/types/command-transport.ts`及`src/main/application/command/`下request hash、result、store与coordinator四个模块。
- compatibility fields：扩展`command-types.ts`、`command-registry.ts`、`command-envelope.ts`和`m5a-command-definitions.ts`，保留M5A production command bus行为；既有registry/bus测试补齐durable metadata。
- tests：新增request-hash、durable-store、durable-coordinator、envelope-v2四个定向测试文件。
- evidence/gates：isolated verifier增加`command`阶段；新增M5B-4 source-delta fixture/生成器，runtime inventory与scope allowlist只开放到M5B-4，M5B-5仍fail closed。
- 未修改：production preload/renderer API、IPC业务签名、handler/service、正式Schema版本和migration/startup注册。

### 5.3 已执行命令

| 命令 | 状态 | 证据 |
|---|---|---|
| `npm test -- src/main/application/command/__tests__/request-hash.test.ts src/main/application/command/__tests__/durable-command-store.test.ts src/main/application/command/__tests__/durable-command-coordinator.test.ts src/main/application/command/__tests__/envelope-v2.test.ts` | PASS | 4 files / 22 tests；覆盖PBKDF2 KAT、same/new-key矩阵、actor/session/device/command冲突、target不重求值、lease renew/takeover/fencing、3 attempts、canonical result和secret拒绝。 |
| `npm run db:m5b:isolated:verify -- --stage command` | PASS | 显式`/tmp/svets-m5b-*`库中完成M4→0.1.18隔离迁移、两段storage、generation 2 / attempts 2的retry接管、`SUCCEEDED`result及导出重开；`command_secret_absent=true`、`command_persisted=true`，PASS后删除owned root。 |
| `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs scripts/__tests__/m5b-isolated-db.test.mjs` | PASS | 3 files / 30 tests；M5B-4 exact source delta、历史fixture不可回写、scope后续步骤fail closed及隔离command persistence通过。 |
| `npm test -- src/main/application/command/__tests__/command-registry.test.ts src/main/application/command/__tests__/command-bus.test.ts src/main/application/command/__tests__/command-envelope.test.ts` | PASS | 3 files / 22 tests；M5A兼容registry、bus与legacy envelope回归通过。 |
| `npm run contract:m5b:event-batch:check -- --mode migration --step M5B-4` | PASS | 75/29/46、36/10分类不变；pending仍为46/1/43/8，source digest精确匹配M5B-4 fixture。 |
| `npm run contract:m5b:scope:check -- --step M5B-4` | PASS | HEAD/branch/index无漂移；preserved=764、累计M5B changes=64、violations=0。 |
| `npm run typecheck` | PASS | `vue-tsc --noEmit`与Node TypeScript检查退出码0。 |
| `npm run lint` | PASS | 退出码0；0 errors、661个既有Vue格式warnings，未声称零warning。 |
| `git diff --check` | PASS | 无whitespace error。 |
| `npm run docs:index:check` | PASS | 文档索引current。 |

### 5.4 未执行项

| 检查 | 状态 | 说明 |
|---|---|---|
| production preload/IPC durable metadata | NOT_RUN | 计划明确在M5B-14统一切换；本步不得改变renderer参数或提前开放renderer自选key。 |
| native Electron command composition | NOT_RUN | 完整production/native ABI接线属于M5B-14/15；本步用显式Memory/sql.js临时库证明协议，不冒充production runtime PASS。 |
| planner、file sink与PONR后恢复 | NOT_RUN | M5B-5才提供通用batch coordinator；本步的失败路径通过execute spy=0和未接线import graph证明没有提前调用planner/file sink。 |

### 5.5 首次失败与实现后审查关闭记录

- 首轮核心测试有2个suite因Vite test runtime不能解析新增value import的`@shared`别名而失败，另有1个unused type import；改为仓库内静态相对import并移除unused import后通过，未改变业务合同。
- store最初以`UPDATE ... RETURNING`经`.get()`执行原子写，已有source scanner只把它识别为read。实现后审查将其改为同一`BEGIN IMMEDIATE`内单条`UPDATE.run()`、`SELECT changes()`和row reload，既保持单SQL lease原子性，又让3个写callsite被清单门禁显式捕获。
- runtime inventory扩展后，两个M5B-3历史测试错误地以M5B-4当前checkout验证旧digest。修复为从冻结M5B-2/3 delta重建历史scan，并明确断言进入后续步骤后旧生成器失败关闭且不改fixture hash；M5B-4 current digest仍做exact验证。
- 结果协议自审发现初版只浅冻结public result且只拒绝少量精确敏感键；改为canonical clone、递归冻结，并拒绝`accessToken`、`passwordHash`等复合敏感名，新增回归测试后22/22通过。
- scope gate在M5B-4 allowlist开放前按设计报告17个新/改路径越界；逐项核对后只加入本步17个路径，最终64个累计M5B变化、0 violation，M5B-5继续拒绝。

### 5.6 副作用与回滚核对

- 隔离验证只写helper创建并校验的唯一`/tmp/svets-m5b-*`根；未打开、读取、hash或修改默认运行数据库、默认userData或默认action-log。
- 未新增依赖、未生成`package-lock.json`、未注册production migration、未把transport metadata加入renderer业务API，也未启动lease timer或后台worker。
- 本步仍未进入production PONR；删除未接线durable模块/tests/fixture并恢复兼容registry字段和M5B-4 gate扩展即可回到M5B-3，不存在production数据回滚。

## 6. Step M5B-5 — 通用 batch coordinator、prepared-only registry 与四阶段恢复

### 6.1 结论

状态：`PASS`

完成事实：

- coordinator固定执行PREPARE → APPLY → COMMITTED → SQLite CONFIRM → index → result；完整PREPARE+EVENT fsync后立即清除planner plan，后续恢复只使用durable prepared facts，planner调用数固定为0且不替换预留batch。
- process-wide FIFO mutex负责当前进程公平串行；跨worker generation fencing由SQLite `BEGIN IMMEDIATE`保护。首次`create/open`、阈值`seal/create`、PREPARE/COMMITTED append及index发布均在文件变更前复核exact owner、generation与expiry；恢复追加COMMITTED采用相同边界，失租稳定返回`RECOVERY_BUSY`。
- APPLY在单个IMMEDIATE transaction内写入`applied_event_batch`、`processed_event`、`domain_event_projection`、projector/effect与cursor；任一event故障整体回滚。projection source保存canonical相对segment path及EVENT行号/byte offset，并对batch、processed event与领域投影逐字段复核。
- event/result/effect registry只接受登记的payload/result/effect version，并只从prepared EVENT与durable command row重建；prepared public result递归冻结，plan-only effect参数在PREPARE前拒绝。
- startup recovery覆盖PREPARE、APPLY、COMMITTED、CONFIRM、index、cursor与result窗口；活动段只修复物理不完整尾部并按损坏snapshot确定性归档。`CONFIRMED && !COMMITTED`、完整malformed/duplicate COMMITTED、projection/effect/result漂移与未知version均fail closed进入`CORRUPTION_READ_ONLY`。
- mixed replay要求显式infrastructure fixture，先保持legacy原始bytes不变并运行legacy reducer，再按verified global sequence应用v2 batch；没有宣称能从JSONL恢复完整command history。
- differential harness校验M5B-1 legacy oracle hash，在两个独立`/tmp`子根顺序运行legacy/v2，normalizer只允许显式数值数组路径和同类型scalar替换；三组冻结场景比较业务projection、result与event语义。
- fault matrix覆盖13个coordinator fault point与10个recovery restart窗口，并逐项验证故障前状态、唯一允许恢复计数、attempt/planner count和最终唯一batch/result；另覆盖synthetic no-op无batch/DML/file写入。
- M5B-5 source delta精确为10个direct callsite与1个legacy capability callsite；current scanner为74 channels、249 direct callsites、36 direct files、73 capability callsites、13 roots，target digest为`c5f20f90046e097ce7323eb92091d6e8900bb0099acbfa1cca9fac8a090a5853`。迁移清单仍有46 command、1 health、43 legacy与8 report pending，没有提前减少M5B-6以后项目。
- production import graph未引用coordinator/recovery，正式Schema/migration/startup、真实service与IPC合同均未接线；production cutover仍保留到M5B-14。

### 6.2 真实变更

- runtime：新增`writer-mutex.ts`、`command-plan.ts`、`batch-coordinator.ts`、`projection-source.ts`、`result-registry.ts`、`startup-recovery.ts`、`mixed-domain-replay.ts`、`runtime-corruption.ts`与test-only fault injector。
- durable command store：增加processing枚举、prepared lease接管与已验证无PREPARE的过期命令恢复；post-PONR接管不增加business attempt。
- tests：新增coordinator、startup recovery、mixed replay、projection source、fencing、fault matrix、tamper recovery及differential harness测试与共享synthetic support。
- evidence/gates：新增crash matrix、M5B-5 source-delta fixture与生成器；runtime inventory、scope和isolated verifier扩展到coordinator阶段，M5B-6仍fail closed。
- 未修改：production composition、正式Schema注册、legacy writer、renderer/preload API与任何默认数据路径。

### 6.3 已执行命令

| 命令 | 状态 | 证据 |
|---|---|---|
| 计划列出的7个M5B-5核心测试文件 | PASS | 最终7 files / 47 tests；包含新增的首次建段、阈值轮换、recovery COMMITTED失租与`CONFIRMED && !COMMITTED`回归。 |
| `npm test -- src/main/domain/event-batch/__tests__` | PASS | 14 files / 97 tests；storage、hash、legacy、index、coordinator、recovery与differential全部通过。 |
| `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs scripts/__tests__/m5b-isolated-db.test.mjs scripts/__tests__/m5b-isolated-paths.test.mjs` | PASS | 4 files / 39 tests；历史fixture不可回写、M5B-5 exact delta、路径隔离与coordinator persistence通过。 |
| `npm test -- src/main/domain/event-batch/__tests__/command-differential-harness.test.ts scripts/__tests__/m5b-contract-scope.test.mjs` | PASS | 2 files / 9 tests。 |
| `npm run db:m5b:isolated:verify -- --stage coordinator` | PASS | T11–T14=4、indexes=3、capability supported、segments=2、batches=2/events=3、recovery planner=0、attempts=1、relative source与重开持久性通过；owned临时根已删除。 |
| `npm run contract:m5b:event-batch:check -- --mode migration --step M5B-5` | PASS | target 75 channels（29 READ/46 MUTATION）、36/10分类；pending=46/1/43/8，source digest精确匹配。 |
| `npm run contract:m5b:scope:check -- --step M5B-5` | PASS | preserved=764、累计M5B changes=86、violations=0；HEAD/branch/index冻结。 |
| `npm run typecheck` | PASS | `vue-tsc --noEmit`与Node TypeScript检查退出码0。 |
| `npm run lint` | PASS | 退出码0；0 errors、661个既有Vue格式warnings，未声称零warning。 |
| `git diff --check` | PASS | 无whitespace error。 |
| `npm run docs:index:update && npm run docs:index:check` | PASS | 自动清单已更新，检查确认`doc/index.md` current。 |

### 6.4 独立审查与回退关闭

- 首轮独立审查结论为`BLOCKED`：P0指出恢复接受SQLite已CONFIRMED但日志无COMMITTED的冲突；P1指出旧generation可在异步planner返回后、复核lease前创建或轮换segment，recovery追加COMMITTED前也存在同类窗口。
- 修复后增加严格状态矩阵；将normal PREPARE/COMMITTED/index文件变更和recovery COMMITTED追加纳入SQLite写锁并在内部复核租约；tail repair与recovery index发布也使用全局writer transaction串行。
- 四个新增回归场景真实完成generation takeover或完整COMMITTED截断，分别证明首次创建、阈值轮换、recovery append无越权写，以及冲突状态不更新segment/index/cursor/command/result/projection。
- 独立复审最终结论：`PASS`；原P0/P1均关闭，开放P0/P1/P2均为无。Reviewer未重复执行全套命令；其只读源码与测试复审由本节其他自动化证据补足。

### 6.5 未执行项

| 检查 | 状态 | 说明 |
|---|---|---|
| production service/IPC接线与真实领域planner | NOT_RUN | 按计划属于M5B-6～M5B-14；本步必须保持未接线。 |
| native Electron真实多连接锁竞争与完整cutover | NOT_RUN | 属于M5B-15最终验收；当前isolated verifier不冒充production native PASS。 |
| 手工UI检查 | NOT_RUN | 本步无renderer行为且production未接线，不是M5B-5 required gate。 |

### 6.6 副作用与回滚核对

- 所有数据库和文件写验证仅作用于helper创建、规范化并验证的唯一`/tmp/svets-m5b-*`根；未打开、读取、hash或修改默认运行数据库、默认userData或默认action-log。
- 未新增依赖、未生成`package-lock.json`、未注册production migration、未改变启动行为。
- 回滚本步可删除未接线coordinator/recovery/registry/tests/fixtures及M5B-5 gate扩展并恢复durable store的recovery增量；不存在production数据回滚。

## 7. Step M5B-6 — 报告/任务关闭 planner 与 prepared projector

### 7.1 结论

分步验收结论：`AUTOMATION_PASS_MANUAL_PENDING`；自动化状态：`PASS`；完整独立 R3 复审：`BLOCKED`。

- 五个非 artifact 报告命令已具备 versioned planner、prepared payload、projector 与 result recipe：`reports:confirmTaskClosure`、`reports:replaceTaskClosure`、`reports:generate`、`reports:confirmPlacementReview`、`reports:lock`。
- `reports:generate` 在 PREPARE 冻结 builder 内容、lineage、source hash 与 content hash；同 generation 返回零事件完成结果，不占用预留 batch。报告源在 PREPARE 后发生分数漂移时，APPLY 仍投影冻结内容和 hash。
- 关闭替换事件在同一 batch 内将旧关闭记录 supersede、创建 revision 2，并将其 active report 归档；失败注入在 APPLY 前保持关闭和报告投影均不变。
- `planReportGenerationFragment` 仅返回 child event/result fragment，不携带 command store、coordinator 或 batch owner；五命令 golden 固定 plan/result version、事件类型、返回字段和 batch context 键。
- 新增五条冻结 legacy oracle 对照：在独立 `/tmp` 子根、同一时钟和确定性 ID 种子下，逐项比较公开结果、受影响的 `task_closure`/`task_report` 业务字段、事件类型和业务 payload。仅对新生成的 closure/report ID 使用显式逐字段 normalizer；已核验成功、替换、生成、确定性 placement review 拒绝和锁定路径。
- M5B-6 source delta 固定为 `task-closure-projector.ts` 的4个报告/关闭 projector 内部 DML callsite；migration inventory 已从 `46 / 1 / 43 / 8` 收敛到 `41 / 1 / 43 / 8`，production composition、Schema 版本和默认数据路径均未接线。

### 7.2 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| 5个报告/关闭相关测试文件 | PASS | `npm test -- src/main/application/planners/__tests__/report-planner.test.ts src/main/domain/projectors/__tests__/report-projector.test.ts src/main/domain/projectors/__tests__/report-differential.test.ts src/main/domain/__tests__/report-generation.test.ts src/main/domain/__tests__/task-closure-service.test.ts`：5 files / 28 tests。 |
| M5B source-delta 与范围门禁测试 | PASS | `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs`：2 files / 32 tests。 |
| M5B-6 migration inventory | PASS | `npm run contract:m5b:event-batch:check -- --mode migration --step M5B-6`：pending `41 / 1 / 43 / 8`，source digest `f1023fbd72501c97a65b68c973cef7385ddf21525e5ec7dc8c55de96375caf9d`。 |
| M5B-6 scope | PASS | `npm run contract:m5b:scope:check -- --step M5B-6`：preserved=761、M5B changes=101、violations=0。 |
| TypeScript | PASS | `npm run typecheck` 退出码0。 |
| lint | PASS | `npm run lint` 退出码0；0 errors，661条既有 Vue 格式 warnings，未将 warnings 写作零。 |
| whitespace | PASS | `git diff --check` 无输出。 |

### 7.3 审查与未执行项

- 2026-07-30 的非独立 R3 复核发现并关闭 `[P0-01]`：`EventBatchCoordinator.execute` 原先接收调用方在 writer mutex 之外取得的静态 snapshot；两个已受理的关闭命令可在竞争 mutex 前观察同一活动关闭记录，后进入 APPLY 的第二个命令会携带过期 supersede 集合。现改为强制传入 `readSnapshot`，并在持有 writer mutex、完成 lease fence 后才读取 planner facts。新增 coordinator mutex 时序回归与两个已受理关闭命令的并发回归，验证第二条命令会重读第一条命令完成后的状态并正确 supersede。
- 修复后重跑五个报告/关闭测试文件：`5 files / 28 tests`；重跑 coordinator/recovery/fencing/fault-matrix/tamper 集：`7 files / 48 tests`；M5B 当前 source/scope 门禁：`2 files / 32 tests`；typecheck、lint、isolated coordinator verifier、M5B-9 inventory/scope 与 `git diff --check` 均通过。详细命令和输出以本次会话验收记录为准。
- 修复后的非独立复核结论为 `CONDITIONAL_PASS`；当前会话未提供独立 reviewer，不能替代完整 R3 `PASS`。
- 差分测试复制成对临时 data root，并使用两份确定性内存业务库来比较语义；它不是物理 SQLite 成对库的替代。M5B isolated/native 验证保留为后续步骤和 M5B-15 的 required evidence。
- production composition、production migration、默认数据库/默认 userData、Electron 原生流程均未运行，符合 M5B-14 前不切换的范围。

### 7.4 2026-07-30 `vibe-accept step M5B-6`（非独立）

结论：`AUTOMATION_PASS_MANUAL_PENDING`。本结论只覆盖当前 test-only M5B-6 及其共享 coordinator 修复；不将未执行的独立 R3、Electron 原生运行时或生产接线写为通过。

| 检查 | 状态 | 证据 |
|---|---|---|
| 工作区与计划外副作用 | PASS | `git status --short` 显示的是既有 M4/M5A/M5B 连续实施现场；无冲突标记、锁文件或生成二进制。修复未触及 production composition、Schema、IPC/preload、默认数据库路径或 M5B-1 冻结 oracle。 |
| 报告/关闭功能回归 | PASS | `npm test -- src/main/application/planners/__tests__/report-planner.test.ts src/main/domain/projectors/__tests__/report-projector.test.ts src/main/domain/projectors/__tests__/report-differential.test.ts src/main/domain/__tests__/report-generation.test.ts src/main/domain/__tests__/task-closure-service.test.ts`：5 files / 28 tests。 |
| coordinator/recovery 回归 | PASS | `npm test -- src/main/domain/event-batch/__tests__/batch-coordinator.test.ts src/main/domain/event-batch/__tests__/startup-recovery.test.ts src/main/domain/event-batch/__tests__/mixed-domain-replay.test.ts src/main/domain/event-batch/__tests__/projection-source.test.ts src/main/domain/event-batch/__tests__/fencing.test.ts src/main/domain/event-batch/__tests__/fault-matrix.test.ts src/main/domain/event-batch/__tests__/tamper-recovery.test.ts`：7 files / 48 tests。 |
| 共享 projector 调用点回归 | PASS | `npm test -- src/main/domain/projectors/__tests__/training-projector.test.ts src/main/domain/projectors/__tests__/assessment-projector.test.ts`：2 files / 10 tests。 |
| 类型与 lint | PASS | `npm run typecheck` 退出码0；`npm run lint` 退出码0，0 errors、661 条既有 Vue 格式 warnings。 |
| 当前 M5B source/scope | PASS | `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs`：2 files / 32 tests；`npm run contract:m5b:event-batch:check -- --mode migration --step M5B-9` 和 `npm run contract:m5b:scope:check -- --step M5B-9` 均通过。 |
| isolated coordinator | PASS | `npm run db:m5b:isolated:verify -- --stage coordinator`：schema `0.1.18-event-batch-v2.2`、4个批次表/3个索引、2 batches/3 events、recovery planner calls=0；唯一 `/tmp/svets-m5b-*` 根在 PASS 后删除。 |
| 文档与空白检查 | PASS | `npm run docs:index:check` 通过；`git diff --check` 无输出。 |

| 适用不变量 | 状态 | 验证 |
|---|---|---|
| `INV-EVT-001` / `INV-EVT-002` / `INV-EVT-003` | PASS | coordinator 的 lock 内快照重读、prepared payload、故障矩阵、recovery 与 tamper 回归覆盖。 |
| `INV-RES-001` / `INV-RES-002` | PASS | report planner/projector golden、source drift 和关闭替换回归覆盖冻结结果与 replay 语义。 |
| `INV-DATA-001` / `INV-DATA-003` | PASS | 所有数据库验证使用显式 `/tmp` 根；M5B scope gate 确认未改 production schema/startup。 |
| `INV-IPC-001` | NOT_RUN | 本步按 M5B-14 前 test-only 边界，不允许生产 IPC/preload 接线。 |

未执行或阻塞项：独立 R3 reviewer 为 `BLOCKED`（当前环境不允许独立 reviewer agent）；Electron 原生多连接竞争、手工 UI 与 production cutover 为 `NOT_RUN`（分别属于 M5B-15 或 M5B-14 之后）。这些项阻止完整 `PASS`，并继续阻止 M5B-10、M5B-12、M5B-13。

### 7.5 继续条件

- M5B-7 仅以 M5B-5 `PASS` 为前置，可继续实施；M5B-10、M5B-12、M5B-13 仍需取得 M5B-6 独立复审结论后才可开始。
- M5B-6 不得标记为完整 `PASS`，直至独立 R3 review 通过；当前 evidence-based accept 仅证明自动化，仍为 `AUTOMATION_PASS_MANUAL_PENDING`。

## 8. Step M5B-7 — 十个 gate-only command 与可恢复 auth binding

### 8.1 结论

分步验收结论：`AUTOMATION_PASS_MANUAL_PENDING`；自动化验收：`PASS`；完整 R3 独立复审：`BLOCKED`。

- 十个 auth/student/strategy 命令由未接线的 `GateOnlyExecutor` 在同一个 `BEGIN IMMEDIATE` 中执行 lease fence、业务 DML 与 canonical `SUCCEEDED` result；测试验证事务异常时 DML 回滚、command 不产生 result，成功路径不创建 `applied_event_batch` 或 `processed_event`。
- legacy A/B 对照在两份独立的临时内存库中实际执行全部十条命令，只对生成的账户、学生、会话 ID 与时间戳作显式 normalizer；公开结果、业务投影、会话撤销统计和审计计数一致。
- 登录持久结果不含 password 或 token；提交后仅以 `auth_session_id` 绑定 sender，重放可在绑定丢失后恢复。禁用账号的确定性登录拒绝可持久重放；已撤销绑定无法再受理受保护命令。
- logout 仅允许同一 completed `auth:logout` 行走自撤销重放例外；相同 idempotency key 不能由 `auth:login` 复用。该例外不返回敏感数据，且不跳过其他 command 的 actor 校验。
- source delta 冻结为 student DML 移入外层 gate transaction 的 6 项移除和 6 项新增；M5B migration inventory 现为 36 条 batch-domain、10 条 gate-only，pending 为 `31 / 1 / 43 / 8`。production composition、正式 schema/startup、默认数据库与 legacy writer 均未接线。

### 8.2 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| M5B-7 精确回归集 | PASS | `npm test -- src/main/application/command/__tests__/gate-only-executor.test.ts src/main/application/services/__tests__/account-command-bus.test.ts src/main/ipc/handlers/__tests__/auth.test.ts src/main/ipc/handlers/__tests__/student-create.test.ts src/main/ipc/handlers/__tests__/student-mutate.test.ts src/main/ipc/handlers/__tests__/strategy-create-version.test.ts src/main/ipc/handlers/__tests__/strategy-update.test.ts src/main/ipc/handlers/__tests__/strategy-set-active.test.ts`：8 files / 128 tests。 |
| durable completion/hash 交叉回归 | PASS | `npm test -- src/main/application/command/__tests__/durable-command-coordinator.test.ts src/main/application/command/__tests__/durable-command-store.test.ts src/main/application/command/__tests__/request-hash.test.ts`：3 files / 16 tests。 |
| M5B source/scope/isolated tests | PASS | `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs scripts/__tests__/m5b-isolated-db.test.mjs`：3 files / 37 tests；M5B-7 source delta 冻结、后续 fail-closed 和 gate transaction 均通过。 |
| isolated gate-only | PASS | `npm run db:m5b:isolated:verify -- --stage gate-only`：`gate_status=SUCCEEDED`、`replayed=true`、`batches=0`；唯一 `/tmp/svets-m5b-*` 根在 PASS 后删除。 |
| M5B-7 migration inventory | PASS | `npm run contract:m5b:event-batch:check -- --mode migration --step M5B-7`：75 channels、36 BATCH_DOMAIN/10 GATE_ONLY、source digest `1b29f1facae737e0b6263601ce5fbc3ccb535155fba11f6fea5613fb7f78fc03`。 |
| M5B-7 scope | PASS | `npm run contract:m5b:scope:check -- --step M5B-7`：preserved=757、M5B changes=111、violations=0。 |
| TypeScript | PASS | `npm run typecheck` 退出码0。 |
| lint | PASS | `npm run lint` 退出码0；0 errors，661条既有 Vue 格式 warnings。 |
| whitespace | PASS | `git diff --check` 无输出。 |

### 8.3 非独立自审与未执行项

- 非独立自审结论：`CONDITIONAL_PASS`。已重读 gate executor/apply、durable completion、session binding、source gate、isolated verifier和实际测试；未发现未关闭 P0/P1。审查中发现 logout 特例应显式限制持久行 `commandType`，已补为 `auth:logout` 并用跨命令同 key 冲突回归覆盖。当前会话没有独立 reviewer，因此不得把 R3 审查写为完全 `PASS`。
- Electron native 运行时与真实多连接竞争：`NOT_RUN`。当前步骤按 M5B-14 前不接线原则仅运行 Memory/sql.js/系统 SQLite 的显式临时根验证；M5B-15 才执行完整原生 Electron 验证。
- 手工 UI：`NOT_RUN`。没有 renderer 或 production IPC 接线，不能将未接线 test composition 冒充用户可操作流程。

### 8.4 副作用与回滚核对

- 跨文件登记已核对：十条 registry row 由共同 executor 测试覆盖；DML/result 由 outer IMMEDIATE 与 rollback/isolated 测试覆盖；登录 hash 与 secret-free result 由 request-hash/command-log 断言覆盖；logout 自撤销、disabled/revoked 和 binding replay 均有定向负测。
- `GateOnlyExecutor` 仅被 tests 和 isolated verifier 引用，未出现在 production runtime、IPC/preload 或 renderer import graph；本步没有新增依赖、没有改动默认数据库、没有注册 production migration。
- 仍处于 production PONR 前；可删除未接线 gate executor/apply、M5B-7 transaction helper/tests/fixture及相应 gate allowlist回到 M5B-6，当前没有 production 数据需要回滚。

## 9. Step M5B-8 — training planner 与 prepared projector

### 9.1 结论

自动化验收：`PASS`；完整 R3 分步验收：`BLOCKED`。

- 六个训练命令已具备 test-only 的 versioned planner、prepared payload、projector 与 result recipe：`training:createSession`、`training:startStep`、`training:completeStep`、`training:skipStep`、`training:failStep`、`training:retryStep`。共享类型同时保留 legacy training payload，并新增 v2 batch metadata/payload union。
- 创建事件冻结训练会话、业务会话和四个确定性 step ID；步骤事件冻结 owner、step/session before/after、attempt、三元键、策略版本、完成统计与策略等级。投影器只消费已验证的 EVENT，并对逐事件 FSM、同批完成 fragment、before-state 和精确字段集 fail closed。
- 旧服务在所有 step 均不再 `NOT_STARTED` 时完成会话，触发命令可以是 complete、skip 或 fail。新 planner 保持该行为：任一终态步骤成为最后未处理步骤时，都在同一个 root plan 追加 `TRAINING_COMPLETED`，不会生成第二个 transaction 或 batch。
- A/B 对照在两份同构的显式测试库中逐步执行完整路径，覆盖六个已登记的 `M5B-DIFF-TRAINING-*` ID。每步比较公开语义、训练会话/步骤/result 业务快照及事件类型序列，仅忽略实现派生 ID 和时间。
- 末步双 EVENT 在第二个 `APPLY_EVENT` 前故障时，第一步 EVENT 的业务投影、结果和 `applied_event_batch` 插入都随事务回滚；只保留此前五个已确认 root batch。M5B-8 source delta 冻结为 training projector 内部的9个 DML callsite，migration pending 收敛到 `25 / 1 / 43 / 8`。

### 9.2 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| M5B-8 精确回归集 | PASS | `npm test -- src/main/application/planners/__tests__/training-planner.test.ts src/main/domain/projectors/__tests__/training-projector.test.ts src/main/application/services/__tests__/training-command-bus.test.ts src/main/ipc/handlers/__tests__/training-create.test.ts src/main/ipc/handlers/__tests__/training-steps.test.ts src/main/ipc/handlers/__tests__/training-complete.test.ts src/main/ipc/handlers/__tests__/training-redline.test.ts`：7 files / 57 tests。 |
| M5B source/scope 测试 | PASS | `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs`：2 files / 30 tests；M5B-8 delta 精确验证、M5B-7 历史视图与后续 fail-closed 均通过。 |
| M5B-8 migration inventory | PASS | `npm run contract:m5b:event-batch:check -- --mode migration --step M5B-8`：75 channels、36 BATCH_DOMAIN/10 GATE_ONLY、pending `25 / 1 / 43 / 8`、source digest `6d9e30b2adbb67e176a03e1ca23c33dbf72a743b8fe5b6bb8b4f6fa02e62f2ba`。 |
| M5B-8 scope | PASS | `npm run contract:m5b:scope:check -- --step M5B-8`：preserved=757、M5B changes=118、violations=0。 |
| TypeScript | PASS | `npm run typecheck` 退出码0。 |
| lint | PASS | `npm run lint` 退出码0；0 errors、661条既有 Vue 格式 warnings。 |
| whitespace | PASS | `git diff --check` 无输出。 |

### 9.3 审查与未执行项

- 非独立自审发现并关闭两项实现风险：步骤 EVENT 类型与状态迁移曾未绑定，现已按五种 EVENT 分别校验；terminal step 的 `session_completed` 与同批 `TRAINING_COMPLETED` 曾未交叉核对，现要求严格相邻且方向一致。当前会话没有独立 reviewer，故完整 R3 review/accept 仍为 `BLOCKED`。
- Electron native、多连接竞争和手工 UI：`NOT_RUN`。本步骤不接 production composition、IPC 或正式 schema/startup；Memory/sql.js 测试和 helper 自有的临时 data root 不能冒充真实 Electron 验证。

### 9.4 副作用与回滚核对

- 跨文件登记已核对：6条 command 的 plan/result、last-step completion 顺序、strategy/step snapshot、三元 safety block、legacy payload compatibility 与 A/B evidence 均有自动测试；legacy training service/reducer 未修改。
- `TrainingPlanner`、`registerTrainingPreparedFacts` 和 test harness 只由测试引用，production runtime、IPC/preload、renderer、正式 schema/migration 与默认数据库均未引用或修改；未新增依赖、未生成 `package-lock.json`。
- 仍处于 production PONR 前；回滚仅需删除未接线 training planner/projector、测试、M5B-8 fixture/allowlist 及共享 v2 类型扩展，不存在生产数据回滚。

## 10. Step M5B-9 — assessment planner 与 prepared projector

### 10.1 结论

自动化验收：`PASS`；独立 R3 code review：`PASS`；evidence-based accept：`AUTOMATION_PASS_MANUAL_PENDING`。

- 十条非 redline 测评命令已具备 test-only versioned planner、prepared payload、projector 与 result recipe：`assessment:createSession`、`assessment:submitAnswer`、`assessment:emotionInterrupt`、`assessment:emotionResume`、`assessment:pauseSitting`、`assessment:startNextSitting`、`assessment:recordEmotionCollapse`、`assessment:abortSession`、`assessment:calculateResult`、`assessment:startSession`。`assessment:triggerRedline`未在本步接线，保留给 M5B-12。
- planner 在 PREPARE 冻结会话三元键、策略版本、题目列表和返回题目快照、答题结果、当前坐次、情绪崩溃阈值/历史、终止原因、结算分数及结果载荷。坐次崩溃达到阈值时固定同批`SITTING_ENDED → EMOTION_COLLAPSE_RECORDED → EMOTION_COLLAPSE_THRESHOLD_REACHED → SESSION_COMPLETED`；普通结算固定`RESULT_CALCULATED → SESSION_COMPLETED`。
- projector 只接受 v2 metadata 完整的登记 EVENT，复用冻结的`applyAssessmentEvent`在 batch APPLY transaction 内投影，从而保持已有业务会话、题目快照、答题、坐次、结果和 schema trigger 语义；`assertProjected`逐类核验会话、答题、坐次和结果记录。
- `SESSION_STARTED`的 prepared payload 额外冻结完整 session-question 投影事实。恢复测试在 PREPARE fsync 后禁用题库题目，验证 projector 从 EVENT 的事实表重建题目快照、`plannerCalls=0`，不以实时`question_bank`重新决定历史投影。
- `startSession`覆盖首次坐次加首题激活、已有坐次零事件重放，以及旧会话缺失坐次投影时的单`SITTING_STARTED`补偿。补偿 batch 显式冻结当前题指针，result recipe 不再猜测存在首题事件。
- legacy→v2 A/B 在两份独立内存库逐步执行全部十条登记命令。比较公开响应（显式忽略实现生成 ID）、会话/结果语义和`ASSESSMENT_SESSION`事件类型顺序；基础流程与安全熔断后的`LEVEL_FAIL_BY_SAFETY`结算均一致。
- M5B-9 source delta 固定为零新增 direct/capability mutation callsite：新 planner 只读冻结事实，prepared projector 委托冻结 reducer；scope gate 单独冻结 M5B-9 test-only 文件，防止生产 composition、IPC、schema 或默认数据路径漂移。

### 10.2 已执行检查

| 检查 | 状态 | 证据 |
|---|---|---|
| M5B-9 精确回归集 | PASS | `npm test -- src/main/application/planners/__tests__/assessment-planner.test.ts src/main/domain/projectors/__tests__/assessment-projector.test.ts src/main/application/services/__tests__/assessment-command-bus.test.ts src/main/ipc/handlers/__tests__/assessment-create.test.ts src/main/ipc/handlers/__tests__/assessment-answer.test.ts src/main/ipc/handlers/__tests__/assessment-emotion.test.ts src/main/ipc/handlers/__tests__/assessment-start-session.test.ts`：7 files / 95 tests。 |
| M5B source/scope 测试 | PASS | `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs`：2 files / 33 tests。 |
| M5B-9 migration inventory | PASS | `npm run contract:m5b:event-batch:check -- --mode migration --step M5B-9`：75 channels、36 BATCH_DOMAIN/10 GATE_ONLY、pending `15 / 1 / 43 / 8`、source digest `6d9e30b2adbb67e176a03e1ca23c33dbf72a743b8fe5b6bb8b4f6fa02e62f2ba`。 |
| M5B-9 scope | PASS | `npm run contract:m5b:scope:check -- --step M5B-9`：preserved=757、M5B changes=127、violations=0；仅允许 M5B-6/M5B-9 精确 R3 审查记录，任意其他新增路径仍 fail closed。 |
| TypeScript | PASS | `npm run typecheck` 退出码0。 |
| lint | PASS | `npm run lint`退出码0；0 errors、661条既有 Vue 格式 warnings。 |
| whitespace | PASS | `git diff --check` 无输出。 |

### 10.3 审查与未执行项

- 独立 R3 复审：`PASS`。修复前审查的 P0/P1 均已由新的上下文按 payload、planner、projector、隔离恢复、默认 worker 静态回归和范围门禁重新核验；详见`event-batch-v2.2-runtime-m5b9-r3-review.md`的“Repair R3 Re-review”。
- Native Electron、真实多连接竞争、production IPC/composition、正式 schema/startup 与默认数据库：`NOT_RUN`。本步明确保持 M5B-14 前未接线边界，Memory/sql.js 与受控`/tmp`验证不能替代这些检查。

### 10.4 副作用与回滚核对

- 跨文件登记已核对：十条 command 的 plan/result、隐式子事件顺序、题目/答案/结果冻结、旧会话坐次兼容和 A/B 语义均有自动测试；`assessment-service.ts`、`assessment-reducer.ts`、IPC/preload 和 schema 未修改。
- 新 planner/projector/test harness 仅被测试期组合引用；未新增依赖、未生成`package-lock.json`、未读写默认数据库、未注册 production migration。
- 仍处 production PONR 前；回滚仅需删除未接线 assessment planner/projector、测试、M5B-9 fixture/allowlist 和共享 v2 类型增量，不存在 production 数据回滚。

### 10.5 完整测试历史视图修正

- `npm test` 首次在 M5A command-boundary 的4个 target 断言失败：测试误把已经进入 M5B-9 的 checkout 当作 M5A 最终 checkout，和本记录第3.4节已登记的“后续 M5B 工作区中 M5A target CLI 预期失败”相矛盾。
- 修复将这4个断言改为由冻结的 `m5a-command-boundary-active-v1.json` 重建 M5A target scan，并保留当前 checkout 默认 target CLI 的预期失败断言；同时显式验证固定 Git tree 的 baseline CLI 通过。未放宽 M5A target 边界、active manifest 或 M5B source/scope gate。
- 同次完整测试还发现 M4 safety-SQL 清单仍停在52条，遗漏 M5B-8/9 planner 中5条可执行 `src/main` SQL。它们虽在 M5B-14 前只由测试 composition 调用，但不属于测试或 migration 文件，按扫描合同必须逐条登记；现已分类为4条三元 `AGGREGATE_MATCH_REKEY` 与1条 known-ID `NON_SAFETY_QUERY`，并将 target 总数固定为57条。
- M5B-9 scope gate 对这两项 M4/M5A 修复及其测试的3条精确路径登记为 checkpoint predecessor gate repair；范围测试仍证明任意其他 M4 路径为 `UNEXPECTED_NEW_PATH`，不引入目录级豁免。
