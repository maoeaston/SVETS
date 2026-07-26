你现在需要在当前项目中安装一套同时供 Claude Code 和 Codex 使用的 Vibe Coding 工作流。

项目根目录下已经存在：

```text
vibe-coding-skills-v2/
```

该目录是本套工作流的原始安装包和唯一内容来源。请先完整检查其中的目录、文件和内部路径引用，再执行安装。

本次任务只安装和配置工作流，不修改业务代码，不启动功能开发，不提交、不 push、不 merge。

---

# 一、任务目标

完成后，需要同时满足：

1. Claude Code 可以通过项目级命令使用：

   * `vibe-feature`
   * `vibe-impl`
   * `vibe-review`
   * `vibe-accept`

2. Codex 可以将以上四个工作流识别为项目级 Skills。

3. Claude Code 和 Codex 共用同一套：

   * 权威基线指针；
   * 项目不变量；
   * 工作流协议。

4. 不在 Claude 和 Codex 目录中复制整份工作流正文。

5. `vibe-coding-skills-v2/commands/` 中的四个 Markdown 文件继续作为四个工作流的唯一正文来源。

6. 不覆盖已有项目配置；遇到已有文件时先读取、比较并做最小合并。

---

# 二、开始前检查

先确认当前工作目录确实是项目根目录。至少检查以下项目：

```text
package.json
AGENTS.md
src/
doc/
.claude/
.agents/
vibe-coding-skills-v2/
```

部分目录可能尚不存在，这是允许的。

然后读取：

```text
vibe-coding-skills-v2/README.md
vibe-coding-skills-v2/00-改版说明.md

vibe-coding-skills-v2/commands/vibe-feature.md
vibe-coding-skills-v2/commands/vibe-impl.md
vibe-coding-skills-v2/commands/vibe-review.md
vibe-coding-skills-v2/commands/vibe-accept.md

vibe-coding-skills-v2/shared/vibe-workflow-contract.md
vibe-coding-skills-v2/shared/baseline.example.yaml
vibe-coding-skills-v2/shared/project-invariants.example.md
```

同时读取现有：

```text
AGENTS.md
doc/specs/
package.json
```

并搜索当前项目中是否已经存在：

```text
baseline.yaml
project-invariants.md
vibe-workflow-contract.md
vibe-feature
vibe-impl
vibe-review
vibe-accept
```

不要根据文件名直接覆盖已有文件。

---

# 三、安装后的目标结构

最终建议形成以下结构：

```text
<project-root>/
├── AGENTS.md
│
├── vibe-coding-skills-v2/
│   ├── README.md
│   ├── 00-改版说明.md
│   ├── commands/
│   │   ├── vibe-feature.md
│   │   ├── vibe-impl.md
│   │   ├── vibe-review.md
│   │   └── vibe-accept.md
│   └── shared/
│       ├── vibe-workflow-contract.md
│       ├── baseline.example.yaml
│       └── project-invariants.example.md
│
├── .claude/
│   └── commands/
│       ├── vibe-feature.md
│       ├── vibe-impl.md
│       ├── vibe-review.md
│       └── vibe-accept.md
│
├── .agents/
│   └── skills/
│       ├── vibe-feature/
│       │   └── SKILL.md
│       ├── vibe-impl/
│       │   └── SKILL.md
│       ├── vibe-review/
│       │   └── SKILL.md
│       └── vibe-accept/
│           └── SKILL.md
│
└── doc/
    ├── ai/
    │   ├── vibe-workflow-contract.md
    │   └── vibe-coding-skills/
    │       ├── README.md
    │       └── 00-改版说明.md
    │
    └── specs/
        ├── baseline.yaml
        └── project-invariants.md
```

不要创建 `.codex/skills/`。本项目的 Codex 项目级 Skills 放在：

```text
.agents/skills/
```

