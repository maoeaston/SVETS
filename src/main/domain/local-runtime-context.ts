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

interface CallerRow {
  user_id: string
  role: string
  status: string
}

interface RuntimeRow {
  organization_id: string
  node_id: string
  device_id: string
  device_runtime_session_id: string
}

interface AuthSessionRow {
  auth_session_id: string
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

function findActiveRuntime(db: DBAdapter): RuntimeRow | undefined {
  return db
    .prepare(
      `SELECT
         o.organization_id,
         n.node_id,
         d.device_id,
         drs.device_runtime_session_id
       FROM device_runtime_session drs
       JOIN device d ON d.device_id = drs.device_id
       JOIN node n ON n.node_id = d.node_id
       JOIN organization o ON o.organization_id = n.organization_id
       WHERE drs.status = 'ACTIVE'
         AND d.status = 'ACTIVE'
         AND n.status = 'ACTIVE'
         AND o.status = 'ACTIVE'
       ORDER BY drs.created_at ASC, drs.device_runtime_session_id ASC
       LIMIT 1`
    )
    .get() as RuntimeRow | undefined
}

function createLocalRuntime(db: DBAdapter): RuntimeRow {
  const organizationId = uuidv4()
  const nodeId = uuidv4()
  const deviceId = uuidv4()
  const runtimeId = uuidv4()

  db.prepare('INSERT INTO organization (organization_id, name) VALUES (?, ?)').run(
    organizationId,
    `Local Organization ${shortId(organizationId)}`
  )
  db.prepare(
    `INSERT INTO node (node_id, organization_id, node_name, node_type)
     VALUES (?, ?, ?, 'ELECTRON_KIOSK')`
  ).run(nodeId, organizationId, `Local Node ${shortId(nodeId)}`)
  db.prepare(
    `INSERT INTO device
       (device_id, node_id, device_name, device_role, trust_state, capabilities_json)
     VALUES (?, ?, ?, 'HYBRID', 'TRUSTED', ?)`
  ).run(deviceId, nodeId, `Local Device ${shortId(deviceId)}`, JSON.stringify(['LOCAL_ASSIGNMENT']))
  db.prepare(
    `INSERT INTO device_runtime_session (device_runtime_session_id, device_id)
     VALUES (?, ?)`
  ).run(runtimeId, deviceId)

  return {
    organization_id: organizationId,
    node_id: nodeId,
    device_id: deviceId,
    device_runtime_session_id: runtimeId
  }
}

function findReusableAuthSession(
  db: DBAdapter,
  teacherUserId: string,
  deviceRuntimeSessionId: string
): AuthSessionRow | undefined {
  return db
    .prepare(
      `SELECT auth_session_id
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

function createDeviceKeyAuthSession(
  db: DBAdapter,
  teacherUserId: string,
  deviceRuntimeSessionId: string
): AuthSessionRow {
  const authSessionId = uuidv4()
  const tokenSeed = uuidv4()
  const refreshTokenSeed = uuidv4()

  db.prepare(
    `INSERT INTO auth_session
       (auth_session_id, user_id, device_runtime_session_id, auth_method, capabilities_json,
        token_hash, refresh_token_hash, expires_at, status)
     VALUES (?, ?, ?, 'DEVICE_KEY', ?, ?, ?, datetime('now', '+8 hours'), 'ACTIVE')`
  ).run(
    authSessionId,
    teacherUserId,
    deviceRuntimeSessionId,
    JSON.stringify(['LOCAL_ASSIGNMENT']),
    hashUuid('local-runtime-token', tokenSeed),
    hashUuid('local-runtime-refresh', refreshTokenSeed)
  )

  return { auth_session_id: authSessionId }
}

export function ensureLocalRuntimeContext(
  db: DBAdapter,
  teacherUserId: string,
  context: AcceptedCommandContext
): LocalRuntimeContext {
  assertAcceptedAssignmentChild(context, teacherUserId)
  const tx = db.transaction(() => {
    assertActiveTeacherOrAdmin(db, teacherUserId)
    const runtime = findActiveRuntime(db) ?? createLocalRuntime(db)
    const authSession =
      findReusableAuthSession(db, teacherUserId, runtime.device_runtime_session_id) ??
      createDeviceKeyAuthSession(db, teacherUserId, runtime.device_runtime_session_id)

    return {
      organizationId: runtime.organization_id,
      nodeId: runtime.node_id,
      deviceId: runtime.device_id,
      deviceRuntimeSessionId: runtime.device_runtime_session_id,
      teacherAuthSessionId: authSession.auth_session_id
    }
  })

  return tx()
}
