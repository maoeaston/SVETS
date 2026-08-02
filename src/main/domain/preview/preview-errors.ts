import {
  PREVIEW_ERROR_CODES,
  type PreviewErrorCode
} from '../../../shared/types/preview-errors'

export { PREVIEW_ERROR_CODES, type PreviewErrorCode }

export class PreviewContractError extends Error {
  constructor(
    public readonly code: PreviewErrorCode,
    message: string,
    public readonly field?: string,
    public readonly cause?: unknown
  ) {
    super('[preview-contract] ' + code + ': ' + message + (field ? ' at ' + field : ''))
    this.name = 'PreviewContractError'
  }
}

export function previewErrorCode(error: unknown): PreviewErrorCode | null {
  return error instanceof PreviewContractError ? error.code : null
}
