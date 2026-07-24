import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildActivateEligibleSql, reviewQuestionBankRows } from '../lib/question-bank-review-gate.mjs'
import { mapImportRow } from '../lib/question-bank-import.mjs'

function buildTrueFalseRow(overrides = {}) {
  return {
    question_id: 'Q_BASE_SAFETY_OPERATION_TF_001',
    module_type: 'SAFETY_OPERATION',
    question_type: 'TRUE_FALSE',
    status: 'DRAFT',
    media_asset_id: 'asset_img_safety_001',
    tool_asset_ids_json: null,
    content_json: JSON.stringify({
      question_type: 'TRUE_FALSE',
      prompt: '图中的开箱动作是否安全？',
      expected_answer: true,
      assessment_point: '安全开箱动作识别',
      ability_tags: ['SAFETY_OPERATION'],
      media_brief: '正确开箱示意图',
      source: {
        import_batch_id: 'batch_20260704_001',
        source_file: '通用基础能力评估题库.xlsx',
        source_row: 12,
        imported_at: '2026-07-04T01:00:00.000Z',
        imported_by: 'codex'
      }
    }),
    scoring_rule_json: JSON.stringify({
      scoring_type: 'EXACT_MATCH',
      max_score: 2,
      correct_score: 2,
      incorrect_score: 0
    }),
    ...overrides
  }
}

const ACTIVE_ASSETS = {
  asset_img_safety_001: { asset_id: 'asset_img_safety_001', status: 'ACTIVE' }
}

