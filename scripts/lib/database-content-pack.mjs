import { createHash } from 'node:crypto'
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  approvedAssetsToResourceRows,
  buildVisualAssetResourceSql,
  validateVisualAssetManifest
} from './visual-asset-manifest.mjs'
import {
  buildDevAccountSeedSql,
  loadDevAccounts,
  verifyDevPassword
} from './dev-accounts.mjs'
import {
  assertSqliteCliAvailable,
  executeSqliteScript,
  runSqliteCommand
} from './sqlite-cli.mjs'

export const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
export const contentPack = JSON.parse(
  readFileSync(join(projectRoot, 'scripts', 'config', 'database-content-pack.json'), 'utf8')
)

const schemaPath = join(projectRoot, 'src', 'main', 'db', 'schema.sql')
const managedAssetRoles = [
  'QUESTION_MEDIA',
  'UI_ASSET',
  'TOOL_CHECKLIST',
  'ROLE_PLAY_SCRIPT',
  'SEALED_ADMIN_CONFIG',
  'OFFLINE_SETUP_GUIDE'
]
const seededStrategyIds = [
  'strategy_baseline_shelver_v1',
  'strategy_mock_shelver_v1',
  'strategy_training_shelver_v1',
  'strategy_job_skill_shelver_v1'
]

function runSql(dbPath, sql) {
  return executeSqliteScript(dbPath, sql, { encoding: 'utf8' })
}

function fullSchemaSql() {
  return `PRAGMA foreign_keys = ON;\nBEGIN IMMEDIATE;\n${readFileSync(schemaPath, 'utf8')}\nCOMMIT;`
}

function queryScalar(dbPath, sql) {
  return String(runSqliteCommand([dbPath, sql], { encoding: 'utf8' })).trim()
}

function queryJson(dbPath, sql) {
  const output = queryScalar(dbPath, sql)
  return output ? JSON.parse(output) : []
}

function stripTransaction(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*(BEGIN|COMMIT);\s*$/.test(line))
    .join('\n')
}

function contentSeedSql() {
  const questionSql = contentPack.questionContracts.map((contract) => {
    const source = readFileSync(join(projectRoot, contract.path), 'utf8')
    return stripTransaction(source).replaceAll(
      'INSERT INTO domain_event_projection',
      'INSERT OR IGNORE INTO domain_event_projection'
    )
  })
  const accounts = loadDevAccounts(projectRoot)
  const manifestPath = join(projectRoot, contentPack.assetManifestPath)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const validation = validateVisualAssetManifest(manifest, { projectRoot })
  if (!validation.ok) {
    throw new Error(`视觉资产合同校验失败：\n${validation.errors.join('\n')}`)
  }
  const assetRows = approvedAssetsToResourceRows(manifest, projectRoot)
  const assetSql = stripTransaction(
    buildVisualAssetResourceSql(assetRows, new Date().toISOString())
  )

  return {
    sql: [
      'PRAGMA foreign_keys = ON;',
      'BEGIN IMMEDIATE;',
      buildDevAccountSeedSql(accounts),
      'DELETE FROM question_bank;',
      "DELETE FROM domain_event_projection WHERE aggregate_type='QUESTION_BANK' AND event_type='QUESTION_IMPORTED';",
      ...questionSql,
      assetSql,
      'COMMIT;'
    ].join('\n'),
    approvedAssetCount: assetRows.length
  }
}

function questionRows(dbPath) {
  return queryJson(
    dbPath,
    `SELECT COALESCE(json_group_array(json_object(
      'question_id', question_id,
      'job_code', job_code,
      'bank_domain', bank_domain,
      'module_type', module_type,
      'job_module_code', job_module_code,
      'question_type', question_type,
      'item_usage', item_usage,
      'difficulty_level', difficulty_level,
      'content_json', content_json,
      'scoring_rule_json', scoring_rule_json,
      'safety_sensitive', safety_sensitive,
      'sensory_tags_json', sensory_tags_json,
      'status', status,
      'version', version
    )), '[]')
    FROM (SELECT * FROM question_bank ORDER BY question_id);`
  )
}

