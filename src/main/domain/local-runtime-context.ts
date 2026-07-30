import { createHash } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../db/interface'
import type { AcceptedCommandContext } from '../application/command/command-types'

export interface LocalRuntimeContext {
  organizationId: string
  nodeId: string
  deviceId: string
  deviceRuntimeSessionId: string
  teacherAuthSessionId: string
}

export interface LocalRuntimeContextPlan {
  readonly schema_version: 'local-runtime-context-plan-v2'
  readonly context: LocalRuntimeContext
  readonly organization: Readonly<{
    organization_id: string
    name: string
    type: 'SCHOOL' | 'CENTER' | 'DISTRICT'
    status: 'ACTIVE'
  }>
  readonly node: Readonly<{
    node_id: string
    organization_id: string
    node_name: string
    node_type: 'ELECTRON_KIOSK' | 'STANDALONE_SERVER' | 'CLOUD'
    status: 'ACTIVE'
  }>
  readonly device: Readonly<{
    device_id: string
    node_id: string
    device_name: string
    device_role: 'STUDENT_WORKSTATION' | 'TEACHER_TABLET' | 'ADMIN_TERMINAL' | 'HYBRID'
    credential_hash: string | null
    trust_state: 'PENDING' | 'TRUSTED' | 'REVOKED'
    is_kiosk_enabled: boolean
    allows_self_login: boolean
    capabilities: readonly string[] | null
    last_heartbeat_at: string | null
    status: 'ACTIVE'
  }>
  readonly runtime: Readonly<{
    device_runtime_session_id: string
    device_id: string
    started_at: string
    last_heartbeat_at: string
    client_version: string | null
    status: 'ACTIVE'
  }>
  readonly auth_session: Readonly<{
    auth_session_id: string
    user_id: string
    device_runtime_session_id: string
    auth_method: 'DEVICE_KEY'
    capabilities: readonly string[]
    token_hash: string
    refresh_token_hash: string | null
    issued_at: string
    expires_at: string
    last_activity_at: string
    status: 'ACTIVE'
  }>
}

export interface LocalRuntimePlanOptions {
  readonly deviceRuntimeSessionId?: string
  readonly requireExistingAuth?: boolean
  readonly generateId?: (kind: LocalRuntimePlanIdentity) => string
  readonly timestamp?: string
  readonly expiresAt?: string
}

export type LocalRuntimePlanIdentity =
  | 'organization'
  | 'node'
  | 'device'
  | 'device-runtime-session'
  | 'auth-session'
  | 'token-seed'
  | 'refresh-token-seed'

interface CallerRow {
  user_id: string
  role: string
  status: string
}

interface RuntimeTopologyRow {
  organization_id: string
  organization_name: string
  organization_type: 'SCHOOL' | 'CENTER' | 'DISTRICT'
  organization_status: 'ACTIVE'
  node_id: string
  node_name: string
  node_type: 'ELECTRON_KIOSK' | 'STANDALONE_SERVER' | 'CLOUD'
  node_status: 'ACTIVE'
  device_id: string
  device_name: string
  device_role: 'STUDENT_WORKSTATION' | 'TEACHER_TABLET' | 'ADMIN_TERMINAL' | 'HYBRID'
  credential_hash: string | null
  trust_state: 'PENDING' | 'TRUSTED' | 'REVOKED'
  is_kiosk_enabled: number
  allows_self_login: number
  capabilities_json: string | null
  device_last_heartbeat_at: string | null
  device_status: 'ACTIVE'
  device_runtime_session_id: string
  started_at: string
  runtime_last_heartbeat_at: string
  client_version: string | null
  runtime_status: 'ACTIVE'
}

interface AuthSessionRow {
  auth_session_id: string
  user_id: string
  device_runtime_session_id: string
  auth_method: 'DEVICE_KEY'
  capabilities_json: string
  token_hash: string
  refresh_token_hash: string | null
  issued_at: string
  expires_at: string
  last_activity_at: string
  status: 'ACTIVE'
}

