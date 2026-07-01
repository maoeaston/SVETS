#!/usr/bin/env node
/**
 * 学生档案管理 9 步 E2E 冒烟（对应 .continue-here.md 第 19-28 行清单）
 *
 * 4 次 Electron 启动：
 *   app A (teacher)  — step 1~6（建立学生 + 修改 + 校验）
 *   app B (student)  — step 8-pre（归档前学生可登录）
 *   app C (teacher)  — step 7（归档）
 *   app D (student)  — step 9（归档后 ACCOUNT_DISABLED）
 *
 * 用法：node scripts/e2e/student-profile.mjs
 * 产物：/tmp/e2e-student-profile/*.png + 控制台汇总
 */
import { _electron as electron } from 'playwright'
import { mkdirSync } from 'node:fs'

const SHOTS = '/tmp/e2e-student-profile'
mkdirSync(SHOTS, { recursive: true })

const results = []
const ts = Date.now()
const studentUsername = `e2e_${ts}`
const studentName = `E2E学生_${ts}`
const studentPassword = 'Test@1234'

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

// fieldset 定位 helper：用 legend 文本分组（避免 label 子串冲突）
const FS = (legend) => `fieldset:has(legend:has-text("${legend}"))`
const LOGIN_FS = FS('登录账号')
const BASE_FS = FS('基本信息')
const SP_FS = FS('感官画像')

// ============== app A (teacher): step 1~6 ==============
log('\n──── app A: teacher session ────')
let { app, window } = await launchApp()

