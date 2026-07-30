import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, posix, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'

export const INVENTORY_SCHEMA_VERSION = 'm5a-command-boundary-inventory-v1'
export const PLANNING_BASE_COMMIT = '40541c82ef374f28ce300365e0e5cc82423dd99a'
export const EXPECTED_COUNTS = Object.freeze({ channels: 74, reads: 28, mutations: 46, direct_files: 35, delegating_roots: 5 })

const TEST_ONLY_FILES = new Set([
  'src/main/db/memory-adapter.ts',
  'src/main/db/test-helpers.ts'
])

const FILE_SINK_NAMES = new Set([
  'appendFile',
  'appendFileSync',
  'copyFile',
  'copyFileSync',
  'createWriteStream',
  'fsync',
  'fsyncSync',
  'ftruncateSync',
  'link',
  'linkSync',
  'mkdir',
  'mkdirSync',
  'openSync',
  'rename',
  'renameSync',
  'rmdirSync',
  'rm',
  'rmSync',
  'truncate',
  'truncateSync',
  'unlink',
  'unlinkSync',
  'writeFile',
  'writeFileSync',
  'writeSync'
])

const DB_SINK_METHODS = new Set(['exec', 'pragma', 'run'])
const CAPABILITY_METHODS = new Set(['runSingleEventCommand', 'runSingleEventCommandSync'])
const RECOVERY_CAPABILITIES = new Set([
  'reconcileActionLog',
  'reconcileActionLogEventGroup',
  'recoverActionLog'
])

const FINAL_EXCEPTION_FILES = new Map([
  ['src/main/db/memory-adapter.ts', 'TEST_ONLY'],
  ['src/main/db/test-helpers.ts', 'TEST_ONLY'],
  ['src/main/db/migration-backup.ts', 'MIGRATION_INTERNAL'],
  ['src/main/db/migrations.ts', 'MIGRATION_INTERNAL'],
  ['src/main/db/report-migration.ts', 'MIGRATION_INTERNAL'],
  ['src/main/db/safety-rekey-migration.ts', 'MIGRATION_INTERNAL']
])

function normalizeRepoPath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function stableFingerprint(value) {
  return sha256(JSON.stringify(value))
}

