import { _electron as electron } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const userDataDir = mkdtempSync(join(tmpdir(), 'svets-m4-ui-'))
const databasePath = join(userDataDir, 'data', 'xc-career-guide.db')
const app = await electron.launch({
  args: ['--no-sandbox', 'out/main/index.js'],
  env: {
    ...process.env,
    SVETS_E2E: '1',
    SVETS_USER_DATA_DIR: userDataDir
  },
  timeout: 30000
})

let page
let passed = false
let appClosed = false

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function login(username, password, expectedPath) {
  await page.waitForSelector('#username', { timeout: 15000 })
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(new RegExp(expectedPath.replace('/', '\\/')), { timeout: 10000 })
}

async function logout() {
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.waitForSelector('#username', { timeout: 10000 })
}

function runSql(sql) {
  console.log('[m4-ui] sqlite3 fixture write started')
  const result = spawnSync('sqlite3', ['-bail', databasePath], {
    input: `PRAGMA busy_timeout = 5000;\nPRAGMA foreign_keys = ON;\n${sql}`,
    encoding: 'utf8',
    timeout: 10000
  })
  if (result.status !== 0 || result.error) throw new Error(`sqlite3 fixture failed: ${result.error?.message ?? result.stderr ?? result.stdout}`)
  console.log('[m4-ui] sqlite3 fixture write completed')
}

function querySql(sql) {
  console.log('[m4-ui] sqlite3 assertion query started')
  const result = spawnSync('sqlite3', ['-json', databasePath, sql], { encoding: 'utf8', timeout: 10000 })
  if (result.status !== 0 || result.error) throw new Error(`sqlite3 query failed: ${result.error?.message ?? result.stderr ?? result.stdout}`)
  console.log('[m4-ui] sqlite3 assertion query completed')
  return JSON.parse(result.stdout || '[]')
}

