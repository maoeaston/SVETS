export type DragMap = Record<string, string>

/**
 * 将 itemId 放入 zoneId。
 * - 若 zone 已有其他 item，执行 swap（被挤出的 item 接管 itemId 原来的 zone，若无则退回出发区）。
 * - 若 item 已在目标 zone，返回 null（调用方不 emit）。
 */
export function applyDrop(map: DragMap, itemId: string, zoneId: string): DragMap | null {
  const prevItemInZone = Object.entries(map).find(([, z]) => z === zoneId)?.[0]
  if (prevItemInZone === itemId) return null

  const newMap = { ...map }
  const prevZoneOfItem = newMap[itemId]

  if (prevItemInZone) {
    if (prevZoneOfItem) {
      newMap[prevItemInZone] = prevZoneOfItem
    } else {
      delete newMap[prevItemInZone]
    }
  }
  newMap[itemId] = zoneId
  return newMap
}

/** 将 itemId 移回出发区（删除映射）。 */
export function applyUnplace(map: DragMap, itemId: string): DragMap {
  const newMap = { ...map }
  delete newMap[itemId]
  return newMap
}
