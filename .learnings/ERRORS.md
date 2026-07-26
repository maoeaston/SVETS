# Errors

## [ERR-20260724-VIBE1] agents-skills-sandbox-readonly

**Logged**: 2026-07-24T23:20:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
受控沙箱在项目根目录允许写入，但对已有 `.agents` 目录下创建 `.agents/skills` 返回只读文件系统。

### Error
```
mkdir: cannot create directory ‘.agents/skills’: Read-only file system
```

### Context
- Command/operation attempted: `mkdir -p doc/ai/vibe-coding-skills .agents/skills/vibe-feature .agents/skills/vibe-impl .agents/skills/vibe-review .agents/skills/vibe-accept .claude/commands`
- 当前任务要求把 Codex 项目级 Skills 放在 `.agents/skills/`，不得放到 `.codex/skills/`。
- `.agents` 目录存在，但受控沙箱未允许写入该路径。

### Suggested Fix
对创建 `.agents/skills/*` 的操作申请提升权限；后续文件写入如仍被拒绝，同样按最小范围提升权限执行。

### Metadata
- Reproducible: yes
- Related Files: vibe.md, .agents/skills
- See Also:

### Resolution
- **Resolved**: 2026-07-24T23:21:00+08:00
- **Commit/PR**: none
- **Notes**: 通过用户批准的提升权限创建 `.agents/skills/*` 目录；后续 `apply_patch` 成功写入 Skill 文件。

---

## [ERR-20260720-001] vitest-node-spawnsync-sandbox-eperm

**Logged**: 2026-07-20T10:49:47+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
Vitest 内用 `execFileSync(process.execPath, ...)` 重跑确定性构建脚本时，受控环境对已完成的 Node 子进程报告伪 `EPERM`。

### Error
```
Error: spawnSync /home/maoea/.nvm/versions/node/v24.14.1/bin/node EPERM
```

### Context
- 命令：`./node_modules/.bin/vitest run scripts/__tests__/job-skill-shelver-298-revisions.test.mjs`
- 前六项审核集合、hash、Schema、合并与候选测试已通过。
- 与 `ERR-20260714-012` 属于同类受控沙箱伪错误。

### Suggested Fix
测试内改用 `spawnSync`，当 `status === 0` 时忽略伴随的 `EPERM`；仍对非零状态和缺少状态的错误失败。

### Metadata
- Reproducible: intermittent
- Related Files: scripts/__tests__/job-skill-shelver-298-revisions.test.mjs
- See Also: ERR-20260714-012

### Resolution
- **Resolved**: 2026-07-20T10:51:00+08:00
- **Commit/PR**: working tree
- **Notes**: 按既有经验改用 `spawnSync` 并以退出状态为首要判据。

---

## [ERR-20260724-RG2] rg-pattern-shell-command-substitution

**Logged**: 2026-07-24T22:16:23+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
双引号包裹的 `rg` 正则中含 Markdown 反引号，shell 将其误作命令替换。

### Error
```
/bin/bash: line 1: task_closure: command not found
```

### Context
- Command/operation attempted: 在双引号正则中搜索包含反引号的 Markdown 文本。
- 搜索仍返回了部分结果，但退出状态和输出已被 shell 解析污染。

### Suggested Fix
包含 Markdown 反引号的 `rg` pattern 使用单引号，或删除不必要的反引号匹配。

### Metadata
- Reproducible: yes
- Related Files: doc/features/report-page-framework-prd.md

### Resolution
- **Resolved**: 2026-07-24T22:16:23+08:00
- **Commit/PR**: none
- **Notes**: 后续命令改用单引号 pattern，并重新执行验证。

---

## [ERR-20260724-VAL1] punctuation-check-multiple-files

**Logged**: 2026-07-24T22:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
标点检查脚本一次只接受一个文件，却在单次调用中传入了多个文件。

### Error
```
check_punctuation.py: error: unrecognized arguments
```

### Context
- Command/operation attempted: 对五个 Markdown 文件执行一次 `check-punctuation.sh`。

### Suggested Fix
为每个文件单独调用脚本，可在工具编排层并行执行。

### Metadata
- Reproducible: yes
- Related Files: doc/features/report-page-framework-prd.md

### Resolution
- **Resolved**: 2026-07-24T22:20:00+08:00
- **Commit/PR**: none
- **Notes**: 已改为逐文件调用。

---

## [ERR-20260724-VAL2] git-diff-no-index-exit-code

**Logged**: 2026-07-24T22:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
把 `git diff --no-index --check` 的正常差异退出码 1 误当成空白检查失败。

### Error
```
Command exited with status 1 and no whitespace diagnostics.
```

### Context
- Command/operation attempted: 对尚未跟踪的 Mini-PRD 执行 `git diff --no-index --check /dev/null <file>`。

### Suggested Fix
跟踪文件继续用 `git diff --check`；未跟踪文件单独用 `awk` 检查行尾空白，不把 no-index 的“有差异”状态当作错误。

### Metadata
- Reproducible: yes
- Related Files: doc/features/report-page-framework-prd.md

### Resolution
- **Resolved**: 2026-07-24T22:20:00+08:00
- **Commit/PR**: none
- **Notes**: 后续验证改用明确的行尾空白检查。

---

## [ERR-20260724-VAL3] legacy-doc-punctuation-noise

**Logged**: 2026-07-24T22:22:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
对历史累积文档执行整文件标点检查时，被与本次新增内容无关的既有格式问题阻断。

### Error
```
check-punctuation reported pre-existing dash, spacing, and half-width punctuation findings.
```

### Context
- Affected legacy files: `doc/会话启动.md`、`doc/index.md`、`.learnings/ERRORS.md`。
- 本次新建的 `doc/features/report-page-framework-prd.md` 单文件检查通过。

### Suggested Fix
功能任务只核对新增行和新建文件；历史整文件格式清理应单独立项，避免无关文档 churn。

### Metadata
- Reproducible: yes
- Related Files: doc/会话启动.md, doc/index.md, .learnings/ERRORS.md

### Resolution
- **Resolved**: 2026-07-24T22:22:00+08:00
- **Commit/PR**: none
- **Notes**: 保留历史文本不动，改为核对本次 diff 和新建文档。

---

## [ERR-20260724-RG1] rg-glob-path-pattern-slip

**Logged**: 2026-07-24T19:05:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
F6-2 查询结果相关测试时，把 shell glob 形式的 `src/main/**/*.test.ts` 直接交给 `rg`，当前路径下没有匹配项时触发 `No such file or directory`。

### Error
```
rg: src/main/**/*.test.ts: No such file or directory (os error 2)
```

### Context
- Command/operation attempted: `rg -n "result_record.*strategy|strategy_type|module_type|TRAINING_COMPLETION|JOB_SKILL_SCORE|OPERATION_PASS_RATE" src/main/**/*.test.ts src/main/**/__tests__/*.ts -g '*.ts'`
- 目的是查找 F6-2 需要更新的结果字段断言。

### Suggested Fix
搜索测试时优先用目录加 `-g`：`rg -n "pattern" src/main src/shared -g '*.test.ts' -g '*.ts'`，避免把未展开的 glob 当作必存在路径。

### Metadata
- Reproducible: yes
- Related Files: .learnings/ERRORS.md
- See Also: ERR-20260722-E14

### Resolution
- **Resolved**: 2026-07-24T19:05:00+08:00
- **Commit/PR**: none
- **Notes**: 后续检索改用真实目录和 `-g` 过滤。

---

## [ERR-20260723-005] full-test-environment-and-existing-artifacts

**Logged**: 2026-07-23T01:34:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
全量测试未完全通过，其中 F4 夹具外键问题已修复，其余失败由受控沙箱和任务前已有题库审核产物漂移造成。

### Error
```
spawnSync sqlite3 EPERM
expected '' to contain 'content=22/210'
expected '' to contain 'authority is current'
```

### Context
- F4 修复后，`assessment-start-session.test.ts` 16 项与 F4 专项 106 项均通过。
- 全量测试中 3 项脚本测试需要子进程 `sqlite3`，受控沙箱禁止执行。
- 2 项 JOB_SKILL 审核脚本断言输出为空，关联工作区既有内容审核产物，不涉及 F4 文件。

### Suggested Fix
在允许 `sqlite3` 子进程的环境复跑数据库内容包测试；由题库审核任务核对并重建相关审核产物后再复跑两个脚本断言。

### Metadata
- Reproducible: yes
- Related Files: scripts/__tests__/database-content-pack.test.mjs

### Resolution
- **Resolved**: 2026-07-23T01:35:00+08:00
- **Notes**: 在允许 sqlite3 子进程的环境重新运行 `npm test` 后，81 个测试文件、910 项测试全部通过；审核脚本输出也恢复正常。

---

## [ERR-20260723-004] shell-quoting

**Logged**: 2026-07-23T01:26:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
只读检索命令包含未闭合的单引号，shell 在执行前拒绝解析。

