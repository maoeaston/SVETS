#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const docRoot = join(projectRoot, 'doc')
const outputPath = join(docRoot, 'doc-map.html')
const textExtensions = new Set(['.md', '.json', '.sql', '.html', '.txt', '.tsv', '.py'])
const moduleRoots = ['src/main', 'src/shared', 'src/renderer/src', 'scripts']

function toPosixPath(value) {
  return value.replace(/\\/g, '/')
}

function listFiles(rootPath) {
  return readdirSync(rootPath, { withFileTypes: true }).flatMap((entry) => {
    const path = join(rootPath, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })
}

function readText(path) {
  if (!textExtensions.has(extname(path).toLowerCase())) return ''
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function stripGeneratedInventory(text) {
  return text.replace(/<!-- AUTO-GENERATED:DOC-INVENTORY:START -->[\s\S]*?<!-- AUTO-GENERATED:DOC-INVENTORY:END -->/, '')
}

function cleanInline(value) {
  return value
    .replace(/^#{1,6}\s+/, '')
    .replace(/[`*_>#|]/g, '')
    .replace(/｜/g, ' · ')
    .replace(/\[[^\]]+\]\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getTitle(text, path) {
  const h1 = text.match(/^#\s+(.+)$/m)?.[1]
  if (h1) return cleanInline(h1)
  const featureName = text.match(/^##\s+功能名称\s*$\r?\n\s*([^\r\n]+)/m)?.[1]
  if (featureName) return cleanInline(featureName)
  return basename(path)
}

function getExcerpt(text, fallback) {
  const lines = text
    .split(/\r?\n/)
    .map(cleanInline)
    .filter((line) => line.length > 18 && !line.startsWith('```') && !line.startsWith('---'))
  const candidate = lines.find((line) => !/^(文档状态|当前产品合同|关联 PRD|对应 Mini-PRD|来源 PRD)/.test(line))
  return (candidate ?? fallback).slice(0, 160)
}

function classify(path, text) {
  const normalized = path.toLowerCase()
  const preamble = text.slice(0, 900).toLowerCase()
  if (normalized.endsWith('/mvp_prd_v1.0.9-authoritative.md')) {
    return { status: 'AUTHORITATIVE', statusLabel: '当前权威', role: 'MVP 范围、运行时合同与验收标准' }
  }
  if (normalized.includes('v2.2-authoritative-baseline')) {
    return { status: 'AUTHORITATIVE', statusLabel: '当前权威', role: '方案 B 多设备架构实施基线' }
  }
  if (normalized.includes('/specs/impl/')) {
    return { status: 'IMPLEMENTED', statusLabel: '实施追溯', role: '历史实现决策、验收计划或任务拆解' }
  }
  const superseded =
    normalized.includes('/archive/') ||
    normalized.includes('已废弃') ||
    /^(?:#|>)?\s*.*\b(superseded|retired)\b|^(?:#|>)?\s*.*已废止/.test(preamble)
  if (superseded) return { status: 'HISTORY', statusLabel: '历史追溯', role: '归档、废止版本或历史实施资料' }
  if (normalized.includes('/assets/asset-manifest') || normalized.includes('/reference/')) {
    return { status: 'REFERENCE', statusLabel: '参考输入', role: normalized.includes('manifest') ? '机器可读的视觉资产合同' : '源数据、研究资料或视觉规划输入' }
  }
  if (normalized.includes('/assets/')) {
    return { status: 'ACTIVE', statusLabel: '活跃资产合同', role: '资产模板、审核记录或结构约束' }
  }
  if (normalized.includes('/specs/')) {
    return { status: 'ACTIVE', statusLabel: '活跃规范', role: '跨功能数据、事件、题库或架构规范' }
  }
  if (normalized.includes('/features/')) {
    if (normalized.endsWith('-prd.md')) return { status: 'ACTIVE', statusLabel: '活跃 Mini-PRD', role: '功能范围、边界条件和验收输入' }
    if (normalized.endsWith('-impl.md')) return { status: 'ACTIVE', statusLabel: '活跃实现文档', role: '代码模块、步骤、测试与落地范围' }
    return { status: 'ACTIVE', statusLabel: '活跃工作文档', role: '功能流程、生产 SOP 或上线门禁' }
  }
  if (normalized.endsWith('/index.md')) return { status: 'ACTIVE', statusLabel: '导航索引', role: '人工维护的文档阅读入口与权威性说明' }
  return { status: 'ACTIVE', statusLabel: '会话文档', role: '开发会话启动、恢复或交接清单' }
}

function docAliases(path) {
  const docRelative = path.replace(/^doc\//, '')
  return [path, docRelative, basename(path)]
}

function normalizeForScript(value) {
  return value.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

function buildData() {
  const docPaths = listFiles(docRoot)
    .filter((path) => path !== outputPath)
    .map((path) => toPosixPath(relative(projectRoot, path)))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
  const modulePaths = moduleRoots
    .flatMap((root) => listFiles(join(projectRoot, root)))
    .map((path) => toPosixPath(relative(projectRoot, path)))
    .filter((path) => /\.(ts|vue|mjs|sql)$/.test(path))
    .sort()
  const docs = docPaths.map((path) => {
    const absolutePath = join(projectRoot, path)
    const text = readText(absolutePath)
    const classification = classify(path, text)
    return {
      id: path,
      path,
      folder: path.split('/').slice(0, -1).join('/') || 'doc',
      extension: extname(path).slice(1).toUpperCase() || 'FILE',
      bytes: statSync(absolutePath).size,
      title: getTitle(text, basename(path)),
      excerpt: getExcerpt(text, classification.role),
      ...classification,
      outgoing: [],
      incoming: [],
      modules: [],
      missingModules: [],
      counterpart: null
    }
  })
  const byPath = new Map(docs.map((doc) => [doc.path, doc]))
  const moduleLikePattern = /(?:src\/(?:main|shared|renderer\/src)\/[^\s`'"<>|)]+\.(?:ts|vue)|scripts\/[^\s`'"<>|)]+\.mjs)/g

  for (const doc of docs) {
    let text = readText(join(projectRoot, doc.path))
    if (doc.path === 'doc/index.md') text = stripGeneratedInventory(text)
    if (!text) continue
    for (const target of docs) {
      if (target.path === doc.path) continue
      if (docAliases(target.path).some((alias) => alias.length > 8 && text.includes(alias))) doc.outgoing.push(target.path)
    }
    for (const target of modulePaths) if (text.includes(target)) doc.modules.push(target)
    const mentioned = new Set(text.match(moduleLikePattern) ?? [])
    for (const path of mentioned) if (!modulePaths.includes(path)) doc.missingModules.push(path)
  }

  for (const doc of docs) {
    doc.outgoing = [...new Set(doc.outgoing)].sort()
    doc.modules = [...new Set(doc.modules)].sort()
    doc.missingModules = [...new Set(doc.missingModules)].sort()
    for (const targetPath of doc.outgoing) byPath.get(targetPath)?.incoming.push(doc.path)
    const match = doc.path.match(/^doc\/features\/([^/]+)-(prd|impl)\.md$/)
    if (match) {
      const counterpart = `doc/features/${match[1]}-${match[2] === 'prd' ? 'impl' : 'prd'}.md`
      if (byPath.has(counterpart)) doc.counterpart = counterpart
    }
  }
  for (const doc of docs) doc.incoming.sort()

  return {
    generatedAt: new Date().toISOString(),
    docs,
    folders: [...new Set(docs.map((doc) => doc.folder))].sort((left, right) => left.localeCompare(right, 'zh-CN')),
    totals: {
      docs: docs.length,
      active: docs.filter((doc) => doc.status === 'ACTIVE' || doc.status === 'AUTHORITATIVE').length,
      history: docs.filter((doc) => doc.status === 'HISTORY' || doc.status === 'IMPLEMENTED').length,
      modules: new Set(docs.flatMap((doc) => doc.modules)).size
    }
  }
}

function renderPage(data) {
  const serializedData = normalizeForScript(JSON.stringify(data))
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SVETS 文档地图</title>
  <style>
    :root { --ink: #17231f; --muted: #66736d; --line: #d8dfda; --paper: #f6f6f1; --panel: #ffffff; --teal: #0b7465; --teal-soft: #d9f0e9; --amber: #e5aa38; --amber-soft: #fff0c9; --rose: #b84857; --rose-soft: #f9e2e4; --blue: #306f9f; --blue-soft: #dcecf7; --violet: #7155a4; --violet-soft: #ebe5f5; --radius: 6px; }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: var(--paper); font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; letter-spacing: 0; }
    button, input { font: inherit; letter-spacing: 0; }
    button { color: inherit; cursor: pointer; }
    .app { min-height: 100vh; display: grid; grid-template-rows: auto auto minmax(0, 1fr); }
    .masthead { display: flex; align-items: center; gap: 14px; padding: 18px 24px 15px; background: #17231f; color: #f7fbf8; border-bottom: 4px solid var(--amber); }
    .brand-mark { width: 35px; height: 35px; object-fit: contain; border-radius: 4px; background: #fff; padding: 3px; }
    .eyebrow { color: #a9c7bd; font: 600 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
    h1 { margin: 2px 0 0; font-size: 22px; line-height: 1.15; font-weight: 720; }
    .header-meta { margin-left: auto; text-align: right; color: #c4d1ca; font-size: 12px; line-height: 1.45; }
    .header-meta strong { color: #fff; font-weight: 650; }
    .overview { display: grid; grid-template-columns: minmax(260px, 1fr) repeat(4, minmax(108px, .42fr)); gap: 1px; background: var(--line); border-bottom: 1px solid var(--line); }
    .overview > div { min-height: 84px; padding: 14px 24px; background: var(--panel); }
    .overview-label { color: var(--muted); font-size: 12px; }
    .overview-value { display: block; margin-top: 3px; font-size: 24px; line-height: 1; font-weight: 720; }
    .overview-text { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .workspace { min-height: 0; display: grid; grid-template-columns: 240px minmax(430px, 1fr) 390px; }
    .sidebar, .details { min-height: 0; overflow: auto; background: var(--panel); }
    .sidebar { border-right: 1px solid var(--line); padding: 18px 12px; }
    .details { border-left: 1px solid var(--line); padding: 18px; }
    .section-title { margin: 0 0 10px; color: var(--muted); font: 650 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
    .tree-button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 9px; min-height: 32px; padding: 6px 8px; border: 0; border-left: 3px solid transparent; background: transparent; text-align: left; }
    .tree-button:hover { background: #f0f3f0; }
    .tree-button.selected { background: var(--teal-soft); border-left-color: var(--teal); font-weight: 650; }
    .tree-label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .tree-count, .count { flex: 0 0 auto; color: var(--muted); font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .legend { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--line); }
    .legend-row { display: flex; align-items: center; gap: 8px; margin: 9px 0; color: var(--muted); font-size: 12px; }
    .status-dot { width: 9px; height: 9px; flex: 0 0 9px; border-radius: 50%; background: var(--blue); }
    .status-dot.authoritative { background: var(--teal); }.status-dot.active { background: var(--blue); }.status-dot.reference { background: var(--amber); }.status-dot.history { background: var(--rose); }.status-dot.implemented { background: var(--violet); }
    .catalog { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); }
    .catalog-top { padding: 18px 20px 12px; background: var(--panel); }
    .search { width: 100%; height: 38px; padding: 0 12px; border: 1px solid #b9c6be; border-radius: 4px; outline: none; color: var(--ink); background: #fbfcfa; }
    .search:focus { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(11,116,101,.13); }
    .filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 20px 14px; background: var(--panel); border-bottom: 1px solid var(--line); }
    .filter { min-height: 29px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 3px; background: #fff; color: #4f5b55; font-size: 12px; }
    .filter:hover { border-color: #91aa9f; }.filter.active { border-color: var(--teal); background: var(--teal-soft); color: #075e52; font-weight: 650; }
    .list-wrap { min-height: 0; overflow: auto; }
    .file-row { width: 100%; display: grid; grid-template-columns: 9px minmax(0, 1fr) 86px 62px; gap: 10px; align-items: center; min-height: 69px; padding: 10px 20px; border: 0; border-bottom: 1px solid #e5e9e6; background: transparent; text-align: left; }
    .file-row:hover { background: #f4f8f5; }.file-row.selected { background: #e5f3ec; box-shadow: inset 3px 0 0 var(--teal); }
    .file-main { min-width: 0; }.file-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 660; line-height: 1.35; }.file-path { overflow: hidden; margin-top: 3px; color: var(--muted); font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }.file-summary { margin-top: 3px; color: #6d7973; font-size: 12px; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }.file-ref { color: var(--muted); text-align: right; font-size: 11px; line-height: 1.3; }.type-badge { justify-self: end; padding: 3px 5px; border: 1px solid var(--line); border-radius: 3px; color: var(--muted); font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .empty { padding: 42px 20px; color: var(--muted); text-align: center; }
    .detail-top { padding-bottom: 15px; border-bottom: 1px solid var(--line); }.detail-status { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; }.detail-title { margin: 9px 0 6px; font-size: 20px; line-height: 1.3; }.detail-path { color: var(--muted); overflow-wrap: anywhere; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }.detail-excerpt { margin: 12px 0 0; color: #4d5a54; line-height: 1.55; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; margin: 16px 0; background: var(--line); border: 1px solid var(--line); }.detail-grid div { padding: 10px; background: #fafbf9; }.detail-grid span { display: block; color: var(--muted); font-size: 11px; }.detail-grid strong { display: block; margin-top: 3px; font: 600 14px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .detail-section { margin-top: 19px; }.detail-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 0 0 8px; font-size: 12px; font-weight: 720; }.relation-list { display: flex; flex-direction: column; gap: 5px; }.relation { width: 100%; display: flex; align-items: center; gap: 7px; padding: 7px 8px; border: 1px solid #e1e6e2; border-radius: 4px; background: #fff; text-align: left; }.relation:hover { border-color: #8eb1a3; background: #f2f7f4; }.relation-text { min-width: 0; overflow: hidden; font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }.module { display: block; padding: 7px 8px; border-left: 3px solid var(--amber); background: #fffbf1; color: #47534d; overflow-wrap: anywhere; font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; }.missing { border-left-color: var(--rose); background: #fff5f5; }.detail-empty { color: var(--muted); font-size: 12px; line-height: 1.5; }
    .counterpart { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px; border: 1px solid #b9ddd1; border-radius: 4px; background: var(--teal-soft); }.counterpart button { min-width: 0; padding: 0; border: 0; color: #075e52; background: transparent; text-align: left; font: 600 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.counterpart span { color: #287164; font-size: 11px; white-space: nowrap; }
    .hidden { display: none !important; }
    @media (max-width: 1120px) { .workspace { grid-template-columns: 210px minmax(380px, 1fr) 330px; }.overview > div { padding-inline: 15px; } }
    @media (max-width: 820px) { .header-meta { display: none; }.overview { grid-template-columns: repeat(2, 1fr); }.overview > div:first-child { grid-column: 1 / -1; }.workspace { grid-template-columns: 1fr; }.sidebar { display: none; }.details { border-left: 0; border-top: 1px solid var(--line); max-height: none; }.catalog { min-height: 510px; }.file-row { grid-template-columns: 9px minmax(0, 1fr) 50px; }.file-ref { display: none; } }
  </style>
</head>
<body>
  <main class="app">
    <header class="masthead">
      <img class="brand-mark" src="reference/xuancanlogo.png" alt="炫灿">
      <div><div class="eyebrow">SVETS / information architecture</div><h1>文档地图</h1></div>
      <div class="header-meta"><strong id="generated-at"></strong><br>由仓库文档与代码路径关系生成</div>
    </header>
    <section class="overview" aria-label="文档概览">
      <div><div class="overview-label">当前工作集</div><span class="overview-value" id="workset-count"></span><p class="overview-text">权威合同、活跃规范与功能实施文档</p></div>
      <div><div class="overview-label">文档文件</div><span class="overview-value" id="doc-count"></span><p class="overview-text">含机器合同与源数据</p></div>
      <div><div class="overview-label">已接入模块</div><span class="overview-value" id="module-count"></span><p class="overview-text">文档明确落点的现存代码</p></div>
      <div><div class="overview-label">历史资料</div><span class="overview-value" id="history-count"></span><p class="overview-text">归档、已废止与实施快照</p></div>
      <div><div class="overview-label">视图结果</div><span class="overview-value" id="result-count"></span><p class="overview-text">随目录、状态和检索更新</p></div>
    </section>
    <section class="workspace">
      <aside class="sidebar"><h2 class="section-title">目录</h2><div id="folder-tree"></div><div class="legend"><h2 class="section-title">状态</h2><div class="legend-row"><i class="status-dot authoritative"></i>当前权威</div><div class="legend-row"><i class="status-dot active"></i>活跃工作文档</div><div class="legend-row"><i class="status-dot reference"></i>参考输入</div><div class="legend-row"><i class="status-dot implemented"></i>实施追溯</div><div class="legend-row"><i class="status-dot history"></i>历史追溯</div></div></aside>
      <section class="catalog" aria-label="文档清单">
        <div class="catalog-top"><input id="search" class="search" type="search" placeholder="搜索文件名、标题、用途或代码模块" autocomplete="off"></div>
        <div class="filters" id="filters"><button class="filter active" data-status="WORKING">当前工作集</button><button class="filter" data-status="ALL">全部</button><button class="filter" data-status="AUTHORITATIVE">当前权威</button><button class="filter" data-status="ACTIVE">活跃</button><button class="filter" data-status="REFERENCE">参考输入</button><button class="filter" data-status="IMPLEMENTED">实施追溯</button><button class="filter" data-status="HISTORY">历史</button></div>
        <div class="list-wrap" id="file-list"></div>
      </section>
      <aside class="details" id="details" aria-live="polite"></aside>
    </section>
  </main>
  <script>
    const data = ${serializedData};
    const byPath = new Map(data.docs.map(doc => [doc.path, doc]));
    const state = { folder: 'ALL', status: 'WORKING', query: '', selected: null };
    const statusClass = { AUTHORITATIVE: 'authoritative', ACTIVE: 'active', REFERENCE: 'reference', HISTORY: 'history', IMPLEMENTED: 'implemented' };
    const statusRank = { AUTHORITATIVE: 0, ACTIVE: 1, REFERENCE: 2, IMPLEMENTED: 3, HISTORY: 4 };
    const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    const formatBytes = bytes => bytes < 1024 ? bytes + ' B' : bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    function folderLabel(folder) { return folder.replace(/^doc\\/?/, '') || 'doc / 根目录'; }
    function isInWorkingSet(doc) { return doc.status === 'AUTHORITATIVE' || doc.status === 'ACTIVE'; }
    function filteredDocs() {
      const query = state.query.trim().toLocaleLowerCase();
      return data.docs.filter(doc => {
        const folderMatch = state.folder === 'ALL' || doc.folder === state.folder || doc.folder.startsWith(state.folder + '/');
        const statusMatch = state.status === 'ALL' || state.status === 'WORKING' ? (state.status === 'ALL' || isInWorkingSet(doc)) : doc.status === state.status;
        const haystack = [doc.path, doc.title, doc.excerpt, doc.role, ...doc.modules, ...doc.missingModules].join(' ').toLocaleLowerCase();
        return folderMatch && statusMatch && (!query || haystack.includes(query));
      }).sort((left, right) => statusRank[left.status] - statusRank[right.status] || left.path.localeCompare(right.path, 'zh-CN'));
    }
    function select(path) { state.selected = path; render(); const details = document.querySelector('#details'); if (window.innerWidth <= 820) details?.scrollIntoView({ behavior: 'smooth', block: 'start' }); else details?.scrollTo({ top: 0 }); }
    function relationButton(path, label) { const doc = byPath.get(path); return '<button class="relation" data-select="' + escapeHtml(path) + '"><i class="status-dot ' + statusClass[doc.status] + '"></i><span class="relation-text">' + escapeHtml(label ?? doc.path) + '</span></button>'; }
    function renderTree() {
      const folders = ['ALL', ...data.folders];
      document.querySelector('#folder-tree').innerHTML = folders.map(folder => {
        const count = folder === 'ALL' ? data.docs.length : data.docs.filter(doc => doc.folder === folder || doc.folder.startsWith(folder + '/')).length;
        return '<button class="tree-button ' + (state.folder === folder ? 'selected' : '') + '" data-folder="' + escapeHtml(folder) + '"><span class="tree-label">' + escapeHtml(folder === 'ALL' ? '全部目录' : folderLabel(folder)) + '</span><span class="tree-count">' + count + '</span></button>';
      }).join('');
    }
    function renderList() {
      const docs = filteredDocs();
      document.querySelector('#result-count').textContent = docs.length;
      document.querySelector('#file-list').innerHTML = docs.length ? docs.map(doc => '<button class="file-row ' + (state.selected === doc.path ? 'selected' : '') + '" data-select="' + escapeHtml(doc.path) + '"><i class="status-dot ' + statusClass[doc.status] + '"></i><span class="file-main"><span class="file-title">' + escapeHtml(doc.title) + '</span><span class="file-path">' + escapeHtml(doc.path) + '</span><span class="file-summary">' + escapeHtml(doc.role) + '</span></span><span class="file-ref">被引用 ' + doc.incoming.length + '<br>模块 ' + doc.modules.length + '</span><span class="type-badge">' + escapeHtml(doc.extension) + '</span></button>').join('') : '<div class="empty">没有匹配的文档。</div>';
      if (!state.selected || !docs.some(doc => doc.path === state.selected)) state.selected = docs[0]?.path ?? null;
    }
    function renderDetail() {
      const doc = byPath.get(state.selected);
      const container = document.querySelector('#details');
      if (!doc) { container.innerHTML = '<div class="empty">请选择一个文档查看关系。</div>'; return; }
      const counterpart = doc.counterpart ? '<section class="detail-section"><h2 class="detail-heading">功能配对</h2><div class="counterpart"><button data-select="' + escapeHtml(doc.counterpart) + '">' + escapeHtml(byPath.get(doc.counterpart).title) + '</button><span>' + (doc.path.endsWith('-prd.md') ? '实现文档' : 'Mini-PRD') + '</span></div></section>' : '';
      const outgoing = doc.outgoing.length ? doc.outgoing.map(path => relationButton(path)).join('') : '<p class="detail-empty">未识别到直接引用的仓库文档。</p>';
      const incoming = doc.incoming.length ? doc.incoming.map(path => relationButton(path)).join('') : '<p class="detail-empty">没有其他文档直接提及此文件。</p>';
      const modules = doc.modules.length ? doc.modules.map(path => '<code class="module">' + escapeHtml(path) + '</code>').join('') : '<p class="detail-empty">未识别到现存代码模块引用。</p>';
      const missing = doc.missingModules.length ? '<section class="detail-section"><h2 class="detail-heading">文中提到但仓库不存在的模块 <span class="count">' + doc.missingModules.length + '</span></h2><div class="relation-list">' + doc.missingModules.map(path => '<code class="module missing">' + escapeHtml(path) + '</code>').join('') + '</div></section>' : '';
      container.innerHTML = '<div class="detail-top"><div class="detail-status"><i class="status-dot ' + statusClass[doc.status] + '"></i>' + escapeHtml(doc.statusLabel) + '</div><h2 class="detail-title">' + escapeHtml(doc.title) + '</h2><div class="detail-path">' + escapeHtml(doc.path) + '</div><p class="detail-excerpt">' + escapeHtml(doc.excerpt) + '</p></div><div class="detail-grid"><div><span>文件类型</span><strong>' + escapeHtml(doc.extension) + '</strong></div><div><span>文件大小</span><strong>' + formatBytes(doc.bytes) + '</strong></div><div><span>被文档引用</span><strong>' + doc.incoming.length + '</strong></div><div><span>代码模块</span><strong>' + doc.modules.length + '</strong></div></div><section class="detail-section"><h2 class="detail-heading">用途</h2><p class="detail-empty">' + escapeHtml(doc.role) + '</p></section>' + counterpart + '<section class="detail-section"><h2 class="detail-heading">引用的文档 <span class="count">' + doc.outgoing.length + '</span></h2><div class="relation-list">' + outgoing + '</div></section><section class="detail-section"><h2 class="detail-heading">被这些文档引用 <span class="count">' + doc.incoming.length + '</span></h2><div class="relation-list">' + incoming + '</div></section><section class="detail-section"><h2 class="detail-heading">关联的现存代码模块 <span class="count">' + doc.modules.length + '</span></h2><div class="relation-list">' + modules + '</div></section>' + missing;
    }
    function render() { renderTree(); renderList(); renderDetail(); document.querySelectorAll('.filter').forEach(button => button.classList.toggle('active', button.dataset.status === state.status)); }
    document.addEventListener('click', event => { const selectTarget = event.target.closest('[data-select]'); const folderTarget = event.target.closest('[data-folder]'); const statusTarget = event.target.closest('[data-status]'); if (selectTarget) select(selectTarget.dataset.select); if (folderTarget) { state.folder = folderTarget.dataset.folder; render(); } if (statusTarget) { state.status = statusTarget.dataset.status; render(); } });
    document.querySelector('#search').addEventListener('input', event => { state.query = event.target.value; render(); });
    document.querySelector('#generated-at').textContent = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.generatedAt));
    document.querySelector('#doc-count').textContent = data.totals.docs;
    document.querySelector('#workset-count').textContent = data.totals.active;
    document.querySelector('#history-count').textContent = data.totals.history;
    document.querySelector('#module-count').textContent = data.totals.modules;
    render();
  </script>
</body>
</html>
`
}

const data = buildData()
writeFileSync(outputPath, renderPage(data), 'utf8')
console.log(`[doc-map] wrote ${toPosixPath(relative(projectRoot, outputPath))} with ${data.docs.length} documents`)