describe('question-bank review gate', () => {
  it('合格 TRUE_FALSE 题通过审核', () => {
    const report = reviewQuestionBankRows([buildTrueFalseRow()], {
      assetsById: ACTIVE_ASSETS
    })

    expect(report.checked).toBe(1)
    expect(report.eligible).toBe(1)
    expect(report.blocked).toBe(0)
    expect(report.items[0]).toMatchObject({
      question_id: 'Q_BASE_SAFETY_OPERATION_TF_001',
      status: 'ELIGIBLE'
    })
  })

  it('content_json.question_type 与行字段不一致时失败', () => {
    const report = reviewQuestionBankRows(
      [
        buildTrueFalseRow({
          content_json: JSON.stringify({
            question_type: 'SINGLE_CHOICE',
            prompt: '图中的开箱动作是否安全？',
            options: [
              { key: 'A', text: '安全' },
              { key: 'B', text: '不安全' }
            ],
            expected_answer: 'A',
            assessment_point: '安全开箱动作识别',
            ability_tags: ['SAFETY_OPERATION'],
            source: {
              import_batch_id: 'batch_20260704_001',
              source_file: '通用基础能力评估题库.xlsx',
              source_row: 12,
              imported_at: '2026-07-04T01:00:00.000Z',
              imported_by: 'codex'
            }
          })
        })
      ],
      { assetsById: ACTIVE_ASSETS }
    )

    expect(report.items[0].status).toBe('BLOCKED')
    expect(report.items[0].reasons.join('\n')).toMatch(/question_type/i)
  })

  function buildDragDropRow(overrides = {}) {
    return buildTrueFalseRow({
      question_id: 'Q_BASE_FINE_MOTOR_DRAG_001',
      module_type: 'FINE_MOTOR',
      question_type: 'DRAG',
      content_json: JSON.stringify({
        question_type: 'DRAG',
        prompt: '将商品拖到正确位置',
        assessment_point: '货架分类认知',
        ability_tags: ['FINE_MOTOR'],
        // v1.2：items/zones 在 interaction.config（运行时权威路径）
        interaction: {
          type: 'DRAG_DROP',
          config: {
            items: [{ item_id: 'item_1', label: '牛奶', image_asset_id: 'asset_img_safety_001' }],
            zones: [{ zone_id: 'zone_1', label: '冷藏区', accepts: ['item_1'] }]
          }
        },
        source: {
          import_batch_id: 'batch_20260704_001',
          source_file: '通用基础能力评估题库.xlsx',
          source_row: 30,
          imported_at: '2026-07-04T01:00:00.000Z',
          imported_by: 'codex'
        }
      }),
      scoring_rule_json: JSON.stringify({
        scoring_type: 'MAPPING_MATCH',
        max_score: 2,
        correct_mapping: { item_1: 'zone_1' },
        all_correct_score: 2,
        partial_credit: false
      }),
      ...overrides
    })
  }

  it('合格 DRAG_DROP 题（interaction.config + MAPPING_MATCH）通过审核', () => {
    const report = reviewQuestionBankRows([buildDragDropRow()], { assetsById: ACTIVE_ASSETS })
    expect(report.items[0].status).toBe('ELIGIBLE')
  })

  it('DRAG scoring_type 非 ORDER_MATCH/MAPPING_MATCH 时失败', () => {
    const report = reviewQuestionBankRows(
      [
        buildDragDropRow({
          scoring_rule_json: JSON.stringify({
            scoring_type: 'DRAG_PARTIAL',
            max_score: 2,
            all_correct_score: 2,
            partial_correct_score: 1,
            incorrect_score: 0
          })
        })
      ],
      { assetsById: ACTIVE_ASSETS }
    )

    expect(report.items[0].status).toBe('BLOCKED')
    expect(report.items[0].reasons.join('\n')).toMatch(/ORDER_MATCH or MAPPING_MATCH/i)
  })

  it('引用不存在 asset 时失败', () => {
    const report = reviewQuestionBankRows(
      [buildTrueFalseRow({ media_asset_id: 'asset_missing_001' })],
      { assetsById: ACTIVE_ASSETS }
    )

    expect(report.items[0].status).toBe('BLOCKED')
    expect(report.items[0].reasons.join('\n')).toMatch(/asset_missing_001/i)
  })

  it('引用 DEPRECATED asset 时失败', () => {
    const report = reviewQuestionBankRows([buildTrueFalseRow()], {
      assetsById: {
        asset_img_safety_001: { asset_id: 'asset_img_safety_001', status: 'DEPRECATED' }
      }
    })

    expect(report.items[0].status).toBe('BLOCKED')
    expect(report.items[0].reasons.join('\n')).toMatch(/DEPRECATED/i)
  })

  it('扫描 presentation、variant、tool、script、sealed config 和 offline setup 的资产引用', () => {
    const content = JSON.parse(buildTrueFalseRow().content_json)
    content.presentation = { assets: [{ asset_id: 'asset_presentation' }] }
    content.variants = [{ media_asset_id: 'asset_variant' }]
    content.administration = {
      script_asset_id: 'asset_script',
      sealed_config_asset_id: 'asset_sealed'
    }
    content.offline_setup = { asset_ids: ['asset_setup'] }
    const row = buildTrueFalseRow({
      tool_asset_ids_json: JSON.stringify(['asset_tool']),
      content_json: JSON.stringify(content)
    })
    const report = reviewQuestionBankRows([row], { assetsById: ACTIVE_ASSETS })

    expect(report.items[0].status).toBe('BLOCKED')
    for (const assetId of [
      'asset_presentation', 'asset_variant', 'asset_script',
      'asset_sealed', 'asset_setup', 'asset_tool'
    ]) {
      expect(report.items[0].reasons).toContain(`asset reference not found: ${assetId}`)
    }
  })

  it('线上 rubric 含经提示时失败', () => {
    const report = reviewQuestionBankRows(
      [
        buildTrueFalseRow({
          content_json: JSON.stringify({
            question_type: 'TRUE_FALSE',
            prompt: '图中的开箱动作是否安全？',
            expected_answer: true,
            assessment_point: '安全开箱动作识别',
            ability_tags: ['SAFETY_OPERATION'],
            note: '原始计分规则：经提示后可以完成',
            source: {
              import_batch_id: 'batch_20260704_001',
              source_file: '通用基础能力评估题库.xlsx',
              source_row: 12,
              imported_at: '2026-07-04T01:00:00.000Z',
              imported_by: 'codex'
            }
          })
        })
      ],
      { assetsById: ACTIVE_ASSETS }
    )

    expect(report.items[0].status).toBe('BLOCKED')
    expect(report.items[0].reasons.join('\n')).toMatch(/经提示/i)
  })

  it('Step 3 的 DRAFT 占位标记必须被拦下', () => {
    const report = reviewQuestionBankRows(
      [
        buildTrueFalseRow({
          content_json: JSON.stringify({
            question_type: 'TRUE_FALSE',
            prompt: '图中的开箱动作是否安全？',
            expected_answer: false,
            assessment_point: '安全开箱动作识别',
            ability_tags: ['SAFETY_OPERATION'],
            note: '[DRAFT_REVIEW_REQUIRED] 源 CSV 导入占位，需人工补齐答案/结构后再审核激活',
            source: {
              import_batch_id: 'batch_20260704_001',
              source_file: '通用基础能力评估题库.xlsx',
              source_row: 12,
              imported_at: '2026-07-04T01:00:00.000Z',
              imported_by: 'codex'
            }
          })
        })
      ],
      { assetsById: ACTIVE_ASSETS }
    )

    expect(report.items[0].status).toBe('BLOCKED')
    expect(report.items[0].reasons.join('\n')).toMatch(/DRAFT_REVIEW_REQUIRED/)
  })

  it('activate SQL 只包含合格题', () => {
    const report = reviewQuestionBankRows(
      [
        buildTrueFalseRow(),
        buildTrueFalseRow({
          question_id: 'Q_BASE_SAFETY_OPERATION_TF_002',
          media_asset_id: 'asset_missing_001'
        })
      ],
      { assetsById: ACTIVE_ASSETS }
    )

    const sql = buildActivateEligibleSql(report.items)

    expect(sql).toContain('UPDATE question_bank SET status = \'ACTIVE\'')
    expect(sql).toContain('Q_BASE_SAFETY_OPERATION_TF_001')
    expect(sql).not.toContain('Q_BASE_SAFETY_OPERATION_TF_002')
  })

  // 防漂移：转换器（question-bank-import）产物必须整体通过上线门禁。
  // 二者若再次分叉（如一方改了 content_json 结构而另一方未跟上），本测试立即失败。
  it('转换器产物整体通过门禁（母题库 298 条契约锁定）', () => {
    const sourcePath = fileURLToPath(
      new URL('../../doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json', import.meta.url)
    )
    const rawRows = JSON.parse(readFileSync(sourcePath, 'utf-8'))
    const rows = rawRows.map((raw, i) => {
      const m = mapImportRow(raw, {
        sourceRow: i + 1,
        importedAt: '2026-07-16T00:00:00.000Z',
        importedBy: 'question-bank-import'
      })
      return {
        question_id: m.question_id,
        module_type: m.module_type,
        item_usage: m.item_usage,
        question_type: m.question_type,
        status: 'DRAFT',
        media_asset_id: m.media_asset_id,
        tool_asset_ids_json: m.tool_asset_ids_json,
        content_json: JSON.stringify(m.content_json),
        scoring_rule_json: JSON.stringify(m.scoring_rule_json)
      }
    })
    // assetsById 传空：母题库题目 media_brief 待补素材，尚无 asset 引用（assets:[]），
    // 故资产校验不产生引用；若未来补入 asset 引用需同步提供 assetsById。
    const report = reviewQuestionBankRows(rows, { assetsById: {} })
    expect(report.checked).toBe(298)
    expect(report.blocked).toBe(0)
  })
})
