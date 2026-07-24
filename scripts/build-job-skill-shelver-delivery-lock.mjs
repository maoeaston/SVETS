#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashFile, hashRecord, hashText } from './lib/job-skill-contract-hash.mjs'
import {
  AUDIO_CONTRACTS,
  DELIVERY_GENERATED_AT,
  buildOfflineSetups,
  currentBySource,
  deliveryAssetSpecs,
  deliveryGroups,
  expectedAnswer,
  loadDeliveryInputs
} from './lib/job-skill-delivery-contract.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const toolkitPath = resolve(projectRoot, 'doc/assets/offline-toolkit-manifest-v1.json')
const lockPath = resolve(projectRoot, 'doc/features/job-skill-shelver-question-delivery-lock-v1.json')

const inventory = [
  ['station_stable_work_surface', 'PHYSICAL', '稳定工作台面和评测站位', '每站位 1 套', '无松动、无锐边、通道无遮挡'],
  ['kit_reset_checklist', 'DOCUMENT', '工具包 v2.2 逐题复位清单', '每站位 1 份覆膜件', '只展示材料复位，不展示密封答案'],
  ['shelf_three_tier', 'PHYSICAL', '三层可调迷你陈列货架', '每站位 1 组', '固定防倾倒，操作高度不得要求攀爬'],
  ['products_general_set', 'PHYSICAL', 'G01-G20 通用商品及近邻/规格副本', '按 v2.2 固定编号和数量', '全部标注教学评测专用，禁止食用或使用'],
  ['products_fixed_date_set_g01_g12_g15_g16', 'PHYSICAL', 'G01-G12、G15-G16 共 14 件固定模拟日期商品', '每站位 14 件', '标签模糊或脱落时停止评分并更换'],
  ['simulated_work_date_sign', 'DOCUMENT', '固定模拟工作日 2026-09-10 日期牌', '每站位 1 张', '不得替换为现实日期'],
  ['zone_expiry_handling', 'PHYSICAL', '临期待处理区和报损隔离区标识', '各 1 个', '区域边界清晰且不阻挡通道'],
  ['boundary_samples_d01_d05', 'PHYSICAL', 'D01-D05 无伤害边界样品', '每站位 5 件', '无腐败物、无液体、无锐边和真实压力'],
  ['zone_problem_goods', 'PHYSICAL', '问题商品区及周转箱', '每站位 1 套', '与正常商品区物理分离'],
  ['ppe_cut_resistant_gloves', 'PHYSICAL', '防割手套', '每站位 1 双，按尺码备选', '破损或不合手时不得使用'],
  ['safe_box_cutter', 'PHYSICAL', '自动回弹安全开箱刀', '每站位 1 把', '仅用于明确允许刀具的场景；徒手拆箱题不得提供'],
  ['cartons_b01_b03', 'PHYSICAL', 'B01-B03 标准训练纸箱', '每站位 3 个', '重量和封装方式按逐题清单复位'],
  ['delivery_document_set', 'DOCUMENT', '送货单、库存表、差异版文件及答案封套', '每站位 1 套', '学员材料与密封答案分开存放'],
  ['recording_stationery_set', 'PHYSICAL', '记录表、记录本、笔和计算器', '每站位 1 套', '书写工具无尖锐破损'],
  ['offline_scanner_with_sku_json', 'PHYSICAL', '离线扫码设备、本地 SKU JSON 与纸面编号回退表', '每站位 1 套', '不得联网；技术故障不按答错处理'],
  ['cold_chain_samples_and_zone_labels', 'PHYSICAL', '3 件唯一可判断冷链样品及冷藏/冷冻标签', '每站位 1 套', '使用安全空包装，不使用需真实冷藏的食品'],
  ['role_play_badges', 'PHYSICAL', '负责人、顾客和同事角色胸牌', '每站位 1 套', '评估员按锁定脚本表演，不即兴改变评分条件'],
  ['safe_cleanup_set', 'CONSUMABLE', '警示牌、钝边碎片、吸水垫和清洁工具', '每站位 1 套', '不得使用真实玻璃、刺激性液体或锐器'],
  ['recall_marker_set', 'DOCUMENT', '3 件召回标记、召回通知和密封答案键', '每站位 1 套', '召回标识仅用于教具，避免与真实商品混用'],
  ['software_visible_timer', 'SOFTWARE', '软件可视计时器', '每评测终端 1 个', '正确率和安全优先于速度；技术中断暂停计时'],
  ['powered_off_equipment_prop', 'PHYSICAL', '断电设备外壳或设备图片卡', '每站位 1 件', '不得接电、不得制造真实机械风险'],
  ['folding_step_stool', 'PHYSICAL', '折叠两步踏脚凳', '每站位 1 个', '仅作场景道具；需要攀爬时由评估员接管']
].map(([item_id, kind, description, quantity_contract, safety_contract]) => ({
  item_id, kind, description, quantity_contract, safety_contract
}))

