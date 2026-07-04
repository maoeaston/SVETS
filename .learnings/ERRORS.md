# Errors

Command failures and integration errors.

---

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
