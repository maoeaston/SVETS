# Errors

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
