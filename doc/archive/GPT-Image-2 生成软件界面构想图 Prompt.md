## 🤖 Assistant

# GPT-Image-2 生成软件界面构想图 — Prompt 方案

---

## 关键技巧说明

根据实践经验 [^1][^3]，让 AI 生成 UI 界面图的核心要点是：

1. **明确说明是"UI screenshot/mockup"**——否则模型会生成插画风格而非界面风格
2. **指定设备框架**（tablet/desktop/kiosk）——帮助模型确定比例和布局
3. **描述具体的界面元素和布局**——越具体越好，包括位置、颜色、内容
4. **指定设计风格参考**——如 "Material Design" "iOS Human Interface" 等
5. **注明这是"pixel-perfect rendered UI"**——避免模型生成手绘草图风格

---

## 界面构想图 Prompt 合集（8张核心界面）

---

### 界面 1：学生端主页（训练模块选择）

```
prompt: A pixel-perfect UI screenshot of a touchscreen kiosk application for special education vocational training. The screen shows a student home page with a 2x2 grid of large module cards. Each card is approximately 400x300px with rounded corners (16px radius), containing: a simple flat illustration icon on top and a short Chinese label below (2-3 characters). The four cards are labeled "商品分类" (with a shelf icon, green tint), "排面整理" (with an alignment icon, blue tint), "临损检测" (with a magnifying glass icon, orange tint), "补货流程" (with a cart icon, purple tint). At the top-left corner is a small bear avatar (circle, 48px) with "小明同学" text next to it. At the top-right corner is a soft pink heart-shaped SOS button labeled "我需要帮助". The background is a very soft warm gray (#FAFAFA). Bottom of screen shows a simple progress bar indicating "今日已完成 2/4". Color scheme: primary green (#4CAF50), secondary blue (#2196F3), warm accents. NO red colors anywhere. The overall feel is: clean, calm, spacious, large touch targets, minimal text, child-friendly but not childish. Display this as a 1920x1080 landscape desktop/kiosk application window with minimal window chrome.

size: 1536x1024
quality: high
background: opaque
output_format: png
```

---

### 界面 2：商品分类训练（拖拽交互中）

```
prompt: A pixel-perfect UI screenshot of a touchscreen educational app showing a grocery classification training exercise. The screen is divided into two main areas: TOP AREA (30% height): A "source zone" with 4 product images (apple, milk carton, shampoo bottle, chip bag) arranged in a horizontal row, each on a slightly raised card with soft shadow. One item (the apple) is shown being "dragged" — slightly enlarged with a blue glow border, positioned between source and target. BOTTOM AREA (60% height): Three category drop zones arranged horizontally, each is a large rounded rectangle (pastel colored): left zone is labeled "水果区" (soft green background, fruit basket icon), middle zone is labeled "饮料区" (soft blue background, cup icon), right zone is labeled "日用品区" (soft purple background, bottle icon). The milk carton has already been correctly placed in the "饮料区" zone with a small green checkmark. TOP BAR: Shows current step "第2步/共4步", a progress indicator, and the bear avatar. The SOS heart button is visible in top-right. A speech bubble at the top shows the instruction "把苹果放到正确的区域" in large clear font. Background: very light warm gray. Style: Material Design 3 / modern flat UI, clean shadows, large touch targets (minimum 80px), very spacious layout. NO red colors. Display as 1920x1080 kiosk application.

size: 1536x1024
quality: high
background: opaque
output_format: png
```

---

### 界面 3：临损商品检测（点选交互）