### Error
```
/bin/bash: -c: line 1: unexpected EOF while looking for matching `''
```

### Context
- 在组合多条 `rg` 检索与后续检查时，末尾模式字符串未正确闭合。
- 未执行任何项目命令，未改动数据。

### Suggested Fix
执行前逐段核对引号；复杂检索拆成独立命令。

### Metadata
- Reproducible: yes
- Related Files: .learnings/ERRORS.md

### Resolution
- **Resolved**: 2026-07-23T01:26:00+08:00
- **Notes**: 已改为独立、引号闭合的检索命令。

---

## [ERR-20260723-003] punctuation-check-single-file-argument

**Logged**: 2026-07-23T00:43:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
文档标点检查脚本一次只接受一个文件。将两个路径放在同一次调用中会被参数解析拒绝。

### Error
```
check_punctuation.py: error: unrecognized arguments: doc/features/data-persistence-recovery-impl.md
```

### Suggested Fix
对每份文档分别执行 `check-punctuation.sh --lang zh <file>`。

### Resolution
- **Resolved**: 2026-07-23T00:43:00+08:00
- **Notes**: 已逐份检查 F3 两份文档，均返回 `punctuation: ok`。

---

## [ERR-20260722-F52] runtime-database-content-pack-drift

**Logged**: 2026-07-22T18:43:00+08:00
**Priority**: medium
**Status**: pending
**Area**: data

### Summary
默认运行数据库未同步到当前 2026.07.22.1 内容包，`npm run db:verify` 只读校验失败。

### Error
```
缺少迁移记录 2026-07-20_job_skill_phase4_asset_roles
开发账号密码不符合共享合同
题库语义哈希及题库导入事件投影与内容包不一致
```

### Context
- Command/operation attempted: `npm run db:verify`
- 当前任务明确禁止为题库合同工作写真实运行数据库，因此未执行默认路径的 `db:sync --reset`。
- 使用 `/tmp` 一次性数据库执行同一内容包的 sync + verify 已通过。

### Suggested Fix
由独立数据运维任务在确认真实历史数据可备份后执行默认运行库同步；先保留现状，不把运行库修复混入功能开发。

### Metadata
- Reproducible: yes
- Related Files: scripts/config/database-content-pack.json, scripts/db-sync.mjs, scripts/db-verify.mjs

---

## [ERR-20260722-F53] rg-pattern-parsed-as-option

**Logged**: 2026-07-22T18:44:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
以 `--db` 开头的 rg 模式被解析为命令选项，首次检索失败。

### Error
```
rg: unrecognized flag --db|parseArgs|exists|backup|force|sync
```

### Context
- Command/operation attempted: `rg -n "--db|..." ...`
- 模式首字符为连字符，未使用 `--` 结束选项解析。

### Suggested Fix
检索以连字符开头的模式时使用 `rg -n -- "pattern" files`。

### Metadata
- Reproducible: yes
- Related Files: scripts/db-sync.mjs, scripts/lib/database-content-pack.mjs

### Resolution
- **Resolved**: 2026-07-22T18:44:00+08:00
- **Commit/PR**: none
- **Notes**: 使用 `rg -n --` 重跑成功。

---

## [ERR-20260723-001] vitest-child-process-sandbox-eprem-and-stdout-loss

**Logged**: 2026-07-23T00:21:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
全量 Vitest 在受控沙箱中无法启动 sqlite3 子进程，并会丢失部分 Node 子进程标准输出。

### Error
```
spawnSync sqlite3 EPERM
expected '' to contain 'content=22/210'
expected '' to contain 'authority is current'
```

### Context
- `scripts/__tests__/database-content-pack.test.mjs` 与 `database-content-pack-migration-ledger.test.mjs` 使用 `execFileSync('sqlite3', ...)`，在 Vitest worker 内被拦截；直接执行 `sqlite3 --version` 正常。
- `scripts/build-job-skill-shelver-298-rereview-results.mjs` 与 `scripts/verify-job-skill-shelver-contract-chain.mjs` 直接用 Node 执行时会输出预期文本；Vitest 内 `spawnSync(process.execPath, ...)` 返回成功但 stdout 为空。
- F2 相关 `auth.test.ts` 和所有主进程权限测试通过，未发现产品代码回归。

### Suggested Fix
在具备非受控子进程权限的 CI 或本地终端重跑上述 5 项；若需使受控沙箱也可验收，独立评审测试辅助函数的子进程降级策略，避免把该运维改动混入 F2。

### Metadata
- Reproducible: yes
- Related Files: scripts/__tests__/database-content-pack.test.mjs, scripts/__tests__/database-content-pack-migration-ledger.test.mjs, scripts/__tests__/job-skill-shelver-298-rereview-results.test.mjs, scripts/__tests__/job-skill-shelver-contract-chain.test.mjs
- See Also: ERR-20260720-001

### Resolution
- **Resolved**: 2026-07-23T00:22:00+08:00
- **Commit/PR**: working tree
- **Notes**: 以非受控子进程权限复跑 4 个测试文件，15 项测试全部通过；确认无 F2 产品代码回归。

---

## [ERR-20260723-002] vitest-unsupported-tothrowobject-matcher

**Logged**: 2026-07-23T00:24:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
恢复专项测试使用了当前 Vitest 类型定义未提供的 `toThrowObject` 断言。

### Error
```
Property 'toThrowObject' does not exist on type 'Assertion<...>'
```

### Context
- `src/main/domain/__tests__/recovery.test.ts` 的异常断言在 `npm run typecheck` 阶段失败。

### Resolution
- **Resolved**: 2026-07-23T00:24:00+08:00
- **Notes**: 改为显式捕获 `RecoveryLogError`，断言错误码与行号。

---

## [ERR-20260722-E41] git-diff-check-markdown-trailing-space

**Logged**: 2026-07-22T18:39:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
文档同步后 `git diff --check` 因新增 Markdown 行尾空格失败。

### Error
```
doc/features/student-profile-impl.md: trailing whitespace
```

### Context
- Command/operation attempted: `git diff --check`
- 两个加粗小标题行保留了 Markdown 硬换行空格，但后面紧跟普通段落，不需要硬换行。

### Suggested Fix
新增或修改 Markdown 后始终运行 `git diff --check`；普通标题或独立段落不要保留行尾双空格。

### Metadata
- Reproducible: yes
- Related Files: doc/features/student-profile-impl.md

### Resolution
- **Resolved**: 2026-07-22T18:40:00+08:00
- **Commit/PR**: none
- **Notes**: 已移除两处行尾空格并安排重新校验。

---

## [ERR-20260722-298] delivery-date-count-assumption

**Logged**: 2026-07-22T14:55:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
298题替代题接入时，交付合同的日期场景数按题干文本误推为22，实际分类仍为20。

### Error
```
[delivery-contract] expected 22 date questions, found 20
```

### Context
- Command: `node scripts/build-job-skill-shelver-delivery-lock.mjs`
- 日期场景的正式判定依赖 `material_requirement` 中的固定合同标记，而不是题干或线下工具说明中的日期词。

### Suggested Fix
保持日期场景断言为20；新增替代题的日期材料只进入通用线下站位，不自动增加固定日期交付合同。

### Metadata
- Reproducible: yes
- Related Files: scripts/lib/job-skill-delivery-contract.mjs

### Resolution
- **Resolved**: 2026-07-22T14:55:00+08:00
- **Commit/PR**: none
- **Notes**: 已按现有交付分类合同修正预期计数。

---

## [ERR-20260722-299] delivery-lock-count-assumption

**Logged**: 2026-07-22T14:57:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
298题替代题接入时，依据旧锁文件的差量推算唯一交付锁定题数为176；生成器按当前集合实际得到181。

### Error
```
[delivery-contract] expected 176 uniquely locked questions, found 181
```

### Context
- Command: `node scripts/build-job-skill-shelver-delivery-lock.mjs`
- 旧交付锁并非由当前处置权威确定性重建，不能作为新集合差量计算的基线。

### Suggested Fix
将181作为当前权威集合的锁定题总数，并用生成器、Schema和专项测试共同固定该值。

### Metadata
- Reproducible: yes
- Related Files: scripts/build-job-skill-shelver-delivery-lock.mjs

### Resolution
- **Resolved**: 2026-07-22T14:57:00+08:00
- **Commit/PR**: none
- **Notes**: 已以生成器实际集合计数替代旧文件差量推算。

---

## [ERR-20260722-300] database-content-pack-sqlite-buffer

**Logged**: 2026-07-22T15:25:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
内容包验证一次性读取298道题目的JSON聚合结果，超过Node子进程默认输出缓冲区。

### Error
```
spawnSync sqlite3 ENOBUFS
```

### Context
- Command: `npm test -- scripts/__tests__/database-content-pack.test.mjs`
- 失败发生在 `questionRows()` 的 `sqlite3 json_group_array` 查询，未写入运行数据库。

### Suggested Fix
在共享SQLite CLI封装中设置16 MiB的默认 `maxBuffer`，同时保留调用方显式覆盖能力。

### Metadata
- Reproducible: yes
- Related Files: scripts/lib/sqlite-cli.mjs, scripts/lib/database-content-pack.mjs

### Resolution
- **Resolved**: 2026-07-22T15:25:00+08:00
- **Commit/PR**: none
- **Notes**: 已提高共享CLI封装的默认输出缓冲区。

---

## [ERR-20260722-301] historical-contract-replay-after-authority-amendment

**Logged**: 2026-07-22T15:30:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
298题现行权威接入替代题后，三个历史生成器把现行处置状态误当作历史输入，导致全量测试失败。

### Error
```
authority must contain exactly 11 rejected questions
Patch set drifted from current locked review inputs
```

### Context
- Command: `npm test`
- 历史审核包记录的是V1淘汰和当时的交付锁哈希；现行权威合法地记录了11个审核通过但无激活权的替代版本。

### Suggested Fix
历史重放应保留锁定输入快照用于字节级验证，同时仅用现行权威校验来源记录未漂移及替代版本接管关系。

### Metadata
- Reproducible: yes
- Related Files: scripts/build-job-skill-shelver-298-rejected-reconsideration.mjs, scripts/build-job-skill-shelver-298-rejected-replacements-v2.mjs, scripts/build-job-skill-shelver-298-targeted-v3.mjs

### Resolution
- **Resolved**: 2026-07-22T15:30:00+08:00
- **Commit/PR**: none
- **Notes**: 历史生成器改为读取锁定历史哈希，同时接受现行替代题处置状态；相应回归测试通过。

---

## [ERR-20260722-018] rejected-replacement-json-array-key-assumption

**Logged**: 2026-07-22T16:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
查询 V3 候选与内容复审结果时误把题目数组写成 `items`，实际顶层字段为 `questions`，两条只读 `jq` 查询失败。

### Error
```
jq: error: Cannot iterate over null (null)
```

### Context
- Operation attempted: 从 V3 候选和陈晓青复审结果中筛选 6 道退回题。
- No project artifact was changed by the failed queries.

### Suggested Fix
查询前先用 `jq 'keys'` 或读取同链路生成器确认顶层数组字段，再编写筛选表达式。

### Metadata
- Reproducible: yes
- Related Files: doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.json, doc/features/job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-result-chen-xiaoqing-2026-07-22.json

### Resolution
- **Resolved**: 2026-07-22T16:00:00+08:00
- **Commit/PR**: none
- **Notes**: 改用 `.questions[]` 后查询成功。

---

## [ERR-20260722-019] v4-rubric-test-phrase-mismatch

**Logged**: 2026-07-22T17:05:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
V4 专项测试期望“目视检查并口头确认”，实际候选写成更明确的“目视检查并向评估员口头确认”，导致字符串包含断言失败。

### Error
```
expected '关键安全动作：目视检查并向评估员口头确认材料无尖锐、污染或重压风险' to contain '目视检查并口头确认'
```

### Context
- Operation attempted: 运行 6 道 V4 定点修订专项测试。
- 生成逻辑、评分规则和其余 6 项测试均通过。

### Suggested Fix
断言应锁定真正需要的可观察行为和对象，不应因省略介词短语而误判更明确的文案。

### Metadata
- Reproducible: yes
- Related Files: scripts/__tests__/job-skill-shelver-298-rejected-replacement-targeted-v4.test.mjs

### Resolution
- **Resolved**: 2026-07-22T17:05:00+08:00
- **Commit/PR**: none
- **Notes**: 保留候选文案，测试改为匹配“向评估员口头确认”。

---

## [ERR-20260722-020] v4-markdown-punctuation-gate-spacing

**Logged**: 2026-07-22T17:25:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
V4 候选 Markdown 首次运行中文标点门禁时，大量中英文和中文数字组合缺少空格。

### Error
```
[zh-missing-space] '6道', 'V4定', '同S', '2分' ...
```

### Context
- Operation attempted: 对生成的 V4 人读候选 Markdown 运行 write 技能标点门禁。
- JSON 机器合同和语义哈希不应因排版空格被改写。

### Suggested Fix
在 Markdown 生成出口统一格式化汉字与 ASCII 字母或数字之间的间距，只调整人读文档，不改 JSON、审核包数据或题目语义哈希。

### Metadata
- Reproducible: yes
- Related Files: scripts/build-job-skill-shelver-298-rejected-replacement-targeted-v4.mjs, doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v4.md

### Resolution
- **Resolved**: 2026-07-22T17:25:00+08:00
- **Commit/PR**: none
- **Notes**: 新增确定性 Markdown 排版函数，并重跑生成与标点门禁。

---

## [ERR-20260722-019] playwright-chromium-sandbox-host

**Logged**: 2026-07-22T10:34:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
本地静态审核页的 Playwright 冒烟测试在受限沙箱中无法启动 Chromium。

### Error
```
FATAL: content/browser/sandbox_host_linux.cc:41 Check failed: . shutdown: Operation not permitted
```

### Context
- Command: `python3 /tmp/svets_rejected_replacement_v3_html_smoke.py`
- JavaScript 内联编译测试已经通过；失败只发生在真实浏览器进程启动阶段。

### Suggested Fix
需要真实浏览器见证时在获批的沙箱外环境运行；若审核人将自行填写，不把模拟提交作为本轮交付门槛。

### Metadata
- Reproducible: yes
- Related Files: doc/features/job-skill-shelver-298-rejected-replacement-targeted-v3-content-rereview-packet-chen-xiaoqing-v1.html, doc/features/job-skill-shelver-298-rejected-replacement-targeted-v3-safety-technical-rereview-packet-he-dong-v1.html

### Resolution
- **Resolved**: 2026-07-22T10:45:00+08:00
- **Commit/PR**: none
- **Notes**: 用户明确由两位审核人自行填写，不再模拟审核提交；保留内联脚本编译和生成合同测试作为本轮验证。

---

## [ERR-20260722-018] targeted-v3-inline-script-newline-escaping

**Logged**: 2026-07-22T10:31:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
V3 自包含审核页生成器把内联 JavaScript 字符串中的换行转成了实际换行，导致脚本无法编译。

### Error
```
SyntaxError: Invalid or unexpected token
```

### Context
- Command: `vitest run scripts/__tests__/job-skill-shelver-298-rejected-replacement-targeted-v3.test.mjs`
- 失败发生在审核页内联脚本编译检查，候选 JSON 与其余合同断言通过。

### Suggested Fix
外层模板字符串内若要在生成的 JavaScript 字符串中保留 `\n`，生成器源代码必须使用双重转义，并保留内联脚本编译测试。

### Metadata
- Reproducible: yes
- Related Files: scripts/build-job-skill-shelver-298-rejected-replacement-targeted-v3.mjs, scripts/__tests__/job-skill-shelver-298-rejected-replacement-targeted-v3.test.mjs

### Resolution
- **Resolved**: 2026-07-22T10:32:20+08:00
- **Commit/PR**: none
- **Notes**: 将审核页外层模板改为 `String.raw`，保留生成后内联 JavaScript 所需的换行转义；7项专项测试随后全部通过。

---

## [ERR-20260721-B12] overlapping-full-test-timeout

**Logged**: 2026-07-21T11:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
并行验证中的全量测试输出尚未完整回收时又启动了一次 `npm test`，两个重型数据库内容包测试资源竞争，使第二次运行在30秒测试上限处超时。

### Error
```
database content pack > syncs idempotently, detects drift, and creates a pre-reset backup
Test timed out in 30000ms.
```

### Context
- 其余70个测试文件、807项测试通过；失败为超时而非断言错误。
- 该测试此前通常接近30秒，不应与另一轮全量测试重叠运行。

### Suggested Fix
等待统一执行会话明确结束；数据库内容包测试单独回归。若无并行负载时仍稳定超过30秒，则按当前合同工作量调整该集成测试时限，不修改断言。

### Metadata
- Reproducible: yes under overlapping runs
- Related Files: scripts/__tests__/database-content-pack.test.mjs

### Resolution
- **Resolved**: 2026-07-21T11:01:00+08:00
- **Commit/PR**: none
- **Notes**: 无并行负载时两次均约52秒完成，确认阶段四合同校验已使30秒上限过短；把迁移账本检查拆到独立测试文件，并将重型阶段时限调整为90秒。最终 `npm test` 为72文件/811测试通过，无worker通信错误，未修改或跳过任何断言。

---

## [ERR-20260721-A11] vitest-nested-execfile-eperm

**Logged**: 2026-07-21T09:45:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
专项测试在 Vitest worker 内用 `execFileSync` 做正向重复检查时返回 `EPERM`，而同文件的 `spawnSync` 负向检查和外层合同命令均可运行。

### Error
```
spawnSync /home/maoea/.nvm/versions/node/v24.14.1/bin/node EPERM
```

### Context
- Command/operation attempted: Vitest 内再次同步启动 Node 执行 `--check`。
- 业务脚本在外层直接执行成功，产物内容断言和两个负向子进程测试也成功。

### Suggested Fix
正向测试直接断言已生成的确定性产物；脚本 `--check` 由独立 npm 合同命令覆盖，避免在同一测试中重复嵌套启动进程。

### Metadata
- Reproducible: unknown
- Related Files: scripts/__tests__/job-skill-shelver-298-rejected-reconsideration.test.mjs

### Resolution
- **Resolved**: 2026-07-21T09:46:00+08:00
- **Commit/PR**: none
- **Notes**: 删除冗余的正向嵌套子进程；保留产物结构断言、漂移拒绝和源快照漂移拒绝测试。

---

## [ERR-20260720-P4R] parallel-generated-json-write-race

**Logged**: 2026-07-20T22:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
全量 Vitest 并行执行阶段一重建测试和阶段二交付锁测试时，直接覆盖生成的 authority JSON 会让另一个测试短暂读到空文件。

### Error
```
delivery lock source authority sha256 unexpectedly became SHA-256(empty)
```

### Context
- Command: `npm test`
- 单独或顺序执行均通过；仅并行读写同一生成产物时出现。
- Related generator: `scripts/build-job-skill-shelver-298-authority.mjs`

### Suggested Fix
生成权威文件时先写同目录临时文件，再原子 rename 到目标路径；所有可被并行测试读取的确定性产物沿用该模式。

### Metadata
- Reproducible: yes
- Related Files: scripts/build-job-skill-shelver-298-authority.mjs, scripts/__tests__/job-skill-shelver-delivery-lock.test.mjs

### Resolution
- **Resolved**: 2026-07-20T22:02:00+08:00
- **Commit/PR**: none
- **Notes**: authority生成器改为同目录临时文件写入后原子rename；并行重跑阶段一、阶段二和文档索引测试共16项通过。

---

## [ERR-20260720-G52] v5-editorial-index-overwrote-question-id

**Logged**: 2026-07-20T19:35:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
V5 构建器为按 V4 前驱建立索引时覆盖了临时记录的 `question_id`，校验函数误把 V4 ID 与门禁要求的 V5 ID 比较。

### Error
```
Error: M1_OP_037_V4 does not match V4 gate next_question_id
```

### Context
- Operation attempted: `npm run contract:job-skill:v5:build`
- 校验在写出任何 V5 候选或复审包之前失败。

### Suggested Fix
临时索引记录同时保留 `previous_question_id` 作为索引键和 `editorial_question_id` 作为原始 V5 ID；版本链校验使用后者。

### Metadata
- Reproducible: yes
- Related Files: scripts/build-job-skill-shelver-298-targeted-v5.mjs

### Resolution
- **Resolved**: 2026-07-20T19:36:00+08:00
- **Commit/PR**: none
- **Notes**: 校验改为比较保留的 `editorial_question_id`，随后重跑确定性构建。

---

## [ERR-20260720-E30] targeted-v3-preserved-count

**Logged**: 2026-07-20T15:02:00+08:00
**Priority**: low
**Status**: resolved
**Area**: data

### Summary
阶段三首次构建把保留V2的66道全部假设为已有delivery lock，遗漏1道无需语义修改但也没有图片合同的审核标记分歧题。

### Error
```
Error: Expected 66 delivery-only returns, received 65
```

### Resolution
将集合准确命名为“无语义变化而保留V2”，允许其中包含65道交付绑定题和1道审核标记假阳性；生成器和测试固定66/145分流。

---

## [ERR-20260720-P2G] handoff_patch_and_shell_quote

**Logged**: 2026-07-20T14:43:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
收尾说明补丁把列表标题误写成一级标题，随后 shell 检索命令中的反引号未转义。

### Error
```
apply_patch verification failed: Failed to find expected lines in .continue-here.md
/bin/bash: unexpected EOF while looking for matching ``'
```

### Context
- `.continue-here.md` 的“本轮验证”位于列表内
- shell 双引号中的 Markdown 反引号触发命令替换解析

### Suggested Fix
按实际列表上下文应用补丁；检索包含反引号的文本时避免 shell 双引号。

### Metadata
- Reproducible: yes
- Related Files: .continue-here.md

### Resolution
- **Resolved**: 2026-07-20T14:43:00+08:00
- **Commit/PR**: working tree
- **Notes**: 已读取实际上下文并改用精确补丁。

---

## [ERR-20260720-P2F] offline_setup_type_narrowing

**Logged**: 2026-07-20T14:41:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
`offline_setup` 运行时校验通过测试，但 TypeScript 未保留循环后的属性缩窄。

### Error
```
TS18046: 'input.offline_setup.item_ids' is of type 'unknown'
```

### Context
- `isRecord` 只把对象缩窄为 `Record<string, unknown>`
- 循环中校验数组后，再次从原对象访问字段仍是 `unknown`

### Suggested Fix
使用局部 `offlineSetup` 和 `itemIds` 变量，在同一控制流中完成类型验证和长度检查。

### Metadata
- Reproducible: yes
- Related Files: src/main/utils/validate-content-json.ts

### Resolution
- **Resolved**: 2026-07-20T14:41:00+08:00
- **Commit/PR**: working tree
- **Notes**: 已改为局部变量缩窄，不改变运行时校验语义。

---

## [ERR-20260720-P2E] rereview_schema_status_drift

**Logged**: 2026-07-20T14:50:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tests

### Summary
阶段二专测暴露两份阶段一复审 Schema 的 status 常量与实际 JSON 再次漂移。

### Error
```
$.status must equal "SUBMITTED_REVIEWER_EXPORT"
```

### Context
- 实际结果由人工 Markdown 原件接收，JSON 状态为 `INGESTED_REVIEWER_MARKDOWN`
- Schema 错误地要求审核页面直接导出的 `SUBMITTED_REVIEWER_EXPORT`

### Suggested Fix
恢复 Schema 的准确接收状态，并继续由来源 hash 区分原始审核证据。

### Metadata
- Reproducible: yes
- Related Files: doc/features/job-skill-shelver-298-semantic-change-content-rereview-result-v1.schema.json, doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-v1.schema.json

### Resolution
- **Resolved**: 2026-07-20T14:50:00+08:00
- **Commit/PR**: working tree
- **Notes**: 根因是审核包构建器覆盖已接收结果 Schema；已移除该写入并增加 Schema hash 回归断言，两份 Schema 恢复为 `INGESTED_REVIEWER_MARKDOWN`，不改审核结论。

---

## [ERR-20260720-P2D] delivery_date_classifier

**Logged**: 2026-07-20T14:45:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: data

### Summary
首次构建只按非 Pilot 的材料要求短语识别日期题，漏掉 Pilot 的 `M3_OP_043_V2`。

### Error
```
[delivery-contract] expected 20 date questions, found 19
```

### Context
- 19 道非 Pilot 日期题含统一的“固定模拟工作日”材料要求
- Pilot `M3_OP_043_V2` 的日期合同直接写在题干和 sealed config 中

### Suggested Fix
日期题分类同时读取材料要求和题干中的固定模拟日期，不依赖单一审核模板短语。

### Metadata
- Reproducible: yes
- Related Files: scripts/lib/job-skill-delivery-contract.mjs, doc/features/job-skill-shelver-pilot-revision-candidates-v3.json

### Resolution
- **Resolved**: 2026-07-20T14:45:00+08:00
- **Commit/PR**: working tree
- **Notes**: 分类器已覆盖 Pilot 固定模拟日期题，固定断言仍为20。

---

## [ERR-20260720-P2C] apply_patch_context

**Logged**: 2026-07-20T14:35:00+08:00
**Priority**: low
**Status**: resolved
**Area**: backend

### Summary
为线下 setup 校验补测试时，补丁中的测试文件上下文与实际文件不一致。

### Error
```
apply_patch verification failed: Failed to find expected lines in validate-content-json.test.ts
```

### Context
- 类型和校验器改动与测试改动放在同一补丁，整块未应用

### Suggested Fix
先读取测试文件实际 describe 结构，再分文件应用小补丁。

### Metadata
- Reproducible: yes
- Related Files: src/shared/types/json-schemas.ts, src/main/utils/validate-content-json.ts, src/main/utils/__tests__/validate-content-json.test.ts

### Resolution
- **Resolved**: 2026-07-20T14:35:00+08:00
- **Commit/PR**: working tree
- **Notes**: 已改为分文件补丁，不保留半应用状态。

---

## [ERR-20260720-P2A] phase_2_source_inspection

**Logged**: 2026-07-20T14:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: docs

### Summary
阶段二首次读取采购规范时使用了错误的仓库相对路径。

### Error
```
sed: can't read reference/offline-toolkit-procurement-spec.md: No such file or directory
```

### Context
- 实际文件位于 `doc/reference/offline-toolkit-procurement-spec.md`
- 用户早先省略了 `doc/` 前缀，仓库文件搜索随后确认了正确位置

### Suggested Fix
涉及用户提供的相对路径时先用 `rg --files` 核对实际位置。

### Metadata
- Reproducible: yes
- Related Files: doc/reference/offline-toolkit-procurement-spec.md

### Resolution
- **Resolved**: 2026-07-20T14:00:00+08:00
- **Commit/PR**: working tree
- **Notes**: 已改用正确路径继续读取，未影响任何文件。

---

## [ERR-20260720-P2B] candidate_shape_probe

**Logged**: 2026-07-20T14:02:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
临时数据探针误把候选数组字段写成 `candidates`，并误判逐题字段结构。

### Error
```
TypeError: Cannot read properties of undefined (reading '0')
TypeError: Cannot read properties of undefined (reading 'question_type')
```

### Context
- 文件顶层数组实际为 `questions`
- 候选题字段实际为 `question_type` 和 `proposed_question`，不是 `candidate.*`

### Suggested Fix
先打印顶层 keys 和单条记录，再编写批量分析探针。

### Metadata
- Reproducible: yes
- Related Files: doc/features/job-skill-shelver-298-question-revision-candidates-v1.json

### Resolution
- **Resolved**: 2026-07-20T14:02:00+08:00
- **Commit/PR**: working tree
- **Notes**: 已按实际结构复算 89/68/13 三组题目。

---

## [ERR-20260720-A3F] request_user_input-default-mode-unavailable

**Logged**: 2026-07-20T12:48:41+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
Default collaboration mode exposed `request_user_input` metadata but rejected the call at runtime.

### Error
```
request_user_input is unavailable in Default mode
```

### Context
- Operation attempted: confirm the `learn` skill analysis mode with a 60-second auto-resolution.
- Environment: Codex Default collaboration mode.
- Fallback: proceeded with the recommended Quick Reference mode stated in commentary.

### Suggested Fix
Treat the active collaboration-mode instruction as authoritative and skip `request_user_input` in Default mode even when the tool appears in the available-tool catalog.

### Metadata
- Reproducible: yes
- Related Files: none

---

## [ERR-20260720-001] shell-rg-markdown-backtick-pattern

**Logged**: 2026-07-20T11:11:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
用双引号包裹 `rg` 搜索模式时，模式里的 Markdown 反引号被 shell 当作命令替换执行。

### Error
```
/bin/bash: line 1: candidate_record_hash: command not found
```

### Context
- Command/operation attempted: 扫描 `.continue-here.md` 和 `doc/会话启动.md` 是否残留旧下一步表述。
- Root cause: 搜索模式含有反引号，外层使用了双引号。

### Suggested Fix
搜索包含 Markdown 反引号的文本时使用单引号包裹模式，或改用脚本读取文件再做字符串包含检查。

### Metadata
- Reproducible: yes
- Related Files: .continue-here.md, doc/会话启动.md

### Resolution
- **Resolved**: 2026-07-20T11:11:00+08:00
- **Commit/PR**: none
- **Notes**: 使用单引号重跑后无旧表述匹配；该 `rg` 无匹配时返回 1 属预期。

---

## [ERR-20260714-012] node-spawnsync-sandbox-eperm-with-zero-status

**Logged**: 2026-07-14T18:36:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
受控沙箱中 Node 24 的 `execFileSync('sqlite3', ...)` 在子进程成功时仍抛出伪 EPERM；错误对象同时包含 `status: 0` 和正确 stdout。

### Error
```
Error: spawnSync sqlite3 EPERM
status: 0
stdout: '1\n'
```

### Context
- 最小命令：sqlite3 通过 `.read` 执行 `select 1;`
- 直接 shell sqlite3 返回 1，Vitest 内执行也通过，仅 Node direct CLI + 沙箱组合产生伪 error 字段。

### Suggested Fix
SQLite CLI 统一使用 `spawnSync`，以 `status` 为首要判据；`status === 0` 时忽略伴随的沙箱 error 字段，非零退出和 ENOENT 仍正常抛错。

### Metadata
- Reproducible: yes, sandbox direct CLI
- Related Files: scripts/lib/sqlite-cli.mjs

### Resolution
- **Resolved**: 2026-07-14T18:37:00+08:00
- **Commit/PR**: pending
- **Notes**: 新增 `runSqliteCommand` 统一包装，并接入 db:sync/db:verify 与一次性 seed 工具。

---

## [ERR-20260719-016] playwright-chromium-sandbox-host-denied

**Logged**: 2026-07-19T12:34:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
受限沙箱阻止 Chromium sandbox host 启动，静态题库查看器的视觉测试未能在默认权限下运行。

### Error
```
FATAL sandbox_host_linux.cc: Check failed: shutdown: Operation not permitted
```

### Context
- Playwright 已带 `--no-sandbox`，仍被外层执行沙箱阻止浏览器进程初始化。
- HTML 生成已完成，失败发生在浏览器启动前。

### Suggested Fix
在获批的非沙箱执行环境中重跑同一只读 Playwright 脚本。

### Metadata
- Reproducible: yes
- Related Files: doc/reference/question-bank-viewer.html

### Resolution
- **Resolved**: 2026-07-19T12:41:00+08:00
- **Commit/PR**: none
- **Notes**: 在获批的非沙箱环境完成桌面和375px复验；24题Pilot区、394题来源区、7条历史替代标记均正确，无横向溢出或控制台错误。

---

## [ERR-20260719-015] scoring-test-dropped-only-active-freeze-trigger

**Logged**: 2026-07-19T12:31:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
线下详情测试为夹具注入完整内容时只关闭 ACTIVE 冻结触发器，仍被“已被会话引用”冻结触发器阻断。

### Error
```
referenced question semantic fields are frozen; create a superseding question instead
```

### Context
- 测试先创建会话，再更新该会话引用的题库夹具。
- 生产规则正确，失败仅来自测试注入顺序。

### Suggested Fix
专用测试在更新夹具前同时关闭 ACTIVE 与 referenced 两个不可变触发器；生产代码不改。

### Metadata
- Reproducible: yes
- Related Files: src/main/ipc/handlers/__tests__/job-skill-scoring.test.ts

### Resolution
- **Resolved**: 2026-07-19T12:31:00+08:00
- **Commit/PR**: none
- **Notes**: 测试显式关闭两个语义冻结触发器。

---

## [ERR-20260719-014] visual-doc-title-assumption

**Logged**: 2026-07-19T12:28:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
给视觉生产文档增加题目权威入口时，按文件名猜测了其中两个Markdown标题，组合补丁被安全拒绝。

### Error
```
apply_patch verification failed: Failed to find expected lines
```

### Context
- 实际标题分别为“逐资产 Prompt 编译新会话指南”和“Seedance 视频资产生产 SOP”。
- apply_patch 未产生部分写入。

### Suggested Fix
修改文档前读取每个文件首行，使用实际标题作为上下文。

### Metadata
- Reproducible: yes
- Related Files: doc/features/visual-asset-prompt-compilation-session-guide.md, doc/features/visual-asset-video-production-sop.md

### Resolution
- **Resolved**: 2026-07-19T12:28:00+08:00
- **Commit/PR**: none
- **Notes**: 使用实际标题重新应用小补丁。

---

## [ERR-20260719-013] doc-index-context-drift

**Logged**: 2026-07-19T12:24:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
更新 `doc/index.md` 人工导航时，组合补丁中的一处上下文与当前并行修改不完全一致，补丁被安全拒绝。

### Error
```
apply_patch verification failed: Failed to find expected lines
```

### Context
- 工作区已有未提交的 `doc/index.md` 修改。
- apply_patch 未产生部分写入。

### Suggested Fix
重新读取目标段落，按当前精确文本拆成小补丁，保留已有导航内容。

### Metadata
- Reproducible: no
- Related Files: doc/index.md

### Resolution
- **Resolved**: 2026-07-19T12:24:00+08:00
- **Commit/PR**: none
- **Notes**: 改用精确上下文小补丁。

---

## [ERR-20260719-012] offline-candidate-hash-mutated-by-status-note

**Logged**: 2026-07-19T12:18:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
首次生成 v3 时给6道离线候选增加了渲染状态文字，导致记录内容与保留的 v2 candidate hash 不一致。

### Error
```
expected preserved candidate hash to equal canonical v3 record hash
```

### Context
- 修复稿明确6道离线题的数据合同和 hash 必须完全不变。
- 渲染修复状态属于 manifest 门禁信息，不属于候选题记录。

### Suggested Fix
离线候选对象原样复用 v2；把 renderer 实现状态写入 manifest 顶层，不写入候选记录。

### Metadata
- Reproducible: yes
- Related Files: scripts/build-job-skill-shelver-revision-v3.mjs

### Resolution
- **Resolved**: 2026-07-19T12:18:00+08:00
- **Commit/PR**: none
- **Notes**: v3 生成器现原样复用6道离线候选，渲染状态转移到 manifest.renderer_fix。

---

## [ERR-20260719-011] scoring-criteria-closure-narrowing

**Logged**: 2026-07-19T12:12:00+08:00
**Priority**: low
**Status**: resolved
**Area**: backend

### Summary
TypeScript 不会把对象的 `unknown` 属性在嵌套回调中持续窄化为数组。

### Error
```
job-skill-scoring.ts: 'scoring.criteria' is of type 'unknown'
```

### Context
- `Array.isArray(scoring.criteria)` 后，在内部 `build` 回调中再次访问该对象属性。

### Suggested Fix
先把已窄化结果保存到局部常量，再在嵌套回调中使用。

### Metadata
- Reproducible: yes
- Related Files: src/main/ipc/handlers/job-skill-scoring.ts

### Resolution
- **Resolved**: 2026-07-19T12:12:00+08:00
- **Commit/PR**: none
- **Notes**: 使用 `scoringCriteria` 局部数组。

---

## [ERR-20260719-010] job-skill-scoring-view-wrong-path

**Logged**: 2026-07-19T11:45:00+08:00
**Priority**: low
**Status**: resolved
**Area**: frontend

### Summary
首次读取离线评分界面时遗漏了 `teacher/` 子目录，导致 `sed` 找不到文件。

### Error
```
sed: can't read src/renderer/src/views/JobSkillScoringView.vue: No such file or directory
```

### Context
- `rg` 已显示正确路径为 `src/renderer/src/views/teacher/JobSkillScoringView.vue`。
- 不影响项目文件，仅影响首次读取命令。

### Suggested Fix
读取前优先使用 `rg --files` 返回的完整路径，不根据组件名猜目录。

### Metadata
- Reproducible: yes
- Related Files: src/renderer/src/views/teacher/JobSkillScoringView.vue

### Resolution
- **Resolved**: 2026-07-19T11:45:00+08:00
- **Commit/PR**: none
- **Notes**: 后续使用正确路径读取。

---

## [ERR-20260719-009] safety-review-doc-index-stale

**Logged**: 2026-07-19T11:34:00+08:00
**Priority**: low
**Status**: pending
**Area**: docs

### Summary
新增安全与技术审核结论和结果文件后，文档自动索引尚未同步。

### Error
```
[doc-index] doc/index.md is stale; run npm run docs:index:update
```

### Context
- Command/operation attempted: `npm run docs:index:check`
- 新文件：安全与技术审核 Markdown 结论和 JSON 结果。

### Suggested Fix
后续正式接收审核结果并更新门禁状态时，运行 `npm run docs:index:update`，随后再次运行 `npm run docs:index:check`。

### Metadata
- Reproducible: yes
- Related Files: doc/index.md, doc/features/job-skill-shelver-pilot-safety-technical-review-conclusion-2026-07-19.md, doc/features/job-skill-shelver-pilot-safety-technical-review-result-2026-07-19.json

---

## [ERR-20260719-008] ad-hoc-json-schema-validator-null-branch

**Logged**: 2026-07-19T11:30:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
临时 JSON Schema 递归检查器未处理 schema 空分支，校验安全与技术审核结果时自身抛出 TypeError。

### Error
```
TypeError: Cannot read properties of undefined (reading 'const')
```

### Context
- 尝试校验 `job-skill-shelver-pilot-safety-technical-review-result-2026-07-19.json`。
- 失败来自临时检查器对未定义子 schema 缺少保护，不代表审核 JSON 不合法。

### Suggested Fix
优先使用仓库已安装的 Ajv；当前 Ajv v6 校验声明为 2020-12 的合同时，需在校验副本中移除 `$schema` 元模式声明后执行本合同所用约束。若必须使用临时递归检查器，应先处理布尔 schema、空 schema 与未定义 `items`。

### Metadata
- Reproducible: yes
- Related Files: doc/features/job-skill-shelver-pilot-safety-technical-review-result-v1.schema.json

### Resolution
- **Resolved**: 2026-07-19T11:30:00+08:00
- **Commit/PR**: none
- **Notes**: Ajv v6 不能加载 2020-12 元模式；在不修改原合同的情况下，仅从内存校验副本移除 `$schema` 后校验通过。

---

## [ERR-20260719-007] imagemagick-screenshot-crop

**Logged**: 2026-07-19T10:40:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
视觉验收尝试用 ImageMagick 裁剪全页截图，但当前环境未安装 `identify` 和 `convert`。

### Error
```
/bin/bash: identify: command not found
```

### Context
- 目的：从超长全页截图提取桌面和手机首屏。
- 影响：未修改项目文件，改由 Playwright 直接生成 viewport 截图。

### Suggested Fix
视觉测试直接同时输出全页截图和 viewport 截图，不依赖额外图片处理工具。

### Metadata
- Reproducible: yes
- Related Files: .tmp-safety-tech-packet-test.py

### Resolution
- **Resolved**: 2026-07-19T10:40:00+08:00
- **Commit/PR**: none
- **Notes**: Playwright 已直接输出 1280x900 和 375x812 首屏截图。

---

## [ERR-20260719-006] review-packet-import-save-order

**Logged**: 2026-07-19T10:38:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
安全与技术审核包导入 JSON 后，通用保存函数从空日期输入框回读并覆盖导入日期。

### Error
```
导入后 reviewed_date 为空，进度恢复但日期未恢复。
```

### Context
- 操作：导出完整结果，清空 localStorage，再导入同一 JSON。
- 根因：导入处理顺序为更新 state、save、render；save 在 render 前从空 DOM 输入框回读日期。

### Suggested Fix
导入时先 render 导入状态，再调用 save 持久化。

### Metadata
- Reproducible: yes
- Related Files: scripts/build-job-skill-shelver-review-pack-v2.mjs, doc/features/job-skill-shelver-pilot-safety-technical-review-packet-v2.html

### Resolution
- **Resolved**: 2026-07-19T10:38:00+08:00
- **Commit/PR**: none
- **Notes**: 调整为 render 后 save，真实 Chromium 导入复测通过。

---

## [ERR-20260719-005] review-packet-inline-script-escaping

**Logged**: 2026-07-19T10:36:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
HTML 生成器的模板字符串把内层 JavaScript 字符串中的换行转成真实换行，导致浏览器脚本语法错误。

### Error
```
SyntaxError: Invalid or unexpected token
```

### Context
- 操作：真实 Chromium 打开安全与技术审核包。
- 根因：生成器模板中的 `\\n` 转义层级不足，输出到单引号字符串后成为非法换行。

### Suggested Fix
生成后用 `vm.Script` 检查内嵌脚本语法，并为内层字符串保留字面量换行转义。

### Metadata
- Reproducible: yes
- Related Files: scripts/build-job-skill-shelver-review-pack-v2.mjs, doc/features/job-skill-shelver-pilot-safety-technical-review-packet-v2.html

### Resolution
- **Resolved**: 2026-07-19T10:36:00+08:00
- **Commit/PR**: none
- **Notes**: 修正双层转义，静态语法检查和真实 Chromium 均通过。

---

## [ERR-20260719-004] review-result-field-probe

**Logged**: 2026-07-19T10:12:56+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
审核结果探查命令误把题目数组字段假定为 `results`，实际字段为 `questions`。

### Error
```
jq: error: null (null) has no keys
```

### Context
- Command/operation attempted: 用 `jq` 查看审核结果摘要和首条记录结构。
- 输入文件: `doc/features/job-skill-shelver-pilot-content-review-result-2026-07-19.json`
- 影响: 只读命令失败，没有修改审核结果或项目文件。

### Suggested Fix
先读取顶层键和字段类型，再按 Schema 中的实际字段名执行校验。

### Metadata
- Reproducible: yes
- Related Files: doc/features/job-skill-shelver-pilot-content-review-result-2026-07-19.json

### Resolution
- **Resolved**: 2026-07-19T10:12:56+08:00
- **Commit/PR**: none
- **Notes**: 已读取顶层结构，后续校验统一使用 `questions` 字段。

---

## [ERR-20260719-003] review-packet-contract-check-shell

**Logged**: 2026-07-19T08:54:30+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
最终审核包合同检查中的 JavaScript 正则被 shell 转义破坏，且组合命令未启用失败即停。

### Error
```
SyntaxError: Invalid regular expression flags
```

### Context
- Command/operation attempted: 组合执行 HTML 数据提取、Schema 校验和禁用字符检查
- Root cause: heredoc 内正则出现多余反斜杠；前一段失败后 shell 继续执行，导致组合命令退出码仍为 0

### Suggested Fix
合同检查使用字符串边界提取内嵌 JSON，并在组合命令开头启用 `set -e`；不能只看最后一个子命令的退出码。

### Metadata
- Reproducible: yes
- Related Files: doc/features/job-skill-shelver-pilot-content-review-packet-v1.html
- See Also: ERR-20260719-002

### Resolution
- **Resolved**: 2026-07-19T08:55:00+08:00
- **Commit/PR**: none
- **Notes**: 已改为字符串边界提取并单独重跑合同校验。

---

## [ERR-20260719-002] playwright-chromium-sandbox

**Logged**: 2026-07-19T02:01:51+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
无头 Chromium 在受限沙箱内因浏览器 sandbox host 权限限制无法启动。

### Error
```
FATAL:content/browser/sandbox_host_linux.cc:41 Check failed: . shutdown: Operation not permitted (1)
```

### Context
- Command/operation attempted: `python3 .tmp-review-packet-test.py`
- Purpose: 验证静态 HTML 审核包的桌面、窄屏、表单和下载行为
- Environment: workspace-write 受限沙箱

### Suggested Fix
真实 Chromium 视觉和下载验证应在获批的非沙箱环境中运行；脚本语法与静态合同检查仍可留在沙箱内执行。

### Metadata
- Reproducible: yes
- Related Files: doc/features/job-skill-shelver-pilot-content-review-packet-v1.html
- See Also: ERR-20260719-001

### Resolution
- **Resolved**: 2026-07-19T02:02:00+08:00
- **Commit/PR**: none
- **Notes**: 获批后在沙箱外成功启动 Chromium，随后继续执行真实交互测试。

---

## [ERR-20260719-001] nested-sqlite3-spawn-sandbox

**Logged**: 2026-07-19T01:07:36+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
在 Node `child_process.execFileSync()` 内嵌套启动 `sqlite3` 做只读 manifest 复核时，被受限沙箱标记为 `EPERM`。

### Error
```
Error: spawnSync sqlite3 EPERM
```

### Context
- Command/operation attempted: Node 单行脚本通过 `execFileSync('sqlite3', ...)` 读取 `/tmp` 审核库
- Purpose: 复核 Pilot 24 题 manifest 与 strategy 集合及逐题 hash
- Environment: Codex workspace-write 受限沙箱；直接从 shell 调用 `sqlite3` 正常

### Suggested Fix
在该环境使用 shell 直接调用 `sqlite3`，把 JSON 输出通过管道交给 Node；避免 Node 再嵌套启动受限子进程。

### Metadata
- Reproducible: yes
- Related Files: doc/features/job-skill-shelver-pilot-activation-manifest-v1.json

### Resolution
- **Resolved**: 2026-07-19T01:07:36+08:00
- **Commit/PR**: none
- **Notes**: 改用 shell `sqlite3 | node` 的非嵌套验证方式。

---

## [ERR-20260714-011] node-execfilesync-sqlite-stdin-not-closed

**Logged**: 2026-07-14T18:33:00+08:00
**Priority**: high
**Status**: resolved
**Area**: database

### Summary
Node 24 direct CLI/PTY 环境下使用 `execFileSync('sqlite3', { input: sql })` 时 stdin 未关闭，sqlite3 与 Node 互相等待，数据库只留下 0 字节文件和 journal。

### Error
```
node: do_epoll_wait
sqlite3: unix_stream_read_generic
```

### Context
- `db:sync` 卡在首次完整 schema 加载。
- 最小 `select 1` 同样复现；sqlite3 等 stdin EOF，Node 等子进程退出。
- Vitest 子进程环境未复现，因此仅靠单元测试无法覆盖真实 CLI/PTY 边界。

### Suggested Fix
不通过 stdin 传大段 SQL；写入临时 `.sql` 文件后调用 sqlite3 `.read`，finally 删除临时目录。扫描并统一替换所有同形数据库运维脚本。

### Metadata
- Reproducible: yes, direct CLI/PTY
- Related Files: scripts/lib/sqlite-cli.mjs, scripts/lib/database-content-pack.mjs

### Resolution
- **Resolved**: 2026-07-14T18:35:00+08:00
- **Commit/PR**: pending
- **Notes**: 6 个 sqlite3 stdin 调用已统一迁移到 `executeSqliteScript`；卡住的会话均已终止。

---

## [ERR-20260714-010] vitest-timeout-under-parallel-build-load

**Logged**: 2026-07-14T18:27:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
全量 Vitest 与 typecheck、electron-vite build 同时运行时，两个既有 sql.js 用例超过默认 5 秒超时；隔离复跑 39 个相关测试全部通过。

### Error
```
Test timed out in 5000ms.
```

### Context
- Timed out: `assessment-emotion.test.ts` 1 例、`student-read.test.ts` 1 例
- 同一轮另有 600 个测试通过，两个失败均无断言差异。
- 隔离命令复跑后 39/39 通过，文件耗时分别 3.09s / 4.84s。

### Suggested Fix
资源密集型全量测试不要与 typecheck/build 并行；先并行跑静态检查，再单独跑完整 Vitest 套件。不要通过放宽业务测试超时掩盖验证调度问题。

### Metadata
- Reproducible: under parallel verification load
- Related Files: src/main/ipc/handlers/__tests__/assessment-emotion.test.ts, src/main/ipc/handlers/__tests__/student-read.test.ts

### Resolution
- **Resolved**: 2026-07-14T18:28:00+08:00
- **Commit/PR**: pending
- **Notes**: 隔离复跑全部通过；最终门禁改为无并行构建负载的全量测试。

---

## [ERR-20260714-009] sqlite-vacuum-into-cli-parameter-typing

**Logged**: 2026-07-14T18:22:00+08:00
**Priority**: low
**Status**: resolved
**Area**: database

### Summary
用 sqlite3 CLI 验证 `VACUUM INTO` 绑定参数时，把匿名参数设置成了非文本值，SQLite 拒绝文件名；改用显式文本参数后验证通过。

### Error
```
Error: stepping, non-text filename
```

### Context
- Command/operation attempted: `.parameter set ? <path>` 后执行 `VACUUM INTO ?`
- Cause: CLI `.parameter` 自动解释参数值，未将路径保留为 SQL 文本。

### Suggested Fix
CLI 使用带 SQL 引号的 `?1` 文本参数；应用内对受控备份路径做单引号转义后作为 `VACUUM INTO` 文件名字面量。

### Metadata
- Reproducible: yes
- Related Files: src/main/db/connection.ts, scripts/lib/database-content-pack.mjs

### Resolution
- **Resolved**: 2026-07-14T18:23:00+08:00
- **Commit/PR**: pending
- **Notes**: `?1` 文本参数验证成功；生产连接改用转义后的受控路径字面量。

---

## [ERR-20260714-008] sqlite-readonly-runtime-db-sandbox

**Logged**: 2026-07-14T17:32:11+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
在工作区沙箱内只读探测 WSL 用户数据目录中的 SQLite 运行库失败，提升为只读外部访问后成功。

### Error
```
Error: in prepare, unable to open database file (14)
```

### Context
- Command: `sqlite3 -readonly /home/maoea/.config/xc-career-guide/data/xc-career-guide.db ...`
- 数据库位于仓库工作区外，普通沙箱命令无法打开；文件本身存在且没有损坏。

### Suggested Fix
检查仓库外运行库时使用受控的只读权限提升，并保持 `-readonly`，不要为诊断复制或改写数据库。

### Metadata
- Reproducible: yes
- Related Files: src/main/db/connection.ts

### Resolution
- **Resolved**: 2026-07-14T17:32:11+08:00
- **Commit/PR**: pending
- **Notes**: 受控只读检查成功；数据库 `PRAGMA integrity_check` 返回 `ok`。

---

## [ERR-20260714-007] inline-node-shell-backticks

**Logged**: 2026-07-14T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
内联 Node 文档检查命令在双引号 shell 参数中包含 Markdown 反引号，导致 Bash 提前解析失败。

### Error
```
/bin/bash: unexpected EOF while looking for matching ``'
```

### Context
- Command: inline `node -e` PRD structure check
- Cause: shell 双引号未隔离 JavaScript 中的三个反引号。

### Suggested Fix
内联脚本使用 shell 单引号，并通过 `String.fromCharCode(96,96,96)` 表达 Markdown 围栏。

### Metadata
- Reproducible: yes
- Related Files: doc/specs/MVP_PRD_v1.0.9-authoritative.md

### Resolution
- **Resolved**: 2026-07-14T00:00:00+08:00
- **Commit/PR**: pending
- **Notes**: 已改用不含字面反引号的检查表达式。

---

## [ERR-20260714-005] prd-builder-template-literal-fence

**Logged**: 2026-07-14T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
一次性 PRD 合并脚本中的 Markdown 代码围栏未转义，导致 Node 把模板字符串提前结束。

### Error
```
SyntaxError: Unexpected identifier 'text'
```

### Context
- Command: `node /tmp/build-authoritative-prd.mjs`
- Cause: JavaScript template literal 内直接包含三个反引号。

### Suggested Fix
模板字符串内的 Markdown 围栏必须转义，或改用不含反引号的拼接方式。

### Metadata
- Reproducible: yes
- Related Files: doc/specs/MVP_PRD_v1.0.9-authoritative.md

### Resolution
- **Resolved**: 2026-07-14T00:00:00+08:00
- **Commit/PR**: pending
- **Notes**: 已转义代码围栏并重新运行生成脚本。

---

## [ERR-20260714-006] prd-builder-constant-order

**Logged**: 2026-07-14T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
PRD 合并脚本在模板常量初始化前调用了该常量，Node 抛出 temporal dead zone 错误。

### Error
```
ReferenceError: Cannot access 'scopeSection' before initialization
```

### Context
- Command: `node /tmp/build-authoritative-prd.mjs`
- Cause: `replaceSection()` 调用位于 `scopeSection` 和 `mainFlowSection` 声明之前。

### Suggested Fix
所有模板常量声明完成后再执行文档变换步骤，并在运行前使用 `node --check` 检查语法。

### Metadata
- Reproducible: yes
- Related Files: doc/specs/MVP_PRD_v1.0.9-authoritative.md

### Resolution
- **Resolved**: 2026-07-14T00:00:00+08:00
- **Commit/PR**: pending
- **Notes**: 已将调用移动到全部模板常量声明之后。

---

Command failures and integration errors.

---

## [ERR-20260714-004] vitest-pbkdf2-worker-contention

**Logged**: 2026-07-14T16:12:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
Full-suite Vitest runs intermittently timed out in PBKDF2-dependent tests when file workers saturated all 12 logical CPUs.

### Error
```
Test timed out in 5000ms.
```

### Context
- Failures appeared in password and auth fixtures that synchronously run 100,000 PBKDF2 iterations.
- The same 23 targeted tests passed in 1.2 seconds when isolated.
- Previous full-suite runs passed, indicating resource contention rather than assertion failure.

### Suggested Fix
Limit full-suite file workers instead of weakening assertions or increasing the per-test timeout.

### Metadata
- Reproducible: intermittent
- Related Files: package.json, src/main/utils/password.ts

### Resolution
- **Resolved**: 2026-07-14T16:13:00+08:00
- **Commit/PR**: pending
- **Notes**: `npm test` now uses `--maxWorkers=50%` to leave CPU headroom for synchronous password hashing.

---

## [ERR-20260714-003] doc-index-template-literal-syntax

**Logged**: 2026-07-14T16:10:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
The first doc index generator run failed because Markdown label backticks were nested directly inside a JavaScript template literal.

### Error
```
SyntaxError: Unexpected identifier '$'
```

### Context
- `markdownLink()` attempted to emit an inline-code Markdown label from an unescaped template literal.
- Node rejected the module before the generator could run.

### Suggested Fix
Use a plain Markdown link label or escape the inner backticks.

### Metadata
- Reproducible: yes
- Related Files: scripts/lib/doc-index.mjs

### Resolution
- **Resolved**: 2026-07-14T16:11:00+08:00
- **Commit/PR**: pending
- **Notes**: Generated links now use plain path labels.

---

## [ERR-20260714-002] schema-scoring-closure-nondeterministic-question

**Logged**: 2026-07-14T16:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
The schema scoring closure test selected an arbitrary question but always inserted it as an ONLINE session question.

### Error
```
assessment_session_question phase must match question_type and item_usage
```

### Context
- `SELECT question_id FROM question_bank LIMIT 1` could select an `OFFLINE_OPERATION` row.
- The fixture then inserted `question_phase='ONLINE'`, correctly rejected by the schema trigger.
- The failure depended on SQLite row selection and appeared only in some full-suite runs.

### Suggested Fix
Filter and order fixture queries so their selected question type matches the phase being tested.

### Metadata
- Reproducible: intermittent
- Related Files: src/main/db/__tests__/schema-scoring-closure.test.ts

### Resolution
- **Resolved**: 2026-07-14T16:01:00+08:00
- **Commit/PR**: pending
- **Notes**: The query now selects a deterministic non-OFFLINE_OPERATION question before inserting an ONLINE session question.

---

## [ERR-20260714-001] check-punctuation-multiple-files

**Logged**: 2026-07-14T15:49:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
The write skill punctuation checker accepts one file per invocation, not multiple file arguments.

### Error
```
check_punctuation.py: error: unrecognized arguments: <second-file> <third-file>
```

### Context
- Command attempted: `check-punctuation.sh --lang zh <file-1> <file-2> <file-3>`
- The wrapper forwards to a CLI with one positional `file` argument.

### Suggested Fix
Invoke the checker once per file or pipe one combined stream through stdin.

### Metadata
- Reproducible: yes
- Related Files: doc/features/visual-asset-video-production-sop.md, doc/features/visual-asset-prompt-compilation-session-guide.md

### Resolution
- **Resolved**: 2026-07-14T15:50:00+08:00
- **Commit/PR**: pending
- **Notes**: The checks were rerun separately for each document.

---

## [ERR-20260706-001] claude-mem-windows-bun-from-wsl-path

**Logged**: 2026-07-06T16:31:00+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary
Installing claude-mem from WSL started the worker with Windows Bun because WSL did not have a Linux Bun binary earlier in `PATH`.

### Error
```
command -v bun
/mnt/c/Users/maoea/AppData/Roaming/npm/bun

