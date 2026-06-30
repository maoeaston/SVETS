# /vibe-accept — 验收清单（合并前必跑）

每个功能步骤完成后，或准备合并前，运行此清单。

## 输入

可选：指定验收范围，例如 `/vibe-accept auth` 只检查 auth 相关。

## 自动化检查（必须全部通过）

### 1. TypeScript 类型检查

```bash
npm run typecheck
```

期望：零错误，零 `any` 类型警告。

### 2. 构建

```bash
npm run build
```

期望：main / preload / renderer 三段全部构建成功。

### 3. 单元测试

```bash
npm test
```

期望：所有 Vitest 用例通过；若无测试文件，明确说明原因（不能假装通过）。

---

## 项目专项检查（人工 + 代码审查）

### 事件溯源完整性

- [ ] 本次改动的所有状态变更，是否都通过 `writeEvent()` 推进？
- [ ] `action_log.jsonl` 写入在 `domain_event_projection` 写入之前？
- [ ] 每个新 EventType 都有对应的 payload interface 定义？

### 数据库约束

- [ ] 新增的状态迁移路径，是否与 schema.sql 触发器一致？
- [ ] 未出现直接 UPDATE `assessment_session.status` 或 `training_session.status`（必须通过触发链）？
- [ ] 涉及 `strategy_config` 引用的会话，`strategy_id/type/job_code/version` 四字段联合校验通过？

### 安全红线

- [ ] 未绕过 `safety_incident` 状态机直接修改 session 状态？
- [ ] 涉及 `REDLINE_HALTED` 的逻辑，`redline_incident_id` 指向同一 `student_id + task_code`？
- [ ] 教师不能执行 `RESOLVED` / `VOIDED` 操作？
- [ ] 未解决安全事件仍阻断同学生同任务的新会话？

### IPC 安全

- [ ] 所有新 IPC 通道在 `src/preload/index.ts` 白名单中显式声明？
- [ ] 渲染进程无直接 `require()` 或 Node.js API 调用？

### 结果体系

- [ ] `ABILITY_SCORE` / `TRAINING_COMPLETION` / `OPERATION_PASS_RATE` 独立计算、未合并？
- [ ] `safety_overridden = 1` 时，`level_result` 强制为 `LEVEL_FAIL_BY_SAFETY`？

### 代码规范

- [ ] 无硬编码题量、阈值、题型比例（必须读 `strategy_config`）？
- [ ] JSON TEXT 字段写入前有格式验证？
- [ ] 无 `console.log` 遗留（开发调试除外）？
- [ ] 无注释掉的代码块？

---

## 手工冒烟（最小路径验证）

根据本次改动范围，至少走一遍以下路径中的相关环节：

1. 教师登录 → 创建学生档案
2. 发起测评 → 学生答题 → 系统记录答案
3. 分配训练 → 完成四步 → 训练完成度生成
4. 线下评分 → 达标率生成 → 报告生成
5. 触发红线 → 会话熔断 → 新会话被阻断

---

## 输出

```
## 验收结论：[通过 / 未通过]

### 未通过项
- [ ] <具体问题，附文件路径和行号>

### 通过确认
- [x] typecheck 零错误
- [x] build 成功
- [x] vitest N 个用例通过
- [x] 专项检查项全部 checked
```

通过后方可 commit 并推送。
