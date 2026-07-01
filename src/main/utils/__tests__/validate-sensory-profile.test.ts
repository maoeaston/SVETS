import { describe, it, expect } from 'vitest'
import { validateSensoryProfile } from '../validate-sensory-profile'

describe('validateSensoryProfile', () => {
  describe('接受合法输入', () => {
    it('null 视为未填写，通过', () => {
      expect(validateSensoryProfile(null)).toEqual({ ok: true })
    })

    it('undefined 视为未填写，通过', () => {
      expect(validateSensoryProfile(undefined)).toEqual({ ok: true })
    })

    it('空对象 {} 通过（后端容错）', () => {
      expect(validateSensoryProfile({})).toEqual({ ok: true })
    })

    it('完整合法对象通过', () => {
      expect(
        validateSensoryProfile({
          noise_sensitivity: 'HIGH',
          light_sensitivity: 'LOW',
          tactile_sensitivity: 'MEDIUM',
          crowd_density_sensitivity: 'HIGH',
          avoid_tags: ['NOISY_SUPERMARKET', 'BRIGHT_FLASH'],
          notes: '对嘈杂环境敏感'
        })
      ).toEqual({ ok: true })
    })

    it('敏感度字段值为 null 通过', () => {
      expect(validateSensoryProfile({ noise_sensitivity: null })).toEqual({ ok: true })
    })

    it('仅部分字段通过', () => {
      expect(validateSensoryProfile({ noise_sensitivity: 'LOW', notes: 'x' })).toEqual({ ok: true })
    })

    it('avoid_tags 为空数组通过', () => {
      expect(validateSensoryProfile({ avoid_tags: [] })).toEqual({ ok: true })
    })
  })

  describe('拒绝非法输入', () => {
    it('敏感度枚举越界', () => {
      const r = validateSensoryProfile({ noise_sensitivity: 'EXTREME' })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain('noise_sensitivity')
    })

    it('光敏感度枚举越界', () => {
      const r = validateSensoryProfile({ light_sensitivity: 'MEDIUM_HIGH' })
      expect(r.ok).toBe(false)
    })

    it('触觉敏感度枚举越界', () => {
      expect(validateSensoryProfile({ tactile_sensitivity: 'high' }).ok).toBe(false)
    })

    it('人群密度敏感度枚举越界', () => {
      expect(validateSensoryProfile({ crowd_density_sensitivity: 3 }).ok).toBe(false)
    })

    it('avoid_tags 非数组（字符串）', () => {
      const r = validateSensoryProfile({ avoid_tags: 'NOISY' })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain('avoid_tags')
    })

    it('avoid_tags 元素非字符串', () => {
      expect(validateSensoryProfile({ avoid_tags: [1, 2] }).ok).toBe(false)
    })

    it('avoid_tags 混合类型', () => {
      expect(validateSensoryProfile({ avoid_tags: ['OK', 5] }).ok).toBe(false)
    })

    it('notes 非字符串', () => {
      const r = validateSensoryProfile({ notes: 123 })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain('notes')
    })

    it('数组作为 input 拒绝', () => {
      expect(validateSensoryProfile(['LOW']).ok).toBe(false)
    })

    it('原始值作为 input 拒绝', () => {
      expect(validateSensoryProfile(42).ok).toBe(false)
      expect(validateSensoryProfile('HIGH').ok).toBe(false)
    })
  })
})