claude-mem health reported:
platform: win32
workerPath: \\wsl.localhost\Ubuntu\home\maoea\.claude\plugins\marketplaces\thedotmack\plugin\scripts\worker-service.cjs
```

### Context
- Command/operation attempted: `npx claude-mem install` followed by `npm run worker:start`
- Root cause: no WSL Linux Bun was installed, so `bun` resolved to Windows via `/mnt/c/...` in WSL `PATH`
- Result: worker used `C:\Users\maoea\.claude-mem\settings.json` instead of `/home/maoea/.claude-mem/settings.json`

### Suggested Fix
Install Linux Bun in WSL and ensure `command -v bun` points to a WSL path before starting claude-mem. Stop any Windows-side Bun worker left from the failed start.

### Metadata
- Reproducible: yes
- Related Files: /home/maoea/.claude-mem/settings.json, /home/maoea/.claude/plugins/marketplaces/thedotmack/plugin/scripts/worker-service.cjs

### Resolution
- **Resolved**: 2026-07-06T16:31:00+08:00
- **Commit/PR**: local environment change
- **Notes**: Stopped the Windows Bun worker, installed Linux Bun via WSL npm, confirmed `command -v bun` is `/home/maoea/.nvm/versions/node/v24.14.1/bin/bun`, and verified claude-mem worker health reports `platform: linux` on `127.0.0.1:37700`.

## [ERR-20260704-003] electron-vite-dynamic-require-local-module

**Logged**: 2026-07-04T12:18:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary
`npm run dev` 启动 Electron 主进程时报 `Cannot find module '../db/connection'`，原因是主进程 bundle 中残留了对本地模块的动态 require。

### Error
```
Error: Cannot find module '../db/connection'
Require stack:
- /home/maoea/projects/SVETS/out/main/index.js
```

### Context
- Command/operation attempted: `npm run dev`
- Source pattern: `src/main/protocol/app-asset.ts` 使用 `createRequire(import.meta.url)` 和字符串模块名 `../db/connection`
- Bundle result: electron-vite 无法静态分析该本地模块引用，`out/main/index.js` 运行时尝试解析不存在的相对路径

### Suggested Fix
主进程本地模块依赖使用静态 `import`，只对真正外部且运行时必须延迟加载的模块使用动态 require。

### Metadata
- Reproducible: yes
- Related Files: src/main/protocol/app-asset.ts, out/main/index.js

### Resolution
- **Resolved**: 2026-07-04T12:18:00+08:00
- **Commit/PR**: pending
- **Notes**: `app-asset.ts` 改为静态导入 `electron` 和 `../db/connection`；`npm run dev` 启动到 `[DB] Ready` 后未再出现该模块加载错误。

## [ERR-20260704-002] git-push-origin-permission-denied

**Logged**: 2026-07-04T11:05:00+08:00
**Priority**: high
**Status**: pending
**Area**: infra

### Summary
Pushing local `main` to `origin` failed because the authenticated GitHub identity does not have write permission to the configured repository.

### Error
```
ERROR: Permission to maoeaston/SVETS.git denied to maoeast.
fatal: Could not read from remote repository.
```

### Context
- Command/operation attempted: `git push origin main`
- Remote: `git@github.com:maoeaston/SVETS.git`
- Local state after failure: `main` is ahead of `origin/main` by 1 commit

### Suggested Fix
Use a GitHub SSH key/account with write access to `maoeaston/SVETS.git`, or update `origin` to the intended writable repository before pushing.

### Metadata
- Reproducible: yes
- Related Files: .git/config

---

## [ERR-20260704-001] better-sqlite3-vitest-abi

**Logged**: 2026-07-04T09:14:30+08:00
**Priority**: high
**Status**: pending
**Area**: tests

### Summary
Vitest 下直接用 `better-sqlite3` 建临时 DB 失败，Node ABI 与原生模块编译版本不匹配。

### Error
```
The module '/home/maoea/projects/SVETS/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using NODE_MODULE_VERSION 145.
This version of Node.js requires NODE_MODULE_VERSION 137.
```

### Context
- Command/operation attempted: `npm run test -- scripts/__tests__/review-question-bank-cli.test.mjs`
- Initial test approach: 在 Vitest 中直接 `new Database(dbPath)` 创建临时 SQLite 文件
- Environment detail: 当前 `vitest` 使用的 Node 版本与已安装 `better-sqlite3` 原生模块 ABI 不一致

### Suggested Fix
脚本测试优先使用 `sql.js` / `MemoryAdapter`，避免依赖 `better-sqlite3` 原生模块；若必须用原生模块，先重建依赖。

### Metadata
- Reproducible: yes
- Related Files: scripts/__tests__/review-question-bank-cli.test.mjs, scripts/review-question-bank.mjs

---
## [ERR-20260715-001] openai-docs-manual-dns-sandbox

**Logged**: 2026-07-15T16:51:00+08:00
**Priority**: low
**Status**: pending
**Area**: infra

### Summary
Codex 官方手册辅助脚本在受限诊断沙箱内无法解析 `developers.openai.com`。

### Error
```
curl: (6) Could not resolve host: developers.openai.com
```

### Context
- Command/operation attempted: `fetch-codex-manual.mjs`
- Purpose: 核对 Codex 启动配置语义
- Environment: WSL2 内受限 Codex 执行沙箱；本地诊断命令可正常运行

### Suggested Fix
需要官方文档时改用当前会话提供的官方文档读取能力，或在获批的网络环境中重试；不要把此沙箱 DNS 失败误判为用户终端的 Codex 启动根因。

### Metadata
- Reproducible: yes
- Related Files: none

---

## [ERR-20260715-002] wsl-interop-sandbox-forward-test

**Logged**: 2026-07-15T09:28:53+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
在受限沙箱内验证 WSL `cmd.exe` 转发分支时，Windows 互操作套接字被沙箱权限拦截。

### Error
```
WSL ERROR: UtilBindVsockAnyPort:309: socket failed 1
```

### Context
- Command/operation attempted: 通过 Codex WSL shim 转发普通 `cmd.exe /c echo` 命令
- Working directory: `/mnt/c/Windows/System32`
- Environment: WSL2 内受限 Codex 执行沙箱

### Suggested Fix
涉及真实 Windows 互操作的验证应在获批的非沙箱环境中重跑，并与 shim 自身逻辑失败区分。

### Metadata
- Reproducible: yes
- Related Files: none

### Resolution
- **Resolved**: 2026-07-15T09:28:53+08:00
- **Commit/PR**: none
- **Notes**: 在获批的非沙箱环境重跑成功，输出 `CODEX_SHIM_FORWARD_OK`，耗时 0.04 秒。

---

## [ERR-20260715-003] m3-assignment-test-fixture-unique-session

**Logged**: 2026-07-15T15:37:30+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
M3 assignment handler 负向测试中复用同一学生、taskCode 与 strategyType 创建第二条未终结 assessment，触发开放会话唯一索引。

### Error
```
UNIQUE constraint failed: assessment_session.student_id, assessment_session.task_code, assessment_session.strategy_type
```

### Context
- Command/operation attempted: `npm test -- src/main/db/__tests__/schema-m3-grant-assignment.test.ts src/main/ipc/handlers/__tests__/assignment.test.ts`
- Scenario: 同一测试用例中先创建并 release assignment，再调用 `seedPreparedSession()` 建第二条 assessment 验证 grant 过期路径。
- Root cause: release assignment 不终结 assessment session；同一学生同一 task/strategy 仍受开放会话唯一约束保护。

### Suggested Fix
测试需要同一学生创建第二条未终结 assessment 时，显式使用不同 `taskCode`；不要绕过 schema 唯一约束或关闭触发器。

### Metadata
- Reproducible: yes
- Related Files: src/main/ipc/handlers/__tests__/assignment.test.ts, src/main/db/test-helpers.ts

### Resolution
- **Resolved**: 2026-07-15T15:37:30+08:00
- **Commit/PR**: none
- **Notes**: 将第二条 fixture session 的 `taskCode` 改为测试内唯一值，focused tests 后续通过。

---

## [ERR-20260719-017] multi-file apply_patch move used generic Markdown context

**Logged**: 2026-07-19T12:45:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
归档多个异构文档时，用通用 `#` 作为 move 补丁上下文，因实际标题行不同导致整批补丁原子失败。

