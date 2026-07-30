import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { PLANNING_BASE_COMMIT } from './m5a-command-boundary-inventory.mjs'

export const M5A_SCOPE_BASE_COMMIT = PLANNING_BASE_COMMIT

const FORBIDDEN_PREFIXES = Object.freeze([
  'src/shared/',
  'src/preload/',
  'src/renderer/'
])

function normalizeRepoPath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

export function isM5aRestrictedContractPath(value) {
  const path = normalizeRepoPath(value)
  if (path === 'src/main/db/schema.sql' || path === 'package-lock.json') return true
  if (FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix))) return true
  return path.startsWith('src/main/db/')
    && !path.includes('/__tests__/')
    && /(?:migration|backup)/i.test(path)
    && /\.(?:ts|mjs)$/.test(path)
}

function runGit(projectRoot, args) {
  const result = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 16 * 1024 * 1024
  })
  if (result.status !== 0) {
    throw new Error(`[m5a-contract-scope] git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  }
  return result.stdout
}

function zeroDelimitedPaths(projectRoot, args) {
  return runGit(projectRoot, args)
    .split('\0')
    .filter(Boolean)
    .map(normalizeRepoPath)
}

function nameStatus(projectRoot, args) {
  return runGit(projectRoot, args).trim()
}

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

function layer(name, paths, status) {
  const restricted = paths.filter(isM5aRestrictedContractPath)
  return { name, paths, restricted, status }
}

export function collectM5aContractScope({ projectRoot, baseCommit = M5A_SCOPE_BASE_COMMIT }) {
  const root = resolve(projectRoot)
  runGit(root, ['rev-parse', '--verify', `${baseCommit}^{commit}`])

  const committed = layer(
    'committed',
    zeroDelimitedPaths(root, ['diff', '--no-renames', '--name-only', '-z', `${baseCommit}..HEAD`, '--']),
    nameStatus(root, ['diff', '--no-renames', '--name-status', `${baseCommit}..HEAD`, '--'])
  )
  const index = layer(
    'index',
    zeroDelimitedPaths(root, ['diff', '--cached', '--no-renames', '--name-only', '-z', baseCommit, '--']),
    nameStatus(root, ['diff', '--cached', '--no-renames', '--name-status', baseCommit, '--'])
  )
  const workingTree = layer(
    'working-tree',
    zeroDelimitedPaths(root, ['diff', '--no-renames', '--name-only', '-z', baseCommit, '--']),
    nameStatus(root, ['diff', '--no-renames', '--name-status', baseCommit, '--'])
  )
  const visibleUntrackedPaths = zeroDelimitedPaths(root, ['ls-files', '--others', '--exclude-standard', '-z', '--'])
  const ignoredRestrictedPaths = zeroDelimitedPaths(root, [
    'ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--',
    'src/main/db', 'src/shared', 'src/preload', 'src/renderer', 'package-lock.json'
  ]).filter(isM5aRestrictedContractPath)
  const untrackedPaths = sortedUnique([...visibleUntrackedPaths, ...ignoredRestrictedPaths])
  const untracked = layer(
    'untracked',
    untrackedPaths,
    [
      ...visibleUntrackedPaths.map((path) => `??\t${path}`),
      ...ignoredRestrictedPaths.map((path) => `!!\t${path}`)
    ].join('\n')
  )
  const layers = [committed, index, workingTree, untracked]

  return {
    projectRoot: root,
    baseCommit,
    layers,
    violations: layers.flatMap((entry) => entry.restricted.map((path) => ({ layer: entry.name, path })))
  }
}

export class M5aContractScopeError extends Error {
  constructor(report) {
    const details = report.violations.map((item) => `${item.layer}:${item.path}`).join(', ')
    super(`[m5a-contract-scope] restricted contract changes detected: ${details}`)
    this.name = 'M5aContractScopeError'
    this.report = report
  }
}

export function verifyM5aContractScope(options) {
  const report = collectM5aContractScope(options)
  if (report.violations.length > 0) throw new M5aContractScopeError(report)
  return report
}

export function formatM5aScopeReport(report) {
  const lines = []
  for (const entry of report.layers) {
    lines.push(`[m5a-contract-scope] ${entry.name} name-status (${entry.paths.length})`)
    lines.push(entry.status || '(none)')
  }
  return lines.join('\n')
}