export const LOCAL_RUNTIME_ASSIGNMENT_CHILD_CAPABILITY = Object.freeze({
  owner: 'local-runtime-context.ensureLocalRuntimeContext',
  parentCommandTypes: Object.freeze(['assignment:create', 'assignment:rebind'] as const),
  phase: 'RUNTIME_ACCEPTED_CHILD',
  actorRoles: Object.freeze(['TEACHER', 'ADMIN'] as const),
  correlationPolicy: 'INHERIT_PARENT' as const
})

function assertAcceptedAssignmentChild(
  context: AcceptedCommandContext,
  teacherUserId: string
): void {
  if (!context || typeof context !== 'object' || !('envelope' in context)) {
    throw new Error('local runtime requires accepted assignment child context')
  }
  const { envelope } = context
  if (!LOCAL_RUNTIME_ASSIGNMENT_CHILD_CAPABILITY.parentCommandTypes.some(
    (commandType) => commandType === envelope.commandType
  )) {
    throw new Error('local runtime requires accepted assignment:create or assignment:rebind parent')
  }
  if (!envelope.correlationId.trim()) {
    throw new Error('local runtime assignment child correlation must be non-empty')
  }
  const actor = envelope.actor
  if (
    actor.kind !== 'USER'
    || actor.userId !== teacherUserId
    || !LOCAL_RUNTIME_ASSIGNMENT_CHILD_CAPABILITY.actorRoles.some((role) => role === actor.role)
  ) {
    throw new Error('local runtime assignment child requires the accepted TEACHER or ADMIN actor')
  }
  const expectedAggregateType = envelope.commandType === 'assignment:create'
    ? 'BUSINESS_SESSION'
    : 'BUSINESS_SESSION_ASSIGNMENT'
  if (envelope.target.aggregate_type !== expectedAggregateType) {
    throw new Error('local runtime assignment child requires the authoritative assignment target')
  }
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function hashUuid(label: string, id: string): string {
  return createHash('sha256').update(`${label}:${id}`, 'utf8').digest('hex')
}

function exactTimestamp(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) {
    throw new Error(`local runtime ${field} must be an exact UTC timestamp`)
  }
  return value
}

function capabilities(value: string | null, field: string): readonly string[] | null {
  if (value === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`local runtime ${field} is invalid JSON`)
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`local runtime ${field} must be a string array`)
  }
  return Object.freeze([...parsed])
}

function assertActiveTeacherOrAdmin(db: DBAdapter, teacherUserId: string): void {
  const row = db
    .prepare('SELECT user_id, role, status FROM user_account WHERE user_id = ?')
    .get(teacherUserId) as CallerRow | undefined
  if (!row || row.status !== 'ACTIVE' || (row.role !== 'TEACHER' && row.role !== 'ADMIN')) {
    throw new Error(
      'ensureLocalRuntimeContext: teacherUserId must reference an ACTIVE TEACHER or ADMIN'
    )
  }
}

function findActiveRuntime(db: DBAdapter, deviceRuntimeSessionId?: string): RuntimeTopologyRow | undefined {
  const selected = deviceRuntimeSessionId
    ? 'AND drs.device_runtime_session_id = ?'
    : ''
  const query = `SELECT
      o.organization_id,
      o.name AS organization_name,
      o.type AS organization_type,
      o.status AS organization_status,
      n.node_id,
      n.node_name,
      n.node_type,
      n.status AS node_status,
      d.device_id,
      d.device_name,
      d.device_role,
      d.credential_hash,
      d.trust_state,
      d.is_kiosk_enabled,
      d.allows_self_login,
      d.capabilities_json,
      d.last_heartbeat_at AS device_last_heartbeat_at,
      d.status AS device_status,
      drs.device_runtime_session_id,
      drs.started_at,
      drs.last_heartbeat_at AS runtime_last_heartbeat_at,
      drs.client_version,
      drs.status AS runtime_status
    FROM device_runtime_session drs
    JOIN device d ON d.device_id = drs.device_id
    JOIN node n ON n.node_id = d.node_id
    JOIN organization o ON o.organization_id = n.organization_id
    WHERE drs.status = 'ACTIVE'
      AND d.status = 'ACTIVE'
      AND n.status = 'ACTIVE'
      AND o.status = 'ACTIVE'
      ${selected}
    ORDER BY drs.created_at ASC, drs.device_runtime_session_id ASC
    LIMIT 1`
  return (deviceRuntimeSessionId
    ? db.prepare(query).get(deviceRuntimeSessionId)
    : db.prepare(query).get()) as RuntimeTopologyRow | undefined
}

