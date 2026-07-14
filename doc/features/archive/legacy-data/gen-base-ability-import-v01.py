#!/usr/bin/env python3
"""生成 BASE_ABILITY 题库 INSERT SQL + BASELINE 策略 question_ratio 更新。"""
import json, uuid, hashlib, textwrap

def esc(s): return s.replace("'", "''")

MODULE_MAP = {
    '精细动作能力': 'FINE_MOTOR',
    '认知理解能力': 'COGNITION',
    '规则执行能力': 'RULE_EXECUTION',
    '情绪调节能力': 'EMOTION_REGULATION',
    '基础社交能力': 'BASIC_SOCIAL',
    '安全操作能力': 'SAFETY_OPERATION',
}

# (question_id, module_zh, sub_dim, task, scoring_point, difficulty)
SW_TASKS = [
    ('GA-FM-005','精细动作能力','双手配合','将5张错位的纸张图层拖拽对齐，再把夹子图标放到标记边。','拖拽精度、对齐顺序、误放和修正。',1),
    ('GA-FM-007','精细动作能力','插接操作','将6个插钉图标逐个拖入对应小孔，完成后再拖回收纳盒。','目标命中、拖拽稳定、顺序和归位。',1),
    ('GA-FM-008','精细动作能力','分拣操作','按系统逐次高亮的目标框，将12个圆片图标拖入对应区域。','连续拖拽准确率、节奏、错误后修正。',2),
    ('GA-FM-009','精细动作能力','堆叠稳定','将6个方块拖到基座上逐层对齐，系统检测重叠和中心偏差。','放置精度、调整次数、层间偏差。',1),
    ('GA-FM-010','精细动作能力','双手转换','一只手持续按住固定区，另一只手将5个图形依次拖到目标区；中途交换双手一次。','双手同时控制、换手、掉点和误触。',2),
    ('GA-FM-011','精细动作能力','规整摆放','将6个商品图拖到货架上，正面朝前、前沿对齐、间距在容差内。','方向、对齐、间距、修正。',2),
    ('GA-FM-013','精细动作能力','拆封操作','沿包装易撕条路径持续滑动至终点，再把封条图标拖入回收区。','持续轨迹、越界、动作顺序。',2),
    ('GA-COG-001','认知理解能力','视觉匹配','在8张图中点击与样图完全相同的2张。','正确数、漏选、误选。',1),
    ('GA-COG-002','认知理解能力','功能分类','将12件物品图片拖入文具、餐具、清洁用品三个区域。','分类正确、混淆类型、自我修正。',1),
    ('GA-COG-003','认知理解能力','同款归类','将8个外观相近的盒子图分成两组同款。','细节辨别、分组一致、修正。',1),
    ('GA-COG-004','认知理解能力','数量点数','点数1—10个物品并点击对应数字。','点数准确、重复计数、数字对应。',1),
    ('GA-COG-005','认知理解能力','数量比较','比较三组图，分别选择更多、较少或一样多。','数量比较、关系词理解。',1),
    ('GA-COG-006','认知理解能力','大小排序','把4个同形不同尺寸的盒子图按从大到小排列。','序列、比较策略、自纠。',1),
    ('GA-COG-007','认知理解能力','形状与位置匹配','将6个几何图形拖入对应轮廓。','形状匹配、方向判断、尝试策略。',1),
    ('GA-RULE-001','规则执行能力','开始信号','任务界面先出现材料但按钮锁定，听到/看到"开始"后进行30秒分拣。','提前反应、启动时延、任务正确。',1),
    ('GA-RULE-002','规则执行能力','停止信号','在连续整理中随机出现停止卡/提示音，受测者停止触控并等待继续。','停止反应、违规触控、恢复。',1),
    ('GA-RULE-003','规则执行能力','区域边界','在标记工作区内完成3分钟分类，物品不得拖出区域。','边界保持、越界、自纠。',1),
    ('GA-RULE-004','规则执行能力','工具归位','完成转移后，系统不自动结束，需将工具图标和剩余材料拖回标识位置。','收尾完整、归位、遗漏。',1),
    ('GA-RULE-005','规则执行能力','两步规则保持','连续摆放8个商品图，始终遵守正面朝前和放入边框两条规则。','双规则保持、漏规则、持续性。',2),
    ('GA-RULE-006','规则执行能力','三步流程执行','按取出材料、完成分类、放回原位三步完成一轮数字任务。','步骤顺序、漏步、重复。',2),
    ('GA-RULE-007','规则执行能力','工作核对','完成6件摆放后，对照样例主动检查并修正系统预设的1处错误。','主动核对、发现、修正准确。',2),
    ('GA-EMO-001','情绪调节能力','状态识别','在任务前后从状态卡中选择当前状态，可多选并选择强度。','是否作答、状态变化、表达方式。',1),
    ('GA-EMO-002','情绪调节能力','求助调节','遇到一个略难但安全的数字任务，界面提供求助入口，观察是否适时使用。','求助时机、具体性、是否继续尝试。',1),
    ('GA-EMO-003','情绪调节能力','错误恢复','任务中出现一处可修正结果，系统中性提示后允许撤销或重做。','恢复行动、持续尝试、策略使用。',2),
    ('GA-EMO-004','情绪调节能力','等待调节','在视觉计时器下等待60秒，期间可查看安静提示但不能开始下一任务。','等待完成、提前操作、策略。',1),
    ('GA-EMO-005','情绪调节能力','预告转换','系统提前1分钟提示当前任务将结束，并切换到下一任务。','转换完成、拖延、求助或休息策略。',1),
    ('GA-EMO-006','情绪调节能力','小变更适应','任务规则不变，但物品颜色或位置与预览不同，继续完成任务。','继续执行、确认、无效坚持旧布局。',2),
    ('GA-EMO-007','情绪调节能力','接受反馈','系统给出一条具体、中性的改进反馈，受测者选择继续、查看示例或求助。','反馈理解、策略选择、继续。',2),
    ('GA-SOC-001','基础社交能力','回应呼唤','在中性任务中随机播放一次姓名或个人称呼，受测者通过语音、AAC或确认按钮回应。','回应存在、时延、方式。',1),
    ('GA-SOC-002','基础社交能力','开始与结束交流','与虚拟同事完成一次开始和结束交流，使用语音、AAC或消息卡。','功能是否完整、时机、对象。',1),
    ('GA-SOC-003','基础社交能力','具体求助','面对缺少关键材料的任务，组合"我需要+材料/说明/协助"消息并发送。','求助具体性、对象、时机。',1),
    ('GA-SOC-004','基础社交能力','请求重复或澄清','音频指令包含模糊指代，受测者选择或表达"请再说一次/具体是哪一个"。','请求类型、针对性、时机。',2),
    ('GA-SOC-005','基础社交能力','任务状态汇报','系统生成完成、部分完成或受阻三种真实状态之一，受测者向虚拟负责人汇报。','真实性、完整性、对象。',2),
    ('GA-SOC-006','基础社交能力','接收物品与确认','虚拟同事发送一件数字材料，受测者接收后用确认按钮、AAC或语音确认。','接收、确认、时机。',1),
    ('GA-SOC-007','基础社交能力','意外后的修复','图片呈现无意碰落他人物品，受测者从动作卡中组合"停止—说明/道歉—协助恢复"。','承担信息、修复行动、是否求助。',2),
    ('GA-SAFE-001','安全操作能力','湿滑风险','观看湿滑地面图，按顺序选择停止靠近、设置提醒/隔离、报告或按授权处理。','危险识别、顺序、权限边界。',1),
    ('GA-SAFE-002','安全操作能力','电气风险','观看破损电线图，选择停止靠近、断开使用并报告。','风险识别、停止、上报。',1),
    ('GA-SAFE-003','安全操作能力','通道障碍','在通道障碍场景中点击安全路线，并选择报告或移除障碍的权限处理。','路线、安全距离、权限。',1),
    ('GA-SAFE-004','安全操作能力','破损尖锐物','观看破损玻璃/尖锐物图，选择隔离、使用指定工具或报告的安全处理。','接触风险、隔离、报告。',1),
    ('GA-SAFE-005','安全操作能力','未知液体/化学品','观看未知液体/无标签清洁剂泄漏图，将停止接触、隔离、报告、按指引处理排序。','未知风险、顺序、权限。',2),
    ('GA-SAFE-006','安全操作能力','高温风险','观看带高温标识的容器，选择停止触碰、保持距离和报告/使用授权防护。','标识理解、触碰风险、权限。',1),
    ('GA-SAFE-007','安全操作能力','高处取物','观看物品高于安全触及范围的场景，选择求助、使用授权踏台或等待处理。','高处风险、工具合规、求助。',1),
]

