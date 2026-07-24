import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const viewerPath = resolve(root, 'doc/reference/question-bank-viewer.html')
const candidatePath = resolve(root, 'doc/features/job-skill-shelver-pilot-revision-candidates-v3.json')
const data = JSON.parse(readFileSync(candidatePath, 'utf8'))
let html = readFileSync(viewerPath, 'utf8')

const START = '<!-- PILOT_V3_OVERLAY_START -->'
const END = '<!-- PILOT_V3_OVERLAY_END -->'

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

function renderQuestion(question) {
  const options = question.options?.length
    ? `<ol class="pilot-options">${question.options.map((option) => `<li class="${option.key === question.candidate_answer ? 'pilot-correct' : ''}"><b>${escapeHtml(option.key)}.</b> ${escapeHtml(option.text)}${option.key === question.candidate_answer ? ' ✓' : ''}</li>`).join('')}</ol>`
    : ''
  const tools = question.tools?.brief ? `<p><b>工具：</b>${escapeHtml(question.tools.brief)}</p>` : ''
  const anchors = question.rubric?.anchors
    ? `<div class="pilot-anchors">${['0', '1', '2'].map((score) => `<p><b>${score}分</b>${escapeHtml(question.rubric.anchors[score])}</p>`).join('')}</div>`
    : ''
  const asset = question.presentation?.asset_requirements?.length
    ? `<details><summary>素材生产条件</summary><ul>${question.presentation.asset_requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>`
    : ''
  const previous = question.previous_question_id ? `<span class="pilot-replaces">替代 ${escapeHtml(question.previous_question_id)}</span>` : ''
  return `<article class="pilot-card" data-pilot-id="${escapeHtml(question.question_id)}">
    <div class="pilot-card-head"><div><span class="pilot-id">${escapeHtml(question.question_id)}@${question.question_version}</span>${previous}</div><span class="pilot-type">${escapeHtml(question.module)} · ${escapeHtml(question.question_type)}</span></div>
    <h3>${escapeHtml(question.prompt)}</h3>${options}${tools}${anchors}
    <p class="pilot-safety"><b>停止条件：</b>${escapeHtml(question.safety?.proposed_stop_conditions || '无额外现场停止条件')}</p>
    ${asset}<p class="pilot-hash">${escapeHtml(question.candidate_record_hash)}</p>
  </article>`
}

const viewerReplacements = { ...data.supersession_map, M2_SC_005: 'M2_SC_005_V3' }
const supersessionJson = JSON.stringify(viewerReplacements).replaceAll('<', '\\u003c')
const overlay = `${START}
<style>
.pilot-authority{margin:18px 24px;padding:18px;border:1px solid #b8c59b;border-radius:12px;background:#f7f9f1;color:#28301f}.pilot-authority h2{margin:0 0 6px;font-size:18px}.pilot-authority p{margin:4px 0;line-height:1.55}.pilot-authority code{font-size:12px;overflow-wrap:anywhere}.pilot-grid{margin:14px 24px 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px}.pilot-card{min-width:0;padding:15px;border:1px solid #cdd7bc;border-left:4px solid #657a3f;border-radius:10px;background:#fff}.pilot-card-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.pilot-id{font:700 12px/1.4 ui-monospace,monospace;color:#405128}.pilot-type,.pilot-replaces{font-size:11px;color:#6d7563}.pilot-replaces{margin-left:8px;padding:2px 6px;border-radius:99px;background:#fff0e7;color:#9b431f}.pilot-card h3{margin:9px 0;font-size:15px;line-height:1.55}.pilot-options{padding-left:22px;line-height:1.65}.pilot-correct{color:#35621f;font-weight:600}.pilot-card p,.pilot-card li{overflow-wrap:anywhere}.pilot-anchors{display:grid;gap:5px;margin:9px 0}.pilot-anchors p{display:grid;grid-template-columns:38px minmax(0,1fr);gap:7px;margin:0;padding:7px 9px;border-radius:6px;background:#f3f6ed;line-height:1.5}.pilot-safety{margin:10px 0;padding:8px 10px;border-left:3px solid #c45b2d;background:#fff5ee;line-height:1.55}.pilot-card details{margin-top:8px}.pilot-card details ul{padding-left:20px;line-height:1.55}.pilot-hash{margin-top:9px;color:#8a9182;font:10px/1.4 ui-monospace,monospace}.legacy-superseded{opacity:.58}.legacy-notice{margin-top:7px;padding:5px 7px;border-radius:5px;background:#fff0e7;color:#9b431f;font-size:11px;font-weight:700}@media(max-width:600px){.pilot-authority{margin:12px}.pilot-grid{margin:12px;grid-template-columns:minmax(0,1fr)}.pilot-card-head{display:grid}.grid{padding:12px;grid-template-columns:minmax(0,1fr)}.toolbar{position:static;padding:10px 12px}.stats{padding:10px 12px;gap:14px}#search{width:100%;min-width:0}.card{min-width:0}.card-header{flex-wrap:wrap}.card-tags{min-width:0}.media-badges .badge{max-width:100%;white-space:normal;overflow-wrap:anywhere}}
</style>
<section class="pilot-authority" id="pilot-current">
  <h2>当前 Pilot 权威候选，strategy v3</h2>
  <p><strong>题目、图片、视频和教具制作以本区24题为准。</strong> 下方394题是原始来源总览，只用于追溯，不得覆盖当前候选。</p>
  <p>机器合同：<code>doc/features/job-skill-shelver-pilot-revision-candidates-v3.json</code>，状态：PENDING，尚未授权激活。</p>
</section>
<section class="pilot-grid">${data.questions.map(renderQuestion).join('')}</section>
<script>
document.addEventListener('DOMContentLoaded',()=>{const replacements=${supersessionJson};document.querySelectorAll('#grid .card').forEach(card=>{const id=card.querySelector('.card-id')?.textContent?.trim();if(!id||!replacements[id])return;card.classList.add('legacy-superseded');const note=document.createElement('div');note.className='legacy-notice';note.textContent='历史源题，当前 Pilot 使用 '+replacements[id];card.querySelector('.card-header')?.after(note)})});
</script>
${END}`

if (html.includes(START)) {
  html = html.replace(new RegExp(`${START}[\\s\\S]*?${END}`), overlay)
} else {
  html = html.replace('<body>', `<body>\n${overlay}`)
}
html = html
  .replace('<title>SVETS 题库总览 — 394题</title>', '<title>SVETS 当前 Pilot 候选与原始题库总览</title>')
  .replace('<h1>SVETS 题库总览</h1>', '<h1>SVETS 原始题库总览，历史来源区</h1>')
  .replace('BASE_ABILITY 96题（蓝色边框）+ JOB_SPECIFIC 298题（绿色边框），共 394题 | 紫色/橙色徽章 = 有媒体/交互需求', '下方394题为原始来源视图；当前 Pilot 生产题目请使用页面顶部 strategy v3 区域')

writeFileSync(viewerPath, html)
console.log(`[question-bank-viewer] Pilot v3 overlay updated: ${data.questions.length} questions`)
