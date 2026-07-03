import { describe, expect, it } from 'vitest'
import {
  buildAssetResourceUpsertSql,
  parseAssetSeedTsv,
  resolveDefaultDbPath,
  validateAssetSeedRows
} from '../lib/question-bank-image-asset-seed.mjs'

const BASE_HEADER =
  'asset_id\tasset_type\tasset_role\tapp_uri\tlocal_path\tmime_type\tfile_hash\tfile_size_bytes\twidth_px\theight_px\tstatus\ttarget_question_type\tattach_field\tcurrent_status\tnotes'

describe('question-bank image asset seed helper', () => {
  it('解析 TSV 成结构化行', () => {
    const rows = parseAssetSeedTsv(
      [
        BASE_HEADER,
        'asset_img_demo\tIMAGE\tQUESTION_MEDIA\tapp://assets/question-media/demo.png\tAIimages/demo.png\timage/png\thash123\t123\t1672\t941\tACTIVE\tTRUE_FALSE\tquestion_bank.media_asset_id\tdirect_attach\t演示素材'
      ].join('\n')
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      asset_id: 'asset_img_demo',
      local_path: 'AIimages/demo.png',
      file_hash: 'hash123',
      file_size_bytes: '123',
      width_px: '1672',
      height_px: '941'
    })
  })

  it('存在 __TODO_ 占位符时拒绝继续', () => {
    const rows = parseAssetSeedTsv(
      [
        BASE_HEADER,
        'asset_img_demo\tIMAGE\tQUESTION_MEDIA\tapp://assets/question-media/demo.png\tAIimages/demo.png\timage/png\t__TODO_SHA256__\t123\t1672\t941\tACTIVE\tTRUE_FALSE\tquestion_bank.media_asset_id\tdirect_attach\t演示素材'
      ].join('\n')
    )

    expect(() => validateAssetSeedRows(rows)).toThrow(/contains placeholder/i)
  })

  it('DRG-OBJ02 v003 总览图若被标成 direct_attach 则拒绝', () => {
    const rows = parseAssetSeedTsv(
      [
        BASE_HEADER,
        'asset_img_drg_obj02_goods_pack_v003\tIMAGE\tQUESTION_MEDIA\tapp://assets/question-media/drg-obj02-goods-facing-pack-v003.png\tAIimages/DRG-OBJ02-goods-facing-pack-v003.png\timage/png\thash123\t123\t1254\t1254\tACTIVE\tDRAG\tcontent_json.drag_items[].image_asset_id\tdirect_attach\t素材包总览图'
      ].join('\n')
    )

    expect(() => validateAssetSeedRows(rows)).toThrow(/DRG-OBJ02/i)
  })

  it('DRG-OBJ02 子素材允许作为 draggable item direct_attach', () => {
    const rows = parseAssetSeedTsv(
      [
        BASE_HEADER,
        'asset_img_drg_obj02_snack_box_blue_v002\tIMAGE\tQUESTION_MEDIA\tapp://assets/question-media/drg-obj02-snack-box-blue-v002.png\tAIimages/drg-obj02-snack-box-blue-v002.png\timage/png\thash123\t123\t1254\t1254\tACTIVE\tDRAG\tcontent_json.drag_items[].image_asset_id\tdirect_attach\t零食盒蓝色子素材'
      ].join('\n')
    )

    expect(() => validateAssetSeedRows(rows)).not.toThrow()
  })

  it('生成 UPSERT SQL，并包含 last_verified_at', () => {
    const rows = parseAssetSeedTsv(
      [
        BASE_HEADER,
        'asset_img_demo\tIMAGE\tQUESTION_MEDIA\tapp://assets/question-media/demo.png\tAIimages/demo.png\timage/png\thash123\t123\t1672\t941\tACTIVE\tTRUE_FALSE\tquestion_bank.media_asset_id\tdirect_attach\t演示素材'
      ].join('\n')
    )
    validateAssetSeedRows(rows)

    const sql = buildAssetResourceUpsertSql(rows, '2026-07-02T20:00:00+08:00')

    expect(sql).toContain('INSERT INTO asset_resource')
    expect(sql).toContain("ON CONFLICT(asset_id) DO UPDATE SET")
    expect(sql).toContain("'2026-07-02T20:00:00+08:00'")
    expect(sql).toContain("'asset_img_demo'")
  })

  it('按平台推导默认 DB 路径', () => {
    expect(
      resolveDefaultDbPath({
        platform: 'linux',
        homeDir: '/home/dev',
        appName: 'xc-career-guide'
      })
    ).toBe('/home/dev/.config/xc-career-guide/data/xc-career-guide.db')

    expect(
      resolveDefaultDbPath({
        platform: 'win32',
        homeDir: 'C:/Users/dev',
        appName: 'xc-career-guide'
      })
    ).toBe('C:/Users/dev/AppData/Roaming/xc-career-guide/data/xc-career-guide.db')

    expect(
      resolveDefaultDbPath({
        platform: 'darwin',
        homeDir: '/Users/dev',
        appName: 'xc-career-guide'
      })
    ).toBe('/Users/dev/Library/Application Support/xc-career-guide/data/xc-career-guide.db')
  })
})
