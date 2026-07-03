// parseAppAssetUrl 单测：纯函数，覆盖合法/非法 URL + 安全过滤。
// 不测 protocol.handle 本身（依赖 Electron runtime，属于集成测试范畴）。
//
// [!] 安全契约：asset_id 必须匹配 /^asset_[a-z0-9_]+$/i，禁止 . / \ 空格 等
// 可被路径穿越利用的字符。任意 malformed path 必须返回 null（handler 会转 400）。

import { describe, it, expect } from 'vitest'
import { parseAppAssetUrl } from '../app-asset'

describe('parseAppAssetUrl', () => {
  describe('合法 URL', () => {
    it('标准格式 app://asset/<asset_id> → 返回 { assetId }', () => {
      const r = parseAppAssetUrl('app://asset/asset_img_drg_obj02_snack_box_blue_v002')
      expect(r).toEqual({ assetId: 'asset_img_drg_obj02_snack_box_blue_v002' })
    })

    it('asset_id 含数字版本号 v002 → 合法', () => {
      const r = parseAppAssetUrl('app://asset/asset_img_jdg_ms02_facing_correct_v001')
      expect(r).toEqual({ assetId: 'asset_img_jdg_ms02_facing_correct_v001' })
    })

    it('大小写混合 asset_id → 合法（正则 /i）', () => {
      // 当前命名规范用全小写，但正则允许大写以便未来扩展
      const r = parseAppAssetUrl('app://asset/asset_Img_DRG_Obj02_MIXED')
      expect(r).toEqual({ assetId: 'asset_Img_DRG_Obj02_MIXED' })
    })

    it('多斜杠前导 → 仍能解析（pathnames 容错）', () => {
      const r = parseAppAssetUrl('app://asset///asset_img_xxx_v001')
      expect(r).toEqual({ assetId: 'asset_img_xxx_v001' })
    })
  })

  describe('协议 / host 拒绝', () => {
    it('非 app: 协议 → null', () => {
      expect(parseAppAssetUrl('http://asset/asset_xxx')).toBeNull()
      expect(parseAppAssetUrl('file:///asset_xxx')).toBeNull()
      expect(parseAppAssetUrl('https://asset/asset_xxx')).toBeNull()
    })

    it('host 非 asset → null', () => {
      expect(parseAppAssetUrl('app://assets/asset_xxx')).toBeNull()
      expect(parseAppAssetUrl('app://bundle/asset_xxx')).toBeNull()
      expect(parseAppAssetUrl('app:///asset_xxx')).toBeNull()
    })

    it('malformed URL → null', () => {
      expect(parseAppAssetUrl('not-a-url')).toBeNull()
      expect(parseAppAssetUrl('')).toBeNull()
      expect(parseAppAssetUrl('://asset')).toBeNull()
    })
  })

  describe('asset_id 安全过滤', () => {
    it('含 .. 路径穿越 → null', () => {
      expect(parseAppAssetUrl('app://asset/../../etc/passwd')).toBeNull()
      expect(parseAppAssetUrl('app://asset/asset_xxx/../y')).toBeNull()
    })

    it('含 / → null（asset_id 不能有路径分隔符）', () => {
      expect(parseAppAssetUrl('app://asset/asset_img/x')).toBeNull()
      expect(parseAppAssetUrl('app://asset/foo/bar')).toBeNull()
    })

    it('含空格 → null', () => {
      expect(parseAppAssetUrl('app://asset/asset_xxx v002')).toBeNull()
    })

    it('不含 asset_ 前缀 → null', () => {
      expect(parseAppAssetUrl('app://asset/my_image_v001')).toBeNull()
      expect(parseAppAssetUrl('app://asset/img_xxx')).toBeNull()
    })

    it('空 asset_id → null', () => {
      expect(parseAppAssetUrl('app://asset/')).toBeNull()
      expect(parseAppAssetUrl('app://asset')).toBeNull()
    })
  })
})
