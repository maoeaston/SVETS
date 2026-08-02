import { randomUUID } from 'crypto'
import { DurableFileCapability } from '../domain/event-batch/file-capability'
import type {
  ActivationErrorCode,
  ActivationOperationResult,
  ActivationSnapshot,
  ActivationStatus
} from '../../shared/types/activation'

const STATE_FILE = 'activation-state.json'
const REQUEST_TIMEOUT_MS = 8_000

interface StoredActivationState {
  schemaVersion: 1
  installationId: string
  serverUrl: string
  token: string | null
  organizationName: string | null
  validUntil: string | null
  lastVerifiedAt: string | null
}

interface ActivationHttpResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

export type ActivationFetch = (
  url: string,
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: string
    signal: AbortSignal
  }
) => Promise<ActivationHttpResponse>

export interface ActivationServiceOptions {
  storageRoot: string
  initialServerUrl: string
  appVersion: string
  questionBankVersion: string
  packaged: boolean
  fetch?: ActivationFetch
  now?: () => Date
  createInstallationId?: () => string
  requestTimeoutMs?: number
}

export interface ActivationServicePort {
  initialize(): Promise<void>
  getStatus(): Promise<ActivationSnapshot>
  configureServer(serverUrl: string): Promise<ActivationOperationResult>
  activate(licenseKey: string): Promise<ActivationOperationResult>
  validate(): Promise<ActivationOperationResult>
  assertBusinessAccess(): Promise<void>
}

export class ActivationRequiredError extends Error {
  readonly code = 'ACTIVATION_REQUIRED'

