import { PreviewContractError } from '../preview/preview-errors'

const PII_PATTERNS = [
  { name: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { name: 'absolute-path', pattern: /(?:^|\s)(?:\/home\/|\/Users\/|[A-Z]:\\|\\\\)[^\s]+/i },
  { name: 'credential', pattern: /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]/i }
] as const

function scan(value: unknown, path: string, violations: string[]): void {
  if (typeof value === 'string') {
    for (const entry of PII_PATTERNS) if (entry.pattern.test(value)) violations.push(`${path}:${entry.name}`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => scan(child, `${path}[${index}]`, violations))
    return
  }
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) scan(child, `${path}.${key}`, violations)
}

export function scanFeedbackForPrivateData(value: unknown): void {
  const violations: string[] = []
  scan(value, '$', violations)
  if (violations.length > 0) throw new PreviewContractError('FEEDBACK_PRIVACY_VIOLATION', `feedback contains private data: ${violations.join(',')}`)
}