# (question_id, module_zh, sub_dim, material, retain_reason, difficulty)
OFFLINE_TASKS = [
    ('GA-FM-001','精细动作能力','指尖精细操作','标准操作盒：15毫米圆片10枚、防滑垫、目标杯。','触屏点击不能替代真实捏取与力度控制。',1),
    ('GA-FM-002','精细动作能力','工具夹持','标准操作盒：安全夹、软球8个、双杯。','软件拖拽不能测出夹具开合和真实握力。',1),
    ('GA-FM-003','精细动作能力','旋转操作','标准操作盒：两个空塑料瓶，统一松紧度。','软件旋转手势不能替代瓶身稳定和真实阻力。',1),
    ('GA-FM-004','精细动作能力','双手配合','标准操作盒：预印中线A5卡纸2张。','触屏折叠不能测出双手固定和纸张控制。',1),
    ('GA-FM-006','精细动作能力','穿引操作','标准操作盒：大孔珠5颗、加固绳端粗软绳。','软件目标拖拽不能替代双手穿引和深度控制。',1),
    ('GA-FM-012','精细动作能力','持物稳定与移动','共用低成本器材：轻质托盘、3个塑料空杯、地面标线。','软件无法测量真实持物稳定、步态和动态平衡。',2),
    ('GA-FM-016','精细动作能力','精细装配','标准操作盒：大号塑料螺母螺栓4组、样例卡。','软件旋转不能替代真实螺纹配合和双手稳定。',2),
    ('GA-SAFE-008','安全操作能力','轻物搬运姿势','学校常用空纸箱或塑料箱，重量统一且轻；两平台。','只能评估轻物搬运基础，不能外推到负重岗位能力。',1),
]

