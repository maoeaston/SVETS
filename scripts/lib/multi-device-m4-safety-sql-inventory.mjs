import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export const INVENTORY_CLASSES = Object.freeze([
  'AGGREGATE_MATCH_REKEY',
  'INCIDENT_PRIMARY_KEY_LOOKUP',
  'STUDENT_WIDE_LIST',
  'NON_SAFETY_QUERY'
])

const PRODUCTION_ROOT = 'src/main'
const EXCLUDED_PATH_PARTS = new Set(['__tests__'])
const EXCLUDED_FILES = new Set([
  'src/main/db/migrations.ts',
  'src/main/db/report-migration.ts',
  'src/main/db/safety-rekey-migration.ts',
  'src/main/db/preview-contract-migration.ts',
  'src/main/domain/projectors/preview-safety-projector.ts',
  'src/main/db/test-helpers.ts'
])
const SQL_START = /^\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i
const SAFETY_TABLE_OPERATION = /\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE)\s+safety_incident\b/i
const SESSION_SAFETY_OPERATION = /\b(?:assessment_session|training_session)\b/i
const OPEN_OR_REDLINED_SESSION = /\bstatus\s+(?:IN\s*\(|=\s*['"]REDLINE_HALTED)|\bredline_incident_id\b/i
const TRAINING_STEP_CASCADE = /\btraining_step_record\b/i

function listTypeScriptFiles(directory, root) {
  const result = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!EXCLUDED_PATH_PARTS.has(entry.name)) result.push(...listTypeScriptFiles(absolute, root))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    const file = relative(root, absolute).replaceAll('\\', '/')
    if (!EXCLUDED_FILES.has(file)) result.push(file)
  }
  return result.sort()
}

export function normalizeSql(sql) {
  return sql.replace(/\$\{[^}]*\}/g, '?').replace(/\s+/g, ' ').trim()
}

export function sqlFingerprint({ file, symbol, sql }) {
  return createHash('sha256').update(`${file}\0${symbol}\0${normalizeSql(sql)}`).digest('hex')
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function enclosingSymbol(source, offset) {
  const before = source.slice(0, offset)
  const matches = [...before.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)]
  const match = matches.at(-1)
  return match?.[1] ?? 'module_scope'
}

function isCandidate(sql) {
  if (!SQL_START.test(sql)) return false
  if (SAFETY_TABLE_OPERATION.test(sql)) return true
  if (SESSION_SAFETY_OPERATION.test(sql) && OPEN_OR_REDLINED_SESSION.test(sql)) return true
  return TRAINING_STEP_CASCADE.test(sql)
    && /^\s*UPDATE\s+training_step_record\b/i.test(sql)
    && /\bstatus\s*=\s*['"]FAILED['"]/i.test(sql)
}

function extractSqlLiterals(source) {
  const literals = []
  const expression = /`([\s\S]*?)`|'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"/g
  for (const match of source.matchAll(expression)) {
    const sql = match[1] ?? match[2] ?? match[3]
    if (isCandidate(sql)) literals.push({ sql, offset: match.index ?? 0 })
  }
  return literals
}

export function scanProductionSafetySql(projectRoot) {
  const files = listTypeScriptFiles(join(projectRoot, PRODUCTION_ROOT), projectRoot)
  const hits = []
  for (const file of files) {
    const source = readFileSync(join(projectRoot, file), 'utf8')
    for (const occurrence of extractSqlLiterals(source)) {
      const symbol = enclosingSymbol(source, occurrence.offset)
      hits.push({
        file,
        symbol,
        line: lineNumber(source, occurrence.offset),
        sql: normalizeSql(occurrence.sql),
        sql_fingerprint: sqlFingerprint({ file, symbol, sql: occurrence.sql })
      })
    }
  }
  return hits.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)
}