function findReusableAuthSession(
  db: DBAdapter,
  teacherUserId: string,
  deviceRuntimeSessionId: string
): AuthSessionRow | undefined {
  return db
    .prepare(
      `SELECT auth_session_id, user_id, device_runtime_session_id, auth_method, capabilities_json,
              token_hash, refresh_token_hash, issued_at, expires_at, last_activity_at, status
         FROM auth_session
        WHERE user_id = ?
          AND device_runtime_session_id = ?
          AND status = 'ACTIVE'
          AND expires_at > datetime('now')
        ORDER BY expires_at DESC, auth_session_id ASC
        LIMIT 1`
    )
    .get(teacherUserId, deviceRuntimeSessionId) as AuthSessionRow | undefined
}

function freshContextPlan(
  teacherUserId: string,
  options: LocalRuntimePlanOptions
): LocalRuntimeContextPlan {
  const generateId = options.generateId ?? (() => uuidv4())
  const timestamp = exactTimestamp(options.timestamp ?? new Date().toISOString(), 'timestamp')
  const expiresAt = exactTimestamp(
    options.expiresAt ?? new Date(new Date(timestamp).getTime() + 8 * 60 * 60 * 1000).toISOString(),
    'expires_at'
  )
  const organizationId = generateId('organization')
  const nodeId = generateId('node')
  const deviceId = generateId('device')
  const runtimeId = generateId('device-runtime-session')
  const authSessionId = generateId('auth-session')
  const tokenSeed = generateId('token-seed')
  const refreshTokenSeed = generateId('refresh-token-seed')
  return Object.freeze({
    schema_version: 'local-runtime-context-plan-v2',
    context: Object.freeze({
      organizationId,
      nodeId,
      deviceId,
      deviceRuntimeSessionId: runtimeId,
      teacherAuthSessionId: authSessionId
    }),
    organization: Object.freeze({
      organization_id: organizationId,
      name: `Local Organization ${shortId(organizationId)}`,
      type: 'SCHOOL',
      status: 'ACTIVE'
    }),
    node: Object.freeze({
      node_id: nodeId,
      organization_id: organizationId,
      node_name: `Local Node ${shortId(nodeId)}`,
      node_type: 'ELECTRON_KIOSK',
      status: 'ACTIVE'
    }),
    device: Object.freeze({
      device_id: deviceId,
      node_id: nodeId,
      device_name: `Local Device ${shortId(deviceId)}`,
      device_role: 'HYBRID',
      credential_hash: null,
      trust_state: 'TRUSTED',
      is_kiosk_enabled: false,
      allows_self_login: true,
      capabilities: Object.freeze(['LOCAL_ASSIGNMENT']),
      last_heartbeat_at: null,
      status: 'ACTIVE'
    }),
    runtime: Object.freeze({
      device_runtime_session_id: runtimeId,
      device_id: deviceId,
      started_at: timestamp,
      last_heartbeat_at: timestamp,
      client_version: null,
      status: 'ACTIVE'
    }),
    auth_session: Object.freeze({
      auth_session_id: authSessionId,
      user_id: teacherUserId,
      device_runtime_session_id: runtimeId,
      auth_method: 'DEVICE_KEY',
      capabilities: Object.freeze(['LOCAL_ASSIGNMENT']),
      token_hash: hashUuid('local-runtime-token', tokenSeed),
      refresh_token_hash: hashUuid('local-runtime-refresh', refreshTokenSeed),
      issued_at: timestamp,
      expires_at: expiresAt,
      last_activity_at: timestamp,
      status: 'ACTIVE'
    })
  })
}

