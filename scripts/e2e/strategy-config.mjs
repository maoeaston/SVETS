#!/usr/bin/env node
/**
 * 策略配置管理 9 步 E2E 冒烟（覆盖 PRD 验收 #31）
 *
 * 2 次 Electron 启动：
 *   app A (admin)    — step 1~6（查看 seed / 新建族 / 新增版本 / 编辑 / 停用 / 启用）
 *   app B (teacher)  — step 7~9（只读列表 / 写按钮隐藏 / IPC FORBIDDEN）
 *
 * 用法：node scripts/e2e/strategy-config.mjs
 * 前置：
 *   - npm run build（out/main/index.js 存在）
 *   - dev DB 已初始化（sqlite3 db < src/main/db/schema.sql 或跑过 npm run dev）
 *   - node scripts/seed-dev-accounts.mjs（admin/Admin@123 + teacher/Teacher@123）
 * 产物：/tmp/e2e-strategy-config/*.png + 控制台汇总
 */
import { _electron as electron } from 'playwright'
import { mkdirSync } from 'node:fs'

const SHOTS = '/tmp/e2e-strategy-config'
mkdirSync(SHOTS, { recursive: true })

const results = []
const ts = Date.now()
// 唯一标识避免与前次 E2E 冲突（impl doc [!] seed 状态依赖）
const familyId = `e2e_train_${ts}`
const jobCode = `E2E_JOB_${ts}`
const familyName = `E2E训练策略_${ts}`

function log(msg) { console.log(msg) }
function shot(name) { return `${SHOTS}/${name}.png` }

async function launchApp() {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    timeout: 30000
  })
  const window = await app.firstWindow()
  window.on('console', (msg) => {
    const t = msg.type()
    if (t === 'error' || t === 'warning') {
      log(`  [renderer:${t}] ${msg.text()}`)
    }
  })
  window.on('pageerror', (err) => log(`  [renderer:error] ${err.message}`))
  return { app, window }
}

async function step(num, name, fn) {
  log(`\n=== Step ${num}: ${name} ===`)
  try {
    await fn()
    results.push({ num, name, ok: true })
    log(`  ✅ Step ${num} PASS`)
  } catch (err) {
    results.push({ num, name, ok: false, err: err.message })
    log(`  ❌ Step ${num} FAIL: ${err.message}`)
    throw err
  }
}

// fieldset 定位 helper（按 legend 文本）
const FS = (legend) => `fieldset:has(legend:has-text("${legend}"))`
const BASE_FS = FS('基础')

async function login(window, username, password) {
  await window.waitForSelector('#username', { timeout: 15000 })
  await window.fill('#username', username)
  await window.fill('#password', password)
  await window.click('button[type="submit"]')
}

// ============== app A (admin): step 1~6 ==============
log('\n──── app A: admin session ────')
let { app, window } = await launchApp()