try {
  console.log('[m4-ui] waiting for the first Electron window')
  page = await app.firstWindow()
  const consoleErrors = []
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.waitForSelector('#username', { timeout: 15000 })
  console.log('[m4-ui] login screen ready')
  const runtime = await app.evaluate(({ app }) => ({
    electron: process.versions.electron,
    nodeModuleAbi: process.versions.modules,
    userData: app.getPath('userData')
  }))
  assert(runtime.nodeModuleAbi === '145', `expected Electron ABI 145, received ${runtime.nodeModuleAbi}`)
  assert(runtime.userData === userDataDir, 'Electron did not use the requested isolated SVETS_USER_DATA_DIR')

  await login('teacher', 'Teacher@123', '/teacher')
  console.log('[m4-ui] teacher workspace ready')
  await page.getByRole('link', { name: '测评任务', exact: true }).click()
  await page.getByRole('heading', { name: '进行中的测评' }).waitFor()
  runSql(`
    BEGIN;
    INSERT INTO strategy_config (
      strategy_id, strategy_type, job_code, strategy_name, online_question_count, offline_question_count, max_score,
      competent_threshold, conditional_threshold, module_veto_threshold, emotion_collapse_threshold, session_validity_days,
      question_policy_json, scoring_policy_json, supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
      version, is_active
    ) SELECT
      'strategy_m4_ui_job_b_base_v1', strategy_type, 'M4_UI_JOB_B', strategy_name || '（M4 UI 岗位 B）', online_question_count, offline_question_count, max_score,
      competent_threshold, conditional_threshold, module_veto_threshold, emotion_collapse_threshold, session_validity_days,
      question_policy_json, scoring_policy_json, supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
      version, is_active
      FROM strategy_config WHERE strategy_id = 'strategy_baseline_shelver_v1' AND version = 1;
    INSERT INTO strategy_config (
      strategy_id, strategy_type, job_code, strategy_name, online_question_count, offline_question_count, max_score,
      competent_threshold, conditional_threshold, module_veto_threshold, emotion_collapse_threshold, session_validity_days,
      question_policy_json, scoring_policy_json, supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
      version, is_active
    ) SELECT
      'strategy_m4_ui_job_b_training_v1', strategy_type, 'M4_UI_JOB_B', strategy_name || '（M4 UI 岗位 B）', online_question_count, offline_question_count, max_score,
      competent_threshold, conditional_threshold, module_veto_threshold, emotion_collapse_threshold, session_validity_days,
      question_policy_json, scoring_policy_json, supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
      version, is_active
      FROM strategy_config WHERE strategy_id = 'strategy_training_shelver_v1' AND version = 1;
    INSERT INTO business_session (business_session_id, session_type, student_id, job_code, task_code, created_by) VALUES
      ('m4-ui-business-assessment-a', 'ASSESSMENT', 'seed-student-001', 'SUPERMARKET_SHELVER', 'UNBOXING_AND_SHELVING', 'seed-teacher-001'),
      ('m4-ui-business-training-a', 'TRAINING', 'seed-student-001', 'SUPERMARKET_SHELVER', 'UNBOXING_AND_SHELVING', 'seed-teacher-001'),
      ('m4-ui-business-assessment-b', 'ASSESSMENT', 'seed-student-001', 'M4_UI_JOB_B', 'UNBOXING_AND_SHELVING', 'seed-teacher-001'),
      ('m4-ui-business-training-b', 'TRAINING', 'seed-student-001', 'M4_UI_JOB_B', 'UNBOXING_AND_SHELVING', 'seed-teacher-001');
    INSERT INTO assessment_session
      (session_id, business_session_id, student_id, strategy_id, strategy_type, job_code, task_code, strategy_version, status, delivery_phase, online_question_count, offline_question_count, created_by) VALUES
      ('m4-ui-assessment-a', 'm4-ui-business-assessment-a', 'seed-student-001', 'strategy_baseline_shelver_v1', 'BASELINE_ASSESSMENT', 'SUPERMARKET_SHELVER', 'UNBOXING_AND_SHELVING', 1, 'ACTIVE', 'PREPARED', 0, 0, 'seed-teacher-001'),
      ('m4-ui-assessment-b', 'm4-ui-business-assessment-b', 'seed-student-001', 'strategy_m4_ui_job_b_base_v1', 'BASELINE_ASSESSMENT', 'M4_UI_JOB_B', 'UNBOXING_AND_SHELVING', 1, 'ACTIVE', 'PREPARED', 0, 0, 'seed-teacher-001');
    INSERT INTO training_session
      (training_session_id, business_session_id, student_id, job_code, task_code, strategy_id, strategy_type, strategy_version, status, total_step_count, created_by) VALUES
      ('m4-ui-training-a', 'm4-ui-business-training-a', 'seed-student-001', 'SUPERMARKET_SHELVER', 'UNBOXING_AND_SHELVING', 'strategy_training_shelver_v1', 'TRAINING_PRACTICE', 1, 'ACTIVE', 0, 'seed-teacher-001'),
      ('m4-ui-training-b', 'm4-ui-business-training-b', 'seed-student-001', 'M4_UI_JOB_B', 'UNBOXING_AND_SHELVING', 'strategy_m4_ui_job_b_training_v1', 'TRAINING_PRACTICE', 1, 'ACTIVE', 0, 'seed-teacher-001');
    COMMIT;
  `)
  console.log('[m4-ui] isolated cross-job fixture committed')

  const redline = await page.evaluate(() => window.api.assessment.triggerRedline({
    callerUserId: 'seed-teacher-001',
    callerRole: 'TEACHER',
    sessionId: 'm4-ui-assessment-a',
    reasonCode: 'OTHER_SAFETY_RISK',
    contextPhase: 'OTHER'
  }))
  assert(redline.success, `teacher redline IPC failed: ${JSON.stringify(redline)}`)
  console.log(`[m4-ui] teacher redline IPC completed: ${JSON.stringify(redline)}`)

  await logout()
  await login('student', 'Student@123', '/student')
  console.log('[m4-ui] student workspace ready')
  await page.evaluate(() => { window.location.hash = '#/student/assessment/m4-ui-assessment-b' })
  await page.getByRole('heading', { name: '测评答题' }).waitFor({ timeout: 10000 })
  assert(await page.getByText('测评已被安全红线终止').count() === 0, 'job B should remain available after job A redline')
  await page.evaluate(() => { window.location.hash = '#/student/assessment/m4-ui-assessment-a' })
  await page.getByText('测评已被安全红线终止').waitFor({ timeout: 10000 })
  await page.screenshot({ path: join(userDataDir, 'student-redline-isolation.png'), fullPage: true })
  console.log('[m4-ui] student UI shows job B available and job A safety-halted')
  await logout()
  await login('teacher', 'Teacher@123', '/teacher')
  const jobBRedline = await page.evaluate(() => window.api.assessment.triggerRedline({
    callerUserId: 'seed-teacher-001',
    callerRole: 'TEACHER',
    sessionId: 'm4-ui-assessment-b',
    reasonCode: 'OTHER_SAFETY_RISK',
    contextPhase: 'OTHER'
  }))
  assert(jobBRedline.success, `job B redline fixture failed: ${JSON.stringify(jobBRedline)}`)
  const incidentA = redline.incidentId
  const confirmed = await page.evaluate(({ incidentA }) => window.api.safety.confirm({
    callerUserId: 'seed-teacher-001',
    callerRole: 'TEACHER',
    incidentId: incidentA,
    reasonCode: 'OTHER_SAFETY_RISK',
    contextPhase: 'OTHER',
    description: 'M4 UI duplicate replacement fixture'
  }), { incidentA })
  assert(confirmed.success, `teacher incident confirmation failed: ${JSON.stringify(confirmed)}`)
  await logout()
  await login('admin', 'Admin@123', '/admin')
  console.log('[m4-ui] admin workspace ready')
  const crossJobDuplicate = await page.evaluate(({ incidentA, jobBIncidentId }) => window.api.safety.void({
    callerUserId: 'seed-admin-001',
    callerRole: 'ADMIN',
    incidentId: incidentA,
    voidReason: 'DUPLICATE_RECORD',
    replacementIncidentId: jobBIncidentId
  }), { incidentA, jobBIncidentId: jobBRedline.incidentId })
  assert(!crossJobDuplicate.success && crossJobDuplicate.errorCode === 'VALIDATION_ERROR', `cross-job duplicate was not rejected: ${JSON.stringify(crossJobDuplicate)}`)

  const factualReplacement = await page.evaluate(({ incidentA }) => window.api.safety.replaceForFactualCorrection({
    callerUserId: 'seed-admin-001',
    callerRole: 'ADMIN',
    incidentId: incidentA,
    reasonCode: 'OTHER_SAFETY_RISK',
    contextPhase: 'OTHER',
    description: 'M4 UI factual correction replacement',
    correctionReason: 'M4 UI duplicate replacement fixture'
  }), { incidentA })
  assert(factualReplacement.success, `same-triplet factual replacement failed: ${JSON.stringify(factualReplacement)}`)
  const sameTripletDuplicate = await page.evaluate(({ incidentA, replacementIncidentId }) => window.api.safety.void({
    callerUserId: 'seed-admin-001',
    callerRole: 'ADMIN',
    incidentId: replacementIncidentId,
    voidReason: 'DUPLICATE_RECORD',
    replacementIncidentId: incidentA
  }), { incidentA, replacementIncidentId: factualReplacement.incidentId })
  assert(sameTripletDuplicate.success, `same-triplet duplicate failed: ${JSON.stringify(sameTripletDuplicate)}`)
  console.log('[m4-ui] duplicate replacement IPC boundary verified')
  assert(consoleErrors.length === 0, `renderer errors: ${JSON.stringify(consoleErrors)}`)

  await app.close()
  appClosed = true
  console.log('[m4-ui] Electron closed; reading the stable isolated SQLite snapshot')
  const redlineState = {
    assessment: querySql("SELECT job_code, status FROM assessment_session WHERE session_id IN ('m4-ui-assessment-b', 'm4-ui-assessment-a') ORDER BY job_code"),
    training: querySql("SELECT job_code, status FROM training_session WHERE training_session_id IN ('m4-ui-training-b', 'm4-ui-training-a') ORDER BY job_code"),
    bindings: querySql("SELECT aggregate_type, aggregate_id FROM safety_incident_binding WHERE incident_id = (SELECT redline_incident_id FROM assessment_session WHERE session_id = 'm4-ui-assessment-a') ORDER BY aggregate_type"),
    duplicate: querySql(`SELECT status, void_reason, replacement_incident_id FROM safety_incident WHERE incident_id = '${factualReplacement.incidentId}'`)[0]
  }
  assert(JSON.stringify(redlineState.assessment) === JSON.stringify([
    { job_code: 'M4_UI_JOB_B', status: 'REDLINE_HALTED' },
    { job_code: 'SUPERMARKET_SHELVER', status: 'REDLINE_HALTED' }
  ]), `assessment post-fixture state mismatch: ${JSON.stringify(redlineState.assessment)}`)
  assert(JSON.stringify(redlineState.training) === JSON.stringify([
    { job_code: 'M4_UI_JOB_B', status: 'REDLINE_HALTED' },
    { job_code: 'SUPERMARKET_SHELVER', status: 'REDLINE_HALTED' }
  ]), `training post-fixture state mismatch: ${JSON.stringify(redlineState.training)}`)
  assert(redlineState.bindings.length === 2, `expected two same-triplet bindings: ${JSON.stringify(redlineState.bindings)}`)
  assert(redlineState.duplicate.status === 'VOIDED' && redlineState.duplicate.void_reason === 'DUPLICATE_RECORD' && redlineState.duplicate.replacement_incident_id === incidentA, `duplicate persistence mismatch: ${JSON.stringify(redlineState.duplicate)}`)
  console.log('[m4-ui] cross-job isolation, same-triplet binding, and duplicate persistence verified in SQLite')

  console.log(JSON.stringify({
    status: 'PASS',
    runtime,
    temporaryPathType: 'mkdtemp(/tmp/svets-m4-ui-*)',
    evidence: {
      studentScreenshot: join(userDataDir, 'student-redline-isolation.png'),
      redline: 'job A assessment/training halted with two bindings; job B remained ACTIVE before its independent fixture incident',
      duplicateReplacement: 'cross-job rejected before write; same-triplet replacement accepted'
    }
  }))
  passed = true
} finally {
  console.log(`[m4-ui] closing Electron; isolated data root ${passed ? 'will be removed' : `is preserved for diagnosis: ${userDataDir}`}`)
  if (!appClosed) await app.close()
  if (passed) rmSync(userDataDir, { recursive: true, force: true })
}