function planForExistingRuntime(
  db: DBAdapter,
  teacherUserId: string,
  runtime: RuntimeTopologyRow,
  options: LocalRuntimePlanOptions
): LocalRuntimeContextPlan {
  const timestamp = exactTimestamp(options.timestamp ?? new Date().toISOString(), 'timestamp')
  const existingAuth = findReusableAuthSession(db, teacherUserId, runtime.device_runtime_session_id)
  if (options.requireExistingAuth && !existingAuth) {
    throw new Error('local runtime explicit device runtime has no active teacher auth session')
  }
  const generateId = options.generateId ?? (() => uuidv4())
  const expiresAt = exactTimestamp(
    options.expiresAt ?? new Date(new Date(timestamp).getTime() + 8 * 60 * 60 * 1000).toISOString(),
    'expires_at'
  )
  const auth = existingAuth
    ? Object.freeze({
      auth_session_id: existingAuth.auth_session_id,
      user_id: existingAuth.user_id,
      device_runtime_session_id: existingAuth.device_runtime_session_id,
      auth_method: existingAuth.auth_method,
      capabilities: capabilities(existingAuth.capabilities_json, 'auth.capabilities_json') ?? Object.freeze([]),
      token_hash: existingAuth.token_hash,
      refresh_token_hash: existingAuth.refresh_token_hash,
      issued_at: existingAuth.issued_at,
      expires_at: existingAuth.expires_at,
      last_activity_at: existingAuth.last_activity_at,
      status: existingAuth.status
    })
    : Object.freeze({
      auth_session_id: generateId('auth-session'),
      user_id: teacherUserId,
      device_runtime_session_id: runtime.device_runtime_session_id,
      auth_method: 'DEVICE_KEY' as const,
      capabilities: Object.freeze(['LOCAL_ASSIGNMENT']),
      token_hash: hashUuid('local-runtime-token', generateId('token-seed')),
      refresh_token_hash: hashUuid('local-runtime-refresh', generateId('refresh-token-seed')),
      issued_at: timestamp,
      expires_at: expiresAt,
      last_activity_at: timestamp,
      status: 'ACTIVE' as const
    })
  return Object.freeze({
    schema_version: 'local-runtime-context-plan-v2',
    context: Object.freeze({
      organizationId: runtime.organization_id,
      nodeId: runtime.node_id,
      deviceId: runtime.device_id,
      deviceRuntimeSessionId: runtime.device_runtime_session_id,
      teacherAuthSessionId: auth.auth_session_id
    }),
    organization: Object.freeze({
      organization_id: runtime.organization_id,
      name: runtime.organization_name,
      type: runtime.organization_type,
      status: runtime.organization_status
    }),
    node: Object.freeze({
      node_id: runtime.node_id,
      organization_id: runtime.organization_id,
      node_name: runtime.node_name,
      node_type: runtime.node_type,
      status: runtime.node_status
    }),
    device: Object.freeze({
      device_id: runtime.device_id,
      node_id: runtime.node_id,
      device_name: runtime.device_name,
      device_role: runtime.device_role,
      credential_hash: runtime.credential_hash,
      trust_state: runtime.trust_state,
      is_kiosk_enabled: runtime.is_kiosk_enabled === 1,
      allows_self_login: runtime.allows_self_login === 1,
      capabilities: capabilities(runtime.capabilities_json, 'device.capabilities_json'),
      last_heartbeat_at: runtime.device_last_heartbeat_at,
      status: runtime.device_status
    }),
    runtime: Object.freeze({
      device_runtime_session_id: runtime.device_runtime_session_id,
      device_id: runtime.device_id,
      started_at: runtime.started_at,
      last_heartbeat_at: runtime.runtime_last_heartbeat_at,
      client_version: runtime.client_version,
      status: runtime.runtime_status
    }),
    auth_session: auth
  })
}

