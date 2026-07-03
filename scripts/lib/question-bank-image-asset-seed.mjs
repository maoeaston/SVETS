import { join } from 'node:path'

const REQUIRED_COLUMNS = [
  'asset_id',
  'asset_type',
  'asset_role',
  'app_uri',
  'local_path',
  'mime_type',
  'file_hash',
  'file_size_bytes',
  'width_px',
  'height_px',
  'status',
  'target_question_type',
  'attach_field',
  'current_status',
  'notes'
]

const PLACEHOLDER_PATTERN = /__TODO_/i

function sqlStr(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function parsePositiveInt(value, fieldName, assetId) {
  const n = Number.parseInt(String(value), 10)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`[asset-seed] ${assetId} ${fieldName} must be a non-negative integer, got ${JSON.stringify(value)}`)
  }
  return n
}

export function parseAssetSeedTsv(tsvText) {
  const lines = tsvText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')

  if (lines.length < 2) {
    throw new Error('[asset-seed] TSV must contain header and at least one data row')
  }

  const header = lines[0].split('\t')
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) {
      throw new Error(`[asset-seed] missing required column: ${col}`)
    }
  }

  return lines.slice(1).map((line, idx) => {
    const values = line.split('\t')
    if (values.length !== header.length) {
      throw new Error(
        `[asset-seed] line ${idx + 2} column count mismatch: expected ${header.length}, got ${values.length}`
      )
    }

    return Object.fromEntries(header.map((col, i) => [col, values[i]]))
  })
}

export function validateAssetSeedRows(rows) {
  const seenAssetIds = new Set()
  const seenUris = new Set()

  for (const row of rows) {
    const assetId = row.asset_id
    if (!assetId) throw new Error('[asset-seed] asset_id is required')

    if (seenAssetIds.has(assetId)) {
      throw new Error(`[asset-seed] duplicate asset_id: ${assetId}`)
    }
    seenAssetIds.add(assetId)

    if (seenUris.has(row.app_uri)) {
      throw new Error(`[asset-seed] duplicate app_uri: ${row.app_uri}`)
    }
    seenUris.add(row.app_uri)

    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'string' && PLACEHOLDER_PATTERN.test(value)) {
        throw new Error(`[asset-seed] ${assetId} field ${key} contains placeholder: ${value}`)
      }
    }

    if (row.asset_type !== 'IMAGE') {
      throw new Error(`[asset-seed] ${assetId} asset_type must be IMAGE, got ${row.asset_type}`)
    }
    if (row.asset_role !== 'QUESTION_MEDIA') {
      throw new Error(`[asset-seed] ${assetId} asset_role must be QUESTION_MEDIA, got ${row.asset_role}`)
    }
    if (row.status !== 'ACTIVE') {
      throw new Error(`[asset-seed] ${assetId} status must be ACTIVE, got ${row.status}`)
    }
    if (row.mime_type !== 'image/png') {
      throw new Error(`[asset-seed] ${assetId} mime_type must be image/png, got ${row.mime_type}`)
    }

    parsePositiveInt(row.file_size_bytes, 'file_size_bytes', assetId)
    parsePositiveInt(row.width_px, 'width_px', assetId)
    parsePositiveInt(row.height_px, 'height_px', assetId)

    if (
      assetId.startsWith('asset_img_drg_obj02_goods_pack_') &&
      row.attach_field === 'content_json.drag_items[].image_asset_id' &&
      row.current_status !== 'placeholder_only'
    ) {
      throw new Error(
        '[asset-seed] DRG-OBJ02 is an overview pack image; it must stay placeholder_only and cannot be treated as direct draggable item'
      )
    }
  }
}

export function buildAssetResourceUpsertSql(rows, isoTimestamp) {
  const valueTuples = rows.map((row) => {
    const fileSizeBytes = parsePositiveInt(row.file_size_bytes, 'file_size_bytes', row.asset_id)
    const widthPx = parsePositiveInt(row.width_px, 'width_px', row.asset_id)
    const heightPx = parsePositiveInt(row.height_px, 'height_px', row.asset_id)

    return `  (
    ${sqlStr(row.asset_id)},
    ${sqlStr(row.asset_type)},
    ${sqlStr(row.asset_role)},
    ${sqlStr(row.app_uri)},
    ${sqlStr(row.local_path)},
    ${sqlStr(row.mime_type)},
    ${sqlStr(row.file_hash)},
    ${fileSizeBytes},
    NULL,
    ${widthPx},
    ${heightPx},
    ${sqlStr(row.status)},
    ${sqlStr(isoTimestamp)}
  )`
  })

  return `INSERT INTO asset_resource (
  asset_id,
  asset_type,
  asset_role,
  app_uri,
  local_path,
  mime_type,
  file_hash,
  file_size_bytes,
  duration_ms,
  width_px,
  height_px,
  status,
  last_verified_at
) VALUES
${valueTuples.join(',\n')}
ON CONFLICT(asset_id) DO UPDATE SET
  asset_type = excluded.asset_type,
  asset_role = excluded.asset_role,
  app_uri = excluded.app_uri,
  local_path = excluded.local_path,
  mime_type = excluded.mime_type,
  file_hash = excluded.file_hash,
  file_size_bytes = excluded.file_size_bytes,
  duration_ms = excluded.duration_ms,
  width_px = excluded.width_px,
  height_px = excluded.height_px,
  status = excluded.status,
  last_verified_at = excluded.last_verified_at,
  updated_at = datetime('now');`
}

export function resolveDefaultDbPath({ platform, homeDir, appName }) {
  if (platform === 'win32') {
    return join(homeDir, 'AppData', 'Roaming', appName, 'data', `${appName}.db`)
  }
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', appName, 'data', `${appName}.db`)
  }
  return join(homeDir, '.config', appName, 'data', `${appName}.db`)
}
