# Vibe Coding Skills v2

这套文件用于把需求、设计、实现、审查和验收组织成可验证的工程闭环。

## 文件结构

```text
vibe-coding-skills-v2/
├── README.md
├── 00-改版说明.md
├── commands/
│   ├── vibe-feature.md
│   ├── vibe-impl.md
│   ├── vibe-review.md
│   └── vibe-accept.md
└── shared/
    ├── vibe-workflow-contract.md
    ├── baseline.example.yaml
    └── project-invariants.example.md
```

## 建议落位

如果使用 Claude Code slash command：

```text
commands/vibe-feature.md  → .claude/commands/vibe-feature.md
commands/vibe-impl.md     → .claude/commands/vibe-impl.md
commands/vibe-review.md   → .claude/commands/vibe-review.md
commands/vibe-accept.md   → .claude/commands/vibe-accept.md
```

共享文件建议放入：

```text
shared/vibe-workflow-contract.md       → doc/ai/vibe-workflow-contract.md
shared/baseline.example.yaml           → doc/specs/baseline.yaml
shared/project-invariants.example.md   → doc/specs/project-invariants.md
```

并在 `AGENTS.md` 中只保留简短入口：

```markdown
## 权威资料

- 当前基线：`doc/specs/baseline.yaml`
- 项目不变量：`doc/specs/project-invariants.md`
- Agent 工作流：`doc/ai/vibe-workflow-contract.md`
```

## 四个命令的职责

| 命令 | 职责 | 不负责 |
|---|---|---|
| `/vibe-feature` | 将需求转为经过审查的 Mini-PRD | 编码、提交、合并 |
| `/vibe-impl` | 将已批准 PRD 转为可验证的原子实施步骤 | 擅自扩大范围、自动推送 |
| `/vibe-review` | 对 PRD、实现文档或真实代码差异做证据化审查 | 修改被审查对象、为找问题而制造问题 |
| `/vibe-accept` | 执行自动门禁、收集证据、标记人工验收状态 | 默认勾选未执行项目、自动发布 |

## 风险等级

- `R0`：文案、样式或无行为变化的小调整。
- `R1`：单模块普通功能，行为可局部验证。
- `R2`：跨模块、IPC/API、权限、数据写入、结果投影。
- `R3`：Schema、迁移、FSM、安全红线、审计、并发、数据修复或不可逆操作。

风险越高，要求加载的上下文、审查独立性、测试范围和人工验收越严格。

## 迁移步骤

1. 先确认 `baseline.yaml` 指向当前权威文件。
2. 将原来分散在四个 Skill 中的项目专属规则迁入 `project-invariants.md`，并赋予稳定 ID。
3. 将可机械判定的规则迁入 lint、测试、Schema、脚本或 CI。
4. 再替换四个旧命令。
5. 首轮运行时重点检查命令路径、脚本名称和项目目录是否匹配。

## 核心原则

Skill 负责工作流、上下文路由和证据要求；真正不可违反的约束，应尽量由类型系统、Schema、测试、静态检查和 CI 强制执行。
