# F5 基础页面与异常中心实现说明

- 对应 Mini-PRD：`doc/features/foundation-pages-exception-center-prd.md`
- 状态：`COMPLETE`
- 日期：2026-07-24

## 1. 实现分层

```text
Vue 角色首页 / 统一 PageState / 异常与安全详情
                    |
              preload 白名单
                    |
        foundation:* / safety:* / training:*
                    |
 error_code_registry + error_event_log + 既有业务投影
```

渲染进程不读文件、不读 SQLite、不缓存持久化状态。角色首页、异常列表和详情每次都从主进程读取可信投影。

## 2. 接口

### `foundation:getOverview`

- 允许：`TEACHER`、`ADMIN`。
- 返回角色工作台数量、资源登记问题数、快照状态和未解决异常数。
- 不执行任何写入或恢复操作。

### `foundation:listExceptions`

- 允许：`TEACHER`、`ADMIN`；学生返回 `FORBIDDEN`。
- 固定最近 30 天范围，支持 `priorityLevel`、`category`、`recoveryStatus`、分页。
- 教师使用教学相关可见范围，管理员查看全部。

### `foundation:getException`

- 延续列表权限。
- 教师响应剥离 `context_json` 与 `stack_trace`，管理员可查看解析后的上下文和堆栈。

### `safety:list` / `safety:get`

- 允许教师和管理员只读。
- 返回学生姓名、状态、原因、环节、发生时间、责任人和绑定会话数。
- 写动作继续使用 F4 的 `confirm / resolve / void / replaceForFactualCorrection`。

### `training:listMySessions`

- 仅允许学生。
- 通过 `student_profile.user_id` 解析本人档案 ID，再返回本人训练，不依赖 `student_id === user_id`。

## 3. 界面系统

### 视觉主题

温和的浅色课堂工作台。画布使用暖灰白，导航使用深橄榄墨色，主要动作使用橄榄绿，安全和阻断使用陶土橙红。相邻表面依靠背景明度阶梯与轻阴影区分。

### 字体与密度

- 字体栈：`-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif`。
- 中文正文行高 1.7；计数使用等宽数字。
- 圆角刻度：4px、8px、12px、999px；按钮统一 8px。
- 触控目标不小于 40×40px。

### 状态组件

`PageState` 统一 `loading / empty / error / forbidden / blocked / success`，提供标题、说明、主动作和辅助动作。加载与空数据必须互斥，阻断型错误不自动消失。

### 响应式

- 1366×768 为主要桌面验收尺寸。
- 900px 以下导航变为顶部横向滚动区。
- 600px 以下卡片与操作区改为单列，按钮保持自然宽度；学生主动作可占内容宽度。
- 遵守 `prefers-reduced-motion`，只过渡 `transform` 与 `opacity`。

## 4. 测试路径

- 正常：教师、学生、管理员分别加载本人首页。
- 空态：无 session、无安全事件、无异常记录。
- 错误：IPC 抛错或返回系统错误后可重试。
- 权限：学生调用异常 IPC 被拒绝；教师看不到管理员技术详情；管理员能查看系统异常。
- 边界：P0-P3 筛选、最近 30 天、非法筛选值、分页上限。
- 安全：教师确认、管理员解决/作废，非法状态和角色继续被拒绝。
- 视觉：1280×720、1366×768、375×812 截图；检查中文长文案、按钮和导航溢出。

## 5. 回退

本阶段不改 schema、不写迁移。回退仅需移除新增只读 IPC、路由和页面，并恢复原角色首页重定向；数据库事实不受影响。

## 6. 完成验证

- `npm run typecheck`：通过。
- `npm run lint`：通过，0 error；仓库现有 Vue 模板格式规则报告 622 条 warning。
- F5 针对性测试：4 files / 49 tests 通过。
- `npm test`：82 files / 917 tests 通过。
- `npm run build`：通过。
- `npm run docs:index:check`：通过。
- `git diff --check`：通过。
- renderer-only Playwright 验收：管理员 1366×768、学生 375×812 页面无横向溢出，管理员和学生跨角色地址访问均按可信会话重定向。
- 验证期间只使用模拟 IPC、内存库、临时库和测试夹具；未初始化或写入真实运行数据库，未激活题库。