function assert(condition, message) {
  if (!condition) throw new Error(`[m4-safety-sql-inventory] ${message}`)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function sqlForSemanticChecks(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''")
}

function aliasesForRelations(sql, tableNames) {
  const aliases = new Set()
  const relation = new RegExp(`\\b(?:FROM|JOIN|UPDATE|INSERT\\s+INTO)\\s+(?:${tableNames.join('|')})\\b(?:\\s+(?:AS\\s+)?([A-Za-z_][\\w]*))?`, 'gi')
  const reservedWords = new Set([
    'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL',
    'ON', 'USING', 'SET', 'VALUES', 'ORDER', 'GROUP', 'HAVING', 'LIMIT', 'RETURNING'
  ])
  for (const match of sql.matchAll(relation)) {
    const alias = match[1]?.toUpperCase()
    aliases.add(alias && !reservedWords.has(alias) ? match[1] : null)
  }
  return aliases
}

function predicateAliasesForField(sql, field) {
  const aliases = new Set()
  const leftSide = new RegExp(`\\b(?:(?<alias>[A-Za-z_][\\w]*)\\.)?${field}\\s*=`, 'gi')
  const rightSide = new RegExp(`=\\s*(?:(?<alias>[A-Za-z_][\\w]*)\\.)?${field}\\b`, 'gi')
  for (const match of sql.matchAll(leftSide)) aliases.add(match.groups?.alias ?? null)
  for (const match of sql.matchAll(rightSide)) aliases.add(match.groups?.alias ?? null)
  return aliases
}

function aggregateKeyPredicateFields(sql) {
  const semanticSql = sqlForSemanticChecks(sql)
  return ['student_id', 'job_code', 'task_code']
    .filter((field) => predicateAliasesForField(semanticSql, field).size > 0)
}

function hasAggregateTripleKeyContract(sql) {
  const semanticSql = sqlForSemanticChecks(sql)
  if (/\bOR\b/i.test(semanticSql)) return false

  const incidentAliases = aliasesForRelations(semanticSql, ['safety_incident'])
  const targetAliases = incidentAliases.size > 0
    ? incidentAliases
    : aliasesForRelations(semanticSql, ['assessment_session', 'training_session'])
  if (targetAliases.size === 0) return false

  const aliasesByField = ['student_id', 'job_code', 'task_code']
    .map((field) => predicateAliasesForField(semanticSql, field))
  if (aliasesByField.some((aliases) => aliases.size === 0)) return false

  return [...aliasesByField[0]].some((alias) => targetAliases.has(alias)
    && aliasesByField.every((aliases) => aliases.has(alias)))
}

function hasIncidentPrimaryKeyContract(sql) {
  return /\bWHERE\b[\s\S]*\b(?:[A-Za-z_][\w]*\.)?incident_id\s*=/i.test(sqlForSemanticChecks(sql))
}

function hasStudentWideReadOnlyContract(sql) {
  return /^\s*SELECT\b/i.test(sqlForSemanticChecks(sql))
}

function assertEntryMetadata(entry) {
  for (const field of ['id', 'file', 'symbol', 'current_predicate', 'target_predicate', 'allowed_reason', 'status']) {
    assert(isNonEmptyString(entry[field]), `entry ${field} is required for ${entry.id || '<unknown>'}`)
  }
  assert(Array.isArray(entry.test_evidence) && entry.test_evidence.length > 0
    && entry.test_evidence.every(isNonEmptyString), `test_evidence is required for ${entry.id}`)
}

function assertClassificationQueryContract(entry, hit) {
  switch (entry.classification) {
    case 'AGGREGATE_MATCH_REKEY':
      assert(hasAggregateTripleKeyContract(hit.sql), `invalid aggregate triple-key contract: ${entry.id}`)
      break
    case 'INCIDENT_PRIMARY_KEY_LOOKUP':
      assert(hasIncidentPrimaryKeyContract(hit.sql), `invalid incident primary-key contract: ${entry.id}`)
      break
    case 'STUDENT_WIDE_LIST':
      assert(hasStudentWideReadOnlyContract(hit.sql), `student-wide list must be read-only SELECT: ${entry.id}`)
      assert(aggregateKeyPredicateFields(hit.sql).length <= 1, `student-wide list cannot contain aggregate key predicate: ${entry.id}`)
      break
    case 'NON_SAFETY_QUERY':
      assert(!(SAFETY_TABLE_OPERATION.test(sqlForSemanticChecks(hit.sql))
        && aggregateKeyPredicateFields(hit.sql).length > 0), `non-safety exemption cannot contain safety aggregate key predicate: ${entry.id}`)
      break
  }
}

export function validateSafetySqlInventory({ hits, inventory, mode = 'baseline' }) {
  assert(['baseline', 'target'].includes(mode), `unknown mode: ${mode}`)
  assert(inventory?.schema_version === 'multi-device-m4-safety-sql-inventory-v1', 'unexpected inventory schema_version')
  assert(Array.isArray(inventory.entries), 'inventory.entries must be an array')

  const ids = new Set()
  const fingerprints = new Set()
  const entryByFingerprint = new Map()
  for (const entry of inventory.entries) {
    assertEntryMetadata(entry)
    assert(!ids.has(entry.id), `duplicate inventory id: ${entry.id}`)
    ids.add(entry.id)
    assert(INVENTORY_CLASSES.includes(entry.classification), `invalid classification for ${entry.id}: ${entry.classification}`)
    assert(typeof entry.sql_fingerprint === 'string' && /^[a-f0-9]{64}$/.test(entry.sql_fingerprint), `invalid fingerprint for ${entry.id}`)
    assert(!fingerprints.has(entry.sql_fingerprint), `duplicate inventory fingerprint: ${entry.sql_fingerprint}`)
    fingerprints.add(entry.sql_fingerprint)
    entryByFingerprint.set(entry.sql_fingerprint, entry)
  }

  const hitByFingerprint = new Map()
  for (const hit of hits) {
    assert(!hitByFingerprint.has(hit.sql_fingerprint), `duplicate SQL occurrence fingerprint: ${hit.file}:${hit.line} (${hit.symbol})`)
    hitByFingerprint.set(hit.sql_fingerprint, hit)
    const entry = entryByFingerprint.get(hit.sql_fingerprint)
    assert(entry, `unregistered SQL hit: ${hit.file}:${hit.line} (${hit.symbol})`)
    assert(entry.file === hit.file, `inventory file mismatch for ${entry.id}: ${entry.file} != ${hit.file}`)
    assert(entry.symbol === hit.symbol, `inventory symbol mismatch for ${entry.id}: ${entry.symbol} != ${hit.symbol}`)
    assertClassificationQueryContract(entry, hit)
  }
  const hitFingerprints = new Set(hitByFingerprint.keys())
  for (const entry of inventory.entries) assert(hitFingerprints.has(entry.sql_fingerprint), `stale inventory entry: ${entry.id}`)
  assert(hits.length === inventory.entries.length, `hit/inventory occurrence count mismatch: ${hits.length} hits, ${inventory.entries.length} entries`)

  const counts = Object.fromEntries(INVENTORY_CLASSES.map((classification) => [classification, 0]))
  for (const entry of inventory.entries) counts[entry.classification] += 1

  const pendingRekey = inventory.entries
    .filter((entry) => entry.classification === 'AGGREGATE_MATCH_REKEY')
    .filter((entry) => entry.status !== 'REKEYED')
    .map((entry) => entry.id)
  const aggregateMissingTripleKey = inventory.entries
    .filter((entry) => entry.classification === 'AGGREGATE_MATCH_REKEY')
    .filter((entry) => {
      const hit = hitByFingerprint.get(entry.sql_fingerprint)
      return !hit || !hasAggregateTripleKeyContract(hit.sql)
    })
    .map((entry) => entry.id)

  if (mode === 'target') {
    const targetProblems = []
    if (pendingRekey.length > 0) targetProblems.push(`target pending re-key entries: ${pendingRekey.join(', ')}`)
    if (aggregateMissingTripleKey.length > 0) targetProblems.push(`target aggregate SQL missing semantic triple-key predicate: ${aggregateMissingTripleKey.join(', ')}`)
    assert(targetProblems.length === 0, targetProblems.join('; '))
  }

  return {
    inventory_version: inventory.inventory_version,
    hit_count: hits.length,
    classification_counts: counts,
    pending_rekey: pendingRekey,
    aggregate_missing_triple_key: aggregateMissingTripleKey
  }
}
