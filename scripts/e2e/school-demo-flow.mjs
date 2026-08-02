import { _electron as electron } from 'playwright'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { listenActivationServer } from '../lib/activation-server.mjs'

const LICENSE_KEY = 'SVETS-SCHOOL-DEMO-2026'
const TEACHER = Object.freeze({ userId: 'seed-teacher-001', role: 'TEACHER' })
const STUDENT = Object.freeze({ userId: 'seed-student-001', role: 'STUDENT' })
const STRATEGY_ID = 'strategy_job_skill_shelver_v1'
const TASK_CODE = 'JOB_SKILL_DEMO_M1M6'
const APP_VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version
const outputRoot = mkdtempSync(join(tmpdir(), 'svets-school-demo-'))
const databasePath = join(outputRoot, 'data', 'xc-career-guide.db')
const keepArtifacts = process.env.SVETS_E2E_KEEP_ARTIFACTS === '1'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function querySql(sql) {
  const result = spawnSync('sqlite3', ['-json', databasePath, sql], {
    encoding: 'utf8',
    timeout: 15_000
  })
  if (result.status !== 0 || result.error) {
    throw new Error(`sqlite3 query failed: ${result.error?.message ?? result.stderr ?? result.stdout}`)
  }
  return JSON.parse(result.stdout || '[]')
}

async function login(page, username, password, pathFragment) {
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(new RegExp(`#/${pathFragment}(?:$|/)`), { timeout: 15_000 })
}

async function logout(page) {
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.locator('#username').waitFor({ timeout: 15_000 })
}

assert(existsSync('out/main/index.js'), 'out/main/index.js missing; run npm run build first')
assert(existsSync('out/renderer/index.html'), 'out/renderer/index.html missing; run npm run build first')

const activationServer = await listenActivationServer({
  licenseKey: LICENSE_KEY,
  organizationName: '学校小范围预览授权',
  deviceLimit: 5,
  validDays: 30
})

let app
let passed = false
const rendererErrors = []

