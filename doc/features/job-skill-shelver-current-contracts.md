# 超市理货员题库与素材当前合同入口

**状态：** 活跃导航入口  
**日期：** 2026-07-31
**范围：** JOB_SKILL 298 题全量预览、270 项素材并行生产、逐题交付状态、预览题包与正式示范测评门禁

## 普通结论

当前产品路线已经调整为：298 道当前题先全部进入教师可见预览内容库，AI 辅助素材并行生产，题目通过各自门禁后按不可变题包逐批开放。24 道 Pilot 只保留为历史复核批次和正式 18+6 候选来源，不再是 JOB_SKILL 首发内容上限。

298 题入库、教师全库可见、学生可作答和正式计分是四个不同层级。题目可以先以 DRAFT 在教师目录展示；当前版本内容、答案或 rubric、专业/安全、renderer 和 required asset 都通过后先成为 `PREVIEW_RELEASE_CANDIDATE`，即使已由正式链转为 ACTIVE 也不能跳过预览批准。随后由产品负责人签名的逐题包责任清单/批准和可信 `user_id ↔ principal_id` 映射证明不同执行主体，在单一原子命令中完成必要的 DRAFT→ACTIVE、PREVIEW_ONLY 授权引用与题包发布。正式与预览必须各自验证发布来源；共享 ACTIVE 不能互相授予权限。预览题包只形成“本题包作答情况”和学校反馈，不生成正式 JOB_SKILL_SCORE。

当前机器事实以 `doc/assets/asset-manifest.json` v0.5.0 为准：270 项全部 `planned`，0 项 `approved`；147 项已绑定题号，且 `question_ids` 与 `current_question_ids` 已同步；213 项绑定 Prompt 模板，但 213 项 `prompt_text` 仍为空。

## 当前只读入口

| 文件 | 作用 |
|---|---|
| `doc/specs/MVP_PRD_v1.0.9-authoritative.md` | 唯一产品合同；路径保留旧文件名，正文权威版本为 v1.0.10 |
| `doc/features/job-skill-298-full-preview-prd.md` | 298 题全量预览 Mini-PRD，定义教师目录、逐题门禁、题包、反馈和结果隔离 |
| `doc/features/job-skill-shelver-runtime-authority-v1.json` | 298 道当前题号、版本和 DRAFT 状态的机器权威 |
| `doc/features/job-skill-shelver-phase4-activation-gate-v1.json` | 历史 Phase 4 全局激活门禁；继续约束正式 18+6 旧发布链，不得用于阻断教师全库目录或无关预览题包 |
| `doc/assets/asset-manifest.json` | 270 项视觉、音频、脚本和工具卡生产合同 |
| `doc/assets/asset-manifest.schema.json` | manifest v0.5.0 结构和题号绑定规则 |
| `doc/features/job-skill-shelver-question-delivery-lock-v1.json` | 181 道需要素材/工具/脚本/视频答案支撑的交付锁 |
| `doc/assets/offline-toolkit-manifest-v1.json` | 100 道线下实操题的材料布置、复位和资产依赖 |

## 素材准备顺序

1. 先读 `doc/assets/asset-manifest.json`，以 `question_ids` 追溯来源题号，以 `current_question_ids` 绑定当前运行时题号。
2. 按题目运行依赖重排批次：先做直接阻断题目作答的刺激素材，再做线下交付材料，最后做共享参考和 UI 资产；不能再等 270 项一起完成。
3. Prompt 只按 `doc/assets/prompt-templates/` 和 manifest 字段编译，不从旧 Prompt、旧批次 JSON 或旧 HTML 审核包复制。
4. 生成图片、视频或脚本前必须运行 `npm run asset:validate`，确认仍是 `total=270, planned=270, approved=0` 或符合当批真实进展。
5. 资产批准只解除受影响题目的资产门禁；不等于题目自动激活，不等于正式 Pilot 门禁通过，也不得原地改变已被 session 引用的题目。
6. 每批批准资产投影到 `asset_resource` 后，只重算相关题目的交付状态，并通过新题目版本或新题包版本补绑。

## 历史文件边界

- `doc/features/job-skill-shelver-298-*` 的大量 JSON/HTML/MD 是审核链、复审链和生成器输入。日常素材生产不要主动阅读，只有重建 298 权威、复盘审核意见或修生成器时才下钻。
- `doc/features/job-skill-shelver-pilot-current-question-authority.md` 只保留 Pilot 24 题门禁追溯价值，不再作为 298 题素材生产唯一入口。
- `doc/features/archive/` 中的旧图片方案、旧 SQL、旧 Prompt 和 Pilot R0/v1/v2 文件只读追溯，不得执行或复制到新生产批次。
- `doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json` 是来源池，不是当前可激活题库，也不是素材生产入口。

## 禁止动作

- 不因“全库可见”批量把 298 道 DRAFT 题改成 ACTIVE；只允许逐题证据齐全并进入批准题包的版本通过运行门禁。
- 不修改策略或历史 manifest 来绕过门禁。
- 不把未批准资产写入 `asset_resource`。
- 不从 archive 或旧审核包直接生成图片、视频或导入 SQL。
- 不删除 298 审核链文件，除非同步更新所有生成器、测试和 hash 追溯。
- 不把 PREVIEW_ONLY 作答情况生成正式 JOB_SKILL_SCORE、岗位等级或就业安置建议。
- 不执行全域删除重导覆盖已有 JOB_SKILL 业务数据；内容包必须使用显式目标库并先 dry-run。
