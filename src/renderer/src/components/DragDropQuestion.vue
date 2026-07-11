<template>
  <div class="dq-wrap">
    <p
      v-if="dragItems.length === 0"
      class="dq-empty"
    >
      题目配置错误，无商品数据
    </p>

    <template v-else>
      <!-- 货架区：drop zones，backgroundAssetId 存在时作背景图 -->
      <div
        class="dq-shelf"
        :style="backgroundAssetId
          ? { backgroundImage: `url('app://asset/${backgroundAssetId}')` }
          : undefined"
      >
        <div
          v-for="zone in dropZones"
          :key="zone.zoneId"
          class="dq-zone"
          :class="{ 'dq-zone--over': dragOverZone === zone.zoneId }"
          @dragover.prevent="dragOverZone = zone.zoneId"
          @dragleave="dragOverZone = null"
          @drop.prevent="onZoneDrop(zone.zoneId, $event)"
        >
          <!-- 已放置的商品（可再次拖走） -->
          <template v-if="zoneToItem[zone.zoneId]">
            <div
              class="dq-placed"
              :class="{ 'dq-item--dragging': draggingId === zoneToItem[zone.zoneId].itemId }"
              draggable="true"
              @dragstart="onDragStart(zoneToItem[zone.zoneId].itemId, $event)"
              @dragend="draggingId = null"
            >
              <img
                v-if="zoneToItem[zone.zoneId].imageAssetId && !imgErrors[zoneToItem[zone.zoneId].itemId]"
                :src="`app://asset/${zoneToItem[zone.zoneId].imageAssetId}`"
                :alt="zoneToItem[zone.zoneId].label"
                class="dq-img"
                @error="imgErrors[zoneToItem[zone.zoneId].itemId] = true"
              >
              <span class="dq-label">{{ zoneToItem[zone.zoneId].label }}</span>
            </div>
          </template>
          <!-- 空格位显示 zone label -->
          <span
            v-else
            class="dq-zone-label"
          >{{ zone.label }}</span>
        </div>
      </div>

      <!-- 商品出发区（未放置的商品） -->
      <div
        class="dq-source"
        :class="{ 'dq-source--over': dragOverZone === '__source__' }"
        @dragover.prevent="dragOverZone = '__source__'"
        @dragleave="dragOverZone = null"
        @drop.prevent="onSourceDrop($event)"
      >
        <div
          v-for="item in unplaced"
          :key="item.itemId"
          class="dq-item"
          :class="{ 'dq-item--dragging': draggingId === item.itemId }"
          draggable="true"
          @dragstart="onDragStart(item.itemId, $event)"
          @dragend="draggingId = null"
        >
          <img
            v-if="item.imageAssetId && !imgErrors[item.itemId]"
            :src="`app://asset/${item.imageAssetId}`"
            :alt="item.label"
            class="dq-img"
            @error="imgErrors[item.itemId] = true"
          >
          <span class="dq-label">{{ item.label }}</span>
        </div>
        <p
          v-if="unplaced.length === 0"
          class="dq-all-placed"
        >
          所有商品已放置
        </p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { applyDrop, applyUnplace } from './drag-drop-logic'

interface DragItem {
  itemId: string
  label: string
  imageAssetId?: string | null
}

interface DropZone {
  zoneId: string
  label: string
}

const props = defineProps<{
  dragItems: DragItem[]
  dropZones: DropZone[]
  backgroundAssetId?: string | null
  modelValue: Record<string, string>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>]
}>()

const draggingId = ref<string | null>(null)
const dragOverZone = ref<string | null>(null)
const imgErrors = reactive<Record<string, boolean>>({})

/** zoneId → 已放置的 DragItem（逆向索引，避免模板内 O(n) 查找） */
const zoneToItem = computed(() => {
  const m: Record<string, DragItem> = {}
  for (const [itemId, zoneId] of Object.entries(props.modelValue)) {
    const item = props.dragItems.find((i) => i.itemId === itemId)
    if (item) m[zoneId] = item
  }
  return m
})

const unplaced = computed(() => props.dragItems.filter((i) => !(i.itemId in props.modelValue)))

function onDragStart(itemId: string, e: DragEvent): void {
  e.dataTransfer!.setData('text/plain', itemId)
  e.dataTransfer!.effectAllowed = 'move'
  draggingId.value = itemId
}

function onZoneDrop(zoneId: string, e: DragEvent): void {
  dragOverZone.value = null
  draggingId.value = null
  const itemId = e.dataTransfer?.getData('text/plain')
  if (!itemId) return
  const result = applyDrop(props.modelValue, itemId, zoneId)
  if (result !== null) emit('update:modelValue', result)
}

function onSourceDrop(e: DragEvent): void {
  dragOverZone.value = null
  draggingId.value = null
  const itemId = e.dataTransfer?.getData('text/plain')
  if (!itemId) return
  if (itemId in props.modelValue) {
    emit('update:modelValue', applyUnplace(props.modelValue, itemId))
  }
}
</script>

<style scoped>
.dq-wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.dq-empty {
  color: #dc2626;
  font-size: 14px;
  padding: 12px;
  background: #fef2f2;
  border-radius: 6px;
}
/* 货架区 */
.dq-shelf {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 20px;
  min-height: 140px;
  border: 2px dashed #d1d5db;
  border-radius: 8px;
  background-color: #f9fafb;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}
/* drop zone 格位 */
.dq-zone {
  width: 100px;
  min-height: 100px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: border-color 0.15s, background 0.15s;
  cursor: default;
}
.dq-zone--over {
  border-color: #3b82f6;
  background: rgba(219, 234, 254, 0.9);
}
.dq-zone-label {
  font-size: 12px;
  color: #6b7280;
  text-align: center;
  padding: 4px;
}
/* 已放置的商品卡片（zone 内） */
.dq-placed {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: grab;
  width: 100%;
  padding: 4px;
}
.dq-placed:active {
  cursor: grabbing;
}
/* 商品出发区 */
.dq-source {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px;
  min-height: 80px;
  border: 2px dashed #d1d5db;
  border-radius: 8px;
  background: #fff;
  transition: border-color 0.15s, background 0.15s;
}
.dq-source--over {
  border-color: #3b82f6;
  background: #eff6ff;
}
.dq-all-placed {
  font-size: 13px;
  color: #6b7280;
  margin: auto;
}
/* 商品卡片 */
.dq-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 88px;
  padding: 8px 6px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  cursor: grab;
  transition: opacity 0.15s, box-shadow 0.15s;
}
.dq-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.dq-item:active {
  cursor: grabbing;
}
.dq-item--dragging {
  opacity: 0.4;
}
.dq-img {
  width: 64px;
  height: 64px;
  object-fit: contain;
  border-radius: 4px;
  background: #f3f4f6;
}
.dq-label {
  font-size: 12px;
  color: #374151;
  text-align: center;
  line-height: 1.3;
  word-break: break-all;
}
</style>