### Resolution
先读取每个文件的准确首行，再以实际首行作为 move 上下文；批量移动前不要假设 Markdown 标题文本。

---

## [ERR-20260720-B7C] functions-exec-parallel-read-syntax

**Logged**: 2026-07-20T13:02:26+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
并行读取三个技能文件时，`Promise.all` 调用缺少右括号导致脚本解析失败。

### Error
```
SyntaxError: missing ) after argument list
```

### Context
- Operation attempted: parallel `sed` reads through `functions.exec`.
- No project command ran and no project file was touched.

### Suggested Fix
提交多调用 JavaScript 前检查 `Promise.all([...])`、数组和语句结尾括号配对。

### Metadata
- Reproducible: yes
- Related Files: none

### Resolution
- **Resolved**: 2026-07-20T13:02:26+08:00
- **Commit/PR**: none
- **Notes**: 修正括号后立即重试成功。

---

## [ERR-20260720-C41] local-audit-command-assumptions

**Logged**: 2026-07-20T13:18:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
本地审计命令先后错误假设 JSON 顶层键为 `candidates`，并把含 `|` 的正则通过未转义 shell 字符串执行，导致两次只读查询失败。

### Resolution
先读取 JSON 顶层键，确认候选数组实际为 `questions`；shell 正则整体使用单引号。后续查询成功，未修改项目数据。