不要使用符号链接。创建普通文件和真实目录，确保 Windows、WSL、Claude Code 和 Codex 都能稳定读取。

---

# 四、安装共享文件

## 4.1 工作流协议

复制：

```text
vibe-coding-skills-v2/shared/vibe-workflow-contract.md
```

到：

```text
doc/ai/vibe-workflow-contract.md
```

处理规则：

* 如果目标文件不存在，创建。
* 如果已经存在，先比较内容。
* 若已有文件明显是旧版，做最小更新。
* 不得删除已有项目特定补充内容。
* 发生冲突时，以新版协议结构为基础，保留项目特定规则，并在结果中说明合并情况。

## 4.2 权威基线文件

将：

```text
vibe-coding-skills-v2/shared/baseline.example.yaml
```

复制并重命名为：

```text
doc/specs/baseline.yaml
```

但不要机械保留示例值。

请根据当前项目真实文件自动识别并填写：

* 项目指令文件；
* 当前权威 PRD；
* 当前权威数据库 Schema；
* JSON 字段数据合同；
* 领域事件 payload 合同；
* 工作流协议；
* 项目不变量；
* package manifest；
* CI 工作流目录；
* 项目测试或验证入口。

识别优先级：

1. `AGENTS.md` 中明确声明的权威文件；
2. 文件名或文档正文中明确标记为 `authoritative` 的文件；
3. 当前代码实际引用的 Schema 或数据合同；
4. 当前项目验证脚本和 CI 使用的路径。

不得单纯按文件名版本号最高就认定为权威文件。

若出现多个候选且无法可靠判断：

* 不要猜测；
* 在 `baseline.yaml` 中使用清晰的 `TODO_CONFIRM`；
* 在最终报告中列出候选文件和需要人工确认的问题。

如果 `doc/specs/baseline.yaml` 已存在：

* 不直接覆盖；
* 校验现有路径是否仍然存在；
* 修复已明确失效的路径；
* 对有歧义的内容保留现值并报告。

## 4.3 项目不变量

将：

```text
vibe-coding-skills-v2/shared/project-invariants.example.md
```

复制并重命名为：

```text
doc/specs/project-invariants.md
```

但必须把它视为模板，而不是已经验证的项目事实。

请对照以下材料核验每条不变量：

```text
AGENTS.md
当前权威 PRD
当前 Schema
事件合同
JSON 数据合同
相关 src/ 实现
现有测试
```

处理要求：

* 已被当前工程证实的规则可以保留。
* 与当前工程不一致的示例内容必须修正。
* 无法确认的规则标记为 `UNVERIFIED`，不能伪装成已生效约束。
* 保留稳定的不变量编号，例如：

  * `INV-EVT-*`
  * `INV-SAFE-*`
  * `INV-RES-*`
  * `INV-IPC-*`
  * `INV-AUTH-*`
  * `INV-DATA-*`
* 不要在多个 Skill 文件里重新复制不变量全文。
* 各 Skill 应通过不变量 ID 引用这里的规则。

重点核验当前项目实际存在的：

* 事件写入顺序；
* JSONL 与 SQLite 投影关系；
* assessment 和 training 状态变更入口；
* FSM 迁移约束；
* safety incident 生命周期；
* “先熔断后归因”原则；
* 三类结果不得混算；
* `strategy_config` 引用一致性；
* IPC 白名单；
* renderer 与 Node API 隔离；
* TEACHER 与 ADMIN 权限边界；
* 数据迁移和兼容性约束。

## 4.4 说明文件

将：

```text
vibe-coding-skills-v2/README.md
vibe-coding-skills-v2/00-改版说明.md
```

复制到：

```text
doc/ai/vibe-coding-skills/README.md
doc/ai/vibe-coding-skills/00-改版说明.md
```

这两个文件用于项目内说明，不是运行入口。

---

# 五、创建 Claude Code 命令适配器

创建目录：

```text
.claude/commands/
```

