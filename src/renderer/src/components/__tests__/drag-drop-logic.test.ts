import { describe, it, expect } from 'vitest'
import { applyDrop, applyUnplace } from '../drag-drop-logic'

describe('applyDrop', () => {
  it('场景1：item 拖入空 zone → map 新增一条', () => {
    const result = applyDrop({}, 'item-A', 'zone-1')
    expect(result).toEqual({ 'item-A': 'zone-1' })
  })

  it('场景2：item 拖入已占用 zone → 两条映射同时更新，单次返回', () => {
    // item-A 在 zone-1，item-B 拖入 zone-1 → item-A 应接管 item-B 原来的 zone-2
    const map = { 'item-A': 'zone-1', 'item-B': 'zone-2' }
    const result = applyDrop(map, 'item-B', 'zone-1')
    expect(result).toEqual({ 'item-A': 'zone-2', 'item-B': 'zone-1' })
  })

  it('场景2b：item 从出发区拖入已占用 zone → 被挤出的 item 退回出发区', () => {
    // item-A 在 zone-1，item-B（未放置）拖入 zone-1 → item-A 退回出发区
    const map = { 'item-A': 'zone-1' }
    const result = applyDrop(map, 'item-B', 'zone-1')
    expect(result).toEqual({ 'item-B': 'zone-1' })
    expect('item-A' in result!).toBe(false)
  })

  it('场景3：item 从 zone 拖回出发区 → map 删除该条（通过 applyUnplace）', () => {
    const map = { 'item-A': 'zone-1', 'item-B': 'zone-2' }
    const result = applyUnplace(map, 'item-A')
    expect(result).toEqual({ 'item-B': 'zone-2' })
    expect('item-A' in result).toBe(false)
  })

  it('场景4：item 已在目标 zone，再次 drop → 返回 null（不 emit）', () => {
    const map = { 'item-A': 'zone-1' }
    const result = applyDrop(map, 'item-A', 'zone-1')
    expect(result).toBeNull()
  })
})

describe('applyUnplace', () => {
  it('场景5：删除不存在的 item → map 不变，无副作用', () => {
    const map = { 'item-A': 'zone-1' }
    const result = applyUnplace(map, 'item-X')
    expect(result).toEqual({ 'item-A': 'zone-1' })
    expect(result).not.toBe(map)
  })
})
