# Seedance 视频资产生产 SOP

**版本：** v1.0.0

**适用合同：** `visual-asset-master-plan.md v1.2.4-video-sop` / `asset-manifest.json v0.3.1`

**适用范围：** A 类 68 个判断题视频、G 类 6 个线下操作示范视频

本文把用户提供的 Seedance 高频使用经验转成 SVETS 的生产规则。原经验属于主观实践总结，本 SOP 只采纳与当前测评、训练和无障碍要求一致的部分。

## 1. 产品化结论

| 实践经验 | SVETS 决策 | 原因 |
|---|---|---|
| Prompt 只写主体、场景、声音、镜头 | 采用 | 信息边界清楚，便于逐项审查 |
| 上传主体和场景参考图 | 采用 | 稳定人物、服装、货架和比例 |
| 不上传完整故事板 | 采用 | 当前视频短，故事板会增加错误解释空间 |
| Prompt 不写长篇情绪和比喻 | 采用 | 测评视频需要可观察动作，不需要叙事修辞 |
| 不给每个 Shot 写时间戳 | 采用 | 用 Shot 数量和顺序控制节奏 |
| 2 至 3 秒一个 Shot | 仅用于训练示范 | 判断题必须保持单镜头、单一可评分动作 |
| 720p 优先 | 采用 | 当前模型响应、成本和生成速度更适合抽选 |
| 不生成 BGM，只保留音效 | 收紧 | 当前合同所有视频 `generate_audio=false`，正式测评保持完全静音 |
| 定稿后再放大 | 有条件采用 | MVP 不要求 4K；需要放大时只处理已批准候选并记录工具版本 |

## 2. 两类视频不能混用规则

### 2.1 A 类判断题视频

- 时长 5 秒，720p，16:9，24fps。
- 只包含一个可评分动作。
- 默认一个连续 Shot，不快切、不转场、不摇镜、不缩放。
- 完全静音，题干由系统 TTS 独立朗读。
- Prompt 不出现“正确”“错误”“违规”“危险答案”等判定词。
- 画面不得出现勾叉、箭头、高亮、成功色、失败色或答案文字。
- 涉及日期、价格、数量、条形码、系统界面的证据由程序叠加，不交给 Seedance 生成。

### 2.2 G 类线下操作示范视频

- 时长 8 秒，720p，16:9，24fps。
- 单动作可使用一个 Shot；多步骤最多三个 Shot。
- 每个 Shot 只表达一个动作，按自然顺序排列，不写时间戳。
- 当前批次仍设置 `generate_audio=false`。
- 超过三个步骤时拆成多个视频资产或用流程步骤条辅助，不压缩成快速蒙太奇。
- 可以使用中景、近景、全景切换，但不得使用炫技运镜或情绪化剪辑。

## 3. 生成前置条件

批量生成视频前必须满足：

1. R1 理货员角色、R2 马甲、R3 货架、R5 光照机位均已 `approved`。
2. A 至 F 六类判断题场景各有一张视频场景锚图，G 类线下示范至少有一张场景锚图。
3. 场景锚图应同时包含角色和环境，用于锁定人物与货架比例。
4. 场景锚图保存在 `doc/assets/reference-assets/video-scene-anchors/`，只作生产参考，不进入运行时资产计数。
5. 对应 Manifest 记录已有完整 `prompt_text`，并通过 Prompt 人工复核。
6. `reference_asset_ids`、`generation_params`、`forbidden_visual_cues` 与 Prompt 一致。

不满足以上条件时，不得用纯文字 Prompt 直接批量生成 74 个视频。

## 4. Prompt 四段合同

每条视频 Prompt 固定使用以下四段，不增加故事板表格、时间轴、镜头运动曲线或营销式修辞。

```text
[SUBJECT]
使用已上传并批准的理货员角色和绿色工作马甲参考。保持面部、发型、体型、服装和人物比例一致。

[SCENE]
使用已上传的对应场景锚图。保持货架结构、商品区域、光照、机位和人物相对尺寸一致。

[AUDIO]
完全静音。无对白、无背景音乐、无环境音、无成功或失败提示音。

[SHOT]
用一句到三句说明景别、机位和唯一动作。只写镜头中实际发生的事情。
```

### 4.1 判断题示例

```text
[SUBJECT]
Use the approved Chinese supermarket worker and green work vest references. Keep the same face, body proportions, hairstyle, and clothing.

[SCENE]
Use the uploaded three-tier shelf scene anchor. Keep the fixed shelf geometry, neutral retail lighting, and worker-to-shelf scale.

[AUDIO]
Silent. No dialogue, music, ambient sound, or feedback sound.

[SHOT]
Fixed eye-level medium-wide shot. The worker places a large detergent bottle on the top shelf, releases both hands, and the bottle remains visibly above shoulder height. One continuous shot, no zoom, no cut, no camera shake.
```

