# 学校演示优先与在线激活实现计划

## 1. 状态与目标

- 状态：`APPROVED_FOR_IMPLEMENTATION`
- 风险等级：`R3`
- 产品合同：`doc/features/school-demo-first-online-activation-prd.md`
- 技术复核：`CONDITIONAL_PASS_NON_INDEPENDENT`

目标是在同一 Electron 应用内实现可配置在线激活、新安装 96+298 内容包、教师 298 题只读目录，并使用现有 JOB_SKILL 固定 18+6 跑通学校演示闭环。不得依赖 preview registry、principal、签名包或默认数据库。

## 2. 依赖顺序

`权威文档 -> 激活状态机 -> 参考服务器 -> IPC 总门 -> 内容包引导 -> 题库查询 -> renderer 路由/UI -> Electron 闭环 -> 验收`

每一步必须先通过本步测试，再进入下一步；任何一步都不得把未运行的检查写成通过。

## 3. 原子实施步骤

### Step 0：同步产品合同

- 文件：权威 PRD、`baseline.yaml`、本 Mini-PRD、复核记录和实现计划。
- 结果：旧 preview 信任链不再被解释为学校演示前置条件。
- 验证：`npm run docs:index:update`、`npm run docs:index:check`、`git diff --check`。
- 回滚：只撤销本步骤新增的覆盖段和索引项，不改历史 preview 文档。

### Step 1：实现主进程激活状态机

- 文件：`src/shared/types/activation.ts`、`src/main/activation/*` 及单元测试。
- 行为：生成稳定 installation ID；校验服务器 URL；串行执行配置、激活、验证；原子保存受限权限文件；授权码不落盘；token 不暴露 renderer。
- 故障：超时、损坏文件、未知响应、过期缓存、服务器切换和并发旧响应均失败关闭。
- 验证：状态机、文件恢复、URL、缓存和并发单元测试。
- 回滚：移除激活模块及其独立 `userData` 文件，不触碰业务数据库。

### Step 2：提供最小参考激活服务器

- 文件：`scripts/activation-server.mjs`、对应测试和 `package.json` script。
- 行为：实现 health、activate、validate；同 installation ID 幂等；设备数和有效期可配置；不记录授权码。
- 验证：有效、无效、过期、设备超限和重复激活合同测试。
- 回滚：删除脚本和 npm 命令，不影响客户端历史数据。

### Step 3：接入 IPC 总门

- 文件：`src/main/ipc/activation.ts`、`src/main/ipc/index.ts`、`src/main/ipc/handler-registry.ts`、`src/preload/index.ts`、`src/shared/types/ipc-api.ts` 和测试。
- 行为：除 runtime health 与 activation IPC 外，业务 IPC 在进入现有 handler 前统一检查激活；现有中央 92 通道清单不扩写为另一套命令系统。
- 并发：已经进入 durable executor 的命令完成；尚未进入的请求在授权失效后拒绝。
- 验证：未激活拒绝、激活放行、renderer 不见 token、旧测试显式注入 always-active gate。
- 回滚：移除 gate 注入和 activation handlers，恢复原注册入口。

### Step 4：新安装装入当前内容包

- 文件：`electron.vite.config.ts`、`src/main/db/connection.ts`、内容包辅助模块和测试。
- 行为：构建时携带两份 SQL；仅在对应题库域为空时按域事务装入 96+298；从策略 JSON 读取固定 24 个题 ID 并将当前演示集合置为可作答。
- 保护：不清空、不覆盖非空题库域；BASE_ABILITY 不因软件激活自动绕过 renderer/专业门禁。
- 验证：fresh/current/restart/半包故障隔离测试，全部使用显式临时数据库。
- 回滚：停止启动引导，保留已经合法装入的题目，不做逆向删除。

### Step 5：实现教师只读题库目录查询

- 文件：`src/shared/types/question-bank-catalog.ts`、主进程查询/IPC 模块和测试。
- 行为：按 domain、module、type、status、keyword 分页；安全解析内容与评分规则；TEACHER/ADMIN 可读，STUDENT/未登录拒绝。
- 保护：不接收 renderer caller ID/role；不返回学生数据、反馈、授权 token；不提供题目状态写入。
- 验证：298 总数、筛选分页、坏 JSON、角色和未激活负向测试。
- 回滚：注销目录 IPC，不改题库数据。

### Step 6：实现激活页面与全局守卫

- 文件：Pinia store、`ActivationView.vue`、router、工作区版本/授权入口及 UI 测试。
- 行为：未激活只进入激活页；可修改地址并确认；激活后进入登录；显示应用版本和题库版本。
- 可用性：键盘、焦点、错误提示、提交忙碌态和窄屏均可用。
- 验证：route guard、状态恢复、错误映射和组件测试。
- 回滚：移除新路由/守卫和入口，不影响主进程状态文件。

### Step 7：实现教师 298 题目录 UI

- 文件：教师路由、导航、`QuestionBankView.vue` 和组件测试。
- 行为：筛选、分页、详情展示题干、选项/交互内容、线下材料/rubric 和评分依据；`DRAFT` 显示“待评审”，`ACTIVE` 显示“可演示”。
- 验证：298 总数、无结果、错误、权限、长文本和窄屏布局。
- 回滚：移除路由和导航，不改 IPC/题库数据。

### Step 8：隔离 Electron 学校演示

- 文件：`scripts/e2e/school-demo-flow.mjs` 及 npm script。
- 流程：启动参考服务器和隔离 userData -> 激活 -> 教师登录 -> 浏览 298 题 -> 创建学生 -> 固定 18+6 测评/训练/评分 -> 查看报告。
- 断言：preview registry 可保持 `INSTALLING`；不产生 preview principal/release/feedback 写入；默认数据库没有访问。
- 验证：Electron 截图、控制台错误和关键数据库证据。
- 回滚：只删除临时目录和测试服务状态。

### Step 9：完整验收

- 命令：`npm run typecheck`、`npm run lint`、相关单测、`npm test`、`npm run build`、数据库检查、文档索引检查和隔离 Electron E2E。
- 方式：使用 `vibe-accept` 输出 `PASS`、`FAIL`、`NOT_RUN` 或 `BLOCKED`，不把人工未执行项写成通过。
- 发布边界：学校小范围演示可在自动化与实机证据通过后进行；正式外部发布前补独立 R3 代码复核。

## 4. 跨文件副作用

| 变化 | 下游影响 | 保护措施 |
|---|---|---|
| 激活 gate | 全部业务 IPC | runtime/activation 白名单；现有 handler 内部语义不变 |
| 启动内容引导 | fresh 数据库 | 仅空域、按域事务、禁止清库覆盖 |
| 24 题可作答 | JOB_SKILL 固定策略 | 从策略读取并严格校验 18+6，不影响其余 274 题 |
| 题库目录 IPC | preload/renderer/权限 | sender session 绑定、只读、角色负测 |
| 路由守卫 | 登录和角色路由 | 激活先于登录，激活后沿用现有 auth guard |
| 版本展示 | package/content pack | 只展示，不参与计分和数据归属 |

## 5. 停止条件

- 任何测试需要访问或修改默认数据库。
- 激活 token、授权码或学生数据进入 renderer 持久状态、日志或报告。
- 298 题目录仍要求 preview registry promotion、principal 或签名包。
- 固定 18+6 的来源需要在多个模块重复硬编码。
- 改动安全 FSM、计分、结果分离或 placement advice 语义。
- 内容引导会覆盖已有题库数据或留下半包。