function activeManagedAssetRows(dbPath) {
  const roles = managedAssetRoles.map((role) => `'${role}'`).join(', ')
  return queryJson(
    dbPath,
    `SELECT COALESCE(json_group_array(json_object(
      'asset_id', asset_id,
      'asset_type', asset_type,
      'asset_role', asset_role,
      'app_uri', app_uri,
      'local_path', local_path,
      'mime_type', mime_type,
      'file_hash', file_hash,
      'file_size_bytes', file_size_bytes,
      'duration_ms', duration_ms,
      'width_px', width_px,
      'height_px', height_px,
      'status', status
    )), '[]')
    FROM (
      SELECT * FROM asset_resource
      WHERE status = 'ACTIVE' AND asset_role IN (${roles})
      ORDER BY asset_id
    );`
  )
}

function seededStrategyRows(dbPath) {
  const ids = seededStrategyIds.map((id) => `'${id}'`).join(', ')
  return queryJson(
    dbPath,
    `SELECT COALESCE(json_group_array(json_object(
      'strategy_id', strategy_id,
      'strategy_type', strategy_type,
      'job_code', job_code,
      'strategy_name', strategy_name,
      'online_question_count', online_question_count,
      'offline_question_count', offline_question_count,
      'max_score', max_score,
      'competent_threshold', competent_threshold,
      'conditional_threshold', conditional_threshold,
      'module_veto_threshold', module_veto_threshold,
      'emotion_collapse_threshold', emotion_collapse_threshold,
      'question_policy_json', question_policy_json,
      'scoring_policy_json', scoring_policy_json,
      'supports_redline_halt', supports_redline_halt,
      'allows_emotion_interrupt', allows_emotion_interrupt,
      'requires_offline_scoring', requires_offline_scoring,
      'version', version,
      'is_active', is_active
    )), '[]')
    FROM (
      SELECT * FROM strategy_config
      WHERE strategy_id IN (${ids}) AND version = 1
      ORDER BY strategy_id
    );`
  )
}

function questionImportEventRows(dbPath) {
  return queryJson(
    dbPath,
    `SELECT COALESCE(json_group_array(json_object(
      'event_id', event_id,
      'aggregate_type', aggregate_type,
      'aggregate_id', aggregate_id,
      'event_type', event_type,
      'event_sequence', event_sequence,
      'payload_json', payload_json,
      'checksum', checksum,
      'schema_version', schema_version
    )), '[]')
    FROM (
      SELECT * FROM domain_event_projection
      WHERE aggregate_type='QUESTION_BANK' AND event_type='QUESTION_IMPORTED'
      ORDER BY event_id
    );`
  )
}