function compactText(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function sourceLine(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function propertyNameText(name, sourceFile) {
  if (!name) return '<anonymous>'
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return compactText(name.getText(sourceFile))
}

function enclosingSymbol(node, sourceFile) {
  const segments = []
  let current = node.parent
  while (current) {
    if (ts.isMethodDeclaration(current) || ts.isGetAccessorDeclaration(current) || ts.isSetAccessorDeclaration(current)) {
      segments.unshift(propertyNameText(current.name, sourceFile))
      const owner = current.parent
      if (owner && ts.isClassLike(owner) && owner.name) segments.unshift(owner.name.text)
      return segments.join('.')
    }
    if (ts.isConstructorDeclaration(current)) {
      const owner = current.parent
      return owner && ts.isClassLike(owner) && owner.name ? `${owner.name.text}.constructor` : 'constructor'
    }
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parent = current.parent
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
      if (ts.isPropertyAssignment(parent)) return propertyNameText(parent.name, sourceFile)
    }
    current = current.parent
  }
  return '<module>'
}

function calleeParts(call, sourceFile) {
  const expression = call.expression
  if (ts.isPropertyAccessExpression(expression)) {
    return {
      name: expression.name.text,
      receiver: compactText(expression.expression.getText(sourceFile)),
      text: compactText(expression.getText(sourceFile))
    }
  }
  if (ts.isElementAccessExpression(expression)) {
    return {
      name: compactText(expression.argumentExpression?.getText(sourceFile) ?? '<dynamic>'),
      receiver: compactText(expression.expression.getText(sourceFile)),
      text: compactText(expression.getText(sourceFile))
    }
  }
  return {
    name: ts.isIdentifier(expression) ? expression.text : compactText(expression.getText(sourceFile)),
    receiver: '',
    text: compactText(expression.getText(sourceFile))
  }
}

function staticString(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null
}

function callsiteRecord({ file, sourceFile, node, kind, callee, detail = '' }) {
  const symbol = enclosingSymbol(node, sourceFile)
  const snippet = compactText(node.getText(sourceFile))
  const fingerprint = stableFingerprint({ file, symbol, kind, callee, detail, snippet })
  return {
    file,
    symbol,
    line: sourceLine(sourceFile, node),
    kind,
    callee,
    detail,
    fingerprint
  }
}

function isProductionTypeScript(file) {
  return file.startsWith('src/main/') && file.endsWith('.ts') && !file.includes('/__tests__/') && !file.endsWith('.test.ts')
}

function resolveRelativeImport(file, specifier) {
  const resolved = normalizeRepoPath(posix.normalize(posix.join(posix.dirname(file), specifier)))
  const candidates = [resolved, `${resolved}.ts`, posix.join(resolved, 'index.ts')]
  return candidates.find((candidate) => TEST_ONLY_FILES.has(candidate)) ?? null
}

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

function sortCallsites(callsites) {
  const sorted = [...callsites].sort((left, right) =>
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.kind.localeCompare(right.kind) ||
    left.fingerprint.localeCompare(right.fingerprint)
  )
  const occurrences = new Map()
  return sorted.map((item) => {
    const occurrence = (occurrences.get(item.fingerprint) ?? 0) + 1
    occurrences.set(item.fingerprint, occurrence)
    return {
      ...item,
      occurrence,
      fingerprint: stableFingerprint({ base_fingerprint: item.fingerprint, occurrence })
    }
  })
}

export function scanSourceEntries(entries) {
  const channels = []
  const directCallsites = []
  const capabilityCallsites = []
  const testOnlyImportViolations = []

  for (const entry of entries) {
    const file = normalizeRepoPath(entry.file)
    if (!isProductionTypeScript(file)) continue
    const sourceFile = ts.createSourceFile(file, entry.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const coordinatorNames = new Set(['ReportCommandCoordinator'])
    const recoveryNames = new Set(RECOVERY_CAPABILITIES)
    const eventWriterNames = new Set(['writeEvent'])
    const fileSinkNames = new Map([...FILE_SINK_NAMES].map((name) => [name, name]))
    const dbAliasNames = new Map()
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const bindings = statement.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      for (const specifier of bindings.elements) {
        const importedName = specifier.propertyName?.text ?? specifier.name.text
        if (importedName === 'ReportCommandCoordinator') coordinatorNames.add(specifier.name.text)
        if (RECOVERY_CAPABILITIES.has(importedName)) recoveryNames.add(specifier.name.text)
        if (importedName === 'writeEvent') eventWriterNames.add(specifier.name.text)
        if (FILE_SINK_NAMES.has(importedName)) fileSinkNames.set(specifier.name.text, importedName)
      }
    }

    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text
        if (specifier.startsWith('.') && !TEST_ONLY_FILES.has(file)) {
          const importedTestOnlyFile = resolveRelativeImport(file, specifier)
          if (importedTestOnlyFile) {
            testOnlyImportViolations.push({ file, imported_test_only_file: importedTestOnlyFile, line: sourceLine(sourceFile, node) })
          }
        }
        const bindings = node.importClause?.namedBindings
        if (bindings && ts.isNamedImports(bindings)) {
          for (const specifier of bindings.elements) {
            const importedName = specifier.propertyName?.text ?? specifier.name.text
            if (importedName === 'ReportCommandCoordinator') {
              capabilityCallsites.push(callsiteRecord({
                file,
                sourceFile,
                node: specifier,
                kind: 'REPORT_COORDINATOR_IMPORT',
                callee: specifier.name.text,
                detail: node.moduleSpecifier.text
              }))
            }
          }
        }
      }

      if (ts.isClassDeclaration(node) && node.name?.text === 'ReportCommandCoordinator') {
        capabilityCallsites.push(callsiteRecord({
          file,
          sourceFile,
          node,
          kind: 'REPORT_COORDINATOR_DECLARATION',
          callee: 'ReportCommandCoordinator'
        }))
      }

      if (ts.isNewExpression(node)) {
        const constructorName = compactText(node.expression.getText(sourceFile))
        if (coordinatorNames.has(constructorName)) {
          capabilityCallsites.push(callsiteRecord({
            file,
            sourceFile,
            node,
            kind: 'REPORT_COORDINATOR_CONSTRUCTION',
            callee: constructorName
          }))
        }
      }

      if ((ts.isParameter(node) || ts.isPropertyDeclaration(node)) && node.type) {
        const typeText = compactText(node.type.getText(sourceFile))
        if ([...coordinatorNames].some((name) => new RegExp(`\\b${name}\\b`).test(typeText))) {
          capabilityCallsites.push(callsiteRecord({
            file,
            sourceFile,
            node,
            kind: 'REPORT_COORDINATOR_INJECTION',
            callee: typeText
          }))
        }
      }

      if (ts.isVariableDeclaration(node) && node.initializer && ts.isPropertyAccessExpression(node.initializer) && CAPABILITY_METHODS.has(node.initializer.name.text)) {
        capabilityCallsites.push(callsiteRecord({
          file,
          sourceFile,
          node,
          kind: 'REPORT_COMMAND_ALIAS',
          callee: compactText(node.initializer.getText(sourceFile))
        }))
      }

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (ts.isIdentifier(node.initializer)) {
          if (eventWriterNames.has(node.initializer.text)) eventWriterNames.add(node.name.text)
          if (fileSinkNames.has(node.initializer.text)) fileSinkNames.set(node.name.text, fileSinkNames.get(node.initializer.text))
          if (dbAliasNames.has(node.initializer.text)) dbAliasNames.set(node.name.text, dbAliasNames.get(node.initializer.text))
        } else if (ts.isPropertyAccessExpression(node.initializer)) {
          const propertyName = node.initializer.name.text
          if (propertyName === 'writeEvent') eventWriterNames.add(node.name.text)
          if (FILE_SINK_NAMES.has(propertyName)) fileSinkNames.set(node.name.text, propertyName)
          if (DB_SINK_METHODS.has(propertyName)) dbAliasNames.set(node.name.text, propertyName)
        }
      }

      if (ts.isBindingElement(node)) {
        const sourceName = node.propertyName ? propertyNameText(node.propertyName, sourceFile) : propertyNameText(node.name, sourceFile)
        const localName = propertyNameText(node.name, sourceFile)
        if (CAPABILITY_METHODS.has(sourceName)) {
          capabilityCallsites.push(callsiteRecord({
            file,
            sourceFile,
            node,
            kind: 'REPORT_COMMAND_ALIAS',
            callee: sourceName
          }))
        }
        if (sourceName === 'writeEvent') eventWriterNames.add(localName)
        if (FILE_SINK_NAMES.has(sourceName)) fileSinkNames.set(localName, sourceName)
        if (DB_SINK_METHODS.has(sourceName)) dbAliasNames.set(localName, sourceName)
      }

      if (ts.isCallExpression(node)) {
        const callee = calleeParts(node, sourceFile)
        if (callee.receiver === 'ipcMain' && callee.name === 'handle') {
          const channel = staticString(node.arguments[0])
          channels.push({
            channel,
            file,
            symbol: enclosingSymbol(node, sourceFile),
            line: sourceLine(sourceFile, node),
            dynamic: channel === null,
            fingerprint: stableFingerprint({ file, symbol: enclosingSymbol(node, sourceFile), channel })
          })
        }

        if (callee.receiver && DB_SINK_METHODS.has(callee.name)) {
          directCallsites.push(callsiteRecord({
            file,
            sourceFile,
            node,
            kind: `DB_${callee.name.toUpperCase()}`,
            callee: callee.text
          }))
        } else if (file === 'src/main/db/migration-startup.ts' && callee.name === 'run') {
          directCallsites.push(callsiteRecord({
            file,
            sourceFile,
            node,
            kind: 'DB_MIGRATION_RUN',
            callee: callee.text,
            detail: 'injected runDatabaseMigrations capability'
          }))
        } else if (!callee.receiver && dbAliasNames.has(callee.name)) {
          const originalName = dbAliasNames.get(callee.name)
          directCallsites.push(callsiteRecord({
            file,
            sourceFile,
            node,
            kind: `DB_${originalName.toUpperCase()}_ALIAS`,
            callee: callee.text,
            detail: originalName
          }))
        } else if (!callee.receiver && eventWriterNames.has(callee.name)) {
          directCallsites.push(callsiteRecord({ file, sourceFile, node, kind: 'EVENT_WRITE', callee: callee.text }))
        } else if ((!callee.receiver && fileSinkNames.has(callee.name)) || FILE_SINK_NAMES.has(callee.name)) {
          const originalName = fileSinkNames.get(callee.name) ?? callee.name
          directCallsites.push(callsiteRecord({ file, sourceFile, node, kind: `FILE_${originalName.toUpperCase()}`, callee: callee.text, detail: originalName === callee.name ? '' : `alias:${callee.name}` }))
        }

        if (CAPABILITY_METHODS.has(callee.name)) {
          capabilityCallsites.push(callsiteRecord({
            file,
            sourceFile,
            node,
            kind: 'REPORT_COMMAND_CALL',
            callee: callee.text
          }))
        } else if (recoveryNames.has(callee.name)) {
          capabilityCallsites.push(callsiteRecord({
            file,
            sourceFile,
            node,
            kind: 'LEGACY_RECOVERY_CALL',
            callee: callee.text
          }))
        } else if (
          file.startsWith('src/main/application/services/')
          && callee.name === 'writeEvent'
          && /(?:^|\.)eventPort$/.test(callee.receiver)
        ) {
          capabilityCallsites.push(callsiteRecord({
            file,
            sourceFile,
            node,
            kind: 'LEGACY_EVENT_PORT_CALL',
            callee: callee.text,
            detail: 'runtime-injected accepted mutation port'
          }))
        } else if (file === 'src/main/ipc/index.ts' && /^register[A-Z].*Handlers$/.test(callee.name)) {
          capabilityCallsites.push(callsiteRecord({
            file,
            sourceFile,
            node,
            kind: 'IPC_HANDLER_REGISTRATION',
            callee: callee.text
          }))
        }
      }

      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  const sortedDirect = sortCallsites(directCallsites)
  const sortedCapabilities = sortCallsites(capabilityCallsites)
  const directFiles = sortedUnique(sortedDirect.map((item) => item.file))
  const delegatingRoots = sortedUnique(
    sortedCapabilities
      .map((item) => item.file)
      .filter((file) => !directFiles.includes(file))
  )

  return {
    channels: [...channels].sort((left, right) => (left.channel ?? '').localeCompare(right.channel ?? '') || left.file.localeCompare(right.file)),
    direct_callsites: sortedDirect,
    direct_files: directFiles,
    capability_callsites: sortedCapabilities,
    delegating_roots: delegatingRoots,
    test_only_import_violations: [...testOnlyImportViolations].sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)
  }
}