# offline rubric: criterion_id -> (desc_0, desc_1, desc_2)
OFFLINE_RUBRICS = {
    'GA-FM-001': [
        ('c1','未能捏起圆片或全部掉落。','能捏起但半数以上掉落或需多次尝试。','完成10枚捏取，掉落不超过2枚，动作稳定。'),
        ('c2','未将圆片放入目标杯。','放入但超过3枚偏出或需教师协助。','不超过2枚偏出，独立完成归杯。'),
    ],
    'GA-FM-002': [
        ('c1','无法操作夹具或全程无效夹取。','完成不足半数或夹具控制明显不稳。','完成8个软球夹取，错误不超过2次。'),
        ('c2','夹取后全部落球或无法放入杯中。','超过3个落球或需教师协助放入。','不超过2个落球，双杯分别归位。'),
    ],
    'GA-FM-003': [
        ('c1','无法握持瓶身或完全无旋转动作。','完成1瓶以下或方向反复错误。','两瓶均完成开合，无明显滑脱。'),
        ('c2','全程单手或瓶身持续倾斜。','偶尔双手配合，拧合不到位超过2次。','双手配合稳定，拧合力度适当。'),
    ],
    'GA-FM-004': [
        ('c1','无法对折或纸张完全位移。','完成对折但中线偏差超过1厘米。','中线对齐偏差在5毫米内，折痕清晰。'),
        ('c2','单手完成或另一手未起固定作用。','双手参与但固定手持续滑动。','双手分工明确，固定手稳定不滑动。'),
    ],
    'GA-FM-006': [
        ('c1','无法穿入任何珠子。','穿入不足3颗或需教师协助引导绳端。','5颗全部穿入，绳端自行引导完成。'),
        ('c2','完成后绳端散开或珠子脱落。','绳端固定不稳，1—2颗脱落。','绳端固定完好，无珠子脱落。'),
    ],
    'GA-FM-012': [
        ('c1','无法端起托盘或行走不足1米。','完成但空杯倒落超过2个或明显偏离标线。','空杯全部保持，沿标线完成3米行走。'),
        ('c2','全程跌跌撞撞或借助支撑物。','步态基本稳定但1次明显失衡。','步态稳定，无借助支撑物。'),
    ],
    'GA-FM-016': [
        ('c1','无法配对螺母螺栓或全程未能拧紧。','完成不足2组或螺纹未咬合即停止。','4组全部拧紧，参照样例卡。'),
        ('c2','单手完成或螺栓持续转动不稳。','双手参与但固定手持续脱手。','双手配合稳定，螺纹咬合完整。'),
    ],
    'GA-SAFE-008': [
        ('c1','无法双手握持或拒绝完成任务。','完成搬运但姿势明显危险（弯腰驼背、单手）。','双手握底，背部基本竖直完成搬运。'),
        ('c2','放置时直接投放或撞击平台。','放置时有冲击但可控。','轻放平台，无撞击声。'),
    ],
}

