# /vibe-accept — 可执行验收门禁

## 目标

根据真实命令、测试、diff 和人工操作证据，判断当前步骤或合并候选是否达到要求。

本命令负责执行与记录，不负责默认提交、推送、合并或发布。

## 模式

```text
/vibe-accept step <step-id-or-scope>
/vibe-accept merge [base...head]
```

- `step`：验证当前原子实施步骤和相关回归；
- `merge`：运行全量合并前门禁。

## Step 0：加载验收基线

读取：

1. `doc/ai/vibe-workflow-contract.md`；
2. 适用的 `AGENTS.md` / rules；
3. `doc/specs/baseline.yaml`；
4. 对应 PRD 和 impl 文档；
5. 本次适用不变量；
6. 当前真实 diff 和工作区状态。

验证命令优先级：

1. `baseline.yaml` 中声明的命令；
2. CI workflow；
3. `package.json` / workspace scripts；
4. 项目文档。

不得猜测不存在的命令。命令不存在时标记 `BLOCKED` 或 `NOT_RUN`，不得假装通过。

## Step 1：预检工作区

至少执行：

```bash
git status --short
git diff --stat
git diff --check
```

并核验：

- 计划内修改文件；
- 计划外修改文件；
- 未跟踪文件；
- 锁文件或依赖变化；
- 大型二进制或生成文件；
- 是否混入无关重构；
- 是否存在未解决冲突。

子 Agent 的总结不能替代此步骤。

## Step 2：确定风险和检查范围

从 PRD/impl 读取风险等级；若实际 diff 扩大影响域，提升风险等级并记录原因。

### step 模式

运行：

- 当前步骤指定的精确验证命令；
- 相关 typecheck/lint；
- 相关单元或集成测试；
- 本步骤适用不变量；
- 跨文件副作用登记同步检查。

### merge 模式

运行项目声明的全量门禁：

- typecheck；
- lint；
- unit test；
- integration test；
- build；
- schema/migration verify；
- invariant verify；
- 相关安全、权限和结果回归；
- 工作区和 diff 检查。

不存在某类测试时，明确记录原因，不得写成“测试通过”。

## Step 3：自动化检查

根据项目实际命令执行，不把以下命令名写死为唯一实现。

建议覆盖：

### 编译与静态检查

- TypeScript typecheck；
- lint；
- 显式 `any`、`no-console`、Secrets、死代码等自动规则；
- renderer Node 边界；
- 未登记 IPC/EventType 的静态检查。

### 测试

- 单元测试；
- 集成测试；
- 状态机和安全负向测试；
- 迁移与历史数据兼容；
- 事件回放和故障恢复；
- 报告或结果快照测试。

### 构建与数据结构

- main / preload / renderer 或当前项目实际构建目标；
- Schema 加载；
- trigger / index / FK；
- migration forward / rollback（适用时）；
- 数据合同校验。

### 项目不变量

逐条输出本次适用 ID 的验证结果。优先使用自动脚本或测试；没有自动化时，说明人工审查证据。

## Step 4：跨文件登记副作用检查

对 impl 中的副作用登记表逐项核验：

```markdown
- [PASS] IPC handler 与 preload/shared type 同步
- [FAIL] 新 EventType 缺少回放测试
- [NOT_RUN] 路由深链接实机检查
```

只完成主文件而遗漏登记文件，应视风险定为 FAIL，不得推迟到“以后顺手补”。

## Step 5：人工验收

仅保留无法可靠自动化的操作，例如：

- Electron 实机流程；
- 教师平板与学生端协同；
- 触摸、摄像头、投影或局域网设备；
- 视觉布局和可访问性；
- 真实断线、重启和恢复；
- 安全红线端到端场景。

每项必须记录：

- 操作步骤；
- 环境；
- 观察结果；
- 截图、日志或测试记录（如有）；
- `PASS / FAIL / NOT_RUN / BLOCKED`。

未实际执行不得勾选为 PASS。

## Step 6：结论等级

### PASS

所有本模式必需自动检查和人工检查均为 PASS。

### AUTOMATION_PASS_MANUAL_PENDING

自动检查通过，但存在必需人工项目 `NOT_RUN` 或 `BLOCKED`。

### FAIL

存在任一必需检查 FAIL。

### BLOCKED

缺少权威资料、命令、环境、权限或存在无法解决的冲突，导致无法形成可信结论。

## Step 7：输出格式

```markdown
# 验收报告

## 结论
PASS / AUTOMATION_PASS_MANUAL_PENDING / FAIL / BLOCKED

## 范围
- 模式：step / merge
- 风险：R0 / R1 / R2 / R3
- base/head：
- PRD / impl：
- 适用不变量：

## 工作区
| 项目 | 状态 | 证据 |
|---|---|---|

## 自动化检查
| 检查 | 命令 | 状态 | 证据 |
|---|---|---|---|

## 不变量核验
| ID | 状态 | 证据 |
|---|---|---|

## 跨文件登记检查

## 人工验收
| 场景 | 状态 | 环境与证据 |
|---|---|---|

## 未通过项
- 文件路径、行号、命令输出或场景证据

## 未执行 / 阻塞项

## 计划外变更

## 规则沉淀候选
- 建议新增的测试、静态检查或不变量

## 下一步
```

## Step 8：授权边界

验收通过只表示“具备提交或创建 PR 的条件”。

除非用户明确授权，不得：

- commit；
- push；
- merge；
- 删除数据库；
- 发布或部署；
- 修改生产数据。