function sourceFile(path) {
  return { path, sha256: hashFile(resolve(projectRoot, path)) }
}

function reverseIndex(setups, field) {
  const result = {}
  for (const setup of setups) {
    for (const id of setup[field]) (result[id] ??= []).push(setup.setup_id)
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)))
}

export function buildDeliveryContracts() {
  const { authority, retained, assetManifest } = loadDeliveryInputs(projectRoot)
  const groups = deliveryGroups(retained)
  const setups = buildOfflineSetups(retained)
  const knownItems = new Set(inventory.map((item) => item.item_id))
  const knownAssets = new Set(assetManifest.assets.map((asset) => asset.asset_id))
  for (const setup of setups) {
    for (const itemId of setup.item_ids) if (!knownItems.has(itemId)) throw new Error(`[delivery-contract] unknown toolkit item: ${itemId}`)
    for (const assetId of setup.asset_ids) if (!knownAssets.has(assetId)) throw new Error(`[delivery-contract] unknown setup asset: ${assetId}`)
  }

  const toolkitBody = {
    $schema: './offline-toolkit-manifest-v1.schema.json',
    schema_version: 'offline-toolkit-manifest-v1',
    manifest_id: 'job-skill-shelver-offline-toolkit-v2.2',
    toolkit_version: '2.2',
    status: 'LOCKED_FOR_PRODUCTION',
    generated_at: DELIVERY_GENERATED_AT,
    source_files: [
      sourceFile('doc/reference/offline-toolkit-procurement-spec.md'),
      sourceFile('doc/features/job-skill-shelver-298-disposition-authority-v1.json'),
      sourceFile('doc/features/job-skill-shelver-298-question-revision-candidates-v1.json'),
      sourceFile('doc/features/job-skill-shelver-298-question-revision-candidates-v3.json'),
      sourceFile('doc/features/job-skill-shelver-298-question-revision-candidates-v4.json'),
      sourceFile('doc/features/job-skill-shelver-298-question-revision-candidates-v5.json'),
      sourceFile('doc/features/job-skill-shelver-298-question-revision-candidates-v6.json'),
      sourceFile('doc/features/job-skill-shelver-298-targeted-v6-rereview-merged-gate-v1.json'),
      sourceFile('doc/features/job-skill-shelver-298-rejected-replacement-candidates-v2.json'),
      sourceFile('doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.json'),
      sourceFile('doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v4.json'),
      sourceFile('doc/features/job-skill-shelver-298-rejected-replacement-targeted-v4-rereview-merged-gate-v1.json'),
      sourceFile('doc/features/job-skill-shelver-pilot-revision-candidates-v3.json'),
      sourceFile('doc/assets/asset-manifest.json')
    ],
    summary: {
      offline_question_total: setups.length,
      inventory_item_total: inventory.length,
      by_module: Object.fromEntries(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map((module) => [module, setups.filter((setup) => setup.module === module).length])),
      date_question_total: groups.date.length,
      script_question_total: groups.script.length,
      example_image_total: groups.offlineExamples.length
    },
    inventory,
    setups,
    reverse_index: {
      item_to_setup_ids: reverseIndex(setups, 'item_ids'),
      asset_to_setup_ids: reverseIndex(setups, 'asset_ids')
    }
  }
  const toolkit = { ...toolkitBody, manifest_hash: hashRecord(toolkitBody) }

  const bySource = currentBySource(retained)
  const questionLocks = new Map()
  const ensureLock = (question) => {
    if (!questionLocks.has(question.source_question_id)) {
      questionLocks.set(question.source_question_id, {
        source_question_id: question.source_question_id,
        current_question_id: question.current_question_id,
        current_question_version: question.authority.current_question_version,
        module: question.module,
        question_type: question.question_type,
        disposition: question.authority.disposition,
        semantic_hash: question.authority.semantic_hash,
        delivery: { types: [], offline_setup_id: null, asset_ids: [], expected_answer: expectedAnswer(question), answer_contract_hash: null }
      })
    }
    return questionLocks.get(question.source_question_id)
  }
  for (const setup of setups) {
    const lock = ensureLock(bySource.get(setup.source_question_id))
    lock.delivery.types.push('OFFLINE_SETUP')
    lock.delivery.offline_setup_id = setup.setup_id
    lock.delivery.asset_ids.push(...setup.asset_ids)
  }

  const assessmentVideos = assetManifest.assets.filter((asset) => asset.category === 'A' && asset.asset_type === 'video')
  if (assessmentVideos.length !== 68) throw new Error(`[delivery-contract] expected 68 assessment videos, found ${assessmentVideos.length}`)
  for (const asset of assessmentVideos) {
    if (asset.question_ids.length !== 1) throw new Error(`[delivery-contract] video must bind one question: ${asset.asset_id}`)
    const question = bySource.get(asset.question_ids[0])
    if (!question) throw new Error(`[delivery-contract] video question is not retained: ${asset.question_ids[0]}`)
    const answer = expectedAnswer(question)
    if (answer !== asset.expected_answer) throw new Error(`[delivery-contract] video answer mismatch: ${asset.asset_id}`)
    const lock = ensureLock(question)
    lock.delivery.types.push('VIDEO_ANSWER')
    lock.delivery.asset_ids.push(asset.asset_id)
    lock.delivery.expected_answer = answer
  }

  const specs = deliveryAssetSpecs(retained)
  for (const spec of specs.images) {
    const question = bySource.get(spec.source_question_id)
    const lock = ensureLock(question)
    lock.delivery.types.push(groups.offlineExamples.some((item) => item.source_question_id === spec.source_question_id) ? 'OFFLINE_EXAMPLE_IMAGE' : 'IMAGE_REQUIREMENT')
    lock.delivery.asset_ids.push(`asset_${spec.plan_key}`)
  }
  for (const spec of specs.scripts) {
    const lock = ensureLock(bySource.get(spec.source_question_id))
    lock.delivery.types.push('ROLE_PLAY_SCRIPT')
    lock.delivery.asset_ids.push(`asset_${spec.plan_key}`)
  }
  for (const spec of AUDIO_CONTRACTS) {
    const lock = ensureLock(bySource.get(spec.source_question_id))
    lock.delivery.types.push('AUDIO_CUE')
    lock.delivery.asset_ids.push(`asset_${spec.plan_key}`)
  }

  const questions = [...questionLocks.values()].map((lock) => {
    lock.delivery.types = [...new Set(lock.delivery.types)].sort()
    lock.delivery.asset_ids = [...new Set(lock.delivery.asset_ids)].sort()
    for (const assetId of lock.delivery.asset_ids) if (!knownAssets.has(assetId)) throw new Error(`[delivery-contract] lock asset missing: ${assetId}`)
    lock.delivery.answer_contract_hash = hashRecord({
      semantic_hash: lock.semantic_hash,
      expected_answer: lock.delivery.expected_answer,
      types: lock.delivery.types,
      offline_setup_id: lock.delivery.offline_setup_id,
      asset_ids: lock.delivery.asset_ids
    })
    return lock
  }).sort((a, b) => a.current_question_id.localeCompare(b.current_question_id))
  if (questions.length !== 181) throw new Error(`[delivery-contract] expected 181 uniquely locked questions, found ${questions.length}`)

  const assetToQuestionIds = {}
  const setupToQuestionId = {}
  for (const question of questions) {
    if (question.delivery.offline_setup_id) setupToQuestionId[question.delivery.offline_setup_id] = question.current_question_id
    for (const assetId of question.delivery.asset_ids) (assetToQuestionIds[assetId] ??= []).push(question.current_question_id)
  }
  const lockBody = {
    $schema: './job-skill-shelver-question-delivery-lock-v1.schema.json',
    schema_version: 'job-skill-shelver-question-delivery-lock-v1',
    lock_id: 'job-skill-shelver-delivery-lock-2026-07-22',
    status: 'LOCKED_FOR_PRODUCTION_NOT_RELEASE',
    generated_at: DELIVERY_GENERATED_AT,
    authority: {
      authority_id: authority.authority_id,
      authority_hash: authority.authority_hash,
      semantic_root_hash: authority.semantic_root_hash
    },
    sources: [
      sourceFile('doc/features/job-skill-shelver-298-disposition-authority-v1.json'),
      {
        path: 'doc/assets/offline-toolkit-manifest-v1.json',
        sha256: hashText(`${JSON.stringify(toolkit, null, 2)}\n`)
      },
      sourceFile('doc/assets/asset-manifest.json')
    ],
    summary: {
      locked_question_total: questions.length,
      offline_setup_total: setups.length,
      video_answer_total: assessmentVideos.length,
      image_requirement_total: groups.image.length,
      offline_example_image_total: groups.offlineExamples.length,
      date_question_total: groups.date.length,
      script_question_total: groups.script.length
    },
    release_gate: {
      releaseable: false,
      reason: '298道题仅编译为DRAFT；24道Pilot独立门禁和270项资产均未完成，禁止激活题目、创建测评或写入运行数据库。'
    },
    questions,
    reverse_index: {
      setup_to_question_id: Object.fromEntries(Object.entries(setupToQuestionId).sort(([a], [b]) => a.localeCompare(b))),
      asset_to_question_ids: Object.fromEntries(Object.entries(assetToQuestionIds).sort(([a], [b]) => a.localeCompare(b)))
    }
  }
  return { toolkit, lock: { ...lockBody, lock_hash: hashRecord(lockBody) } }
}

export function writeDeliveryContracts() {
  const { toolkit, lock } = buildDeliveryContracts()
  writeFileSync(toolkitPath, `${JSON.stringify(toolkit, null, 2)}\n`, 'utf8')
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
  return { toolkit, lock }
}

function checkedInMatches(path, value) {
  return readFileSync(path, 'utf8') === `${JSON.stringify(value, null, 2)}\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--check')) throw new Error('[delivery-contract] supported argument: --check')
  if (args.includes('--check')) {
    const { toolkit, lock } = buildDeliveryContracts()
    if (!checkedInMatches(toolkitPath, toolkit) || !checkedInMatches(lockPath, lock)) {
      throw new Error('[delivery-contract] checked-in delivery contracts are stale; run contract:job-skill:delivery:build')
    }
    console.log('[delivery-contract] toolkit and delivery lock are current')
  } else {
    const { toolkit, lock } = writeDeliveryContracts()
    console.log(`[delivery-contract] wrote ${toolkit.setups.length} setups and ${lock.questions.length} question locks`)
  }
}
