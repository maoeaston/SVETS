import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const paths = {
  candidates: resolve(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v1.json'),
  contentPacket: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-packet-chen-xiaoqing-v1.html'),
  safetyPacket: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-packet-he-dong-v1.html'),
  contentMarkdown: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-packet-chen-xiaoqing-v1.md'),
  safetyMarkdown: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-packet-he-dong-v1.md'),
  contentSchema: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-result-v1.schema.json'),
  safetySchema: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-v1.schema.json')
}

const generatedAt = '2026-07-20T00:00:00+08:00'

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function hashText(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function hashRecord(value) {
  return hashText(JSON.stringify(canonical(value)))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function scriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

function compactQuestion(candidate) {
  const content = candidate.proposed_question.content ?? {}
  const scoring = candidate.proposed_question.scoring_rule ?? {}
  const options = content.options ?? []
  const dragItems = content.drag_items ?? []
  const dropZones = content.drop_zones ?? []
  const rubric = Object.entries(scoring)
    .filter(([key, value]) => key.startsWith('score_') && key.endsWith('_description') && value)
    .map(([key, value]) => ({ key, text: value }))

  return {
    question_id: candidate.question_id,
    previous_question_id: candidate.previous_question_id,
    question_version: candidate.question_version,
    source_question_id: candidate.source_question_id,
    source_record_hash: candidate.source_record_hash,
    candidate_record_hash: candidate.candidate_record_hash,
    module: candidate.module,
    question_type: candidate.question_type,
    difficulty_level: candidate.difficulty_level,
    prompt: content.prompt,
    expected_answer: content.expected_answer ?? candidate.proposed_question.content?.candidate_answer ?? null,
    options,
    drag_items: dragItems,
    drop_zones: dropZones,
    rubric,
    media_asset_id: candidate.proposed_question.media_asset_id,
    media_brief: content.media_brief ?? null,
    tool_asset_ids: candidate.proposed_question.tool_asset_ids,
    sensory_tags: candidate.proposed_question.sensory_tags,
    safety_sensitive: candidate.proposed_question.safety_sensitive,
    safety_stop_conditions: candidate.proposed_question.safety_stop_conditions,
    revision_application: candidate.revision_application,
    review_result_refs: candidate.review_result_refs
  }
}

const candidateSetText = readFileSync(paths.candidates, 'utf8')
const candidateSet = JSON.parse(candidateSetText)
const sourceQuestions = candidateSet.questions.filter((question) => question.revision_application.semantic_change_re_review_required)

assert(candidateSet.summary.semantic_change_re_review_pending === 232, 'candidate summary must expect 232 semantic re-review questions')
assert(sourceQuestions.length === 232, `Expected 232 semantic change candidates, received ${sourceQuestions.length}`)
assert(new Set(sourceQuestions.map((question) => question.question_id)).size === 232, 'duplicate semantic change candidate question_id')
assert(sourceQuestions.every((question) => question.question_id.endsWith('_V2') && question.previous_question_id), 'semantic change candidates must be versioned V2 records')
for (const question of sourceQuestions) {
  const { candidate_record_hash: actual, ...record } = question
  assert(actual === hashRecord(record), `${question.question_id} candidate_record_hash mismatch`)
}

const questions = sourceQuestions.map(compactQuestion)
const packetSource = {
  candidate_set_id: candidateSet.candidate_set_id,
  candidate_set_hash: candidateSet.candidate_set_hash,
  candidate_set_file: 'doc/features/job-skill-shelver-298-question-revision-candidates-v1.json',
  candidate_set_file_hash: hashText(candidateSetText),
  generated_at: generatedAt,
  total: questions.length,
  summary_by_type: Object.fromEntries(['SINGLE_CHOICE', 'TRUE_FALSE', 'DRAG', 'OFFLINE_OPERATION'].map((type) => [
    type,
    questions.filter((question) => question.question_type === type).length
  ]))
}

function packageData(kind) {
  return {
    package_id: kind === 'content'
      ? 'job-skill-shelver-298-semantic-change-content-rereview-packet-chen-xiaoqing-v1'
      : 'job-skill-shelver-298-semantic-change-safety-technical-rereview-packet-he-dong-v1',
    package_version: 1,
    schema_version: kind === 'content'
      ? 'job-skill-shelver-298-semantic-change-content-rereview-result-v1'
      : 'job-skill-shelver-298-semantic-change-safety-technical-rereview-result-v1',
    reviewer_name: kind === 'content' ? '陈晓青' : '赫东',
    reviewer_role: kind === 'content' ? '内容与职业真实性复审' : '安全与技术复审',
    source: packetSource,
    questions
  }
}

const styles = `
:root{color-scheme:light;--ink:#202124;--muted:#5f6368;--line:#d9dde3;--soft:#f5f7fa;--accent:#0f766e;--warn:#b45309;--bad:#b91c1c;--ok:#15803d}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",Arial,sans-serif;color:var(--ink);background:#fff}
header{position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid var(--line);padding:14px 22px}
h1{font-size:20px;line-height:1.3;margin:0 0 6px}h2{font-size:17px;margin:0}.meta{color:var(--muted);font-size:13px;line-height:1.6}
.layout{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:calc(100vh - 78px)}
aside{border-right:1px solid var(--line);background:var(--soft);padding:14px;position:sticky;top:78px;height:calc(100vh - 78px);overflow:auto}
main{padding:18px 24px 48px;max-width:1180px}
.toolbar{display:grid;grid-template-columns:1fr 150px;gap:10px;margin-bottom:12px}.toolbar input,.toolbar select{height:36px;border:1px solid var(--line);border-radius:6px;padding:0 10px;background:#fff}
.nav{width:100%;display:grid;grid-template-columns:44px 1fr 12px;gap:8px;align-items:center;border:1px solid var(--line);background:#fff;border-radius:6px;padding:8px;margin-bottom:8px;text-align:left;cursor:pointer}
.nav small{display:block;color:var(--muted);margin-top:2px}.num{font-variant-numeric:tabular-nums;color:var(--muted)}.dot{width:10px;height:10px;border-radius:50%;background:#cbd5e1}.dot.done{background:var(--ok)}.dot.return{background:var(--warn)}
.card{border-bottom:1px solid var(--line);padding:18px 0 22px}.head{display:grid;grid-template-columns:52px 1fr auto;gap:12px;align-items:start}.index{width:40px;height:40px;border-radius:6px;background:#e0f2f1;color:#115e59;display:grid;place-items:center;font-weight:700}.status{border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:12px;color:var(--muted)}.status.done{color:var(--ok);border-color:#86efac}.status.return{color:var(--warn);border-color:#fbbf24}
.hash{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}.prompt{font-size:18px;line-height:1.55;margin:14px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.box{border:1px solid var(--line);border-radius:6px;padding:12px;background:#fff}.box b{display:block;margin-bottom:6px}.box p,.box li{line-height:1.55}.box p{white-space:pre-wrap;margin:0}.options,.criteria{margin:0;padding-left:22px}.review{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.field label{display:block;font-weight:650;margin-bottom:6px}.field select,.field textarea,.field input{width:100%;border:1px solid var(--line);border-radius:6px;padding:8px;background:#fff}.field textarea{min-height:82px;resize:vertical}.wide{grid-column:1/-1}.actions{position:sticky;bottom:0;background:#fff;border-top:1px solid var(--line);padding:12px 0;display:flex;gap:10px}.actions button{border:0;border-radius:6px;background:var(--accent);color:#fff;padding:10px 14px;font-weight:700;cursor:pointer}.actions button.secondary{background:#374151}.summary{font-weight:700}.notice{border-left:4px solid var(--warn);background:#fff7ed;padding:10px 12px;margin:12px 0;color:#7c2d12}
@media(max-width:900px){.layout{display:block}aside{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}main{padding:14px}.grid,.review{grid-template-columns:1fr}.head{grid-template-columns:44px 1fr}.status{grid-column:2}.toolbar{grid-template-columns:1fr}}
`

function renderDetail(question) {
  const answer = question.expected_answer === null ? '无结构化答案' : JSON.stringify(question.expected_answer)
  const options = question.options?.length ? `<ol class="options">${question.options.map((option) => `<li><b>${escapeHtml(option.key)}</b> ${escapeHtml(option.text)}</li>`).join('')}</ol>` : '<p>无选项</p>'
  const drag = question.drag_items?.length ? `<p>${escapeHtml(question.drag_items.map((item) => `${item.item_id}:${item.label}`).join('；'))}</p><p>${escapeHtml(question.drop_zones.map((zone) => `${zone.label}->${zone.accepts.join('/')}`).join('；'))}</p>` : '<p>无拖拽配置</p>'
  const rubric = question.rubric?.length ? `<ol class="criteria">${question.rubric.map((item) => `<li>${escapeHtml(item.key)}：${escapeHtml(item.text)}</li>`).join('')}</ol>` : '<p>无 0/1/2 锚点或结构化 rubric</p>'
  return `
      <div class="prompt">${escapeHtml(question.prompt)}</div>
      <div class="grid">
        <div class="box"><b>选项与答案</b>${options}<p>期望答案：<span class="hash">${escapeHtml(answer)}</span></p></div>
        <div class="box"><b>拖拽或分区</b>${drag}</div>
        <div class="box"><b>评分规则</b>${rubric}</div>
        <div class="box"><b>素材、工具与安全</b><p>${escapeHtml([
          question.media_brief ? `素材：${question.media_brief}` : null,
          question.media_asset_id ? `media_asset_id：${question.media_asset_id}` : null,
          question.tool_asset_ids ? `tool_asset_ids：${JSON.stringify(question.tool_asset_ids)}` : null,
          `safety_sensitive：${question.safety_sensitive}`,
          question.safety_stop_conditions ? `停止条件：${question.safety_stop_conditions}` : null
        ].filter(Boolean).join('\n'))}</p></div>
        <div class="box wide"><b>原审核意见与本次修订依据</b><p>${escapeHtml([
          `内容要求：${question.revision_application.content_review_requirement}`,
          `建议答案或达标行为：${question.revision_application.suggested_answer_or_behavior}`,
          `素材工具要求：${question.revision_application.material_tool_requirement}`,
          `安全要求：${question.revision_application.safety_requirement}`,
          `技术要求：${question.revision_application.technical_requirement}`,
          question.revision_application.conflict_resolution_requirement ? `人工裁决：${question.revision_application.conflict_resolution_requirement}` : null,
          `自动应用：${question.revision_application.automatically_applied_changes.join(', ') || '无，按审核要求绑定待复审'}`
        ].filter(Boolean).join('\n'))}</p></div>
      </div>`
}

function renderContentCard(question, index) {
  return `<section class="card" id="card-${index}">
    <div class="head"><div class="index">${index + 1}</div><div><h2>${escapeHtml(question.question_id)}@v${question.question_version}</h2><div class="meta">来源 ${escapeHtml(question.source_question_id)} · ${escapeHtml(question.question_type)} · <span class="hash">${escapeHtml(question.candidate_record_hash)}</span></div></div><span class="status" data-status="${escapeHtml(question.question_id)}">待填写</span></div>
    ${renderDetail(question)}
    <div class="review">
      ${selectField(question.question_id, 'content_conclusion', '内容复审结论', ['PASS:通过', 'RETURN_FOR_REVISION:退回复修'])}
      ${selectField(question.question_id, 'prompt_review', '题干表达', ['PASS:清楚自然', 'RETURN_FOR_REVISION:需要修改'])}
      ${selectField(question.question_id, 'occupational_authenticity_review', '职业真实性', ['PASS:符合理货员实际', 'RETURN_FOR_REVISION:需要修改或补边界'])}
      ${selectField(question.question_id, 'answer_or_rubric_review', '答案或 rubric', ['PASS:唯一且可判定', 'RETURN_FOR_REVISION:需要修改'])}
      ${selectField(question.question_id, 'material_tool_review', '素材与工具', ['PASS:足够制作和施测', 'RETURN_FOR_REVISION:需要补充', 'NOT_REQUIRED:本题不需要'])}
      ${selectField(question.question_id, 'safety_marker_decision', '安全敏感标记', ['KEEP:保持当前标记', 'ADD:应标记为安全敏感', 'REMOVE:应取消安全敏感'])}
      ${textField(question.question_id, 'review_note', '复审意见', '通过写“通过”；退回需说明修改点')}
      ${textField(question.question_id, 'material_tool_requirement', '素材、工具或施测补充', '无补充时写“无”')}
    </div>
  </section>`
}

function renderSafetyCard(question, index) {
  return `<section class="card" id="card-${index}">
    <div class="head"><div class="index">${index + 1}</div><div><h2>${escapeHtml(question.question_id)}@v${question.question_version}</h2><div class="meta">来源 ${escapeHtml(question.source_question_id)} · ${escapeHtml(question.question_type)} · <span class="hash">${escapeHtml(question.candidate_record_hash)}</span></div></div><span class="status" data-status="${escapeHtml(question.question_id)}">待填写</span></div>
    ${renderDetail(question)}
    <div class="review">
      ${selectField(question.question_id, 'safety_conclusion', '安全结论', ['PASS:通过', 'RETURN_FOR_REVISION:退回复修'])}
      ${selectField(question.question_id, 'technical_conclusion', '技术结论', ['PASS:通过', 'RETURN_FOR_REVISION:退回复修'])}
      ${selectField(question.question_id, 'renderer_review', 'Renderer 实际展示', ['PASS:可展示', 'RETURN_FOR_REVISION:退回'])}
      ${selectField(question.question_id, 'data_contract_review', '数据合同与哈希', ['PASS:通过', 'RETURN_FOR_REVISION:退回'])}
      ${selectField(question.question_id, 'material_tool_review', '素材与工具可执行性', ['PASS:通过', 'RETURN_FOR_REVISION:退回'])}
      ${selectField(question.question_id, 'safety_sensitive_decision', '最终安全敏感标记', ['SENSITIVE:安全敏感', 'NOT_SENSITIVE:非安全敏感'])}
      ${textField(question.question_id, 'stop_conditions', '停止条件', '敏感题和实操题必须写明；其余题填写“无额外停止条件”')}
      ${textField(question.question_id, 'technical_note', '技术审核备注', '通过写“通过”；退回需说明技术缺口')}
      ${textField(question.question_id, 'safety_note', '安全审核备注', '通过写“通过”；退回需说明安全风险')}
    </div>
  </section>`
}

function selectField(questionId, name, label, options) {
  return `<div class="field"><label for="${questionId}-${name}">${label}</label><select id="${questionId}-${name}" data-q="${questionId}" data-field="${name}" required><option value="">未选择</option>${options.map((item) => {
    const [value, text] = item.split(':')
    return `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`
  }).join('')}</select></div>`
}

function textField(questionId, name, label, placeholder) {
  return `<div class="field wide"><label for="${questionId}-${name}">${label}</label><textarea id="${questionId}-${name}" data-q="${questionId}" data-field="${name}" placeholder="${escapeHtml(placeholder)}" required></textarea></div>`
}

function renderPacket(kind) {
  const data = packageData(kind)
  const cards = data.questions.map(kind === 'content' ? renderContentCard : renderSafetyCard).join('\n')
  const title = kind === 'content' ? '232道语义变化候选内容复审 - 陈晓青' : '232道语义变化候选安全与技术复审 - 赫东'
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${styles}</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">候选集 ${escapeHtml(data.source.candidate_set_id)} · ${data.source.total} 题 · 仅复审新 candidate_record_hash，不具备激活授权</div>
</header>
<div class="layout">
  <aside>
    <div class="toolbar"><input id="query" placeholder="搜索题号或题干"><select id="filter"><option value="all">全部</option><option value="pending">待填写</option><option value="return">退回</option></select></div>
    <div class="summary" id="progress">0 / ${data.questions.length}</div>
    <div id="nav"></div>
  </aside>
  <main>
    <div class="notice">提交导出的 JSON 是机器可读复审结果。页面使用浏览器本地自动保存；关闭前请导出 JSON 留档。</div>
    <div class="grid">
      <div class="field"><label for="review-date">审核日期</label><input id="review-date" type="date" value="2026-07-20" required></div>
      <div class="field"><label for="reviewer">审核人</label><input id="reviewer" value="${escapeHtml(data.reviewer_name)}" readonly></div>
    </div>
    ${cards}
    <div class="actions"><button id="export">校验并导出 JSON</button><button class="secondary" id="clear" type="button">清除本地草稿</button></div>
  </main>
</div>
<script id="package-data" type="application/json">${scriptJson(data)}</script>
<script>
const DATA=JSON.parse(document.getElementById('package-data').textContent);
const KIND=${JSON.stringify(kind)};
const KEY='svets:'+DATA.package_id+':draft';
const state=JSON.parse(localStorage.getItem(KEY)||'{}');
state.answers=state.answers||{};
const q=(id)=>DATA.questions.find(item=>item.question_id===id);
function esc(v){return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function fields(){return [...document.querySelectorAll('[data-q][data-field]')]}
function answer(id){state.answers[id]=state.answers[id]||{};return state.answers[id]}
function conclusion(a){return KIND==='content'?a.content_conclusion:(a.safety_conclusion==='PASS'&&a.technical_conclusion==='PASS'?'PASS':'RETURN_FOR_REVISION')}
function complete(a){const names=KIND==='content'?['content_conclusion','prompt_review','occupational_authenticity_review','answer_or_rubric_review','material_tool_review','safety_marker_decision','review_note','material_tool_requirement']:['safety_conclusion','technical_conclusion','renderer_review','data_contract_review','material_tool_review','safety_sensitive_decision','stop_conditions','technical_note','safety_note'];return names.every(name=>String(a[name]||'').trim())}
function save(){state.reviewed_date=document.getElementById('review-date').value;localStorage.setItem(KEY,JSON.stringify(state));renderNav()}
function hydrate(){document.getElementById('review-date').value=state.reviewed_date||document.getElementById('review-date').value;fields().forEach(el=>{el.value=answer(el.dataset.q)[el.dataset.field]||'';el.oninput=()=>{answer(el.dataset.q)[el.dataset.field]=el.value;save()}});document.getElementById('review-date').oninput=save}
function renderNav(){const nav=document.getElementById('nav');const query=document.getElementById('query').value.trim().toLowerCase();const filter=document.getElementById('filter').value;nav.innerHTML='';let done=0;DATA.questions.forEach((item,index)=>{const a=answer(item.question_id);const isDone=complete(a);if(isDone)done++;const ret=isDone&&conclusion(a)!=='PASS';const hay=(item.question_id+' '+item.source_question_id+' '+item.prompt).toLowerCase();const visible=hay.includes(query)&&(filter==='all'||(filter==='pending'&&!isDone)||(filter==='return'&&ret));document.getElementById('card-'+index).hidden=!visible;const status=document.querySelector('[data-status="'+item.question_id+'"]');status.textContent=ret?'需退回':isDone?'已填写':'待填写';status.className='status '+(ret?'return':isDone?'done':'');const b=document.createElement('button');b.className='nav';b.hidden=!visible;b.innerHTML='<span class="num">'+String(index+1).padStart(3,'0')+'</span><div><strong>'+esc(item.question_id)+'</strong><small>'+esc(item.question_type+' · '+item.candidate_record_hash.slice(0,18))+'</small></div><span class="dot '+(ret?'return':isDone?'done':'')+'"></span>';b.onclick=()=>document.getElementById('card-'+index).scrollIntoView({behavior:'smooth',block:'start'});nav.appendChild(b)});document.getElementById('progress').textContent=done+' / '+DATA.questions.length}
function buildResult(){const reviewed_date=document.getElementById('review-date').value;if(!reviewed_date)throw new Error('缺少审核日期');const records=DATA.questions.map(item=>{const a=answer(item.question_id);if(!complete(a))throw new Error(item.question_id+' 未填写完整');const base={question_id:item.question_id,previous_question_id:item.previous_question_id,question_version:item.question_version,source_question_id:item.source_question_id,source_record_hash:item.source_record_hash,candidate_record_hash:item.candidate_record_hash,reviewer:DATA.reviewer_name,reviewed_date};if(KIND==='content'){return{...base,content_conclusion:a.content_conclusion,prompt_review:a.prompt_review,occupational_authenticity_review:a.occupational_authenticity_review,answer_or_rubric_review:a.answer_or_rubric_review,material_tool_review:a.material_tool_review,safety_marker_decision:a.safety_marker_decision,review_note:a.review_note.trim(),material_tool_requirement:a.material_tool_requirement.trim()}}return{...base,safety_conclusion:a.safety_conclusion,technical_conclusion:a.technical_conclusion,renderer_review:a.renderer_review,data_contract_review:a.data_contract_review,material_tool_review:a.material_tool_review,safety_sensitive_decision:a.safety_sensitive_decision,stop_conditions:a.stop_conditions.trim(),technical_note:a.technical_note.trim(),safety_note:a.safety_note.trim()}});return{schema_version:DATA.schema_version,result_id:DATA.package_id.replace('packet','result')+'-'+reviewed_date,status:'SUBMITTED_REVIEWER_EXPORT',package:{package_id:DATA.package_id,package_version:DATA.package_version},candidate_set:{candidate_set_id:DATA.source.candidate_set_id,candidate_set_hash:DATA.source.candidate_set_hash,candidate_set_file:DATA.source.candidate_set_file,candidate_set_file_hash:DATA.source.candidate_set_file_hash},reviewer:{name:DATA.reviewer_name,role:DATA.reviewer_role,reviewed_date,submitted_at:new Date().toISOString()},summary:{total:records.length,pass:records.filter(r=>(KIND==='content'?r.content_conclusion==='PASS':r.safety_conclusion==='PASS'&&r.technical_conclusion==='PASS')).length,return_for_revision:records.filter(r=>(KIND==='content'?r.content_conclusion!=='PASS':r.safety_conclusion!=='PASS'||r.technical_conclusion!=='PASS')).length},questions:records}}
document.getElementById('query').oninput=renderNav;document.getElementById('filter').oninput=renderNav;document.getElementById('clear').onclick=()=>{if(confirm('清除本地草稿？')){localStorage.removeItem(KEY);location.reload()}};
document.getElementById('export').onclick=()=>{try{const result=buildResult();const blob=new Blob([JSON.stringify(result,null,2)+'\\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=result.result_id+'.json';a.click();URL.revokeObjectURL(a.href)}catch(error){alert(error.message)}};
hydrate();renderNav();
</script>
</body>
</html>
`
}

function mdEscape(value) {
  return String(value ?? '').replaceAll('|', '\\|')
}

function renderMarkdownDetail(question) {
  const lines = [
    `- 新题目 ID / 版本：\`${question.question_id}\` / v${question.question_version}`,
    `- 原题目 ID：\`${question.source_question_id}\``,
    `- 原始记录 hash：\`${question.source_record_hash}\``,
    `- candidate_record_hash：\`${question.candidate_record_hash}\``,
    `- 题型：${question.question_type}`,
    `- 安全敏感：${question.safety_sensitive ? '是' : '否'}`,
    '',
    '**修订后题干：**',
    '',
    `> ${question.prompt}`,
    ''
  ]
  if (question.options.length) {
    lines.push('**修订后选项：**', '')
    for (const option of question.options) lines.push(`- ${option.key}. ${option.text}`)
    lines.push('')
  }
  if (question.drag_items.length) {
    lines.push('**拖拽项与答案区：**', '')
    for (const item of question.drag_items) lines.push(`- ${item.item_id}：${item.label}`)
    for (const zone of question.drop_zones) lines.push(`- ${zone.label} 接受：${zone.accepts.join('、')}`)
    lines.push('')
  }
  if (question.rubric.length) {
    lines.push('**评分规则 / rubric：**', '')
    for (const item of question.rubric) lines.push(`- ${item.key}：${item.text}`)
    lines.push('')
  }
  lines.push(
    '**素材、工具与安全停止条件：**',
    '',
    `- 素材说明：${question.media_brief ?? '无'}`,
    `- media_asset_id：${question.media_asset_id ?? '无'}`,
    `- tool_asset_ids：${question.tool_asset_ids ? JSON.stringify(question.tool_asset_ids) : '无'}`,
    `- safety_stop_conditions：${question.safety_stop_conditions ?? '无'}`,
    '',
    '**原审核意见与本次修订依据：**',
    '',
    `- 内容要求：${question.revision_application.content_review_requirement}`,
    `- 建议答案或达标行为：${question.revision_application.suggested_answer_or_behavior}`,
    `- 素材工具要求：${question.revision_application.material_tool_requirement}`,
    `- 安全要求：${question.revision_application.safety_requirement}`,
    `- 技术要求：${question.revision_application.technical_requirement}`,
    `- 人工裁决：${question.revision_application.conflict_resolution_requirement ?? '无'}`,
    `- 自动应用：${question.revision_application.automatically_applied_changes.join('、') || '无，按审核要求绑定待复审'}`
  )
  return lines.join('\n')
}

function renderMarkdown(kind) {
  const data = packageData(kind)
  const content = kind === 'content'
  const title = content ? '232道语义变化候选内容复审包（陈晓青）' : '232道语义变化候选安全与技术复审包（赫东）'
  const intro = [
    `# ${title}`,
    '',
    `**package_id：** \`${data.package_id}\`  `,
    `**候选集：** \`${data.source.candidate_set_id}\`  `,
    `**候选集 hash：** \`${data.source.candidate_set_hash}\`  `,
    `**候选集文件 hash：** \`${data.source.candidate_set_file_hash}\`  `,
    `**生成时间：** ${data.source.generated_at}  `,
    `**复审题数：** ${data.source.total}`,
    '',
    '## 填写规则',
    '',
    '- 本包只复审已发生语义变化的 V2 候选题。',
    '- 每题必须核对 `candidate_record_hash` 后填写结论。',
    '- 通过题写明“通过”；退回题写明必须修改的具体点。',
    '- 本 Markdown 是审核填写入口；交回后需固化为对应 JSON，JSON 才是机器可读权威结果。',
    '- 复审通过前不得激活题目、不得写运行库、不得生成激活 SQL。',
    '',
    '## 汇总',
    '',
    '| 题型 | 数量 |',
    '|---|---:|',
    ...Object.entries(data.source.summary_by_type).map(([type, total]) => `| ${type} | ${total} |`),
    '',
    '## 审核人信息',
    '',
    `- 审核人：${data.reviewer_name}`,
    `- 审核角色：${data.reviewer_role}`,
    '- 审核日期：YYYY-MM-DD',
    '- 审核人签名：',
    '',
    '---',
    ''
  ]
  const sections = data.questions.map((question, index) => {
    const fields = content
      ? [
          '- 内容复审结论：[ ] 通过 / [ ] 退回复修',
          '- 题干表达：[ ] 清楚自然 / [ ] 需要修改',
          '- 职业真实性：[ ] 符合理货员实际 / [ ] 需要修改或补充边界',
          '- 答案或 rubric：[ ] 唯一且可判定 / [ ] 需要修改',
          '- 素材与工具：[ ] 足够制作和施测 / [ ] 需要补充 / [ ] 本题不需要',
          '- 安全敏感标记：[ ] 保持当前标记 / [ ] 应标记为安全敏感 / [ ] 应取消安全敏感',
          '- 复审意见：',
          '> ',
          '- 素材、工具或施测补充：',
          '> '
        ]
      : [
          '- 安全结论：[ ] 通过 / [ ] 退回复修',
          '- 技术结论：[ ] 通过 / [ ] 退回复修',
          '- Renderer 实际展示：[ ] 可展示 / [ ] 退回',
          '- 数据合同与哈希：[ ] 通过 / [ ] 退回',
          '- 素材与工具可执行性：[ ] 通过 / [ ] 退回',
          '- 最终安全敏感标记：[ ] 安全敏感 / [ ] 非安全敏感',
          '- 停止条件：',
          '> ',
          '- 技术审核备注：',
          '> ',
          '- 安全审核备注：',
          '> '
        ]
    return [
      `## ${index + 1}. ${question.question_id} | ${question.question_type}`,
      '',
      renderMarkdownDetail(question),
      '',
      '**复审填写区：**',
      '',
      ...fields,
      '',
      '---',
      ''
    ].join('\n')
  })
  return `${intro.join('\n')}${sections.join('\n')}`
}

const sharedRecordProperties = {
  question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+_V2$' },
  previous_question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+$' },
  question_version: { const: 2 },
  source_question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+$' },
  source_record_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  candidate_record_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  reviewer: { type: 'string' },
  reviewed_date: { type: 'string', format: 'date' }
}

function resultSchema(kind) {
  const content = kind === 'content'
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: content ? 'Job Skill 298 Semantic Change Content Re-review Result' : 'Job Skill 298 Semantic Change Safety Technical Re-review Result',
    type: 'object',
    additionalProperties: false,
    required: ['schema_version', 'result_id', 'status', 'package', 'candidate_set', 'reviewer', 'summary', 'questions'],
    properties: {
      schema_version: { const: content ? 'job-skill-shelver-298-semantic-change-content-rereview-result-v1' : 'job-skill-shelver-298-semantic-change-safety-technical-rereview-result-v1' },
      result_id: { type: 'string', minLength: 1 },
      status: { const: 'SUBMITTED_REVIEWER_EXPORT' },
      package: {
        type: 'object',
        additionalProperties: false,
        required: ['package_id', 'package_version'],
        properties: {
          package_id: { const: content ? 'job-skill-shelver-298-semantic-change-content-rereview-packet-chen-xiaoqing-v1' : 'job-skill-shelver-298-semantic-change-safety-technical-rereview-packet-he-dong-v1' },
          package_version: { const: 1 }
        }
      },
      candidate_set: {
        type: 'object',
        additionalProperties: false,
        required: ['candidate_set_id', 'candidate_set_hash', 'candidate_set_file', 'candidate_set_file_hash'],
        properties: {
          candidate_set_id: { const: 'job-skill-shelver-298-question-revision-candidates-v1' },
          candidate_set_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
          candidate_set_file: { const: 'doc/features/job-skill-shelver-298-question-revision-candidates-v1.json' },
          candidate_set_file_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }
        }
      },
      reviewer: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'role', 'reviewed_date', 'submitted_at'],
        properties: {
          name: { const: content ? '陈晓青' : '赫东' },
          role: { const: content ? '内容与职业真实性复审' : '安全与技术复审' },
          reviewed_date: { type: 'string', format: 'date' },
          submitted_at: { type: 'string', format: 'date-time' }
        }
      },
      summary: {
        type: 'object',
        additionalProperties: false,
        required: ['total', 'pass', 'return_for_revision'],
        properties: {
          total: { const: 232 },
          pass: { type: 'integer', minimum: 0 },
          return_for_revision: { type: 'integer', minimum: 0 }
        }
      },
      questions: {
        type: 'array',
        minItems: 232,
        maxItems: 232,
        items: {
          type: 'object',
          additionalProperties: false,
          required: content
            ? ['question_id', 'previous_question_id', 'question_version', 'source_question_id', 'source_record_hash', 'candidate_record_hash', 'reviewer', 'reviewed_date', 'content_conclusion', 'prompt_review', 'occupational_authenticity_review', 'answer_or_rubric_review', 'material_tool_review', 'safety_marker_decision', 'review_note', 'material_tool_requirement']
            : ['question_id', 'previous_question_id', 'question_version', 'source_question_id', 'source_record_hash', 'candidate_record_hash', 'reviewer', 'reviewed_date', 'safety_conclusion', 'technical_conclusion', 'renderer_review', 'data_contract_review', 'material_tool_review', 'safety_sensitive_decision', 'stop_conditions', 'technical_note', 'safety_note'],
          properties: content
            ? {
                ...sharedRecordProperties,
                content_conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
                prompt_review: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
                occupational_authenticity_review: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
                answer_or_rubric_review: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
                material_tool_review: { enum: ['PASS', 'RETURN_FOR_REVISION', 'NOT_REQUIRED'] },
                safety_marker_decision: { enum: ['KEEP', 'ADD', 'REMOVE'] },
                review_note: { type: 'string', minLength: 1 },
                material_tool_requirement: { type: 'string', minLength: 1 }
              }
            : {
                ...sharedRecordProperties,
                safety_conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
                technical_conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
                renderer_review: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
                data_contract_review: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
                material_tool_review: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
                safety_sensitive_decision: { enum: ['SENSITIVE', 'NOT_SENSITIVE'] },
                stop_conditions: { type: 'string', minLength: 1 },
                technical_note: { type: 'string', minLength: 1 },
                safety_note: { type: 'string', minLength: 1 }
              }
        }
      }
    }
  }
}

writeFileSync(paths.contentPacket, renderPacket('content'))
writeFileSync(paths.safetyPacket, renderPacket('safety'))
writeFileSync(paths.contentMarkdown, renderMarkdown('content'))
writeFileSync(paths.safetyMarkdown, renderMarkdown('safety'))
// Result schemas belong to the ingestion step after reviewer evidence exists.
// Rebuilding a packet must never roll accepted-result contracts back to export shape.

console.log(`[job-skill-298-rereview] questions=${questions.length}`)
console.log(`[job-skill-298-rereview] content-md=${paths.contentMarkdown}`)
console.log(`[job-skill-298-rereview] safety-md=${paths.safetyMarkdown}`)
console.log(`[job-skill-298-rereview] content=${paths.contentPacket}`)
console.log(`[job-skill-298-rereview] safety=${paths.safetyPacket}`)