def sw_insert(row):
    qid, mod_zh, sub, task, score_pt, diff = row
    mod = MODULE_MAP[mod_zh]
    content = json.dumps({
        "schema_version": "question-content-v1.2",
        "question_type": "SOFTWARE_TASK",
        "prompt": task,
        "assessment_point": score_pt
    }, ensure_ascii=False)
    scoring = '{"scoring_type":"NO_SCORE","scoring_mode":"NONE"}'
    return (f"INSERT INTO question_bank"
            f"(question_id,job_code,bank_domain,module_type,job_module_code,question_type,item_usage,difficulty_level,content_json,scoring_rule_json,media_asset_id,tool_asset_ids_json,safety_sensitive,sensory_tags_json,status,version)"
            f" VALUES('{qid}','SUPERMARKET_SHELVER','BASE_ABILITY',"
            f"'{mod}',NULL,'SOFTWARE_TASK','SCORED_ITEM',{diff},"
            f"'{esc(content)}','{esc(scoring)}',NULL,NULL,0,NULL,'ACTIVE',1);")

def off_insert(row):
    qid, mod_zh, sub, material, reason, diff = row
    mod = MODULE_MAP[mod_zh]
    rubrics = OFFLINE_RUBRICS[qid]
    criteria_content = [{"criterion_id": c[0], "label": sub} for c in rubrics]
    criteria_scoring = [
        {"criterion_id": c[0], "description_0": c[1], "description_1": c[2], "description_2": c[3]}
        for c in rubrics
    ]
    content = json.dumps({
        "schema_version": "question-content-v1.2",
        "question_type": "OFFLINE_OPERATION",
        "prompt": sub + "：" + material,
        "assessment_point": reason,
        "offline_tool_brief": material,
        "rubric_criteria": criteria_content
    }, ensure_ascii=False)
    scoring = json.dumps({
        "scoring_type": "OFFLINE_RUBRIC",
        "criteria": criteria_scoring
    }, ensure_ascii=False)
    return (f"INSERT INTO question_bank"
            f"(question_id,job_code,bank_domain,module_type,job_module_code,question_type,item_usage,difficulty_level,content_json,scoring_rule_json,media_asset_id,tool_asset_ids_json,safety_sensitive,sensory_tags_json,status,version)"
            f" VALUES('{qid}','SUPERMARKET_SHELVER','BASE_ABILITY',"
            f"'{mod}',NULL,'OFFLINE_OPERATION','SCORED_ITEM',{diff},"
            f"'{esc(content)}','{esc(scoring)}',NULL,NULL,0,NULL,'ACTIVE',1);")

lines = ["BEGIN;"]
for row in SW_TASKS:
    lines.append(sw_insert(row))
for row in OFFLINE_TASKS:
    lines.append(off_insert(row))

# 更新 BASELINE 策略的 question_ratio（修复 INVALID_POLICY 根因）
lines.append(
    "UPDATE strategy_config SET question_policy_json = json_patch(question_policy_json, "
    "'{\"question_ratio\":{\"SOFTWARE_TASK\":42,\"OFFLINE_OPERATION\":8}}') "
    "WHERE strategy_id='strategy_baseline_shelver_v1';"
)
lines.append("COMMIT;")

out_path = 'doc/features/question-bank-import-base-ability.sql'
with open(out_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')
print(f"Written {len(lines) - 2} INSERT statements + 1 UPDATE → {out_path}")
