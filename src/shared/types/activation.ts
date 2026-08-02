export const ACTIVATION_STATUSES = [
  'NOT_ACTIVATED',
  'ACTIVE',
  'ACTIVE_CACHED',
  'INVALID_LICENSE',
  'EXPIRED',
  'DEVICE_LIMIT',
  'SERVER_UNAVAILABLE',
  'STORAGE_ERROR'
] as const

export type ActivationStatus = typeof ACTIVATION_STATUSES[number]

export type ActivationErrorCode =
  | 'ACTIVATION_REQUIRED'
  | 'INVALID_SERVER_URL'
  | 'INVALID_LICENSE_KEY'
  | 'INVALID_LICENSE'
  | 'EXPIRED'
  | 'DEVICE_LIMIT'
  | 'SERVER_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'STORAGE_ERROR'

export interface ActivationSnapshot {
  activated: boolean
  status: ActivationStatus
  serverUrl: string
  organizationName: string | null
  validUntil: string | null
  lastVerifiedAt: string | null
  appVersion: string
  questionBankVersion: string
}

export interface ConfigureActivationServerParams {
  serverUrl: string
}

export interface ActivateInstallationParams {
  licenseKey: string
}

export type ActivationOperationResult =
  | { success: true; snapshot: ActivationSnapshot }
  | { success: false; errorCode: ActivationErrorCode; snapshot: ActivationSnapshot }