```
prompt: A pixel-perfect UI screenshot of a touchscreen educational app showing a damaged product inspection exercise. The screen layout: TOP INSTRUCTION BAR: A clear instruction in large Chinese text "找出有问题的商品" (Find the damaged product) with a magnifying glass icon. CENTER AREA: A 2x2 grid of product images on white cards with soft rounded corners. Three products look normal (a clean chip bag, a perfect milk carton, an intact shampoo bottle). One product (bottom-left) shows a milk carton with a visible leak at the bottom — white liquid dripping. Each card is large (approximately 350x350px) with generous spacing. The damaged product has NOT been selected yet — all four cards look interactive with subtle hover affordance. BOTTOM AREA: A hint bar showing "仔细看看，哪个商品漏液了？" in smaller text with a friendly owl/helper icon. TOP-RIGHT: SOS pink heart button. TOP-LEFT: Progress "第3题/共5题" with dots indicator. A small timer-free label says "不着急，慢慢看" (No rush, take your time). Color scheme: soft warm palette, green for correct states, amber/orange for warnings. NO red anywhere — even the "damage" indicators use orange (#FF8A65). Clean Material Design style, very spacious, calming layout. Display as 1920x1080 kiosk.

size: 1536x1024
quality: high
background: opaque
output_format: png
```

---

### 界面 4：补货流程步骤引导（流程型交互）

```
prompt: A pixel-perfect UI screenshot of a touchscreen educational app showing a step-by-step shelf stocking procedure guide. The screen layout: LEFT SIDE (30% width): A vertical step indicator showing 5 steps as large circles connected by lines. Steps are: ①检查空位 (completed, green fill), ②取出商品 (completed, green fill), ③检查商品 (CURRENT, blue fill with pulse ring), ④摆放商品 (upcoming, gray outline), ⑤整理排面 (upcoming, gray outline). Each step circle is large (64px) with Chinese label next to it. CENTER (50% width): The main content area showing the current step "③检查商品". It contains: a simple illustration of a person in green apron holding a box and inspecting it, with a magnifying glass icon. Below the illustration: clear instruction text "拿起商品，看看有没有破损" in large font. A "我检查好了 ✓" large green button at the bottom of this area. RIGHT SIDE (20% width): A reference panel showing "正确示范" with a small thumbnail image of the correct inspection pose. TOP BAR: Module title "补货流程练习", progress, avatar, SOS button. Background: warm light gray. Style: clean, spacious, step-by-step wizard UI. Large buttons (minimum 60px height). NO red. Display as 1920x1080 kiosk.

size: 1536x1024
quality: high
background: opaque
output_format: png
```

---

### 界面 5：SOS 情绪支持中心

```
prompt: A pixel-perfect UI screenshot of a touchscreen educational app showing an emotional support / SOS center page. The screen has a calming, safe atmosphere. BACKGROUND: Soft gradient from light sky blue (#E3F2FD) at top to soft mint green (#E8F5E9) at bottom. CENTER: Three large action cards arranged vertically with generous spacing (each approximately 800x150px, full-width with rounded corners): Card 1: Soft blue background, breathing icon (lungs/wind), text "深呼吸放松" (Deep breathing relaxation), with a play button indicator. Card 2: Soft lavender background, speech bubble icon, text "我想告诉老师" (I want to tell the teacher), with a speaker icon. Card 3: Soft green background, checkmark/thumbs-up icon, text "我准备好了，继续训练" (I'm ready, continue training), with a forward arrow. TOP: Large comforting text "没关系，我们休息一下" (It's okay, let's take a break) in dark gray, with a friendly calm face emoji next to it. NO close/X button visible — only the green "ready to continue" card serves as exit. Very calming, spacious, no visual clutter. Rounded everything, soft shadows. NO red colors anywhere. Display as 1920x1080 kiosk.

size: 1536x1024
quality: high
background: opaque
output_format: png
```

---

### 界面 6：教师端 — 学生进展报告