try {
  app = await electron.launch({
    args: ['--no-sandbox', 'out/main/index.js'],
    env: {
      ...process.env,
      SVETS_E2E: '1',
      SVETS_USER_DATA_DIR: outputRoot,
      SVETS_ACTIVATION_SERVER_URL: activationServer.url
    },
    timeout: 30_000
  })
  const page = await app.firstWindow()
  page.on('pageerror', (error) => rendererErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(message.text())
  })

  await page.setViewportSize({ width: 1365, height: 900 })
  await page.getByRole('heading', { name: '软件授权' }).waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    (serverUrl) => document.querySelector('#activation-server')?.value === serverUrl,
    activationServer.url,
    { timeout: 10_000 }
  )
  const initialActivation = await page.evaluate(() => window.api.activation.getStatus())
  assert(initialActivation.appVersion === APP_VERSION, `expected app version ${APP_VERSION}, received ${initialActivation.appVersion}`)

  const blockedBeforeActivation = await page.evaluate(async () => {
    try {
      await window.api.questionBank.list({ page: 1, pageSize: 1 })
      return { blocked: false, message: '' }
    } catch (error) {
      return { blocked: true, message: String(error) }
    }
  })
  assert(blockedBeforeActivation.blocked, 'business IPC was available before activation')
  assert(blockedBeforeActivation.message.includes('ACTIVATION_REQUIRED'), 'activation gate returned an unexpected error')
  await page.screenshot({ path: join(outputRoot, '01-activation.png'), fullPage: true })

  await page.getByLabel('授权码').fill(LICENSE_KEY)
  await page.getByRole('button', { name: '激活并进入系统' }).click()
  await page.locator('#username').waitFor({ timeout: 20_000 })
  assert(activationServer.getDeviceCount() === 1, 'activation server did not register exactly one installation')

  await login(page, 'teacher', 'Teacher@123', 'teacher')
  await page.evaluate(() => { window.location.hash = '#/teacher/question-bank' })
  await page.getByRole('heading', { name: '岗位题库' }).waitFor({ timeout: 15_000 })

  const catalog = await page.evaluate(async () => {
    const [all, active, draft] = await Promise.all([
      window.api.questionBank.list({ domain: 'JOB_SPECIFIC', page: 1, pageSize: 1 }),
      window.api.questionBank.list({ domain: 'JOB_SPECIFIC', status: 'ACTIVE', page: 1, pageSize: 1 }),
      window.api.questionBank.list({ domain: 'JOB_SPECIFIC', status: 'DRAFT', page: 1, pageSize: 1 })
    ])
    return { all, active, draft }
  })
  assert(catalog.all.success && catalog.all.total === 298, `expected 298 JOB_SPECIFIC questions: ${JSON.stringify(catalog.all)}`)
  assert(catalog.active.success && catalog.active.total === 24, `expected 24 active demo questions: ${JSON.stringify(catalog.active)}`)
  assert(catalog.draft.success && catalog.draft.total === 274, `expected 274 review questions: ${JSON.stringify(catalog.draft)}`)
  await page.getByText('298', { exact: true }).first().waitFor({ timeout: 10_000 })
  await page.screenshot({ path: join(outputRoot, '02-question-bank-298.png'), fullPage: true })

  const prepared = await page.evaluate(async ({ teacher, strategyId, studentId, taskCode }) => {
    const strategies = await window.api.strategy.list({
      callerUserId: teacher.userId,
      callerRole: teacher.role,
      strategyType: 'JOB_SKILL_ASSESSMENT',
      jobCode: 'SUPERMARKET_SHELVER',
      includeInactive: false,
      page: 1
    })
    if (!strategies.success) return { stage: 'strategy', result: strategies }
    const strategy = strategies.items.find((item) => item.strategyId === strategyId && item.isActive)
    if (!strategy) return { stage: 'strategy', result: strategies }
    const created = await window.api.assessment.createSession({
      callerUserId: teacher.userId,
      callerRole: teacher.role,
      studentId,
      strategyId,
      strategyVersion: strategy.version,
      taskCode
    })
    if (!created.success) return { stage: 'create', result: created }
    const assigned = await window.api.assignment.create({
      callerUserId: teacher.userId,
      callerRole: teacher.role,
      businessSessionId: created.businessSessionId,
      confirmationMethod: 'NONE_REQUIRED'
    })
    return { stage: 'assigned', strategyVersion: strategy.version, created, assigned }
  }, {
    teacher: TEACHER,
    strategyId: STRATEGY_ID,
    studentId: STUDENT.userId,
    taskCode: TASK_CODE
  })
  assert(prepared.stage === 'assigned' && prepared.created.success, `assessment setup failed: ${JSON.stringify(prepared)}`)
  assert(prepared.strategyVersion === 3, `expected active JOB_SKILL strategy v3, received ${prepared.strategyVersion}`)
  assert(prepared.created.questions.length === 18, `expected 18 online questions, received ${prepared.created.questions.length}`)
  assert(prepared.assigned.success, `assignment failed: ${JSON.stringify(prepared.assigned)}`)
  const sessionId = prepared.created.sessionId
  const assignmentId = prepared.assigned.assignmentId

  await logout(page)
  await login(page, 'student', 'Student@123', 'student')
  await page.getByRole('button', { name: '确认并开始' }).click()
  await page.waitForURL(new RegExp(`#/student/assessment/${sessionId}$`), { timeout: 20_000 })
  await page.getByRole('heading', { name: '测评答题' }).waitFor({ timeout: 15_000 })
  await page.screenshot({ path: join(outputRoot, '03-student-assessment.png'), fullPage: true })

  const onlineCompletion = await page.evaluate(async ({ student, sessionId, assignmentId }) => {
    const started = await window.api.assignment.startAssessment({
      callerUserId: student.userId,
      callerRole: student.role,
      assignmentId
    })
    if (!started.success) return { stage: 'start', result: started }
    const answers = []
    for (let index = 0; index < 18; index += 1) {
      const detail = await window.api.assessment.getSession({
        callerUserId: student.userId,
        callerRole: student.role,
        sessionId
      })
      if (!detail.success || !detail.currentQuestion) return { stage: 'read', index, result: detail }
      const question = detail.currentQuestion
      let answerPayload
      if (question.questionType === 'TRUE_FALSE') {
        answerPayload = { question_type: 'TRUE_FALSE', selected: true }
      } else if (question.questionType === 'SINGLE_CHOICE') {
        const selected = question.options?.[0]?.key
        if (!selected) return { stage: 'answer-shape', index, question }
        answerPayload = { question_type: 'SINGLE_CHOICE', selected }
      } else if (question.questionType === 'DRAG') {
        const zoneId = question.dropZones?.[0]?.zoneId
        if (!zoneId || !question.dragItems?.length) return { stage: 'answer-shape', index, question }
        answerPayload = {
          question_type: 'DRAG',
          placements: question.dragItems.map((item) => ({ item_id: item.itemId, zone_id: zoneId }))
        }
      } else {
        return { stage: 'unsupported', index, question }
      }
      const submitted = await window.api.assessment.submitAnswer({
        callerUserId: student.userId,
        callerRole: student.role,
        sessionId,
        questionId: question.questionId,
        answerPayload
      })
      if (!submitted.success) return { stage: 'submit', index, questionId: question.questionId, result: submitted }
      answers.push({ questionId: question.questionId, score: submitted.score })
    }
    const final = await window.api.assessment.getSession({
      callerUserId: student.userId,
      callerRole: student.role,
      sessionId
    })
    return { stage: 'complete', answers, final }
  }, { student: STUDENT, sessionId, assignmentId })
  assert(onlineCompletion.stage === 'complete', `online assessment failed: ${JSON.stringify(onlineCompletion)}`)
  assert(onlineCompletion.answers.length === 18, 'online assessment did not submit 18 answers')
  assert(onlineCompletion.final.success && onlineCompletion.final.session.status === 'OFFLINE_PENDING', `expected OFFLINE_PENDING: ${JSON.stringify(onlineCompletion.final)}`)

  await logout(page)
  await login(page, 'teacher', 'Teacher@123', 'teacher')
  await page.evaluate((id) => { window.location.hash = `#/teacher/assessments/${id}/job-skill-scoring` }, sessionId)
  await page.getByRole('heading', { name: '专业岗位线下实操评分' }).waitFor({ timeout: 15_000 })
  await page.getByText('提交6题评分').waitFor({ timeout: 15_000 })
  await page.screenshot({ path: join(outputRoot, '04-offline-scoring.png'), fullPage: true })

  const scored = await page.evaluate(async ({ teacher, sessionId }) => {
    const questions = await window.api.assessment.getSessionScoringQuestions({
      callerUserId: teacher.userId,
      callerRole: teacher.role,
      sessionId
    })
    if (!questions.success) return { stage: 'questions', result: questions }
    const result = await window.api.assessment.submitJobSkillOfflineScores({
      callerUserId: teacher.userId,
      callerRole: teacher.role,
      sessionId,
      scores: questions.offlineQuestions.map((question) => ({
        questionId: question.questionId,
        score: 2,
        anchorVersion: question.anchorVersion,
        ...(question.scoreAnchors?.['2'] ? { selectedAnchor: question.scoreAnchors['2'] } : {})
      }))
    })
    return { stage: 'scored', questions, result }
  }, { teacher: TEACHER, sessionId })
  assert(scored.stage === 'scored' && scored.questions.offlineQuestions.length === 6, `expected 6 offline questions: ${JSON.stringify(scored)}`)
  assert(scored.questions.observationQuestions.length === 0, `unexpected observation questions: ${JSON.stringify(scored.questions.observationQuestions)}`)
  assert(scored.result.success && scored.result.itemsScored === 6, `offline scoring failed: ${JSON.stringify(scored.result)}`)

  await page.evaluate(() => { window.location.hash = '#/teacher/reports' })
  await page.getByRole('heading', { name: '任务报告' }).waitFor({ timeout: 20_000 })
  const report = await page.evaluate(async ({ teacher, sessionId }) => {
    const list = await window.api.reports.list({
      callerUserId: teacher.userId,
      callerRole: teacher.role,
      studentId: 'seed-student-001',
      reportScope: 'JOB_SKILL',
      limit: 20,
      offset: 0
    })
    if (!list.success) return { stage: 'list', list }
    const item = list.items.find((candidate) => candidate.studentId === 'seed-student-001')
    if (!item) return { stage: 'missing', list }
    const detail = await window.api.reports.get({
      callerUserId: teacher.userId,
      callerRole: teacher.role,
      reportId: item.reportId
    })
    const session = await window.api.assessment.getSession({
      callerUserId: teacher.userId,
      callerRole: teacher.role,
      sessionId
    })
    return { stage: 'detail', list, item, detail, session }
  }, { teacher: TEACHER, sessionId })
  assert(report.stage === 'detail' && report.list.total === 1, `expected one JOB_SKILL report: ${JSON.stringify(report)}`)
  assert(report.detail.success && report.detail.report.reportScope === 'JOB_SKILL', `report detail failed: ${JSON.stringify(report.detail)}`)
  assert(report.detail.report.lifecycle.contractValidationStatus === 'VALID', 'generated report contract is not VALID')
  assert(report.session.success && report.session.session.status === 'COMPLETED', `session did not complete: ${JSON.stringify(report.session)}`)
  await page.screenshot({ path: join(outputRoot, '05-report-list.png'), fullPage: true })
  await page.evaluate((reportId) => { window.location.hash = `#/teacher/reports/${reportId}` }, report.item.reportId)
  await page.getByRole('heading', { name: report.item.reportTitle }).waitFor({ timeout: 15_000 })
  await page.screenshot({ path: join(outputRoot, '06-report-detail.png'), fullPage: true })

  await page.evaluate(() => { window.location.hash = '#/activation' })
  await page.getByText('已激活', { exact: true }).waitFor({ timeout: 15_000 })
  await page.screenshot({ path: join(outputRoot, '07-active-license.png'), fullPage: true })
  assert(rendererErrors.length === 0, `renderer errors: ${JSON.stringify(rendererErrors)}`)

  await app.close()
  app = null

  const databaseEvidence = {
    questions: querySql(`SELECT bank_domain, COUNT(*) AS total, SUM(status = 'ACTIVE') AS active FROM question_bank GROUP BY bank_domain ORDER BY bank_domain`),
    strategy: querySql(`SELECT strategy_id, version, is_active FROM strategy_config WHERE strategy_id = '${STRATEGY_ID}' ORDER BY version`),
    session: querySql(`SELECT status, delivery_phase, online_question_count, offline_question_count, online_completed_count FROM assessment_session WHERE session_id = '${sessionId}'`)[0],
    answers: querySql(`SELECT COUNT(*) AS total FROM answer_record WHERE session_id = '${sessionId}' AND status = 'VALID'`)[0],
    offlineScores: querySql(`SELECT COUNT(*) AS total FROM offline_score_record WHERE session_id = '${sessionId}' AND score_scope = 'JOB_SKILL' AND status = 'VALID'`)[0],
    result: querySql(`SELECT result_type, normalized_score, level_result FROM result_record WHERE source_aggregate_id = '${sessionId}' AND is_current = 1`)[0],
    report: querySql(`SELECT report_type, status, contract_validation_status FROM task_report WHERE source_aggregate_id = '${sessionId}'`)[0],
    previewRegistry: querySql(`SELECT status FROM preview_contract_registry WHERE registry_id = 'PREVIEW_CONTRACT_V1'`)[0],
    previewRows: querySql(`SELECT (SELECT COUNT(*) FROM principal_binding_projection) AS principals, (SELECT COUNT(*) FROM preview_release_projection) AS releases, (SELECT COUNT(*) FROM preview_session_projection) AS sessions, (SELECT COUNT(*) FROM preview_feedback_reference_projection) AS feedback`)[0]
  }
  assert(databaseEvidence.questions.find((row) => row.bank_domain === 'BASE_ABILITY')?.total === 96, 'fresh install did not contain 96 BASE_ABILITY questions')
  assert(databaseEvidence.questions.find((row) => row.bank_domain === 'JOB_SPECIFIC')?.total === 298, 'fresh install did not contain 298 JOB_SPECIFIC questions')
  assert(databaseEvidence.answers.total === 18, 'database does not contain 18 valid online answers')
  assert(databaseEvidence.offlineScores.total === 6, 'database does not contain 6 valid offline scores')
  assert(databaseEvidence.session.status === 'COMPLETED' && databaseEvidence.session.delivery_phase === 'FINALIZED', 'database session is not finalized')
  assert(databaseEvidence.report.status === 'GENERATED' && databaseEvidence.report.contract_validation_status === 'VALID', 'database report is not valid')
  assert(databaseEvidence.previewRegistry.status === 'INSTALLING', 'legacy preview trust registry was unexpectedly promoted')
  assert(Object.values(databaseEvidence.previewRows).every((value) => value === 0), 'legacy preview trust projections were unexpectedly used')

  passed = true
  console.log(JSON.stringify({
    status: 'PASS',
    activation: { serverUrl: activationServer.url, registeredDevices: activationServer.getDeviceCount() },
    workflow: { strategyVersion: prepared.strategyVersion, onlineAnswers: 18, offlineScores: 6, reportId: report.item.reportId },
    databaseEvidence,
    artifacts: outputRoot
  }, null, 2))
} finally {
  if (app) await app.close().catch(() => undefined)
  await activationServer.close().catch(() => undefined)
  if (passed && !keepArtifacts) rmSync(outputRoot, { recursive: true, force: true })
  if (!passed) console.error(`[school-demo-e2e] diagnostic artifacts preserved at ${outputRoot}`)
}