await step('1', 'ADMIN 登录 → /admin/strategies 列表显示 ≥2 条 seed', async () => {
  await login(window, 'admin', 'Admin@123')
  await window.waitForURL(/#\/teacher\/students/, { timeout: 10000 })
  // admin 默认落地 /teacher/students，点「策略配置」nav 进入
  await window.click('a:has-text("策略配置")')
  await window.waitForURL(/#\/admin\/strategies/, { timeout: 5000 })
  await window.waitForSelector('.strategy-list .table tbody tr')
  const rowCount = await window.locator('.strategy-list .table tbody tr').count()
  if (rowCount < 2) {
    throw new Error(`seed 策略族应 ≥2, 实际 ${rowCount}（DB 是否已初始化 schema.sql?）`)
  }
  await window.screenshot({ path: shot('01-admin-list'), fullPage: true })
})

await step('2', `新建策略族 ${familyName}（TRAINING_PRACTICE）→ 版本列表出现 v1`, async () => {
  await window.click('button:has-text("新建策略")')
  await window.waitForURL(/#\/admin\/strategies\/new/, { timeout: 5000 })
  await window.waitForSelector(BASE_FS)

  // 基础 fieldset：strategyId / jobCode / strategyName 三个可填 text input（version 只读）
  await window.locator(`${BASE_FS} input[type="text"]`).nth(0).fill(familyId)
  await window.locator(`${BASE_FS} select`).selectOption('TRAINING_PRACTICE')
  await window.locator(`${BASE_FS} input[type="text"]`).nth(1).fill(jobCode)
  await window.locator(`${BASE_FS} input[type="text"]`).nth(2).fill(familyName)
  // 其余字段保持默认（42+8/100/80/60/0.5/3，ratio 14+14+14+8=50，level_rules 默认 3 行）

  await window.screenshot({ path: shot('02-create-form'), fullPage: true })

  await window.click('button:has-text("创建策略")')
  // 提交后：成功→跳版本列表；失败→留页显示 .error-msg
  await window.waitForTimeout(2000)
  const errCount = await window.locator('.error-msg').count()
  if (errCount > 0) {
    const errText = await window.locator('.error-msg').first().textContent()
    await window.screenshot({ path: shot('02-create-FAILED'), fullPage: true })
    throw new Error(`创建失败: "${errText}"`)
  }
  // 提交成功后跳转版本列表
  await window.waitForURL(new RegExp(`#/admin/strategies/${familyId}$`), { timeout: 5000 })
  await window.waitForSelector('.version-list .table tbody tr')

  const versionRows = await window.locator('.version-list .table tbody tr').count()
  if (versionRows !== 1) {
    throw new Error(`新建族后应只有 v1, 实际 ${versionRows} 行`)
  }
  const firstRow = await window.locator('.version-list .table tbody tr').first().textContent()
  if (!firstRow?.includes('v1')) throw new Error(`未显示 v1: "${firstRow}"`)

  await window.screenshot({ path: shot('02-created-v1'), fullPage: true })
})

await step('3', '新增版本 v2 → 版本列表显示 v1 + v2', async () => {
  await window.click('button:has-text("新增版本")')
  await window.waitForURL(/#\/admin\/strategies\/[\w-]+\/new-version/, { timeout: 5000 })
  await window.waitForSelector(BASE_FS)

  // newVersion 模式：预填 v1 数据，version 自动 = 2 只读
  const versionVal = await window.locator(`${BASE_FS} input[type="text"]`).nth(3).inputValue()
  if (versionVal !== 'v2') {
    throw new Error(`newVersion 应预填 v2, 实际 "${versionVal}"`)
  }
  // 改名以区分 v1/v2
  await window.locator(`${BASE_FS} input[type="text"]`).nth(2).fill(`${familyName}_v2`)

  await window.click('button:has-text("创建策略")')
  await window.waitForURL(new RegExp(`#/admin/strategies/${familyId}$`), { timeout: 5000 })
  await window.waitForSelector('.version-list .table tbody tr')

  const versionRows = await window.locator('.version-list .table tbody tr').count()
  if (versionRows !== 2) {
    throw new Error(`应显示 v1+v2 = 2 行, 实际 ${versionRows}`)
  }

  await window.screenshot({ path: shot('03-v2-created'), fullPage: true })
})

await step('4', '编辑 v2（改 strategyName）→ 保存成功', async () => {
  // v2 是最新版本，DESC 排序下首行
  await window.locator('.version-list .table tbody tr').first().locator('a:has-text("编辑")').click()
  await window.waitForURL(/#\/admin\/strategies\/[\w-]+\/v\/2/, { timeout: 5000 })
  await window.waitForSelector(BASE_FS)
  await window.waitForTimeout(400)  // 等 loadForEdit IPC 回填

  const editedName = `${familyName}_v2_已编辑`
  await window.locator(`${BASE_FS} input[type="text"]`).nth(2).fill(editedName)

  await window.click('button:has-text("保存修改")')
  await window.waitForURL(new RegExp(`#/admin/strategies/${familyId}$`), { timeout: 5000 })
  await window.waitForSelector('.version-list .table tbody tr')

  // 验证名称持久化
  const firstRow = await window.locator('.version-list .table tbody tr').first().textContent()
  if (!firstRow?.includes(editedName)) {
    throw new Error(`编辑后名称未持久化: "${firstRow}"`)
  }

  await window.screenshot({ path: shot('04-edited'), fullPage: true })
})

await step('5', '停用 v1 → 状态标签变化', async () => {
  // v1 在 DESC 下是末行
  const rows = window.locator('.version-list .table tbody tr')
  const rowCount = await rows.count()
  const v1Row = rows.nth(rowCount - 1)

  // 记录停用前 active 数量
  const activeBefore = await window.locator('.tag-active').count()

  await v1Row.locator('button:has-text("停用")').click()
  await window.waitForSelector('.info-msg', { timeout: 5000 })
  await window.waitForTimeout(300)  // 等 refetch 完成

  const activeAfter = await window.locator('.tag-active').count()
  if (activeAfter !== activeBefore - 1) {
    throw new Error(`停用后 ACTIVE 应 ${activeBefore - 1}, 实际 ${activeAfter}`)
  }
  // v1 行应显示「停用」标签
  const v1Text = await v1Row.textContent()
  if (!v1Text?.includes('停用')) {
    throw new Error(`v1 停用标签未显示: "${v1Text}"`)
  }

  await window.screenshot({ path: shot('05-deactivated'), fullPage: true })
})

await step('6', '启用 v1 → ACTIVE 数量恢复', async () => {
  const rows = window.locator('.version-list .table tbody tr')
  const rowCount = await rows.count()
  const v1Row = rows.nth(rowCount - 1)

  const activeBefore = await window.locator('.tag-active').count()

  await v1Row.locator('button:has-text("启用")').click()
  await window.waitForSelector('.info-msg', { timeout: 5000 })
  await window.waitForTimeout(300)

  const activeAfter = await window.locator('.tag-active').count()
  if (activeAfter !== activeBefore + 1) {
    throw new Error(`启用后 ACTIVE 应 ${activeBefore + 1}, 实际 ${activeAfter}`)
  }

  await window.screenshot({ path: shot('06-reactivated'), fullPage: true })
})

await app.close()
log('\n──── app A closed ────')

// ============== app B (teacher): step 7~9 ==============
log('\n──── app B: teacher session (read-only) ────')
;({ app, window } = await launchApp())

await step('7', 'TEACHER 手敲 #/admin/strategies → 列表可见（读路径开放）', async () => {
  await login(window, 'teacher', 'Teacher@123')
  await window.waitForURL(/#\/teacher\/students/, { timeout: 10000 })

  // TEACHER 无「策略配置」nav 入口；手敲 URL 进入
  await window.evaluate(() => { window.location.hash = '#/admin/strategies' })
  await window.waitForSelector('.strategy-list .table tbody tr', { timeout: 5000 })

  const rowCount = await window.locator('.strategy-list .table tbody tr').count()
  if (rowCount < 2) {
    throw new Error(`TEACHER 应看到 ≥2 条 seed, 实际 ${rowCount}`)
  }

  await window.screenshot({ path: shot('07-teacher-read-list'), fullPage: true })
})

await step('8', 'TEACHER 写按钮全部不可见（新建/编辑/停用）', async () => {
  // 列表页：无「新建策略」按钮
  const createBtnCount = await window.locator('button:has-text("新建策略")').count()
  if (createBtnCount !== 0) {
    throw new Error(`TEACHER 不应见「新建策略」, 实际 ${createBtnCount} 个`)
  }

  // 进入某族版本列表，验证编辑/停用按钮不可见
  await window.locator('.strategy-list .table tbody tr').first().locator('a:has-text("查看版本")').click()
  await window.waitForURL(/#\/admin\/strategies\/[\w-]+/, { timeout: 5000 })
  await window.waitForSelector('.version-list .table tbody tr')

  const editBtnCount = await window.locator('a:has-text("编辑")').count()
  const toggleBtnCount = await window.locator('button:has-text("停用"), button:has-text("启用")').count()
  const newVersionBtnCount = await window.locator('button:has-text("新增版本")').count()
  if (editBtnCount !== 0) throw new Error(`TEACHER 不应见「编辑」, 实际 ${editBtnCount}`)
  if (toggleBtnCount !== 0) throw new Error(`TEACHER 不应见「停用/启用」, 实际 ${toggleBtnCount}`)
  if (newVersionBtnCount !== 0) throw new Error(`TEACHER 不应见「新增版本」, 实际 ${newVersionBtnCount}`)

  // 应显示「只读」提示
  const readonlyHintCount = await window.locator('.readonly-hint').count()
  if (readonlyHintCount < 1) throw new Error(`应显示只读提示, 实际 ${readonlyHintCount}`)

  await window.screenshot({ path: shot('08-teacher-readonly'), fullPage: true })
})

await step('9', 'TEACHER 直接调 IPC createVersion → FORBIDDEN', async () => {
  // 从 Pinia store 读真实 teacher userId（assertCaller 按此查用户，role 校验才有效）
  const teacherUserId = await window.evaluate(() => {
    const el = document.querySelector('#app')
    if (!el || !el.__vue_app__) return null
    const pinia = el.__vue_app__.config.globalProperties.$pinia
    if (!pinia) return null
    return pinia.state.value.auth?.userId ?? null
  })
  if (!teacherUserId) throw new Error('无法从 Pinia 读取 teacher userId')

  // 构造一个对 ADMIN 会通过校验的合法负载；TEACHER 唯一失败点应是 role 检查
  const result = await window.evaluate(async (uid) => {
    return await window.api.strategy.createVersion({
      callerUserId: uid,
      callerRole: 'TEACHER',
      strategy: {
        strategyId: 'forbidden_test_' + Date.now(),
        strategyType: 'BASELINE_ASSESSMENT',
        jobCode: 'FORBIDDEN_JOB',
        strategyName: '禁止测试',
        onlineQuestionCount: 42,
        offlineQuestionCount: 8,
        maxScore: 100,
        competentThreshold: 80,
        conditionalThreshold: 60,
        moduleVetoThreshold: 0.5,
        emotionCollapseThreshold: 3,
        questionPolicy: {
          module_scope: 'CROSS_MODULE',
          question_ratio: { TRUE_FALSE: 14, SINGLE_CHOICE: 14, DRAG: 14, OFFLINE_OPERATION: 8 }
        },
        scoringPolicy: {
          score_values: [0, 1, 2],
          normalization: 'raw_score/max_score*100',
          safety_override_enabled: true,
          level_rules: [
            { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
            { min: 60, max: 79, level: 'LEVEL_CONDITIONAL' },
            { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
          ]
        },
        supportsRedlineHalt: true,
        allowsEmotionInterrupt: true,
        requiresOfflineScoring: true,
        version: 1,
        isActive: true
      }
    })
  }, teacherUserId)

  if (result.success !== false || result.errorCode !== 'FORBIDDEN') {
    throw new Error(`预期 FORBIDDEN, 实际: ${JSON.stringify(result)}`)
  }

  await window.screenshot({ path: shot('09-forbidden'), fullPage: true })
})

await app.close()
log('\n──── app B closed ────')

// ============== 汇总 ==============
log('\n==================== 汇总 ====================')
const passed = results.filter((r) => r.ok).length
log(`通过: ${passed}/${results.length}`)
for (const r of results) {
  log(`  ${r.ok ? '✅' : '❌'} Step ${r.num}: ${r.name}` + (r.ok ? '' : ` — ${r.err}`))
}
log(`截图目录: ${SHOTS}/`)

process.exitCode = passed === results.length ? 0 : 1
