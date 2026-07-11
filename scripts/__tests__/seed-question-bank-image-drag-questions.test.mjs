import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// SQL 文件是派生产物（gitignored），测试前按需生成
beforeAll(() => {
  if (!existsSync('doc/features/question-bank-image-drag-question-seed.sql')) {
    execFileSync('node', ['scripts/seed-question-bank-image-drag-questions.mjs', '--dry-run'], {
      stdio: 'inherit',
    })
  }
})

describe('question-bank drag question seed sql', () => {
  it('包含 ROW 35 / 38 的正式 DRAFT 拖拽题与图片挂接', () => {
    const sql = readFileSync(
      'doc/features/question-bank-image-drag-question-seed.sql',
      'utf-8'
    )

    expect(sql).toContain('Q_BASE_FINE_MOTOR_DRAG_002')
    expect(sql).toContain('Q_BASE_FINE_MOTOR_DRAG_005')
    expect(sql).toContain('"source_row":35')
    expect(sql).toContain('"source_row":38')
    expect(sql).toContain('asset_img_drg_bg01_shelf_board_v001')
    expect(sql).toContain('asset_img_drg_obj02_snack_box_blue_v002')
    expect(sql).toContain('asset_img_drg_obj02_drink_bottle_orange_v002')
    expect(sql).toContain("'DRAFT'")
  })

  it('两道题都覆盖全部 9 张 DRG-OBJ02 v002 子素材', () => {
    const sql = readFileSync(
      'doc/features/question-bank-image-drag-question-seed.sql',
      'utf-8'
    )

    // 9 个 image_asset_id 都要出现至少两次（两道题各引用一次）
    const expectedAssetIds = [
      'asset_img_drg_obj02_snack_box_blue_v002',
      'asset_img_drg_obj02_snack_box_red_v002',
      'asset_img_drg_obj02_snack_box_yellow_v002',
      'asset_img_drg_obj02_snack_box_green_v002',
      'asset_img_drg_obj02_homecare_box_white_blue_v002',
      'asset_img_drg_obj02_homecare_box_white_orange_v002',
      'asset_img_drg_obj02_homecare_box_purple_white_v002',
      'asset_img_drg_obj02_drink_bottle_orange_v002',
      'asset_img_drg_obj02_drink_bottle_green_v002'
    ]
    for (const id of expectedAssetIds) {
      const occurrences = sql.split(id).length - 1
      expect(occurrences).toBeGreaterThanOrEqual(2)
    }
  })

  it('DRAG_002 用 9 slot 一对一映射，DRAG_005 用 3 品类 zone 一对多', () => {
    const sql = readFileSync(
      'doc/features/question-bank-image-drag-question-seed.sql',
      'utf-8'
    )

    // DRAG_002：9 个 slot_01..slot_09
    for (let i = 1; i <= 9; i++) {
      const slotId = `slot_${String(i).padStart(2, '0')}`
      expect(sql).toContain(`"zone_id":"${slotId}"`)
    }

    // DRAG_005：3 个品类 zone
    expect(sql).toContain('"zone_id":"zone_homecare"')
    expect(sql).toContain('"zone_id":"zone_drink"')
    expect(sql).toContain('"zone_id":"zone_snack"')

    // prompt 文本体现 9-item 升级
    expect(sql).toContain('9 个商品')
    expect(sql).toContain('9 个货品')
  })
})
