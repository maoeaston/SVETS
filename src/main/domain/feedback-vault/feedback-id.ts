import { randomUUID } from 'crypto'
import { PreviewContractError } from '../preview/preview-errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function createOpaqueFeedbackId(): string {
  return randomUUID()
}

export function assertOpaqueFeedbackId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', `${field} must be a CSPRNG UUID`, field)
  return value
}
