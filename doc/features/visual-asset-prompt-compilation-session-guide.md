# 逐资产 Prompt 编译新会话指南

**版本：** v1.0.0

**目标：** 在不调用生成 API 的前提下，把 Manifest 中 AI 资产的模板、描述、参考资产和约束编译为可审核的逐资产 `prompt_text`。

当前 196 个 AI 图片/视频资产都绑定了模板，但 `prompt_text` 仍为空。不要在一个会话里一次编译 196 条，应按小批次完成并人工复核。

## 1. 推荐批次

1. R1-R6 核心参考资产，共 6 条。
2. C 类商品母版，前 16 条。
3. C 类商品母版，后 16 条，加 B 类 P0 场景。
4. D 类异常商品，共 11 条。
5. B 类剩余场景和 E 类 16 个 AI 合成底图。
6. F 类 26 个 AI 图片资产。
7. A 类视频，按 A-F 六个场景模板分别编译。
8. G 类 6 个视频、6 个流程条和 12 个工具卡。

每批建议 6 至 20 条。上一批没有完成人工复核前，不进入下一批。

## 2. 新会话启动 Prompt

新会话第一批从 R1-R6 开始，直接使用以下提示词：

```text
读取仓库根目录 AGENTS.md、doc/index.md、.continue-here.md 和最近仓库记录。

本次任务是“视觉资产逐资产 Prompt 编译”，只编译 Prompt，不调用 APIMart，不生成图片或视频，不修改数据库。

必须先读取并以这些文件为准：
1. doc/reference/visual-asset-master-plan.md
2. doc/assets/asset-manifest.json
3. doc/assets/asset-manifest.schema.json
4. doc/features/question-bank-image-integration-checklist.md
5. doc/features/visual-asset-video-production-sop.md
6. doc/features/visual-asset-prompt-compilation-session-guide.md
7. doc/assets/prompt-templates/ 下对应模板

本批范围：Manifest 中 category=REFERENCE 的 R1-R6 六项。

工作要求：
- 为本批每条 AI 资产填写完整、独立、可人工审核的 prompt_text。
- Prompt 必须从对应模板、description、target_cue、reference_asset_ids、text_handling、required_overlay 和 forbidden_visual_cues 编译，不得凭空增加资产或改变测评语义。
- 图片主模型保持 gpt-image-2；不得把 gpt-image-2-official 改成主模型。
- 不修改 asset_id、plan_key、question_ids、expected_answer、model、route、generation_params、lifecycle_status 或审核状态。
- 不运行 asset:manifest:build，避免覆盖已编译 Prompt。
- 不调用任何生成 API，不产生费用。
- 对无法确定的视觉决策写入批次待确认清单，不要自行猜测。

完成后运行 npm run asset:validate 和视觉资产相关测试，报告已编译 asset_id、未决问题和验证结果。
```

## 3. 后续批次 Prompt

R1-R6 之后，新开会话使用以下提示词，并替换 `本批范围`：

```text
继续执行 SVETS 视觉资产逐资产 Prompt 编译。先读取 AGENTS.md、doc/index.md、.continue-here.md，以及：
- doc/reference/visual-asset-master-plan.md
- doc/assets/asset-manifest.json
- doc/assets/asset-manifest.schema.json
- doc/features/question-bank-image-integration-checklist.md
- doc/features/visual-asset-video-production-sop.md
- doc/features/visual-asset-prompt-compilation-session-guide.md
- doc/assets/prompt-templates/ 下对应模板

本批范围：[填写 category、asset_id 前缀或明确 asset_id 列表，建议 6 至 20 条]

只填写本批 AI 资产的 prompt_text，不调用 APIMart，不生成素材，不修改数据库、生命周期、答案、模型路由、参考关系或审核状态。

图片 Prompt 必须具体描述可见主体、构图、背景、材质、文字处理和禁用内容，但不要重复无关修辞。

视频 Prompt 必须遵守 visual-asset-video-production-sop.md：
- 固定 SUBJECT / SCENE / AUDIO / SHOT 四段
- 使用批准的主体与场景锚图
- A 类单 Shot、单一可评分动作、5 秒、720p、完全静音
- G 类最多三个 Shot、8 秒、720p、完全静音
- 不上传或描述完整故事板，不写逐秒时间戳
- Prompt 不写正确/错误判定，不泄露 expected_answer
- 不要求模型生成日期、价格、数量、条形码或系统文字

不得运行 asset:manifest:build。完成后运行 npm run asset:validate 和相关测试，并报告本批已编译数量、asset_id 清单、未决问题和验证结果。
```

## 4. Prompt 复核会话

编译和复核应分开。复核会话使用：

```text
对 doc/assets/asset-manifest.json 中以下范围的 prompt_text 做只读审查：[填写范围]。

依据 visual-asset-master-plan.md、visual-asset-video-production-sop.md、题库答案合同和对应 Prompt 模板，逐条检查：
- 是否忠实表达 description 和 target_cue
- 是否使用正确参考资产
- 是否遗漏 text_handling、required_overlay 或 forbidden_visual_cues
- 是否包含答案泄露、颜色暗示、勾叉、箭头或多余文字
- 是否把数据关键内容错误交给 AI 生成
- 视频是否满足四段结构、Shot 数、静音、720p 和无时间戳要求
- 是否出现长篇修辞、重复参考图信息或不可观察的情绪描述

不要修改文件。按严重程度列出 asset_id、问题和建议修改内容；没有问题的资产也要列出通过清单。
```

## 5. 编译输出合同

每批完成时必须交付：

- 已填写 `prompt_text` 的 asset_id 清单
- 每条 Prompt 使用的模板版本
- 需要人工决定的未决项
- `npm run asset:validate` 结果
- 视觉资产相关测试结果
- 明确声明没有调用生成 API

只有 Prompt 编译和独立复核都完成后，才能进入 Seedance 或 GPT-Image-2 生成批次。