export function planLocalRuntimeContext(
  db: DBAdapter,
  teacherUserId: string,
  context: AcceptedCommandContext,
  options: LocalRuntimePlanOptions = {}
): LocalRuntimeContextPlan {
  assertAcceptedAssignmentChild(context, teacherUserId)
  assertActiveTeacherOrAdmin(db, teacherUserId)
  const runtime = findActiveRuntime(db, options.deviceRuntimeSessionId)
  if (options.deviceRuntimeSessionId && !runtime) {
    throw new Error('local runtime explicit device runtime session is not active')
  }
  return runtime
    ? planForExistingRuntime(db, teacherUserId, runtime, options)
    : freshContextPlan(teacherUserId, options)
}

function sameJsonArray(left: readonly string[] | null, right: string | null, field: string): boolean {
  const parsed = capabilities(right, field)
  return JSON.stringify(left) === JSON.stringify(parsed)
}

function assertExisting(row: Record<string, unknown> | undefined, expected: Readonly<Record<string, unknown>>, label: string): void {
  if (!row) return
  for (const [field, value] of Object.entries(expected)) {
    if (row[field] !== value) throw new Error(`local runtime ${label} identity conflict at ${field}`)
  }
}

export function applyLocalRuntimeContextPlan(db: DBAdapter, plan: LocalRuntimeContextPlan): LocalRuntimeContext {
  if (plan.schema_version !== 'local-runtime-context-plan-v2') throw new Error('local runtime plan schema mismatch')
  const organization = db.prepare(
    'SELECT organization_id, name, type, status FROM organization WHERE organization_id = ?'
  ).get(plan.organization.organization_id) as Record<string, unknown> | undefined
  if (!organization) {
    db.prepare('INSERT INTO organization (organization_id, name, type, status) VALUES (?, ?, ?, ?)').run(
      plan.organization.organization_id, plan.organization.name, plan.organization.type, plan.organization.status
    )
  } else {
    assertExisting(organization, plan.organization, 'organization')
  }

  const node = db.prepare(
    'SELECT node_id, organization_id, node_name, node_type, status FROM node WHERE node_id = ?'
  ).get(plan.node.node_id) as Record<string, unknown> | undefined
  if (!node) {
    db.prepare('INSERT INTO node (node_id, organization_id, node_name, node_type, status) VALUES (?, ?, ?, ?, ?)').run(
      plan.node.node_id, plan.node.organization_id, plan.node.node_name, plan.node.node_type, plan.node.status
    )
  } else {
    assertExisting(node, plan.node, 'node')
  }

  const device = db.prepare(
    `SELECT device_id, node_id, device_name, device_role, credential_hash, trust_state,
            is_kiosk_enabled, allows_self_login, capabilities_json, last_heartbeat_at, status
       FROM device WHERE device_id = ?`
  ).get(plan.device.device_id) as Record<string, unknown> | undefined
  if (!device) {
    db.prepare(
      `INSERT INTO device
         (device_id, node_id, device_name, device_role, credential_hash, trust_state,
          is_kiosk_enabled, allows_self_login, capabilities_json, last_heartbeat_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      plan.device.device_id, plan.device.node_id, plan.device.device_name, plan.device.device_role,
      plan.device.credential_hash, plan.device.trust_state, plan.device.is_kiosk_enabled ? 1 : 0,
      plan.device.allows_self_login ? 1 : 0,
      plan.device.capabilities === null ? null : JSON.stringify(plan.device.capabilities),
      plan.device.last_heartbeat_at, plan.device.status
    )
  } else {
    assertExisting(device, {
      device_id: plan.device.device_id,
      node_id: plan.device.node_id,
      device_name: plan.device.device_name,
      device_role: plan.device.device_role,
      credential_hash: plan.device.credential_hash,
      trust_state: plan.device.trust_state,
      is_kiosk_enabled: plan.device.is_kiosk_enabled ? 1 : 0,
      allows_self_login: plan.device.allows_self_login ? 1 : 0,
      last_heartbeat_at: plan.device.last_heartbeat_at,
      status: plan.device.status
    }, 'device')
    if (!sameJsonArray(plan.device.capabilities, device.capabilities_json as string | null, 'device.capabilities_json')) {
      throw new Error('local runtime device identity conflict at capabilities_json')
    }
  }

  const runtime = db.prepare(
    `SELECT device_runtime_session_id, device_id, started_at, last_heartbeat_at, client_version, status
       FROM device_runtime_session WHERE device_runtime_session_id = ?`
  ).get(plan.runtime.device_runtime_session_id) as Record<string, unknown> | undefined
  if (!runtime) {
    db.prepare(
      `INSERT INTO device_runtime_session
         (device_runtime_session_id, device_id, started_at, last_heartbeat_at, client_version, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      plan.runtime.device_runtime_session_id, plan.runtime.device_id, plan.runtime.started_at,
      plan.runtime.last_heartbeat_at, plan.runtime.client_version, plan.runtime.status
    )
  } else {
    assertExisting(runtime, plan.runtime, 'device runtime session')
  }

  const auth = db.prepare(
    `SELECT auth_session_id, user_id, device_runtime_session_id, auth_method, capabilities_json,
            token_hash, refresh_token_hash, issued_at, expires_at, last_activity_at, status
       FROM auth_session WHERE auth_session_id = ?`
  ).get(plan.auth_session.auth_session_id) as Record<string, unknown> | undefined
  if (!auth) {
    db.prepare(
      `INSERT INTO auth_session
         (auth_session_id, user_id, device_runtime_session_id, auth_method, capabilities_json,
          token_hash, refresh_token_hash, issued_at, expires_at, last_activity_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      plan.auth_session.auth_session_id, plan.auth_session.user_id, plan.auth_session.device_runtime_session_id,
      plan.auth_session.auth_method, JSON.stringify(plan.auth_session.capabilities), plan.auth_session.token_hash,
      plan.auth_session.refresh_token_hash, plan.auth_session.issued_at, plan.auth_session.expires_at,
      plan.auth_session.last_activity_at, plan.auth_session.status
    )
  } else {
    assertExisting(auth, {
      auth_session_id: plan.auth_session.auth_session_id,
      user_id: plan.auth_session.user_id,
      device_runtime_session_id: plan.auth_session.device_runtime_session_id,
      auth_method: plan.auth_session.auth_method,
      token_hash: plan.auth_session.token_hash,
      refresh_token_hash: plan.auth_session.refresh_token_hash,
      issued_at: plan.auth_session.issued_at,
      expires_at: plan.auth_session.expires_at,
      last_activity_at: plan.auth_session.last_activity_at,
      status: plan.auth_session.status
    }, 'auth session')
    if (!sameJsonArray(plan.auth_session.capabilities, auth.capabilities_json as string | null, 'auth.capabilities_json')) {
      throw new Error('local runtime auth session identity conflict at capabilities_json')
    }
  }
  return plan.context
}

export function ensureLocalRuntimeContext(
  db: DBAdapter,
  teacherUserId: string,
  context: AcceptedCommandContext
): LocalRuntimeContext {
  const tx = db.transaction(() => applyLocalRuntimeContextPlan(
    db,
    planLocalRuntimeContext(db, teacherUserId, context)
  ))
  return tx()
}
