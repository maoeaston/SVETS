import { _electron as electron } from 'playwright'
import electronPath from 'electron'
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import {
  existsSync,
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync
} from 'fs'
import { homedir, tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(new URL('../..', import.meta.url).pathname)
const OUT_MAIN = join(ROOT, 'out/main/index.js')
const OUT_RENDERER = join(ROOT, 'out/renderer/index.html')
const REPORT_ID = 'e2e-safety-report-001'
const INCIDENT_ID = 'e2e-incident-001'
const SAFETY_CREATED_EVENT_ID = 'e2e-safety-created-event-001'
const SAFETY_CONFIRMED_EVENT_ID = 'e2e-safety-confirmed-event-001'
const REPORT_GENERATED_EVENT_ID = 'e2e-report-generated-event-001'
const STUDENT_ID = 'seed-student-001'
const TEACHER_ID = 'seed-teacher-001'
const GENERATED_AT = '2026-07-26T00:00:00.000Z'
const VIEWPORTS = ['1366x768', '1280x720', '375x812']

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalize(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}: number must be finite`)
    return value
  }
  if (Array.isArray(value)) return value.map((item, index) => normalize(item, `${path}[${index}]`))
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = normalize(value[key], `${path}.${key}`)
      return result
    }, {})
  }
  throw new Error(`${path}: unsupported JSON value`)
}

function sha256CanonicalJson(value) {
  return createHash('sha256').update(JSON.stringify(normalize(value)), 'utf8').digest('hex')
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function safetyReportContent() {
  return {
    report_schema_version: 'safety-termination-report-v1.0',
    report_scope: 'SAFETY',
    source_scope: 'NO_BOUND_SESSION',
    report_type: 'SAFETY_TERMINATION_REPORT',
    generated_at: GENERATED_AT,
    incident_snapshot: {
      incident_id: INCIDENT_ID,
      student_id: STUDENT_ID,
      job_code: 'SUPERMARKET_SHELVER',
      task_code: 'SHELVE_TASK',
      status_at_generation: 'CONFIRMED',
      reason_code: 'BLADE_TOWARD_SELF',
      context_phase: 'OFFLINE_SCORING',
      description: '<script>window.__svetsUnsafeReportExecuted=true</script> 安全事实',
      occurred_at: GENERATED_AT,
      triggered_by: TEACHER_ID,
      confirmed_by: TEACHER_ID,
      confirmed_at: GENERATED_AT
    },
    binding_snapshots: [],
    pre_redline_records: {
      result_ids: [],
      answer_summary: {},
      offline_score_summary: {},
      training_step_summary: {}
    },
    safety_summary: {
      level_result: 'LEVEL_FAIL_BY_SAFETY',
      ordinary_report_blocked: true
    },
    validity_limitations: ['仅用于 E2E 临时见证'],
    correction_lineage: {
      root_incident_id: INCIDENT_ID,
      replaces_incident_id: null,
      supersedes_report_id: null
    },
    source_meta: {
      metadata_availability: 'NO_BOUND_SESSION',
      binding_metadata: []
    },
    placement_advice: {
      enabled: false,
      recommendation: null,
      reason_disabled: 'SAFETY_TERMINATION'
    }
  }
}

async function launchApp(paths, viewport) {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [ROOT],
    cwd: ROOT,
    env: {
      ...process.env,
      SVETS_E2E: '1',
      SVETS_E2E_ACTIVATION_BYPASS: '1',
      SVETS_E2E_VIEWPORT: viewport,
      SVETS_USER_DATA_DIR: paths.userDataDir,
      SVETS_REPORT_E2E_EXPORT_DIR: paths.exportDir,
      ELECTRON_ENABLE_LOGGING: '1'
    }
  })
  const page = await app.firstWindow()
  pageErrors(page)
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => Boolean(window.api?.auth && window.api?.reports), null, { timeout: 15000 })
  return { app, page }
}

function pageErrors(page) {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.e2eErrors = errors
}

async function closeApp(app) {
  try {
    await app.close()
  } catch {
    // Electron may already be closed by app quit.
  }
}

async function loginAs(page, username, password, expectedHashPrefix) {
  await page.evaluate(async () => {
    try {
      await window.api.auth.logout()
    } catch {
      // Ignore missing session.
    }
    window.location.hash = '#/login'
  })
  await page.locator('#username').waitFor({ timeout: 10000 })
  await page.fill('#username', username)
  await page.fill('#password', password)
  await page.getByRole('button', { name: /^登录$/ }).click()
  await page.waitForFunction((prefix) => window.location.hash.startsWith(prefix), expectedHashPrefix, { timeout: 10000 })
}

async function setHash(page, hash) {
  await page.evaluate((nextHash) => {
    window.location.hash = nextHash
  }, hash)
}

async function assertViewport(page, viewport) {
  const [width, height] = viewport.split('x').map(Number)
  const actual = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  assert(actual.width === width && actual.height === height, `viewport mismatch for ${viewport}: got ${actual.width}x${actual.height}`)
}

function verifyBuildExists() {
  assert(existsSync(OUT_MAIN), 'out/main/index.js missing; run npm run build before npm run e2e:report')
  assert(existsSync(OUT_RENDERER), 'out/renderer/index.html missing; run npm run build before npm run e2e:report')
}

function verifyIsolatedDb(paths) {
  const realDbPath = realpathSync(paths.dbPath)
  const realTempRoot = realpathSync(paths.tempRoot)
  const realUserDataDir = realpathSync(paths.userDataDir)
  const realExportDir = realpathSync(paths.exportDir)
  const defaultDbPath = join(homedir(), '.config/xc-career-guide/data/xc-career-guide.db')
  assert(realUserDataDir.startsWith(realTempRoot), `E2E userData is not inside temp root: ${realUserDataDir}`)
  assert(realExportDir.startsWith(realTempRoot), `E2E export dir is not inside temp root: ${realExportDir}`)
  assert(realDbPath.startsWith(realTempRoot), `E2E DB is not inside temp root: ${realDbPath}`)
  assert(realDbPath !== defaultDbPath, `E2E DB resolved to real runtime database: ${defaultDbPath}`)
}

function seedReport(paths) {
  const content = safetyReportContent()
  const contentHash = sha256CanonicalJson(content)
  const actionLogPath = join(paths.userDataDir, 'data/action_log.jsonl')
  const safetyDescription = '<script>window.__svetsUnsafeReportExecuted=true</script> 安全事实'
  const createdPayload = {
    incident_id: INCIDENT_ID,
    student_id: STUDENT_ID,
    job_code: 'SUPERMARKET_SHELVER',
    task_code: 'SHELVE_TASK',
    reason_code: 'BLADE_TOWARD_SELF',
    context_phase: 'OFFLINE_SCORING',
    occurred_at: GENERATED_AT,
    reported_by: TEACHER_ID,
    brief_description: safetyDescription
  }
  const confirmedPayload = {
    incident_id: INCIDENT_ID,
    confirmed_at: GENERATED_AT,
    confirmed_by: TEACHER_ID,
    reason_code: 'BLADE_TOWARD_SELF',
    context_phase: 'OFFLINE_SCORING',
    full_description: safetyDescription
  }
  const generatedPayload = {
    report_id: REPORT_ID,
    student_id: STUDENT_ID,
    job_code: 'SUPERMARKET_SHELVER',
    task_code: 'SHELVE_TASK',
    report_title: 'E2E 安全终止报告',
    report_scope: 'SAFETY',
    report_type: 'SAFETY_TERMINATION_REPORT',
    source_aggregate_type: 'SAFETY_INCIDENT',
    source_aggregate_id: INCIDENT_ID,
    result_ids: [],
    incident_ids: [INCIDENT_ID],
    generated_at: GENERATED_AT,
    generated_by: TEACHER_ID,
    report_content: content,
    task_closure_id: null,
    repair_of_report_id: null,
    lineage_key: sha256CanonicalJson({ root_incident_id: INCIDENT_ID, report_scope: 'SAFETY' }),
    source_set_hash: sha256CanonicalJson({ incident_id: INCIDENT_ID }),
    generation_key: sha256Text('e2e-generation-key'),
    content_hash: contentHash,
    report_revision: 1,
    report_schema_version: 'safety-termination-report-v1.0',
    report_builder_version: 'e2e-fixture',
    generation_reason: 'NORMAL',
    superseded_report_ids: []
  }
  const fixtures = [
    {
      eventId: SAFETY_CREATED_EVENT_ID,
      aggregateType: 'SAFETY_INCIDENT',
      aggregateId: INCIDENT_ID,
      eventType: 'SAFETY_INCIDENT_CREATED',
      eventSequence: 1,
      schemaVersion: 1,
      payload: createdPayload
    },
    {
      eventId: SAFETY_CONFIRMED_EVENT_ID,
      aggregateType: 'SAFETY_INCIDENT',
      aggregateId: INCIDENT_ID,
      eventType: 'SAFETY_INCIDENT_DETAIL_CONFIRMED',
      eventSequence: 2,
      schemaVersion: 1,
      payload: confirmedPayload
    },
    {
      eventId: REPORT_GENERATED_EVENT_ID,
      aggregateType: 'TASK_REPORT',
      aggregateId: REPORT_ID,
      eventType: 'REPORT_GENERATED',
      eventSequence: 1,
      schemaVersion: 2,
      payload: generatedPayload
    }
  ].map((fixture) => {
    const payloadJson = JSON.stringify(fixture.payload)
    return {
      ...fixture,
      payloadJson,
      checksum: sha256Text(payloadJson)
    }
  })
  const [createdEvent, confirmedEvent, reportEvent] = fixtures
  const sql = `
BEGIN;
INSERT INTO domain_event_projection
  (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
   payload_json, checksum, source_log_path, schema_version, created_at, applied_to_snapshot, applied_at)
VALUES
  (${sqlString(createdEvent.eventId)}, 'SAFETY_INCIDENT', ${sqlString(INCIDENT_ID)},
   'SAFETY_INCIDENT_CREATED', 1, ${sqlString(createdEvent.payloadJson)},
   ${sqlString(createdEvent.checksum)}, ${sqlString(actionLogPath)}, ${createdEvent.schemaVersion},
   ${sqlString(GENERATED_AT)}, 1, ${sqlString(GENERATED_AT)}),
  (${sqlString(confirmedEvent.eventId)}, 'SAFETY_INCIDENT', ${sqlString(INCIDENT_ID)},
   'SAFETY_INCIDENT_DETAIL_CONFIRMED', 2, ${sqlString(confirmedEvent.payloadJson)},
   ${sqlString(confirmedEvent.checksum)}, ${sqlString(actionLogPath)}, ${confirmedEvent.schemaVersion},
   ${sqlString(GENERATED_AT)}, 1, ${sqlString(GENERATED_AT)}),
  (${sqlString(reportEvent.eventId)}, 'TASK_REPORT', ${sqlString(REPORT_ID)},
   'REPORT_GENERATED', 1, ${sqlString(reportEvent.payloadJson)},
   ${sqlString(reportEvent.checksum)}, ${sqlString(actionLogPath)}, ${reportEvent.schemaVersion},
   ${sqlString(GENERATED_AT)}, 1, ${sqlString(GENERATED_AT)});
INSERT INTO safety_incident
  (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code,
   description, triggered_by, context_phase, occurred_at, status,
   requires_review_before_next_session)
VALUES
  (${sqlString(INCIDENT_ID)}, ${sqlString(STUDENT_ID)}, 'SUPERMARKET_SHELVER',
   'SHELVE_TASK', ${sqlString(SAFETY_CREATED_EVENT_ID)}, 'BLADE_TOWARD_SELF',
   ${sqlString(safetyDescription)}, ${sqlString(TEACHER_ID)}, 'OFFLINE_SCORING',
   ${sqlString(GENERATED_AT)}, 'PENDING_DETAIL', 1);
UPDATE safety_incident
   SET status = 'CONFIRMED', confirmed_by = ${sqlString(TEACHER_ID)},
       updated_at = ${sqlString(GENERATED_AT)}
 WHERE incident_id = ${sqlString(INCIDENT_ID)};
INSERT INTO task_report
  (report_id, report_type, student_id, source_aggregate_type, source_aggregate_id,
   source_result_ids_json, report_title, report_content_json, generated_event_id,
   generated_by, generated_at, lineage_key, source_set_hash, generation_key, content_hash,
   report_revision, report_schema_version, report_builder_version, generation_reason,
   contract_validation_status, last_applied_event_id, status)
VALUES
  (${sqlString(REPORT_ID)}, 'SAFETY_TERMINATION_REPORT', ${sqlString(STUDENT_ID)}, 'SAFETY_INCIDENT',
   ${sqlString(INCIDENT_ID)}, '[]', ${sqlString('E2E 安全终止报告')}, ${sqlString(JSON.stringify(content))},
   ${sqlString(REPORT_GENERATED_EVENT_ID)}, ${sqlString(TEACHER_ID)}, ${sqlString(GENERATED_AT)},
   ${sqlString(sha256CanonicalJson({ root_incident_id: INCIDENT_ID, report_scope: 'SAFETY' }))},
   ${sqlString(sha256CanonicalJson({ incident_id: INCIDENT_ID }))},
   ${sqlString(sha256Text('e2e-generation-key'))}, ${sqlString(contentHash)}, 1,
   'safety-termination-report-v1.0', 'e2e-fixture', 'NORMAL', 'VALID',
   ${sqlString(REPORT_GENERATED_EVENT_ID)}, 'GENERATED');
COMMIT;
`
  const result = spawnSync('sqlite3', [paths.dbPath], { input: sql, encoding: 'utf8' })
  assert(result.status === 0, `sqlite3 fixture seed failed: ${result.stderr || result.stdout}`)
  for (const fixture of fixtures) {
    appendFileSync(actionLogPath, `${JSON.stringify({
      event_id: fixture.eventId,
      aggregate_type: fixture.aggregateType,
      aggregate_id: fixture.aggregateId,
      event_type: fixture.eventType,
      event_sequence: fixture.eventSequence,
      payload: fixture.payload,
      checksum: fixture.checksum,
      schema_version: fixture.schemaVersion,
      created_at: GENERATED_AT,
      actor_id: TEACHER_ID,
      actor_role: 'TEACHER',
      app_version: '1.0.0-alpha.1'
    })}\n`, { encoding: 'utf8' })
  }
}

async function witnessTeacherViewport(paths, viewport, doLifecycleActions) {
  const { app, page } = await launchApp(paths, viewport)
  try {
    await assertViewport(page, viewport)
    await loginAs(page, 'teacher', 'Teacher@123', '#/teacher')
    await setHash(page, '#/teacher/reports')
    await page.getByRole('heading', { name: '任务报告' }).waitFor({ timeout: 10000 })
    await page.getByText('E2E 安全终止报告').waitFor({ timeout: 10000 })

    const before = await page.evaluate((reportId) => window.api.reports.list({
      callerUserId: 'seed-teacher-001',
      callerRole: 'TEACHER',
      limit: 100,
      offset: 0
    }).then((result) => result.success ? result.items.filter((item) => item.reportId === reportId).length : -1), REPORT_ID)
    assert(before === 1, `expected one seeded report before detail, got ${before}`)

    await page.getByText('E2E 安全终止报告').click()
    await page.getByRole('heading', { name: 'E2E 安全终止报告' }).waitFor({ timeout: 10000 })
    await page.getByRole('heading', { name: '安全事实' }).waitFor({ timeout: 10000 })
    await page.getByText('<script>window.__svetsUnsafeReportExecuted=true</script> 安全事实', { exact: true }).waitFor({ timeout: 10000 })

    const scriptExecuted = await page.evaluate(() => Boolean(window.__svetsUnsafeReportExecuted))
    assert(scriptExecuted === false, 'unsafe report field executed as script')

    const after = await page.evaluate((reportId) => window.api.reports.list({
      callerUserId: 'seed-teacher-001',
      callerRole: 'TEACHER',
      limit: 100,
      offset: 0
    }).then((result) => result.success ? result.items.filter((item) => item.reportId === reportId).length : -1), REPORT_ID)
    assert(after === before, `detail view changed report count: before ${before}, after ${after}`)

    if (doLifecycleActions) {
      page.once('dialog', (dialog) => dialog.accept())
      await page.getByRole('button', { name: '锁定报告' }).click()
      await page.getByText('报告已锁定。').waitFor({ timeout: 10000 })
      await page.getByRole('button', { name: '导出脱敏 HTML' }).click()
      await page.getByText('脱敏 HTML 已导出。').waitFor({ timeout: 10000 })
      const exported = readdirSync(paths.exportDir).filter((name) => name.endsWith('.html'))
      assert(exported.length === 1, `expected one exported HTML file, got ${exported.length}`)
      const html = readFileSync(join(paths.exportDir, exported[0]), 'utf8')
      assert(html.includes('Content-Security-Policy'), 'exported HTML missing CSP')
      assert(!html.includes('<script'), 'exported HTML contains script tag')
      assert(!html.includes('<script>window.__svetsUnsafeReportExecuted=true</script>'), 'exported HTML contains raw unsafe report description')
      const detail = await page.evaluate((reportId) => window.api.reports.get({
        callerUserId: 'seed-teacher-001',
        callerRole: 'TEACHER',
        reportId
      }), REPORT_ID)
      assert(detail.success, 'teacher reports:get failed after export')
      assert(detail.report.lifecycle.status === 'LOCKED', `expected LOCKED, got ${detail.report.lifecycle.status}`)
      assert(typeof detail.report.lifecycle.lastExportedAt === 'string', 'expected lastExportedAt after export')
    }

    await page.screenshot({ path: join(paths.screenshotDir, `report-detail-${viewport}.png`), fullPage: true })
    assert(page.e2eErrors.length === 0, `renderer errors in ${viewport}: ${page.e2eErrors.join('\n')}`)
  } finally {
    await closeApp(app)
  }
}

async function witnessPermission(paths, username, password, expectedPrefix) {
  const { app, page } = await launchApp(paths, '1280x720')
  try {
    await loginAs(page, username, password, expectedPrefix)
    await setHash(page, '#/teacher/reports')
    await page.waitForFunction((prefix) => window.location.hash.startsWith(prefix), expectedPrefix, { timeout: 10000 })
    const result = await page.evaluate(() => window.api.reports.list({
      callerUserId: 'seed-teacher-001',
      callerRole: 'TEACHER',
      limit: 10,
      offset: 0
    }))
    assert(!result.success && result.errorCode === 'FORBIDDEN', `${username} direct reports:list was not forbidden`)
  } finally {
    await closeApp(app)
  }
}

async function witnessRecovery(paths) {
  const { app, page } = await launchApp(paths, '1280x720')
  try {
    await loginAs(page, 'teacher', 'Teacher@123', '#/teacher')
    const detail = await page.evaluate((reportId) => window.api.reports.get({
      callerUserId: 'seed-teacher-001',
      callerRole: 'TEACHER',
      reportId
    }), REPORT_ID)
    assert(detail.success, 'teacher reports:get failed after relaunch')
    assert(detail.report.lifecycle.status === 'LOCKED', `relaunch lost status: ${detail.report.lifecycle.status}`)
    assert(typeof detail.report.lifecycle.lastExportedAt === 'string', 'relaunch lost export lifecycle metadata')
  } finally {
    await closeApp(app)
  }
}

async function main() {
  verifyBuildExists()
  const tempRoot = mkdtempSync(join(tmpdir(), 'svets-report-e2e-'))
  const paths = {
    tempRoot,
    userDataDir: join(tempRoot, 'userData'),
    exportDir: join(tempRoot, 'exports'),
    screenshotDir: join(tempRoot, 'screenshots'),
    dbPath: join(tempRoot, 'userData/data/xc-career-guide.db')
  }
  mkdirSync(paths.exportDir, { recursive: true })
  mkdirSync(paths.screenshotDir, { recursive: true })

  const init = await launchApp(paths, '1280x720')
  await closeApp(init.app)
  assert(existsSync(paths.dbPath), `isolated database was not initialized: ${paths.dbPath}`)
  verifyIsolatedDb(paths)
  seedReport(paths)

  for (const viewport of VIEWPORTS) {
    await witnessTeacherViewport(paths, viewport, viewport === '1280x720')
  }
  await witnessPermission(paths, 'admin', 'Admin@123', '#/admin')
  await witnessPermission(paths, 'student', 'Student@123', '#/student')
  await witnessRecovery(paths)

  console.log(JSON.stringify({
    ok: true,
    tempRoot: paths.tempRoot,
    userDataDir: paths.userDataDir,
    dbPath: paths.dbPath,
    exportDir: paths.exportDir,
    screenshotDir: paths.screenshotDir,
    viewports: VIEWPORTS,
    reportId: REPORT_ID
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