```
prompt: A pixel-perfect UI screenshot of a desktop management dashboard for special education teachers, showing a student progress report. The layout is a standard dashboard with left sidebar navigation. LEFT SIDEBAR (220px width, white background): Navigation items with icons — "学员管理" (active, green highlight), "训练计划", "数据报告", "泛化验收", "系统设置". School logo at top. MAIN CONTENT AREA: Header shows student name "王小明" with bear avatar, age "16岁", tags "ASD轻度". Below header, a tab bar: "能力雷达图" (active) | "训练趋势" | "行为分析". The active tab shows: A radar/spider chart with 4 axes labeled "商品分类", "排面整理", "临损检测", "补货流程". The chart shows two overlaid polygons — one lighter (baseline) and one darker green (current level), clearly showing improvement. To the right of the chart: Key stats cards — "训练天数: 14天", "完成任务: 47次", "当前辅助级别: 部分辅助", "建议: 可尝试递减辅助". Bottom section: A timeline showing recent 7 days of training activity as small dots (green=completed, gray=skipped). Color scheme: professional, clean, green primary (#4CAF50), gray secondary. Clearly a desktop interface (not touch-optimized). NO red. Display as 1920x1080 desktop application.

size: 1536x1024
quality: high
background: opaque
output_format: png
```

---

### 界面 7：排面整理训练（排序型交互）

```
prompt: A pixel-perfect UI screenshot of a touchscreen educational app showing a shelf arrangement/sorting exercise. The screen layout: TOP: Instruction text "按照示范图，把商品排整齐" (Arrange products according to the reference). A small "示范图" reference thumbnail in the top-right showing the correct arrangement (4 products neatly aligned on a shelf). CENTER (main interaction area, 70% of screen): A shelf illustration (horizontal wooden shelf, side view) with 4 product slots marked by dashed outlines. Currently 2 products are already placed correctly (shown solid with green subtle border), and 2 products are sitting BELOW the shelf in a "staging area", waiting to be dragged up to the correct slots. The products are: a milk carton, an orange juice bottle, a water bottle, and a yogurt cup — all should be arranged left-to-right by height (tall to short). Visual guides: Light dashed arrows suggest the drag direction (upward). Slot positions have subtle number labels "1, 2, 3, 4" in light gray. BOTTOM: A hint text "提示：从高到矮排列" with a lightbulb icon. Progress indicator showing "2/4 已摆放". SOS button in corner. Style: Clean, spacious, large drag targets (minimum 100px width per product). Warm wood color for shelf. Soft green (#81C784) for completed indicators. NO red. Display as 1920x1080 kiosk.

size: 1536x1024
quality: high
background: opaque
output_format: png
```

---

### 界面 8：训练完成 — 正向反馈页

```
prompt: A pixel-perfect UI screenshot of a touchscreen educational app showing a task completion celebration page. The screen has a joyful but CALM atmosphere (not overwhelming). CENTER: A large golden star icon (approximately 200px) with subtle sparkle particles around it. Below the star: Large text "太棒了！" (Great job!) in warm dark gray. Below that: Specific praise "你成功完成了商品分类训练" in medium text. Below that: A row of 3 earned star icons (filled gold) out of 3 total, indicating perfect completion. MIDDLE: A simple stats summary card with rounded corners showing: "正确率: 4/4", "用时: 3分钟", "辅助次数: 1次". BOTTOM: Two large buttons side by side — Left button (soft blue, outlined): "休息一下" with a coffee cup icon. Right button (solid green): "继续下一个" with a forward arrow. The overall celebration is GENTLE — no confetti explosion, no flashing animations implied, no overwhelming visual noise. Just warm, encouraging, calm pride. Soft golden/warm color accent for the celebration elements. Background: very soft warm cream (#FFF8E1) gradient. NO red anywhere. Display as 1920x1080 kiosk.

size: 1536x1024
quality: high
background: opaque
output_format: png
```

---

## 汇总参数表