---

## [ERR-20260720-D8A] forked-explorer-parameter-conflict

**Logged**: 2026-07-20T14:05:00+08:00
**Priority**: low
**Status**: resolved
**Area**: orchestration

### Summary
首次派发只读子智能体时同时指定 `fork_context=true` 和 `agent_type=explorer`，工具拒绝该组合。

### Resolution
改为不分叉完整上下文的独立 explorer，并在任务文本中提供工作区、文件范围和输出要求；三个任务随后完成且未修改文件。

---

## [ERR-20260720-F64] full-test-before-doc-index-update

**Logged**: 2026-07-20T17:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
新增V4复审接收台账后，在运行文档索引更新前先执行全量测试，导致唯一的文档索引同步测试失败。

### Error
```
doc/index.md 与当前文件系统清单同步：expected current index to include job-skill-shelver-298-targeted-v4-rereview-ledger-v1.md
```

### Context
- Command/operation attempted: `npm test`
- 业务、合同和其余738项测试均通过；失败只反映新增Markdown尚未进入自动索引。

### Suggested Fix
新增、移动、重命名或归档 `doc/` 文档后，先运行 `npm run docs:index:update`，再执行依赖索引同步的全量测试。

### Metadata
- Reproducible: yes
- Related Files: doc/index.md, doc/features/job-skill-shelver-298-targeted-v4-rereview-ledger-v1.md