await step('1', '教师登录 → 跳 /teacher/students', async () => {
  await window.waitForSelector('#username', { timeout: 15000 })
  await window.fill('#username', 'teacher')
  await window.fill('#password', 'Teacher@123')
  await window.click('button[type="submit"]')
  await window.waitForURL(/#\/teacher\/students/, { timeout: 10000 })
  await window.waitForSelector('.student-list')
  await window.screenshot({ path: shot('01-teacher-login'), fullPage: true })
})

await step('2', `新建学生 ${studentName} → 列表出现 ACTIVE`, async () => {
  await window.click('button:has-text("新建学生")')
  await window.waitForURL(/#\/teacher\/students\/new/, { timeout: 5000 })
  await window.waitForSelector(`legend:has-text("登录账号")`)

  // 登录账号 fieldset 内 3 个 input（顺序：username, password, confirmPassword）
  const loginInputs = window.locator(`${LOGIN_FS} input`)
  await loginInputs.nth(0).fill(studentUsername)
  await loginInputs.nth(1).fill(studentPassword)
  await loginInputs.nth(2).fill(studentPassword)

  // 基本信息 fieldset：4 个字段
  await window.locator(`${BASE_FS} input[type="text"]`).nth(0).fill(studentName)        // studentName
  await window.locator(`${BASE_FS} select`).selectOption('MALE')                          // gender
  await window.locator(`${BASE_FS} input[type="date"]`).fill('2000-01-15')                // birthDate
  await window.locator(`${BASE_FS} input[type="text"]`).nth(1).fill('13800000000')        // guardianContact

  // 感官画像 fieldset
  const spSelects = window.locator(`${SP_FS} select`)
  await spSelects.nth(0).selectOption('HIGH')    // noise
  await spSelects.nth(1).selectOption('MEDIUM')  // light
  await window.locator(`${SP_FS} input[type="text"]`).fill('NOISY_SUPERMARKET')  // avoidTags
  await window.locator(`${SP_FS} textarea`).fill('初始备注')                       // notes

  await window.screenshot({ path: shot('02-form-filled'), fullPage: true })

  await window.click('button:has-text("创建档案")')
  await window.waitForURL(/#\/teacher\/students$/, { timeout: 5000 })
  await window.waitForSelector('.table tbody tr')

  const rowText = await window.locator('.table tbody tr').first().textContent()
  if (!rowText?.includes(studentName)) {
    throw new Error(`列表未出现学生 ${studentName}: "${rowText}"`)
  }
  const activeCount = await window.locator('.tag-active').count()
  if (activeCount < 1) throw new Error('列表无 ACTIVE 标签')

  await window.screenshot({ path: shot('02-list-after-create'), fullPage: true })
})

await step('3', '编辑页字段回填正确（含感官画像）', async () => {
  await window.click('a:has-text("查看 / 编辑")')
  await window.waitForURL(/#\/teacher\/students\/[\w-]+/, { timeout: 5000 })
  await window.waitForSelector(`legend:has-text("基本信息")`)
  await window.waitForTimeout(500)  // 等 loadForEdit IPC

  // 编辑模式不应显示登录账号 fieldset
  const loginFsCount = await window.locator(LOGIN_FS).count()
  if (loginFsCount !== 0) throw new Error(`编辑模式显示了登录账号 fieldset (count=${loginFsCount})`)

  // 基本信息
  const nameVal = await window.locator(`${BASE_FS} input[type="text"]`).nth(0).inputValue()
  if (nameVal !== studentName) throw new Error(`姓名回填错误: "${nameVal}"`)
  const genderVal = await window.locator(`${BASE_FS} select`).inputValue()
  if (genderVal !== 'MALE') throw new Error(`性别回填错误: ${genderVal}`)
  const birthVal = await window.locator(`${BASE_FS} input[type="date"]`).inputValue()
  if (birthVal !== '2000-01-15') throw new Error(`出生日期回填错误: ${birthVal}`)
  const contactVal = await window.locator(`${BASE_FS} input[type="text"]`).nth(1).inputValue()
  if (contactVal !== '13800000000') throw new Error(`监护人联系方式回填错误: ${contactVal}`)

  // 感官画像
  const spSelects = window.locator(`${SP_FS} select`)
  const noiseVal = await spSelects.nth(0).inputValue()
  if (noiseVal !== 'HIGH') throw new Error(`噪音敏感度回填错误: ${noiseVal}`)
  const lightVal = await spSelects.nth(1).inputValue()
  if (lightVal !== 'MEDIUM') throw new Error(`光线敏感度回填错误: ${lightVal}`)
  const avoidVal = await window.locator(`${SP_FS} input[type="text"]`).inputValue()
  if (avoidVal !== 'NOISY_SUPERMARKET') throw new Error(`回避标签回填错误: "${avoidVal}"`)
  const notesVal = await window.locator(`${SP_FS} textarea`).inputValue()
  if (notesVal !== '初始备注') throw new Error(`备注回填错误: "${notesVal}"`)

  await window.screenshot({ path: shot('03-edit-prefill'), fullPage: true })
})

await step('4', '修改感官画像 → 保存 → 持久化验证', async () => {
  const spSelects = window.locator(`${SP_FS} select`)
  await spSelects.nth(0).selectOption('LOW')                 // noise HIGH → LOW
  await window.locator(`${SP_FS} textarea`).fill('修改后的备注')

  await window.click('button:has-text("保存修改")')
  await window.waitForURL(/#\/teacher\/students$/, { timeout: 5000 })

  // 重新进入
  await window.click('a:has-text("查看 / 编辑")')
  await window.waitForURL(/#\/teacher\/students\/[\w-]+/, { timeout: 5000 })
  await window.waitForSelector(`legend:has-text("基本信息")`)
  await window.waitForTimeout(500)

  const noiseVal = await window.locator(`${SP_FS} select`).nth(0).inputValue()
  if (noiseVal !== 'LOW') throw new Error(`噪音敏感度未持久化: ${noiseVal}`)
  const notesVal = await window.locator(`${SP_FS} textarea`).inputValue()
  if (notesVal !== '修改后的备注') throw new Error(`备注未持久化: "${notesVal}"`)

  await window.screenshot({ path: shot('04-edit-persisted'), fullPage: true })
})

await step('5', '重复 username → 提示「用户名已被占用」', async () => {
  await window.click('a:has-text("← 返回列表")')
  await window.waitForURL(/#\/teacher\/students$/, { timeout: 5000 })
  await window.click('button:has-text("新建学生")')
  await window.waitForURL(/#\/teacher\/students\/new/, { timeout: 5000 })
  await window.waitForSelector(`legend:has-text("登录账号")`)

  const loginInputs = window.locator(`${LOGIN_FS} input`)
  await loginInputs.nth(0).fill(studentUsername)  // 重复
  await loginInputs.nth(1).fill(studentPassword)
  await loginInputs.nth(2).fill(studentPassword)
  await window.locator(`${BASE_FS} input[type="text"]`).nth(0).fill(`另一个_${ts}`)
  await window.locator(`${BASE_FS} input[type="date"]`).fill('2001-02-02')  // 满足必填让 IPC 真的发出

  await window.click('button:has-text("创建档案")')
  await window.waitForSelector('.error-msg', { timeout: 5000 })

  const errText = await window.locator('.error-msg').first().textContent()
  if (!errText?.includes('用户名已被占用')) {
    throw new Error(`错误消息错误: "${errText}"`)
  }

  await window.screenshot({ path: shot('05-username-taken'), fullPage: true })
})

await step('6', '必填留空 → 浏览器原生阻断（IPC 不发出）', async () => {
  // 仍在 /new 表单页（step 5 失败后留在原页）
  await window.locator(`${BASE_FS} input[type="text"]`).nth(0).fill('')  // 清空姓名
  await window.click('button:has-text("创建档案")')
  await window.waitForTimeout(500)

  const url = window.url()
  if (!url.includes('/teacher/students/new')) {
    throw new Error(`应仍在 /new, URL=${url}`)
  }

  // HTML5 validation：姓名 input validity.valid === false
  const isInvalid = await window.evaluate(() => {
    const inputs = document.querySelectorAll('input[required][maxlength="50"]')
    return inputs.length > 0 ? !inputs[0].validity.valid : null
  })
  if (isInvalid !== true) {
    throw new Error(`必填校验未触发, isInvalid=${isInvalid}`)
  }

  await window.screenshot({ path: shot('06-required-blocked'), fullPage: true })
})

await app.close()
log('\n──── app A closed ────')

// ============== app B (student): step 8-pre（归档前可登录）==============
log('\n──── app B: student session (pre-archive) ────')
;({ app, window } = await launchApp())

await step('8(pre)', `学生 ${studentUsername} 登录（归档前）→ /student`, async () => {
  await window.waitForSelector('#username', { timeout: 15000 })
  await window.fill('#username', studentUsername)
  await window.fill('#password', studentPassword)
  await window.click('button[type="submit"]')
  await window.waitForURL(/#\/student/, { timeout: 10000 })
  await window.screenshot({ path: shot('08-student-login-ok'), fullPage: true })
})

await app.close()
log('\n──── app B closed ────')

// ============== app C (teacher): step 7（归档）==============
log('\n──── app C: teacher session (archive) ────')
;({ app, window } = await launchApp())

await step('7', `教师归档 ${studentName} → 列表状态 ARCHIVED`, async () => {
  await window.waitForSelector('#username', { timeout: 15000 })
  await window.fill('#username', 'teacher')
  await window.fill('#password', 'Teacher@123')
  await window.click('button[type="submit"]')
  await window.waitForURL(/#\/teacher\/students/, { timeout: 10000 })
  await window.waitForSelector('.student-list')

  await window.click('a:has-text("查看 / 编辑")')
  await window.waitForURL(/#\/teacher\/students\/[\w-]+/, { timeout: 5000 })
  await window.waitForSelector(`legend:has-text("基本信息")`)

  // 自动 accept window.confirm
  window.on('dialog', async (d) => {
    log(`  [dialog:${d.type()}] ${d.message()}`)
    await d.accept()
  })

  await window.click('button:has-text("归档学生")')
  await window.waitForURL(/#\/teacher\/students$/, { timeout: 5000 })

  // 勾选「包含已归档」让 ARCHIVED 行可见
  await window.check('input[type="checkbox"]')
  await window.waitForTimeout(800)

  const archivedCount = await window.locator('.tag-archived').count()
  if (archivedCount < 1) throw new Error('列表无 ARCHIVED 标签')

  await window.screenshot({ path: shot('07-archived'), fullPage: true })
})

await app.close()
log('\n──── app C closed ────')

// ============== app D (student): step 9（归档后 ACCOUNT_DISABLED）==============
log('\n──── app D: student session (post-archive) ────')
;({ app, window } = await launchApp())

await step('9', `归档后登录 ${studentUsername} → ACCOUNT_DISABLED`, async () => {
  await window.waitForSelector('#username', { timeout: 15000 })
  await window.fill('#username', studentUsername)
  await window.fill('#password', studentPassword)
  await window.click('button[type="submit"]')

  await window.waitForSelector('.error-msg', { timeout: 5000 })
  const errText = await window.locator('.error-msg').first().textContent()
  if (!errText?.includes('账号已停用')) {
    throw new Error(`错误消息错误: "${errText}"`)
  }
  const url = window.url()
  if (!url.includes('/login')) {
    throw new Error(`应仍在 /login, URL=${url}`)
  }

  await window.screenshot({ path: shot('09-disabled'), fullPage: true })
})

await app.close()
log('\n──── app D closed ────')

// ============== 汇总 ==============
log('\n==================== 汇总 ====================')
const passed = results.filter((r) => r.ok).length
log(`通过: ${passed}/${results.length}`)
for (const r of results) {
  log(`  ${r.ok ? '✅' : '❌'} Step ${r.num}: ${r.name}` + (r.ok ? '' : ` — ${r.err}`))
}
log(`截图目录: ${SHOTS}/`)

process.exitCode = passed === results.length ? 0 : 1