| # | 界面名称 | size | quality | background | output_format | 用途 |
|:---|:---|:---|:---|:---|:---|:---|
| 1 | 学生端主页 | `1536x1024` | `high` | `opaque` | `png` | 展示整体结构 |
| 2 | 商品分类训练 | `1536x1024` | `high` | `opaque` | `png` | 展示拖拽交互 |
| 3 | 临损检测 | `1536x1024` | `high` | `opaque` | `png` | 展示点选交互 |
| 4 | 补货流程引导 | `1536x1024` | `high` | `opaque` | `png` | 展示流程型交互 |
| 5 | SOS情绪支持 | `1536x1024` | `high` | `opaque` | `png` | 展示安全机制 |
| 6 | 教师端报告 | `1536x1024` | `high` | `opaque` | `png` | 展示数据能力 |
| 7 | 排面整理训练 | `1536x1024` | `high` | `opaque` | `png` | 展示排序交互 |
| 8 | 训练完成反馈 | `1536x1024` | `high` | `opaque` | `png` | 展示激励设计 |

---

## Prompt 编写技巧总结

### 生成 UI 界面图的关键 Prompt 结构 [^1][^3]：

```
[类型声明] A pixel-perfect UI screenshot of a [设备类型] application...
[场景说明] showing [具体页面功能]...
[布局描述] The screen layout: [TOP/LEFT/CENTER/BOTTOM 各区域详细描述]...
[元素细节] Each card/button/icon is [尺寸/颜色/形状/文字内容]...
[风格约束] Style: [设计系统], [情绪氛围], [色彩规则]...
[禁止项] NO red colors, NO complex animations implied, NO visual clutter...
[输出格式] Display as [分辨率] [设备类型].
```

### 关键注意事项：

| # | 要点 | 说明 |
|:---|:---|:---|
| 1 | 说 "pixel-perfect UI screenshot" | 区别于插画/概念图 |
| 2 | 明确写出中文文字内容 | GPT-Image-2 支持中文渲染，但要明确给出 |
| 3 | 用百分比/px描述布局位置 | 帮助模型理解空间分配 |
| 4 | 指定色值 | 不要只说"绿色"，要说"#4CAF50" |
| 5 | 描述交互状态 | "一个item正在被拖拽""按钮处于hover状态" |
| 6 | 声明设计系统 | "Material Design 3" / "iOS style" |
| 7 | 强调间距和触控尺寸 | "large touch targets minimum 80px" |
| 8 | 控制信息密度 | 界面越简洁，AI生成质量越高 |

---

### ⚠️ GPT-Image-2 生成 UI 的已知局限：

| 局限 | 应对方案 |
|:---|:---|
| 中文文字可能有错字/模糊 | 生成后需要用设计工具替换文字层 |
| 复杂数据图表（雷达图）可能不精确 | 图表部分后期用 Figma/Sketch 重绘 |
| 多层级嵌套布局可能错位 | Prompt 中简化层级，每张图聚焦一个核心区域 |
| 颜色可能轻微偏差 | 后处理中校色 |

**建议用法**：这些图用于**PPT展示/概念沟通/方向对齐**，不作为最终开发的 UI 设计稿。真正的开发设计稿应该基于这些构想图在 Figma 中精确重绘。

---

需要我针对某个特定界面再出更多变体 prompt（比如不同状态：空白态/加载态/错误态），或者为 PPT 汇报再补充几张概念展示图吗？
[^1]: [How I created UI with ChatGPT's new image generator (4o)](https://designwithai.substack.com/p/how-i-created-ui-with-chatgpt-new-image-generator)

[^2]: [June 2026 (Theme: Through Time) — ChatGPT / API Image ...](https://community.openai.com/t/june-2026-theme-through-time-chatgpt-api-image-generative-art-gallery-prompt-tips-and-help/1378298)

[^3]: [How I created UI with ChatGPT's new image generator (4o) - Medium](https://medium.com/design-bootcamp/how-i-created-ui-with-chatgpts-new-image-generator-4o-d52389a5833e)

[^4]: [ULTIMATE GPT IMAGE 1.5 TUTORIAL: 15 PROMPT TECHNIQUES](https://www.youtube.com/watch?v=QT1nMo-QMDQ)

[^5]: [Design Stunning App UI with ChatGPT in SECONDS! (No ... - YouTube](https://www.youtube.com/watch?v=oG4yvBmZ1WU)