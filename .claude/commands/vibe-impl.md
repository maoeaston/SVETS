# /vibe-impl — 实现文档生成（PRD → 步骤化实现计划 + 测试设计）

## 触发时机

已有确认的 Mini-PRD（通常来自 `/vibe-feature`），准备进入实现阶段。

## 输入

用户指定 Mini-PRD 文件路径，例如：`/vibe-impl doc/features/auth-login-prd.md`

## 执行步骤

### Step 1：读取 PRD 和相关代码

1. 读取指定的 Mini-PRD 文件
2. 根据涉及的模块，读取对应的源文件（连接层、IPC handler、Vue 视图、共享类型）
3. 读取 `AGENTS.md` 中的关键约束

### Step 2：Writer 生成实现文档

输出一份 `doc/features/<feature-name>-impl.md`，结构如下：

```markdown
## 实现目标（一句话）

## 前置条件
- 依赖哪些已有模块
- 哪些字段/表/事件必须已存在

## 实现步骤（每步对应一个 commit）

### Step N：<步骤名>
**改动文件：**
- `src/xxx/yyy.ts`：具体说明增加/修改什么

**核心逻辑：**
（伪代码或关键设计决策）

**测试用例：**
- 单元测试：正常路径 / 异常路径 / 边界值
- 集成测试：（如涉及 DB 或 IPC）
- 手工验收点：（如涉及 UI）

**commit message 建议：**
`feat(xxx): ...`

---
（重复 Step N...）

## 回归验收清单
- [ ] typecheck 通过
- [ ] build 通过
- [ ] vitest 通过
- [ ] 手工冒烟：描述核心路径
```

### 项目约束检查（Writer 必须自检）

- [ ] 事件写入顺序：JSONL append → domain_event_projection → reducer（不可颠倒）
- [ ] 新 EventType 已加入 `src/shared/types/event-payloads.ts`
- [ ] 新 IPC 通道已在 `src/preload/index.ts` 白名单中声明
- [ ] 无硬编码题量/阈值（必须读 strategy_config）
- [ ] FSM 状态迁移路径与 schema 触发器一致
- [ ] 安全红线相关逻辑：[!] 标注并说明触发链
- [ ] JSON 字段写入前有格式校验

### Step 3：Reviewer 审查（subagent）

启动 Reviewer subagent，提供实现文档全文，要求它：

- 找出步骤间的依赖关系是否正确（有没有前置步骤遗漏）
- 找出测试设计的盲区（特别是并发、异常退出、红线熔断中途）
- 找出可能违反 AGENTS.md 约束的设计
- 指出步骤粒度是否过大（单步不应超过5个文件改动）

### Step 4：输出

- 保存实现文档到 `doc/features/<feature-name>-impl.md`
- 告知用户可以开始逐步执行，每步完成后运行 `/vibe-accept <step-n>`