function explicitSchemaObjectNames(dbPath) {
  return queryJson(
    dbPath,
    `SELECT COALESCE(json_group_array(type || ':' || name), '[]')
     FROM (
       SELECT type, name FROM sqlite_master
       WHERE type IN ('index', 'trigger') AND sql IS NOT NULL
       ORDER BY type, name
     );`
  )
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function digestFile(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

function verifyJobSkillRuntimeContract() {
  const contract = contentPack.jobSkillRuntimeContract
  if (!contract) throw new Error('内容包缺少 jobSkillRuntimeContract')
  const authorityPath = join(projectRoot, contract.authorityPath)
  const deliveryLockPath = join(projectRoot, contract.deliveryLockPath)
  const activationGatePath = join(projectRoot, contract.activationGatePath)
  const questionContract = contentPack.questionContracts.find((item) => item.domain === 'JOB_SPECIFIC')
  if (!questionContract) throw new Error('内容包缺少 JOB_SPECIFIC question contract')
  const sqlPath = join(projectRoot, questionContract.path)

  const pinned = [
    [authorityPath, contract.authorityFileSha256, 'runtime authority'],
    [deliveryLockPath, contract.deliveryLockFileSha256, 'delivery lock'],
    [activationGatePath, contract.activationGateFileSha256, 'activation gate'],
    [sqlPath, contract.questionSqlSha256, 'JOB_SPECIFIC SQL']
  ]
  for (const [path, expected, label] of pinned) {
    const actual = digestFile(path)
    if (actual !== expected) throw new Error(`${label} 文件哈希漂移：${actual} != ${expected}`)
  }

  const authority = JSON.parse(readFileSync(authorityPath, 'utf8'))
  const deliveryLock = JSON.parse(readFileSync(deliveryLockPath, 'utf8'))
  const gate = JSON.parse(readFileSync(activationGatePath, 'utf8'))
  if (authority.authority_hash !== contract.authorityHash) throw new Error('runtime authority_hash 漂移')
  if (authority.semantic_root_hash !== contract.semanticRootHash) throw new Error('runtime semantic_root_hash 漂移')
  if (deliveryLock.lock_hash !== contract.deliveryLockHash) throw new Error('delivery lock_hash 漂移')
  if (gate.runtime_authority?.authority_hash !== contract.authorityHash) throw new Error('activation gate 未绑定当前 runtime authority')
  if (gate.delivery_lock?.lock_hash !== contract.deliveryLockHash) throw new Error('activation gate 未绑定当前 delivery lock')
  if (gate.authority?.may_compile_draft_seed !== true) throw new Error('activation gate 不允许编译 DRAFT seed')
  return { authority, deliveryLock, gate }
}

function buildReferenceSnapshot() {
  const tempDir = mkdtempSync(join(tmpdir(), 'xc-db-reference-'))
  const dbPath = join(tempDir, 'reference.db')
  try {
    runSql(dbPath, fullSchemaSql())
    const runtimeContract = verifyJobSkillRuntimeContract()
    const seed = contentSeedSql()
    runSql(dbPath, seed.sql)
    const activeJobSkillCount = Number(queryScalar(
      dbPath,
      "SELECT COUNT(*) FROM question_bank WHERE bank_domain='JOB_SPECIFIC' AND status='ACTIVE';"
    ))
    if (runtimeContract.gate.authority.may_activate !== true && activeJobSkillCount !== 0) {
      throw new Error('激活门禁关闭时 JOB_SPECIFIC seed 必须全部保持 DRAFT')
    }
    return {
      questionHash: digest(questionRows(dbPath)),
      assetHash: digest(activeManagedAssetRows(dbPath)),
      strategyHash: digest(seededStrategyRows(dbPath)),
      questionImportEventHash: digest(questionImportEventRows(dbPath)),
      explicitSchemaObjects: explicitSchemaObjectNames(dbPath),
      approvedAssetCount: seed.approvedAssetCount,
      runtimeContractHash: digest({
        authorityHash: runtimeContract.authority.authority_hash,
        semanticRootHash: runtimeContract.authority.semantic_root_hash,
        deliveryLockHash: runtimeContract.deliveryLock.lock_hash,
        activationGateHash: runtimeContract.gate.gate_hash,
        questionSqlSha256: contentPack.jobSkillRuntimeContract.questionSqlSha256
      })
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

function verifyStructure(dbPath, issues) {
  const integrity = queryScalar(dbPath, 'PRAGMA integrity_check;')
  if (integrity !== 'ok') issues.push(`integrity_check=${integrity}`)
  const foreignKeyFailures = Number(queryScalar(dbPath, 'SELECT COUNT(*) FROM pragma_foreign_key_check;'))
  if (foreignKeyFailures !== 0) issues.push(`foreign_key_check=${foreignKeyFailures}`)

  const requiredTables = [
    'user_account',
    'schema_migration',
    'student_profile',
    'question_bank',
    'strategy_config',
    'asset_resource',
    'domain_event_projection',
    'organization',
    'node',
    'device',
    'device_runtime_session',
    'auth_session'
  ]
  const tables = new Set(
    queryJson(
      dbPath,
      "SELECT COALESCE(json_group_array(name), '[]') FROM sqlite_master WHERE type='table';"
    )
  )
  for (const table of requiredTables) {
    if (!tables.has(table)) issues.push(`缺少表 ${table}`)
  }

  let ready = requiredTables.every((table) => tables.has(table))
  if (tables.has('student_profile')) {
    const studentColumns = new Set(
      queryJson(dbPath, "SELECT COALESCE(json_group_array(name), '[]') FROM pragma_table_info('student_profile');")
    )
    if (!studentColumns.has('user_id')) {
      issues.push('缺少列 student_profile.user_id')
      ready = false
    }
  }

  if (tables.has('schema_migration')) {
    for (const migration of contentPack.requiredMigrationLedger) {
      const migrationCount = Number(
        queryScalar(
          dbPath,
          `SELECT COUNT(*) FROM schema_migration
           WHERE migration_id='${migration.migrationId}'
             AND schema_version='${migration.schemaVersion}';`
        )
      )
      if (migrationCount !== 1) {
        issues.push(`缺少迁移记录 ${migration.migrationId}@${migration.schemaVersion}`)
      }
    }
  }
  return ready
}

function verifyAccounts(dbPath, issues) {
  const expected = loadDevAccounts(projectRoot)
  const actual = queryJson(
    dbPath,
    `SELECT COALESCE(json_group_array(json_object(
      'username', username,
      'password_hash', password_hash,
      'role', role,
      'display_name', display_name,
      'status', status
    )), '[]') FROM user_account WHERE username IN ('admin', 'teacher', 'student');`
  )
  const byUsername = new Map(actual.map((account) => [account.username, account]))
  for (const account of expected) {
    const stored = byUsername.get(account.username)
    if (!stored) {
      issues.push(`缺少开发账号 ${account.username}`)
      continue
    }
    if (stored.role !== account.role || stored.status !== 'ACTIVE') {
      issues.push(`开发账号 ${account.username} 的角色或状态不一致`)
    }
    if (!verifyDevPassword(account.password, stored.password_hash)) {
      issues.push(`开发账号 ${account.username} 的密码不符合共享合同`)
    }
  }
  const linked = Number(
    queryScalar(
      dbPath,
      `SELECT COUNT(*) FROM student_profile sp
       JOIN user_account ua ON ua.user_id = sp.user_id
       WHERE sp.student_id='seed-student-001' AND ua.username='student';`
    )
  )
  if (linked !== 1) issues.push('开发学生档案未关联 student 登录账号')
}

export function verifyDatabase(dbPath, options = {}) {
  if (!existsSync(dbPath)) throw new Error(`数据库不存在：${dbPath}`)
  const issues = []
  const structureReady = verifyStructure(dbPath, issues)
  if (!structureReady) {
    const result = {
      ok: false,
      dbPath,
      packVersion: contentPack.version,
      packHash: null,
      schemaVersion: contentPack.schemaVersion,
      counts: {},
      approvedAssetCount: 0,
      issues
    }
    if (options.throwOnError !== false) {
      throw new Error(`数据库验证失败：\n- ${issues.join('\n- ')}`)
    }
    return result
  }

  const counts = Object.fromEntries(
    queryJson(
      dbPath,
      `SELECT COALESCE(json_group_array(json_object('domain', bank_domain, 'count', count)), '[]')
       FROM (SELECT bank_domain, COUNT(*) AS count FROM question_bank GROUP BY bank_domain ORDER BY bank_domain);`
    ).map((row) => [row.domain, row.count])
  )
  for (const contract of contentPack.questionContracts) {
    if (counts[contract.domain] !== contract.expectedCount) {
      issues.push(
        `${contract.domain} 题数=${counts[contract.domain] ?? 0}，期望=${contract.expectedCount}`
      )
    }
  }

  verifyAccounts(dbPath, issues)
  const reference = options.reference ?? buildReferenceSnapshot()
  const actualSchemaObjects = new Set(explicitSchemaObjectNames(dbPath))
  for (const objectName of reference.explicitSchemaObjects) {
    if (!actualSchemaObjects.has(objectName)) issues.push(`缺少 schema 对象 ${objectName}`)
  }
  const actualQuestionHash = digest(questionRows(dbPath))
  const actualAssetHash = digest(activeManagedAssetRows(dbPath))
  const actualStrategyHash = digest(seededStrategyRows(dbPath))
  const actualQuestionImportEventHash = digest(questionImportEventRows(dbPath))
  if (actualQuestionHash !== reference.questionHash) issues.push('题库语义哈希与内容包不一致')
  if (actualAssetHash !== reference.assetHash) issues.push('ACTIVE 视觉资产投影与 Manifest 不一致')
  if (actualStrategyHash !== reference.strategyHash) issues.push('内置策略配置与 schema 合同不一致')
  if (actualQuestionImportEventHash !== reference.questionImportEventHash) {
    issues.push('题库导入事件投影与内容包不一致')
  }

  const packHash = digest({
    version: contentPack.version,
    schemaVersion: contentPack.schemaVersion,
    requiredMigrationLedger: contentPack.requiredMigrationLedger,
    questionHash: reference.questionHash,
    assetHash: reference.assetHash,
    strategyHash: reference.strategyHash,
    questionImportEventHash: reference.questionImportEventHash,
    runtimeContractHash: reference.runtimeContractHash,
    explicitSchemaObjectHash: digest(reference.explicitSchemaObjects)
  })
  const result = {
    ok: issues.length === 0,
    dbPath,
    packVersion: contentPack.version,
    packHash,
    schemaVersion: contentPack.schemaVersion,
    counts,
    approvedAssetCount: reference.approvedAssetCount,
    issues
  }
  if (!result.ok && options.throwOnError !== false) {
    throw new Error(`数据库验证失败：\n- ${issues.join('\n- ')}`)
  }
  return result
}

function isExistingCurrentSchema(dbPath) {
  const hasUserTable = Number(
    queryScalar(dbPath, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='user_account';")
  )
  if (hasUserTable === 0) return true
  const hasUserId = Number(
    queryScalar(dbPath, "SELECT COUNT(*) FROM pragma_table_info('student_profile') WHERE name='user_id';")
  )
  return hasUserId === 1
}

function backupDatabase(dbPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(dirname(dbPath), 'backups', `pre-reset.${timestamp}`)
  mkdirSync(backupDir, { recursive: true })
  if (existsSync(dbPath)) {
    const backupPath = join(backupDir, 'xc-career-guide.db')
    const escapedPath = backupPath.replaceAll("'", "''")
    queryScalar(dbPath, `VACUUM INTO '${escapedPath}';`)
  }
  const actionLogPath = join(dirname(dbPath), 'action_log.jsonl')
  if (existsSync(actionLogPath)) copyFileSync(actionLogPath, join(backupDir, 'action_log.jsonl'))
  return backupDir
}

export function syncDatabase(dbPath, options = {}) {
  try {
    assertSqliteCliAvailable()
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('未找到 sqlite3 CLI；请先安装 sqlite3 后再执行数据库同步。')
    }
    throw error
  }
  // 所有内容合同必须在创建目录、备份、建表或 seed 之前通过，避免失败后留下半写入运行库。
  verifyJobSkillRuntimeContract()
  mkdirSync(dirname(dbPath), { recursive: true })
  let backupPath = null
  const actionLogPath = join(dirname(dbPath), 'action_log.jsonl')
  const hasLocalState = ['', '-wal', '-shm'].some((suffix) => existsSync(`${dbPath}${suffix}`)) ||
    existsSync(actionLogPath)
  if (options.reset && hasLocalState) {
    backupPath = backupDatabase(dbPath)
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
    rmSync(actionLogPath, { force: true })
  }

  if (existsSync(dbPath) && !isExistingCurrentSchema(dbPath)) {
    throw new Error(
      '检测到旧版开发库。请关闭 Electron 后执行 npm run db:sync -- --reset；' +
        '应用正常启动也可先完成 v0.1.12 -> v0.1.13 迁移。'
    )
  }

  runSql(dbPath, fullSchemaSql())
  const seed = contentSeedSql()
  runSql(dbPath, seed.sql)
  const verification = verifyDatabase(dbPath)
  return { ...verification, backupPath }
}