为四个命令分别创建轻量适配器。

不要把 `vibe-coding-skills-v2/commands/` 中的整份正文复制到 `.claude/commands/`。

## 5.1 `.claude/commands/vibe-feature.md`

内容应表达：

```markdown
请读取并严格执行项目根目录下：

`vibe-coding-skills-v2/commands/vibe-feature.md`

同时读取：

- `doc/ai/vibe-workflow-contract.md`
- `doc/specs/baseline.yaml`
- `doc/specs/project-invariants.md`
- `AGENTS.md`

将下面的调用参数作为本次功能需求输入：

$ARGUMENTS

不得根据记忆复述工作流；必须读取上述当前文件后执行。
```

## 5.2 `.claude/commands/vibe-impl.md`

内容应表达：

```markdown
请读取并严格执行项目根目录下：

`vibe-coding-skills-v2/commands/vibe-impl.md`

同时读取：

- `doc/ai/vibe-workflow-contract.md`
- `doc/specs/baseline.yaml`
- `doc/specs/project-invariants.md`
- `AGENTS.md`

将下面的调用参数作为本次实现计划输入：

$ARGUMENTS

不得根据记忆复述工作流；必须读取上述当前文件后执行。
```

## 5.3 `.claude/commands/vibe-review.md`

内容应表达：

```markdown
请读取并严格执行项目根目录下：

`vibe-coding-skills-v2/commands/vibe-review.md`

同时读取：

- `doc/ai/vibe-workflow-contract.md`
- `doc/specs/baseline.yaml`
- `doc/specs/project-invariants.md`
- `AGENTS.md`

将下面的调用参数作为本次审查输入：

$ARGUMENTS

审查必须基于真实文件、真实 diff 和验证证据，不得只依据开发者总结。
```

## 5.4 `.claude/commands/vibe-accept.md`

内容应表达：

```markdown
请读取并严格执行项目根目录下：

`vibe-coding-skills-v2/commands/vibe-accept.md`

同时读取：

- `doc/ai/vibe-workflow-contract.md`
- `doc/specs/baseline.yaml`
- `doc/specs/project-invariants.md`
- `AGENTS.md`

将下面的调用参数作为本次验收模式或验收范围输入：

$ARGUMENTS

没有实际执行的检查必须标记为 NOT_RUN 或 BLOCKED，不得声明通过。
```

可以在不改变上述语义的前提下整理文字，但不得复制四份完整工作流正文。

---

# 六、创建 Codex 项目级 Skills

创建：

```text
.agents/skills/
```

每个 Skill 必须有独立目录和 `SKILL.md`。

每个 `SKILL.md` 必须包含 YAML frontmatter：

```yaml
---
name: <skill-name>
description: <清晰描述何时调用该 skill>
---
```

Skill 正文保持轻量，只负责：

1. 指向 `vibe-coding-skills-v2/commands/` 中的唯一工作流正文；
2. 要求读取共享协议、基线、不变量和 `AGENTS.md`；
3. 定义输入如何传给主工作流；
4. 不复制整份主工作流。

## 6.1 `.agents/skills/vibe-feature/SKILL.md`

建议结构：

```markdown
---
name: vibe-feature
description: Use when starting, defining, scoping, or revising a project feature before implementation. Produces a risk-classified Mini-PRD grounded in the repository's authoritative baseline and project invariants.
---

# Vibe Feature

Before doing any feature design, read:

1. `AGENTS.md`
2. `doc/specs/baseline.yaml`
3. `doc/specs/project-invariants.md`
4. `doc/ai/vibe-workflow-contract.md`
5. `vibe-coding-skills-v2/commands/vibe-feature.md`

Treat the user's current feature request as the input to the workflow.

Follow `vibe-coding-skills-v2/commands/vibe-feature.md` as the authoritative procedure.

Do not rely on a remembered copy of the workflow. Do not begin implementation unless the user explicitly requests implementation after the feature specification is complete.
```