  constructor() {
    super('ACTIVATION_REQUIRED')
    this.name = 'ActivationRequiredError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function parseStoredState(value: unknown): StoredActivationState | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  if (typeof value.installationId !== 'string' || value.installationId.length < 8) return null
  if (typeof value.serverUrl !== 'string') return null
  if (!isOptionalString(value.token) || !isOptionalString(value.organizationName)) return null
  if (value.validUntil !== null && !isIsoDate(value.validUntil)) return null
  if (value.lastVerifiedAt !== null && !isIsoDate(value.lastVerifiedAt)) return null
  return {
    schemaVersion: 1,
    installationId: value.installationId,
    serverUrl: value.serverUrl,
    token: value.token,
    organizationName: value.organizationName,
    validUntil: value.validUntil,
    lastVerifiedAt: value.lastVerifiedAt
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

export function normalizeActivationServerUrl(rawUrl: string, packaged: boolean): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) throw new ActivationInputError('INVALID_SERVER_URL')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new ActivationInputError('INVALID_SERVER_URL')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ActivationInputError('INVALID_SERVER_URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ActivationInputError('INVALID_SERVER_URL')
  }
  if (packaged && parsed.protocol !== 'https:') throw new ActivationInputError('INVALID_SERVER_URL')
  if (!packaged && parsed.protocol === 'http:' && !isLoopback(parsed.hostname)) {
    throw new ActivationInputError('INVALID_SERVER_URL')
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.toString().replace(/\/$/, '')
}

class ActivationInputError extends Error {
  constructor(readonly code: ActivationErrorCode) {
    super(code)
  }
}

class ActivationRemoteError extends Error {
  constructor(readonly code: 'SERVER_UNAVAILABLE' | 'INVALID_RESPONSE') {
    super(code)
  }
}

export class ActivationService implements ActivationServicePort {
  private state: StoredActivationState
  private status: ActivationStatus = 'NOT_ACTIVATED'
  private queue: Promise<void> = Promise.resolve()
  private initialized = false
  private readonly now: () => Date
  private readonly fetchImpl: ActivationFetch
  private readonly createInstallationId: () => string
  private readonly requestTimeoutMs: number
  private capability: DurableFileCapability | null = null

  constructor(private readonly options: ActivationServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as ActivationFetch)
    this.createInstallationId = options.createInstallationId ?? randomUUID
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
    this.state = this.newState(this.initialServerUrl())
  }

  initialize(): Promise<void> {
    return this.enqueue(async () => {
      if (this.initialized) return
      try {
        this.ensureCapability()
        const stored = this.readState()
        if (stored) {
          this.state = stored
          this.status = this.hasValidCache() ? 'ACTIVE_CACHED' : stored.token ? 'EXPIRED' : 'NOT_ACTIVATED'
        } else {
          this.persistState()
        }
        this.initialized = true
        if (this.state.token) await this.validateInternal()
      } catch {
        this.status = 'STORAGE_ERROR'
        this.initialized = true
      }
    })
  }

  async getStatus(): Promise<ActivationSnapshot> {
    await this.queue
    return this.snapshot()
  }

  configureServer(serverUrl: string): Promise<ActivationOperationResult> {
    return this.enqueue(async () => {
      try {
        const normalized = normalizeActivationServerUrl(serverUrl, this.options.packaged)
        if (normalized !== this.state.serverUrl) {
          this.state = {
            ...this.state,
            serverUrl: normalized,
            token: null,
            organizationName: null,
            validUntil: null,
            lastVerifiedAt: null
          }
          this.status = 'NOT_ACTIVATED'
        }
        this.ensureCapability()
        this.persistState()
        return { success: true, snapshot: this.snapshot() }
      } catch (error) {
        const errorCode = error instanceof ActivationInputError ? error.code : 'STORAGE_ERROR'
        if (errorCode === 'STORAGE_ERROR') this.status = 'STORAGE_ERROR'
        return { success: false, errorCode, snapshot: this.snapshot() }
      }
    })
  }

  activate(licenseKey: string): Promise<ActivationOperationResult> {
    return this.enqueue(async () => {
      const normalizedKey = licenseKey.trim()
      if (!normalizedKey || normalizedKey.length > 512) {
        return this.failure('INVALID_LICENSE_KEY')
      }
      if (!this.state.serverUrl) return this.failure('INVALID_SERVER_URL')

      try {
        const response = await this.post('/v1/activations', {
          licenseKey: normalizedKey,
          installationId: this.state.installationId,
          appVersion: this.options.appVersion
        })
        return this.applyActivationResponse(response)
      } catch (error) {
        return this.remoteFailure(error)
      }
    })
  }

  validate(): Promise<ActivationOperationResult> {
    return this.enqueue(() => this.validateInternal())
  }

  async assertBusinessAccess(): Promise<void> {
    await this.queue
    if (!this.snapshot().activated) throw new ActivationRequiredError()
  }

  private async validateInternal(): Promise<ActivationOperationResult> {
    if (!this.state.token || !this.state.serverUrl) return this.failure('ACTIVATION_REQUIRED')
    try {
      const response = await this.post('/v1/activations/validate', {
        token: this.state.token,
        installationId: this.state.installationId,
        appVersion: this.options.appVersion
      })
      return this.applyValidationResponse(response)
    } catch (error) {
      return this.remoteFailure(error)
    }
  }

  private applyActivationResponse(response: unknown): ActivationOperationResult {
    if (!isRecord(response) || response.installationId !== this.state.installationId) {
      return this.remoteFailure(new ActivationRemoteError('INVALID_RESPONSE'))
    }
    const status = response.status
    if (status === 'ACTIVE') {
      if (
        typeof response.token !== 'string'
        || response.token.length < 16
        || typeof response.organizationName !== 'string'
        || !response.organizationName.trim()
        || !isIsoDate(response.validUntil)
        || Date.parse(response.validUntil) <= this.now().getTime()
      ) return this.remoteFailure(new ActivationRemoteError('INVALID_RESPONSE'))
      this.state = {
        ...this.state,
        token: response.token,
        organizationName: response.organizationName.trim(),
        validUntil: response.validUntil,
        lastVerifiedAt: this.now().toISOString()
      }
      this.status = 'ACTIVE'
      return this.persistResult()
    }
    return this.applyConfirmedFailure(status)
  }

  private applyValidationResponse(response: unknown): ActivationOperationResult {
    if (!isRecord(response) || response.installationId !== this.state.installationId) {
      return this.remoteFailure(new ActivationRemoteError('INVALID_RESPONSE'))
    }
    if (response.status === 'ACTIVE') {
      if (
        typeof response.organizationName !== 'string'
        || !response.organizationName.trim()
        || !isIsoDate(response.validUntil)
        || Date.parse(response.validUntil) <= this.now().getTime()
      ) return this.remoteFailure(new ActivationRemoteError('INVALID_RESPONSE'))
      this.state = {
        ...this.state,
        organizationName: response.organizationName.trim(),
        validUntil: response.validUntil,
        lastVerifiedAt: this.now().toISOString()
      }
      this.status = 'ACTIVE'
      return this.persistResult()
    }
    return this.applyConfirmedFailure(response.status)
  }

  private applyConfirmedFailure(status: unknown): ActivationOperationResult {
    const errorCode = status === 'INVALID_LICENSE'
      ? 'INVALID_LICENSE'
      : status === 'EXPIRED'
        ? 'EXPIRED'
        : status === 'DEVICE_LIMIT'
          ? 'DEVICE_LIMIT'
          : null
    if (!errorCode) return this.remoteFailure(new ActivationRemoteError('INVALID_RESPONSE'))

    if (this.snapshot().activated) return this.failure(errorCode)
    this.state = {
      ...this.state,
      token: null,
      organizationName: null,
      validUntil: null,
      lastVerifiedAt: this.now().toISOString()
    }
    this.status = errorCode
    const persisted = this.persistResult()
    return persisted.success ? this.failure(errorCode) : persisted
  }

  private persistResult(): ActivationOperationResult {
    try {
      this.ensureCapability()
      this.persistState()
      return { success: true, snapshot: this.snapshot() }
    } catch {
      this.status = 'STORAGE_ERROR'
      return this.failure('STORAGE_ERROR')
    }
  }

  private remoteFailure(error: unknown): ActivationOperationResult {
    const errorCode = error instanceof ActivationRemoteError ? error.code : 'SERVER_UNAVAILABLE'
    if (this.hasValidCache()) {
      this.status = 'ACTIVE_CACHED'
      return { success: true, snapshot: this.snapshot() }
    }
    this.status = 'SERVER_UNAVAILABLE'
    return this.failure(errorCode)
  }

  private failure(errorCode: ActivationErrorCode): ActivationOperationResult {
    return { success: false, errorCode, snapshot: this.snapshot() }
  }

  private snapshot(): ActivationSnapshot {
    const activated = (this.status === 'ACTIVE' || this.status === 'ACTIVE_CACHED') && this.hasValidCache()
    return Object.freeze({
      activated,
      status: this.status,
      serverUrl: this.state.serverUrl,
      organizationName: activated ? this.state.organizationName : null,
      validUntil: activated ? this.state.validUntil : null,
      lastVerifiedAt: this.state.lastVerifiedAt,
      appVersion: this.options.appVersion,
      questionBankVersion: this.options.questionBankVersion
    })
  }

  private hasValidCache(): boolean {
    return Boolean(
      this.state.token
      && this.state.validUntil
      && Date.parse(this.state.validUntil) > this.now().getTime()
    )
  }

  private initialServerUrl(): string {
    if (!this.options.initialServerUrl.trim()) return ''
    try {
      return normalizeActivationServerUrl(this.options.initialServerUrl, this.options.packaged)
    } catch {
      return ''
    }
  }

  private newState(serverUrl: string): StoredActivationState {
    return {
      schemaVersion: 1,
      installationId: this.createInstallationId(),
      serverUrl,
      token: null,
      organizationName: null,
      validUntil: null,
      lastVerifiedAt: null
    }
  }

  private ensureCapability(): void {
    if (!this.capability) this.capability = new DurableFileCapability(this.options.storageRoot)
  }

  private readState(): StoredActivationState | null {
    const snapshot = this.capability?.readStable(STATE_FILE)
    if (!snapshot) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(snapshot.bytes.toString('utf8'))
    } catch {
      throw new Error('activation state is not valid JSON')
    }
    const state = parseStoredState(parsed)
    if (!state) throw new Error('activation state schema is invalid')
    if (state.serverUrl) normalizeActivationServerUrl(state.serverUrl, this.options.packaged)
    return state
  }

  private persistState(): void {
    if (!this.capability) throw new Error('activation storage is unavailable')
    const existing = this.capability.readStable(STATE_FILE)
    const temp = `.activation-state-${randomUUID()}.tmp`
    const bytes = Buffer.from(`${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
    const handle = this.capability.createExclusive(temp, bytes)
    this.capability.close(handle)
    try {
      this.capability.atomicReplace(temp, STATE_FILE, existing?.identity)
    } catch (error) {
      try {
        this.capability.removeFile(temp)
      } catch {
        // Atomic replace may already have consumed the temporary file.
      }
      throw error
    }
  }

  private async post(pathname: string, body: Record<string, string>): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    try {
      const response = await this.fetchImpl(`${this.state.serverUrl}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      const text = await response.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new ActivationRemoteError('INVALID_RESPONSE')
      }
      if (!response.ok && !isRecord(parsed)) throw new ActivationRemoteError('INVALID_RESPONSE')
      return parsed
    } catch (error) {
      if (error instanceof ActivationRemoteError) throw error
      throw new ActivationRemoteError('SERVER_UNAVAILABLE')
    } finally {
      clearTimeout(timeout)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}