### Resolution
- **Resolved**: 2026-07-20T17:20:00+08:00
- **Commit/PR**: none
- **Notes**: 随即按项目流程更新并检查文档索引，然后重跑全量测试。

---

## [ERR-20260722-A51] asset-manifest-authority-hash-order

**Logged**: 2026-07-22T16:17:01+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
重建 `asset-manifest.json` 后立即运行 `npm run asset:validate`，校验器发现 manifest 记录的运行时权威与交付锁 SHA-256 已过期。

### Error
```
[asset-manifest] ERROR manifest.question_authority.job_skill_runtime_authority_sha256 is stale for doc/features/job-skill-shelver-runtime-authority-v1.json
[asset-manifest] ERROR manifest.question_authority.delivery_lock_sha256 is stale for doc/features/job-skill-shelver-question-delivery-lock-v1.json
```

### Context
- Command/operation attempted: `npm run asset:validate`
- Input state: `asset-manifest.json` 刚由 `npm run asset:manifest:build -- --force` 生成。
- 当前交付锁也引用 `asset-manifest.json`，因此 hash 生成顺序必须收敛，不能只重建其中一个文件。

### Suggested Fix
让素材 manifest 引用稳定的权威路径和状态，不记录会循环变化的 delivery lock 文件 hash；重建 manifest 后再重建 delivery lock。