## 6.2 `.agents/skills/vibe-impl/SKILL.md`

建议结构：

```markdown
---
name: vibe-impl
description: Use when an approved feature PRD must be converted into an atomic, testable, reversible implementation plan with explicit cross-file side effects and validation evidence.
---

# Vibe Implementation Plan

Before producing an implementation plan, read:

1. `AGENTS.md`
2. `doc/specs/baseline.yaml`
3. `doc/specs/project-invariants.md`
4. `doc/ai/vibe-workflow-contract.md`
5. `vibe-coding-skills-v2/commands/vibe-impl.md`
6. The PRD or feature specification supplied by the user

Treat the user's current request and supplied PRD path as the workflow input.

Follow `vibe-coding-skills-v2/commands/vibe-impl.md` as the authoritative procedure.

Do not copy stale assumptions from earlier conversations. Verify repository paths and cross-file registration side effects against the current checkout.
```

## 6.3 `.agents/skills/vibe-review/SKILL.md`

建议结构：

```markdown
---
name: vibe-review
description: Use for evidence-based independent review of a PRD, implementation plan, code diff, migration, schema change, safety logic, or other high-risk project artifact.
---

# Vibe Review

Before reviewing, read:

1. `AGENTS.md`
2. `doc/specs/baseline.yaml`
3. `doc/specs/project-invariants.md`
4. `doc/ai/vibe-workflow-contract.md`
5. `vibe-coding-skills-v2/commands/vibe-review.md`
6. The actual review target
7. The real git diff and relevant tests when reviewing code

Treat the user's current request as the review type and scope.

Follow `vibe-coding-skills-v2/commands/vibe-review.md` as the authoritative procedure.

Every finding must be supported by a file path, line range, diff hunk, command output, or specific design section. Do not manufacture findings merely to satisfy the reviewer role.
```

## 6.4 `.agents/skills/vibe-accept/SKILL.md`

建议结构：

```markdown
---
name: vibe-accept
description: Use after an implementation step or before commit, pull request, merge, or release to run evidence-based project validation and report PASS, FAIL, NOT_RUN, or BLOCKED without overstating unexecuted checks.
---

# Vibe Acceptance

Before validating, read:

1. `AGENTS.md`
2. `doc/specs/baseline.yaml`
3. `doc/specs/project-invariants.md`
4. `doc/ai/vibe-workflow-contract.md`
5. `vibe-coding-skills-v2/commands/vibe-accept.md`
6. Current package scripts, CI workflow, git status, and git diff

Treat the user's current request as the validation mode or scope.

Follow `vibe-coding-skills-v2/commands/vibe-accept.md` as the authoritative procedure.

Never report an unexecuted manual check as passed. Validation success does not authorize commit, push, merge, deletion, database reset, or release.
```

可以根据项目实际情况优化 description，但：

* `name` 必须分别为：

  * `vibe-feature`
  * `vibe-impl`
  * `vibe-review`
  * `vibe-accept`
* 不得把四个 Skill 合并成一个。
* 不得把 Skills 放到 `.codex/skills/`。
* 不得把 `SKILL.md` 本身做成符号链接。
* 不得把完整工作流复制进四个 `SKILL.md`。

---

# 七、更新根目录 AGENTS.md

读取现有 `AGENTS.md`，保留全部已有内容。

在合适位置增加一个独立章节，例如：