错误动作只描述行为本身。不要写 “wrong action”“unsafe” 或 “incorrect placement”。

### 4.2 训练示范示例

```text
[SUBJECT]
Use the approved worker and vest references. Keep the worker consistent across all shots.

[SCENE]
Use the uploaded unpacking and shelf scene anchor. Keep the carton, trolley, shelf, lighting, and scale unchanged.

[AUDIO]
Silent. No dialogue, music, ambient sound, or feedback sound.

[SHOT 1]
Medium-wide fixed shot. The worker places the carton beside the shelf and opens it with the approved safety cutter.

[SHOT 2]
Close shot. The worker checks one product package and date label area without showing readable generated text.

[SHOT 3]
Medium shot. The worker places the checked product on the shelf with the front facing outward.
```

## 5. Prompt 编写禁区

- 不重复描述参考图已经明确的人物五官、货架材质和服装细节。
- 不写“电影感”“史诗感”“治愈氛围”等与评分无关的抽象词。
- 不上传带箭头、表格、Highlight 或镜头曲线的故事板。
- 不写逐秒时间戳。
- 不把多个可评分动作塞入 A 类判断视频。
- 不在 Prompt 中写正确答案或题库 `expected_answer`。
- 不要求模型生成可读日期、价格、数量、条形码、二维码或系统文字。
- 不用声音作为唯一职业判断线索。

## 6. API 参数

```json
{
  "model": "doubao-seedance-2.0",
  "size": "16:9",
  "resolution": "720p",
  "duration": 5,
  "generate_audio": false
}
```

- A 类 `duration=5`。
- G 类视频 `duration=8`。
- 不用 GPT 图片模型生成视频。
- 不在抽选阶段生成 1080p 或 4K。
- 参考图通过 Seedance 支持的图片输入字段提交，具体 URL 或 Asset URL 不写进 `prompt_text`。

## 7. 抽选策略

### 7.1 场景模板试跑

先从 A 至 F 每类选一个代表视频，G 类选一个代表视频。每个代表视频生成三个候选，用于确认：

- 角色和场景一致性
- 动作可读性
- 单镜头稳定性
- 720p 响应质量
- 程序叠加预留空间

模板未冻结前，不批量生成同类剩余视频。

### 7.2 正式批次

- `standard`：先生成两个候选；都不通过时再生成第三个。
- `assessment_critical`：生成三个候选。
- `safety_critical`：生成三个候选，并逐帧审核。
- 同一资产连续三次都不通过时，停止抽选，先修场景锚图或 Prompt。

每次候选都记录模型、参数、参考图版本、任务 ID 和失败原因。不得通过切换到图片模型或提高分辨率解决动作理解问题。

## 8. 验收清单

候选视频至少检查：

- 主体与 R1/R2 一致，没有换脸、换装或体型漂移。
- 场景与锚图一致，货架层数、比例和机位稳定。
- A 类只有一个可评分动作，动作结果在 5 秒内清晰可见。
- G 类 Shot 不超过三个，顺序自然，无快速蒙太奇。
- 没有多余人物、肢体异常、物体穿模或商品数量漂移。
- 没有答案文字、勾叉、箭头、高亮或颜色暗示。
- 没有模型生成的数据关键文字。
- 视频完全静音。
- 分辨率为 720p，画面在目标触控屏上可辨识。
- 关键动作不依赖暂停在单个模糊帧上才能看清。

## 9. 后处理与放大

1. 先在 720p 候选中完成内容审核，再决定是否放大。
2. MVP 目标设备为 1920x1080，只有 720p 在实际显示尺寸下不清楚时才放大到 1080p。
3. 4K 不是 MVP 交付要求。
4. 放大不得补造文字、改变动作、增加物体或改变答案线索。
5. 使用外部放大工具时，在 QA 记录中写明工具、版本、参数和处理日期。

## 10. 完成定义

视频资产进入 `reviewing` 前必须满足：

- `prompt_text` 已编译并人工复核
- 参考资产和场景锚图已批准
- 生成参数符合 Manifest
- 候选选择理由和淘汰原因有记录
- 程序叠加已经完成或已有可执行规格
- 文件路径、SHA-256 和时长已回填

完整的生产、审核和入库门禁继续以 `question-bank-image-integration-checklist.md` 为准。