### Metadata
- Reproducible: yes
- Related Files: doc/assets/asset-manifest.json, doc/features/job-skill-shelver-question-delivery-lock-v1.json, scripts/build-visual-asset-manifest.mjs, scripts/lib/visual-asset-manifest.mjs

### Resolution
- **Resolved**: 2026-07-22T16:31:23+08:00
- **Commit/PR**: none
- **Notes**: manifest 的 `question_authority` 保留路径和状态，不记录 delivery lock hash；按 `asset:manifest:build` → `contract:job-skill:delivery:build` 顺序重建后，asset/delivery 校验通过。

---

## [ERR-20260722-B17] missing-sha-helper-in-manifest-builder

**Logged**: 2026-07-22T16:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
为 `asset-manifest.json` 补运行时权威 SHA-256 字段后，生成器调用了未定义的 `sha256File()` helper。

### Error
```
ReferenceError: sha256File is not defined
```

### Context
- Command/operation attempted: `npm run asset:manifest:build -- --force`
- Input state: `scripts/build-visual-asset-manifest.mjs` 已新增 `job_skill_runtime_authority_sha256` 输出字段。

### Suggested Fix
新增合同字段时先确认是否会形成循环依赖；如果字段不应进入最终合同，删除字段而不是补 helper。

### Metadata
- Reproducible: yes
- Related Files: scripts/build-visual-asset-manifest.mjs