```markdown
## Vibe Coding 工作流

本项目同时使用 Claude Code 和 Codex。

### 唯一工作流正文

- `vibe-coding-skills-v2/commands/vibe-feature.md`
- `vibe-coding-skills-v2/commands/vibe-impl.md`
- `vibe-coding-skills-v2/commands/vibe-review.md`
- `vibe-coding-skills-v2/commands/vibe-accept.md`

Claude Code 的 `.claude/commands/` 和 Codex 的 `.agents/skills/`
仅作为运行适配入口，不是工作流正文的第二事实来源。

### 共享约束

- 当前权威基线：`doc/specs/baseline.yaml`
- 项目不变量：`doc/specs/project-invariants.md`
- 工作流协议：`doc/ai/vibe-workflow-contract.md`

执行任何 Vibe Coding 工作流前，必须读取上述当前文件。

不得根据文件名猜测当前权威 PRD、Schema 或数据合同。
不得在多个 Skill 中复制项目不变量全文。
不得把未实际执行的检查声明为通过。

### 工作流选择

- 新功能定义、范围和 Mini-PRD：`vibe-feature`
- PRD 转步骤化实现计划：`vibe-impl`
- PRD、计划、代码或 diff 独立审查：`vibe-review`
- 实现步骤或合并前验收：`vibe-accept`
```

如果 `AGENTS.md` 已有类似章节，做最小合并，不创建重复章节。

不要改变现有工程约束的优先级。

---

# 八、路径一致性检查

安装后，搜索以下旧路径或错误路径：

```text
.codex/skills
baseline.example.yaml
project-invariants.example.md
MVP_PRD_v1.0.9-authoritative.md
doc/ai/vibe-workflow-contract.md
doc/specs/baseline.yaml
doc/specs/project-invariants.md
```

检查要求：

1. 运行入口不得继续引用 `.example` 文件。
2. 四个 Skill 不得硬编码某个 PRD 版本。
3. 权威 PRD 必须通过 `baseline.yaml` 解析。
4. Claude 与 Codex 入口必须指向同一组工作流正文。
5. 不变量只能在 `project-invariants.md` 集中定义。
6. 如果源工作流文件内部仍有与目标结构冲突的路径，做最小修正。
7. 不要改变工作流的业务语义和风险控制要求。

---

# 九、验证

至少执行以下检查：

```bash
git status --short
git diff --check
git diff -- AGENTS.md .claude .agents doc/ai doc/specs vibe-coding-skills-v2
```

同时确认：

* [ ] `.claude/commands/` 下存在四个命令适配器
* [ ] `.agents/skills/` 下存在四个独立 Skill
* [ ] 每个 Codex `SKILL.md` 都有合法 YAML frontmatter
* [ ] 每个 `SKILL.md` 都有唯一的 `name`
* [ ] 每个 `description` 都明确说明适用场景
* [ ] 四个 Claude 入口都传递 `$ARGUMENTS`
* [ ] 四个 Claude 入口都指向根目录安装包中的唯一正文
* [ ] 四个 Codex Skill 都指向相同的唯一正文
* [ ] `baseline.yaml` 中不存在无意保留的示例路径
* [ ] `project-invariants.md` 已区分 VERIFIED 与 UNVERIFIED
* [ ] `AGENTS.md` 没有丢失原内容
* [ ] 未修改业务代码
* [ ] 未 commit
* [ ] 未 push
* [ ] 未 merge

不需要因为本次纯文档和配置安装而运行完整业务测试，但要明确说明未运行的测试及原因。

---

# 十、最终输出

完成后给出：

```markdown
## 安装结论

[完成 / 部分完成 / 阻断]

## 创建文件

- 路径
- 用途

## 修改文件

- 路径
- 修改内容

## Claude Code 入口

- 命令
- 对应适配文件
- 对应唯一工作流正文

## Codex Skills

- Skill 名称
- SKILL.md 路径
- 对应唯一工作流正文

## 权威基线解析结果

- PRD
- Schema
- JSON contract
- Event contract
- 测试入口
- CI 入口

## 待人工确认

- 无法自动判断的路径或规则
- `UNVERIFIED` 项目不变量
- 已有文件合并冲突

## 验证证据

- `git status --short`
- `git diff --check`
- 关键目录树
- 未运行的检查及原因
```

不要只回复“已经安装完成”。必须列出实际文件路径和验证证据。