function walkTypeScriptFiles(directory, projectRoot, output) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walkTypeScriptFiles(absolute, projectRoot, output)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue
    output.push({ file: normalizeRepoPath(relative(projectRoot, absolute)), source: readFileSync(absolute, 'utf8') })
  }
}

export function readCheckoutSources(projectRoot) {
  const root = resolve(projectRoot)
  const entries = []
  walkTypeScriptFiles(join(root, 'src', 'main'), root, entries)
  return entries.sort((left, right) => left.file.localeCompare(right.file))
}

function runGit(projectRoot, args) {
  const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8', shell: false })
  if (result.status !== 0) throw new Error(`[m5a-command-boundary] git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  return result.stdout
}

export function readGitTreeSources(projectRoot, baseCommit = PLANNING_BASE_COMMIT) {
  const files = runGit(projectRoot, ['ls-tree', '-r', '--name-only', baseCommit, '--', 'src/main'])
    .split(/\r?\n/)
    .filter((file) => isProductionTypeScript(file))
  return files.map((file) => ({
    file,
    source: runGit(projectRoot, ['show', `${baseCommit}:${file}`])
  }))
}

export function scanCheckout(projectRoot) {
  return scanSourceEntries(readCheckoutSources(projectRoot))
}

export function scanGitTree(projectRoot, baseCommit = PLANNING_BASE_COMMIT) {
  return scanSourceEntries(readGitTreeSources(projectRoot, baseCommit))
}

function assertSchema(document, label) {
  if (!document || document.schema_version !== INVENTORY_SCHEMA_VERSION) {
    throw new Error(`${label} schema_version must be ${INVENTORY_SCHEMA_VERSION}`)
  }
}

function assertExactSet(actual, expected, label) {
  const actualValues = sortedUnique(actual)
  const expectedValues = sortedUnique(expected)
  const missing = expectedValues.filter((item) => !actualValues.includes(item))
  const extra = actualValues.filter((item) => !expectedValues.includes(item))
  if (missing.length || extra.length) {
    throw new Error(`${label} mismatch; missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`)
  }
  if (actual.length !== actualValues.length) throw new Error(`${label} contains duplicate values`)
}

function assertSetCoverage(actual, expected, label) {
  const actualValues = sortedUnique(actual)
  const expectedValues = sortedUnique(expected)
  const missing = expectedValues.filter((item) => !actualValues.includes(item))
  const extra = actualValues.filter((item) => !expectedValues.includes(item))
  if (missing.length || extra.length) {
    throw new Error(`${label} mismatch; missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`)
  }
}

function assertCallsiteManifest(actual, expected, label) {
  assertExactSet(actual.map((item) => item.fingerprint), expected.map((item) => item.fingerprint), `${label} fingerprints`)
  const expectedByFingerprint = new Map(expected.map((item) => [item.fingerprint, item]))
  for (const item of actual) {
    const fixture = expectedByFingerprint.get(item.fingerprint)
    if (!fixture || fixture.file !== item.file || fixture.symbol !== item.symbol || fixture.kind !== item.kind) {
      throw new Error(`${label} metadata mismatch for ${item.fingerprint}`)
    }
  }
}

function assertChannelManifest(actual, expected, label) {
  if (actual.some((item) => item.dynamic || !item.channel)) throw new Error(`${label} contains dynamic IPC channel`)
  assertExactSet(actual.map((item) => item.channel), expected.map((item) => item.channel), `${label} channel names`)
  const expectedByName = new Map(expected.map((item) => [item.channel, item]))
  for (const item of actual) {
    const fixture = expectedByName.get(item.channel)
    if (!fixture || fixture.file !== item.file || fixture.symbol !== item.symbol || fixture.fingerprint !== item.fingerprint) {
      throw new Error(`${label} metadata mismatch for ${item.channel}`)
    }
  }
}

function validateCounts(scan, channels, { enforceLegacyShape = false } = {}) {
  const reads = channels.filter((item) => item.mode === 'READ').length
  const mutations = channels.filter((item) => item.mode === 'MUTATION').length
  const counts = { channels: channels.length, reads, mutations, direct_files: scan.direct_files.length, delegating_roots: scan.delegating_roots.length }
  const required = enforceLegacyShape
    ? EXPECTED_COUNTS
    : { channels: EXPECTED_COUNTS.channels, reads: EXPECTED_COUNTS.reads, mutations: EXPECTED_COUNTS.mutations }
  for (const [key, expected] of Object.entries(required)) {
    if (counts[key] !== expected) throw new Error(`expected ${expected} ${key}, received ${counts[key]}`)
  }
  return counts
}

export function validateBaselineInventory(scan, legacy) {
  assertSchema(legacy, 'legacy inventory')
  if (legacy.base_commit !== PLANNING_BASE_COMMIT) throw new Error(`legacy base_commit must be ${PLANNING_BASE_COMMIT}`)
  if (scan.test_only_import_violations.length) throw new Error(`production imports test-only adapter: ${JSON.stringify(scan.test_only_import_violations)}`)
  assertChannelManifest(scan.channels, legacy.channels, 'legacy IPC')
  assertCallsiteManifest(scan.direct_callsites, legacy.direct_callsites, 'legacy direct callsites')
  assertCallsiteManifest(scan.capability_callsites, legacy.capability_callsites, 'legacy capability callsites')
  assertExactSet(scan.direct_files, legacy.direct_files.map((item) => item.path), 'legacy direct files')
  assertExactSet(scan.delegating_roots, legacy.delegating_roots.map((item) => item.path), 'legacy delegating roots')
  for (const channel of legacy.channels) {
    if (!['READ', 'MUTATION'].includes(channel.mode)) throw new Error(`legacy channel ${channel.channel} has invalid mode ${channel.mode}`)
  }
  const classificationCounts = Object.fromEntries(
    [...new Set(legacy.direct_files.map((item) => item.classification))]
      .map((classification) => [classification, legacy.direct_files.filter((item) => item.classification === classification).length])
  )
  const expectedClassifications = { BUS_COMMAND_DIRECT: 13, PRODUCTION_INTERNAL_DIRECT: 19, LOW_LEVEL_PORT: 1, TEST_ONLY_EXCEPTION: 2 }
  if (Object.entries(expectedClassifications).some(([key, count]) => classificationCounts[key] !== count) || Object.keys(classificationCounts).length !== Object.keys(expectedClassifications).length) {
    throw new Error(`legacy direct file classifications mismatch: ${JSON.stringify(classificationCounts)}`)
  }
  const taskClosureCalls = legacy.capability_callsites.filter((item) => item.file === 'src/main/domain/task-closure-service.ts' && item.kind === 'REPORT_COMMAND_CALL')
  assertExactSet(taskClosureCalls.map((item) => item.symbol), ['TaskClosureService.confirmBaseTaskClosure', 'TaskClosureService.replaceBaseTaskClosure'], 'task closure coordinator owners')
  const result = validateCounts(scan, legacy.channels, { enforceLegacyShape: true })
  const fixtureCounts = {
    channels: legacy.channels.length,
    reads: legacy.channels.filter((item) => item.mode === 'READ').length,
    mutations: legacy.channels.filter((item) => item.mode === 'MUTATION').length,
    direct_callsites: legacy.direct_callsites.length,
    direct_files: legacy.direct_files.length,
    capability_callsites: legacy.capability_callsites.length,
    delegating_roots: legacy.delegating_roots.length
  }
  if (JSON.stringify(fixtureCounts) !== JSON.stringify(legacy.counts)) throw new Error('legacy counts metadata mismatch')
  return result
}

function validateManifestIds(items, label, pattern) {
  const ids = items.map((item) => item.id)
  if (ids.some((id) => typeof id !== 'string' || !id)) throw new Error(`${label} requires non-empty ids`)
  if (ids.some((id) => !pattern.test(id))) throw new Error(`${label} contains malformed id`)
  assertExactSet(ids, ids, `${label} ids`)
}

function allManifestEntries(document) {
  return [...document.channels, ...document.direct_callsites, ...document.capability_callsites]
}

function validatePendingFixture(pending) {
  const order = pending.step_order
  if (!Array.isArray(order) || !order.length) throw new Error('pending fixture step_order is required')
  let previous = null
  for (const step of order) {
    const current = pending.steps[step]
    if (!Array.isArray(current)) throw new Error(`pending fixture is missing ${step}`)
    if (new Set(current).size !== current.length) throw new Error(`pending fixture ${step} contains duplicates`)
    if (previous && current.some((id) => !previous.includes(id))) throw new Error(`pending fixture ${step} is not monotonic`)
    previous = current
  }
}

function validateRegisteredException(item, activeById) {
  if (item.planned_step !== 'M5A-11' || item.migrated_in_step !== 'M5A-11') {
    throw new Error(`mapping ${item.id} registered exception must close in M5A-11`)
  }
  for (const field of ['exception_kind', 'exception_reason', 'actor_policy', 'phase', 'transaction_owner', 'retry_policy']) {
    if (typeof item[field] !== 'string' || !item[field]) throw new Error(`mapping ${item.id} registered exception requires ${field}`)
  }
  const activeEntry = activeById.get(item.active_id)
  const expectedKind = FINAL_EXCEPTION_FILES.get(activeEntry?.file)
  if (!expectedKind || item.exception_kind !== expectedKind) {
    throw new Error(`mapping ${item.id} has invalid registered exception scope`)
  }
  if (expectedKind === 'TEST_ONLY' && (item.actor_policy !== 'TEST_ONLY' || item.phase !== 'TEST_FIXTURE')) {
    throw new Error(`mapping ${item.id} has invalid test-only exception policy`)
  }
  if (expectedKind === 'MIGRATION_INTERNAL' && (item.actor_policy !== 'SYSTEM_ONLY' || item.phase !== 'STARTUP_UPGRADE')) {
    throw new Error(`mapping ${item.id} has invalid migration exception policy`)
  }
}

function validateTargetBoundary(scan) {
  const handlerSideEffects = [...scan.direct_callsites, ...scan.capability_callsites]
    .filter((item) => item.file.startsWith('src/main/ipc/handlers/'))
  if (handlerSideEffects.length) {
    throw new Error(`target handler side effects remain: ${handlerSideEffects.map((item) => `${item.file}:${item.symbol}:${item.kind}`).join(', ')}`)
  }
  if (scan.channels.some((item) => item.file !== 'src/main/ipc/handler-registry.ts' || item.symbol !== 'registerCentralIpcHandlers')) {
    throw new Error('target IPC registration is not fully centralized')
  }
  const constructions = scan.capability_callsites.filter((item) => item.kind === 'REPORT_COORDINATOR_CONSTRUCTION')
  if (constructions.length !== 1
    || constructions[0].file !== 'src/main/application/runtime/application-runtime.ts'
    || constructions[0].symbol !== 'createApplicationRuntime') {
    throw new Error('target report coordinator construction must have one composition-root owner')
  }
  const taskClosureCalls = scan.capability_callsites.filter((item) =>
    item.file === 'src/main/domain/task-closure-service.ts' && item.kind === 'REPORT_COMMAND_CALL'
  )
  assertExactSet(
    taskClosureCalls.map((item) => item.symbol),
    ['TaskClosureService.confirmBaseTaskClosure', 'TaskClosureService.replaceBaseTaskClosure'],
    'target task closure coordinator owners'
  )
}

export function validateMigrationInventory({ scan, legacy, active, mapping, pending, step, target = false }) {
  for (const [document, label] of [[legacy, 'legacy inventory'], [active, 'active inventory'], [mapping, 'mapping inventory'], [pending, 'pending inventory']]) {
    assertSchema(document, label)
  }
  if (scan.test_only_import_violations.length) throw new Error(`production imports test-only adapter: ${JSON.stringify(scan.test_only_import_violations)}`)
  assertChannelManifest(scan.channels, active.channels, 'active IPC')
  assertCallsiteManifest(scan.direct_callsites, active.direct_callsites, 'active direct callsites')
  assertCallsiteManifest(scan.capability_callsites, active.capability_callsites, 'active capability callsites')
  assertExactSet(scan.direct_files, active.direct_files.map((item) => item.path), 'active direct files')
  assertExactSet(scan.delegating_roots, active.delegating_roots.map((item) => item.path), 'active delegating roots')

  const legacyEntries = allManifestEntries(legacy)
  const activeEntries = allManifestEntries(active)
  const activeById = new Map(activeEntries.map((item) => [item.id, item]))
  validateManifestIds(legacyEntries, 'legacy entries', /^LEGACY-(?:IPC|DIRECT|CAP)-\d+$/)
  validateManifestIds(activeEntries, 'active entries', /^ACTIVE-(?:IPC|DIRECT|CAP)-\d+$/)
  validateManifestIds(mapping.entries, 'mapping entries', /^MAPPING-(?:\d+|NEW-M5A(?:3|4|5|6|7|8|9|10|11)-\d+)$/)
  const legacyMappings = mapping.entries.filter((item) => typeof item.legacy_id === 'string')
  const newActiveMappings = mapping.entries.filter((item) => item.legacy_id === null)
  assertExactSet(legacyMappings.map((item) => item.legacy_id), legacyEntries.map((item) => item.id), 'mapping legacy ids')
  const activeIds = new Set(activeEntries.map((item) => item.id))
  for (const item of mapping.entries) {
    if (!activeIds.has(item.active_id)) throw new Error(`mapping ${item.id} references unknown active id ${item.active_id}`)
    if (!['MIGRATION_PENDING', 'MIGRATED', 'REGISTERED_EXCEPTION'].includes(item.status)) throw new Error(`mapping ${item.id} has invalid status ${item.status}`)
    if (typeof item.active_owner !== 'string' || !item.active_owner) throw new Error(`mapping ${item.id} requires active_owner`)
    if (typeof item.capability !== 'string' || !item.capability) throw new Error(`mapping ${item.id} requires capability`)
    if (!/^M5A-(?:3|4|5|6|7|8|9|10|11)$/.test(item.planned_step)) throw new Error(`mapping ${item.id} has invalid planned_step ${item.planned_step}`)
    if (!Array.isArray(item.test_evidence) || !item.test_evidence.length) throw new Error(`mapping ${item.id} requires test_evidence`)
    if (item.status === 'MIGRATED' && item.migrated_in_step !== item.planned_step) {
      throw new Error(`mapping ${item.id} migrated step mismatch`)
    }
    if (item.status === 'MIGRATION_PENDING' && item.migrated_in_step !== null) {
      throw new Error(`mapping ${item.id} pending entry cannot have migrated_in_step`)
    }
    if (item.status === 'REGISTERED_EXCEPTION') validateRegisteredException(item, activeById)
  }
  for (const item of newActiveMappings) {
    if (item.origin !== 'M5A_NEW_ACTIVE') throw new Error(`mapping ${item.id} new active entry requires M5A_NEW_ACTIVE origin`)
    if (item.status === 'MIGRATION_PENDING' || item.migrated_in_step !== item.planned_step) {
      throw new Error(`mapping ${item.id} new active entry must be registered in its planned step`)
    }
  }
  assertSetCoverage(mapping.entries.map((item) => item.active_id), activeEntries.map((item) => item.id), 'mapping active ids')

  validatePendingFixture(pending)
  const actualPending = legacyMappings.filter((item) => item.status === 'MIGRATION_PENDING').map((item) => item.legacy_id)
  if (target) {
    if (actualPending.length) throw new Error(`target has ${actualPending.length} MIGRATION_PENDING entries`)
    validateTargetBoundary(scan)
  } else {
    if (!step || !pending.steps[step]) throw new Error(`migration mode requires a known --step; received ${step ?? '<missing>'}`)
    assertExactSet(actualPending, pending.steps[step], `${step} pending ids`)
  }

  return {
    ...validateCounts(scan, active.channels),
    pending: actualPending.length,
    registered_exceptions: mapping.entries.filter((item) => item.status === 'REGISTERED_EXCEPTION').length,
    step: target ? 'target' : step
  }
}

export function loadInventoryDocuments(projectRoot) {
  const fixtureRoot = join(projectRoot, 'scripts', 'fixtures')
  const readJson = (name) => JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'))
  return {
    legacy: readJson('m5a-command-boundary-legacy-v1.json'),
    active: readJson('m5a-command-boundary-active-v1.json'),
    mapping: readJson('m5a-command-boundary-mapping-v1.json'),
    pending: readJson('m5a-command-boundary-pending-v1.json')
  }
}

export function inventoryDigest(scan) {
  return stableFingerprint({
    channels: scan.channels.map((item) => item.fingerprint),
    direct_callsites: scan.direct_callsites.map((item) => item.fingerprint),
    capability_callsites: scan.capability_callsites.map((item) => item.fingerprint),
    direct_files: scan.direct_files,
    delegating_roots: scan.delegating_roots
  })
}
