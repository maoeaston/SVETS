import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export const DOC_INDEX_START = '<!-- AUTO-GENERATED:DOC-INVENTORY:START -->'
export const DOC_INDEX_END = '<!-- AUTO-GENERATED:DOC-INVENTORY:END -->'

function toPosixPath(value) {
  return value.replace(/\\/g, '/')
}

function listFiles(rootPath, predicate, recursive = true) {
  const files = []
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const path = join(rootPath, entry.name)
    if (entry.isDirectory() && recursive) files.push(...listFiles(path, predicate, true))
    if (entry.isFile() && predicate(entry.name, path)) files.push(path)
  }
  return files.sort()
}

function docRelativePath(projectRoot, absolutePath) {
  return toPosixPath(relative(join(projectRoot, 'doc'), absolutePath))
}

function escapeTableCell(value) {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

function markdownTitle(path) {
  const content = readFileSync(path, 'utf8')
  const h1 = content.match(/^#\s+(.+)$/m)
  if (h1) return escapeTableCell(h1[1])

  const featureName = content.match(/^##\s+功能名称\s*$\r?\n(?:\r?\n)*([^\r\n]+)/m)
  if (featureName) return escapeTableCell(featureName[1])

  const firstHeading = content.match(/^#{1,6}\s+(.+)$/m)
  return escapeTableCell(firstHeading?.[1] ?? '未提供标题')
}

function markdownLink(path) {
  return `[${path}](${path})`
}

function renderMarkdownTable(paths, projectRoot) {
  const rows = paths.map((absolutePath) => {
    const path = docRelativePath(projectRoot, absolutePath)
    return `| ${markdownLink(path)} | ${markdownTitle(absolutePath)} |`
  })
  return ['| 文件 | 标题 |', '|---|---|', ...rows].join('\n')
}

function renderFeatureTables(featurePaths, projectRoot) {
  const pairs = new Map()
  const standalone = []
  for (const absolutePath of featurePaths) {
    const path = docRelativePath(projectRoot, absolutePath)
    const match = path.match(/^features\/(.+)-(prd|impl)\.md$/)
    if (!match) {
      standalone.push(absolutePath)
      continue
    }
    const [, feature, type] = match
    if (!pairs.has(feature)) pairs.set(feature, {})
    pairs.get(feature)[type] = path
  }

  const pairRows = [...pairs.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([feature, files]) =>
      `| \`${feature}\` | ${files.prd ? markdownLink(files.prd) : '缺失'} | ${files.impl ? markdownLink(files.impl) : '缺失'} |`
    )

  return [
    '### 7.3 Feature PRD 与实现配对',
    '',
    '| 功能前缀 | PRD | 实现文档 |',
    '|---|---|---|',
    ...pairRows,
    '',
    '### 7.4 Feature 独立文档',
    '',
    renderMarkdownTable(standalone, projectRoot)
  ].join('\n')
}

function renderPromptTemplates(promptPaths, projectRoot) {
  const rows = promptPaths.map((absolutePath) => {
    const content = readFileSync(absolutePath, 'utf8')
    const templateId = content.match(/^\[TEMPLATE_ID:\s*([^\]]+)\]$/m)?.[1] ?? 'missing'
    const version = content.match(/^\[VERSION:\s*([^\]]+)\]$/m)?.[1] ?? 'missing'
    const path = docRelativePath(projectRoot, absolutePath)
    return `| \`${templateId}\` | \`${version}\` | ${markdownLink(path)} |`
  })
  return ['| Template ID | 版本 | 文件 |', '|---|---|---|', ...rows].join('\n')
}

export function collectDocInventory(projectRoot) {
  const docRoot = join(projectRoot, 'doc')
  return {
    rootDocs: listFiles(docRoot, (name) => name.endsWith('.md') && name !== 'index.md', false),
    specs: listFiles(join(docRoot, 'specs'), (name) => name.endsWith('.md')),
    features: listFiles(join(docRoot, 'features'), (name) => name.endsWith('.md'), false),
    references: listFiles(join(docRoot, 'reference'), (name) => name.endsWith('.md'), false),
    promptTemplates: listFiles(join(docRoot, 'assets', 'prompt-templates'), (name) => name.endsWith('.txt'), false),
    referenceReadmes: listFiles(
      join(docRoot, 'assets', 'reference-assets'),
      (name) => name === 'README.md'
    ),
    archiveReadmes: listFiles(join(docRoot, 'features', 'archive'), (name) => name === 'README.md')
  }
}

export function renderDocInventory(projectRoot) {
  const inventory = collectDocInventory(projectRoot)
  return [
    DOC_INDEX_START,
    '> 此区块由 `npm run docs:index:update` 生成，只表示文件存在，不代表权威性或阅读优先级。不要手工编辑。',
    '',
    '### 7.1 根目录会话文档',
    '',
    renderMarkdownTable(inventory.rootDocs, projectRoot),
    '',
    '### 7.2 Specs 文件',
    '',
    renderMarkdownTable(inventory.specs, projectRoot),
    '',
    renderFeatureTables(inventory.features, projectRoot),
    '',
    '### 7.5 Reference Markdown',
    '',
    renderMarkdownTable(inventory.references, projectRoot),
    '',
    '### 7.6 视觉资产 Prompt 模板',
    '',
    renderPromptTemplates(inventory.promptTemplates, projectRoot),
    '',
    '### 7.7 视觉参考与归档入口',
    '',
    renderMarkdownTable([...inventory.referenceReadmes, ...inventory.archiveReadmes].sort(), projectRoot),
    DOC_INDEX_END
  ].join('\n')
}

export function updateDocIndexContent(currentContent, generatedBlock) {
  const start = currentContent.indexOf(DOC_INDEX_START)
  const end = currentContent.indexOf(DOC_INDEX_END)
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error('doc/index.md has an incomplete or invalid generated inventory block')
  }
  if (start === -1) {
    return `${currentContent.trimEnd()}\n\n---\n\n## 7. 自动维护的文件清单\n\n${generatedBlock}\n`
  }
  const afterEnd = end + DOC_INDEX_END.length
  return `${currentContent.slice(0, start)}${generatedBlock}${currentContent.slice(afterEnd)}`
}
