---
name: run-desktop
description: Build, run, and drive the xc-career-guide Electron desktop app. Use when asked to start the desktop app, take a screenshot of it, or interact with its UI.
---

xc-career-guide 是一个 Electron + Vue3 桌面应用。Agent 使用场景通过 Playwright REPL 驱动，需要 xvfb。

## Prerequisites

```bash
sudo apt-get install -y xvfb libgtk-3-0 libxss1 libxkbcommon0 libatk-bridge2.0-0 libcups2 libdrm2 libasound2t64
```

libnss3、libgbm1、playwright-core 已在项目依赖中。electron binary 在 `node_modules/electron/dist/electron`。

## Build

```bash
npm run build
# 产出 out/main/index.js + out/renderer/
```

## Run（agent 路径）

```bash
cd /home/maoea/projects/SVETS
xvfb-run -a node .claude/skills/run-desktop/driver.mjs
```

tmux 封装（推荐）：

```bash
tmux new-session -d -s app -x 200 -y 50
tmux send-keys -t app 'cd /home/maoea/projects/SVETS && xvfb-run -a node .claude/skills/run-desktop/driver.mjs' Enter
timeout 20 bash -c 'until tmux capture-pane -t app -p | grep -q "driver>"; do sleep 0.2; done'
tmux send-keys -t app 'launch' Enter
timeout 60 bash -c 'until tmux capture-pane -t app -p | grep -q "launched"; do sleep 0.2; done'
tmux send-keys -t app 'ss landing' Enter
timeout 10 bash -c 'until tmux capture-pane -t app -p | grep -q "screenshot:"; do sleep 0.2; done'
tmux capture-pane -t app -p
```

截图落在 `/tmp/shots/`（可用 `SCREENSHOT_DIR` 覆盖）。

### Commands

| command | 说明 |
|---|---|
| `launch` | 启动 app，等待窗口出现 |
| `ss [name]` | 截图 → `/tmp/shots/<name>.png` |
| `click <css-sel>` | 点击元素（通过 DOM，不是坐标） |
| `click-text <text>` | 点击包含文字的 button/a/[role=button] |
| `type <text>` / `press <key>` | 键盘输入 |
| `wait <css-sel>` | 等待元素出现，10s 超时 |
| `eval <js>` | 在页面执行 JS，输出 JSON |
| `text [css-sel]` | 输出 innerText |
| `windows` | 列出所有窗口 + webContents |
| `quit` | 关闭 app |

## Run（人工路径）

```bash
npm run dev   # 开发模式，热更新
```

## Gotchas

- **userData 数据库 schema 过旧** — `~/.config/xc-career-guide/data/xc-career-guide.db` 如果是旧版，`db.exec(schema.sql)` 会在新索引处报错。直接删除该文件，app 重启会全量重建。
- **首次启动无数据** — 删库后需要重新导入种子数据（`src/main/db/seed/` 下的 SQL 文件）。
- **launch 超时** — 确保 `out/main/index.js` 存在（先跑 `npm run build`）。
- **Stale Xvfb locks** — `rm -f /tmp/.X*-lock; pkill Xvfb`