### Resolution
- **Resolved**: 2026-07-22T16:20:00+08:00
- **Commit/PR**: none
- **Notes**: 最终未保留该 hash 字段；生成器回到路径和状态引用，避免额外 helper 与循环 hash。

---

## [ERR-20260722-C39] visual-plan-stale-answer-contracts

**Logged**: 2026-07-22T16:31:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: docs

### Summary
升级 `asset-manifest.json` 到当前 298 题运行权威时，部分视觉计划仍保留旧题目的正确/错误答案，导致素材合同生成失败。

### Error
```
asset_vid_a_11_m1_tf_025: expected_answer true differs from question M1_TF_025 (false)
```

### Context
- Command/operation attempted: `node scripts/build-visual-asset-manifest.mjs --force`
- 后续排查共发现 6 个视觉计划行的动作描述和答案仍按旧题版本理解。

### Suggested Fix
素材 manifest 生成器应以当前保留题的最终 `expectedAnswer()` 为准；视觉总计划要同步更新那些已被 V4/V6 修订改写语义的题目。

### Metadata
- Reproducible: yes
- Related Files: doc/reference/visual-asset-master-plan.md, scripts/build-visual-asset-manifest.mjs, doc/assets/asset-manifest.json

### Resolution
- **Resolved**: 2026-07-22T16:31:00+08:00
- **Commit/PR**: none
- **Notes**: 生成器改为从当前保留题读取答案；6 个旧答案计划行已对齐，manifest 重建通过。

---

## [ERR-20260722-D62] final-question-version-dropped-delivery-materials

**Logged**: 2026-07-22T16:38:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: docs

### Summary
交付锁切到最终 V4/V6 题目版本后，部分最终候选记录没有携带旧版 `material_requirement`，导致答案图等交付分组数量下降。

### Error
```
Expected 13 image questions, found 9
```

### Context
- Command/operation attempted: `npm run contract:job-skill:delivery:build`
- 根因是内容版本和交付素材需求来自不同层：最终题干/答案应取最新通过候选，交付材料需求仍需继承旧运行权威中的要求。

### Suggested Fix
在 `loadRetainedQuestions()` 合并最终候选时保留 base effective 题目的 `material_requirement`，只覆盖题干、答案和当前题号等内容字段。

### Metadata
- Reproducible: yes
- Related Files: scripts/lib/job-skill-delivery-contract.mjs, scripts/build-job-skill-shelver-delivery-lock.mjs

### Resolution
- **Resolved**: 2026-07-22T16:38:00+08:00
- **Commit/PR**: none
- **Notes**: 最终候选合并时继承 base material requirement；交付锁恢复为 181 条题目交付锁与 100 条线下工具准备项。

---

## [ERR-20260722-C33] database-content-pack-pinned-hash-drift

**Logged**: 2026-07-22T16:33:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
素材合同、交付锁和阶段四运行时权威重建后，全量测试因内容包配置仍钉住旧 runtime authority 文件 hash 而失败。

### Error
```
runtime authority 文件哈希漂移：sha256:bfb45baf9781e6a9d307c49be6412b456bb49c285597fca03409829f5a093dc2 != sha256:11965f2bd4760bcbdcf94c9341ed73c2af76cbb2425df9634a3d19b3361a130b
```

### Context
- Command/operation attempted: `npm test`
- Input state: `doc/features/job-skill-shelver-runtime-authority-v1.json`、`job-skill-shelver-question-delivery-lock-v1.json`、`job-skill-shelver-phase4-activation-gate-v1.json` 和 `question-bank-import.sql` 已由当前合同重建。
- 后续 sqlite 打不开数据库的失败是初始化未完成后的连锁反应，不是 sqlite 根因。

### Suggested Fix
每次重建阶段四题库内容包后，同步 `scripts/config/database-content-pack.json` 中的 runtime authority、delivery lock、activation gate 和 JOB_SPECIFIC SQL 固定 hash，再重跑内容包测试。

### Metadata
- Reproducible: yes
- Related Files: scripts/config/database-content-pack.json, scripts/lib/database-content-pack.mjs, doc/features/job-skill-shelver-runtime-authority-v1.json

### Resolution
- **Resolved**: 2026-07-22T16:33:00+08:00
- **Commit/PR**: none
- **Notes**: 已更新内容包固定 hash；`database-content-pack` 专项测试和全量测试均通过。

---

## [ERR-20260722-E14] repo-search-command-scope-slip

**Logged**: 2026-07-22T19:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
排查 F2 认证链路时，检索命令误写了不存在的 `test` 目录并把范围放得过大，导致一次命令报错、一次输出噪音过多。

### Error
```
rg: test: No such file or directory (os error 2)
Warning: truncated output
```

### Context
- Command/operation attempted: `rg -n "auth_session|auth:login|assertCaller\\(|assertStudent\\(|callerRole|callerUserId" src test doc/specs src/shared`
- 另一次读取误写为 `sed -n '1,200p' src/preload/index.d.ts`，而实际类型文件在 `src/renderer/src/env.d.ts`。

### Suggested Fix
继续按功能边界缩小检索范围，并在读文件前先用 `rg --files` 或已有结果确认真实路径。

### Metadata
- Reproducible: yes
- Related Files: .learnings/ERRORS.md

### Resolution
- **Resolved**: 2026-07-22T19:02:00+08:00
- **Commit/PR**: none
- **Notes**: 后续检索已改为分文件、分模块读取；F2 认证相关定位恢复正常。

---

## [ERR-20260722-F07] markdown-trailing-whitespace-diff-check

**Logged**: 2026-07-22T19:10:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
更新登录文档时混入 Markdown 行尾空格，导致 `git diff --check` 失败。

### Error
```
doc/features/login-by-role-prd.md: trailing whitespace
```

### Context
- Command/operation attempted: `git diff --check`
- 触发位置在 `doc/features/login-by-role-prd.md` 的标题元数据行和风险提示行。

### Suggested Fix
文档改动收尾时补跑一次 `git diff --check`，对 Markdown 标题和表格附近的双空格换行保持警惕。

### Metadata
- Reproducible: yes
- Related Files: doc/features/login-by-role-prd.md

### Resolution
- **Resolved**: 2026-07-22T19:10:00+08:00
- **Commit/PR**: none
- **Notes**: 已移除 3 处行尾空格，`git diff --check` 重新通过。

---
