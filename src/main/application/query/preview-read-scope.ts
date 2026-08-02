import type { DBAdapter } from '../../db/interface'
import {
  assertPrincipalMappingUsable,
  listPrincipalBindings
} from '../../domain/authority/principal-binding-service'
import {
  assertCanonicalReferenceSet,
  parsePreviewCanonicalJson
} from '../../domain/preview/preview-canonical'
import type { PreviewCanonicalReferenceSet } from '../../../shared/types/preview-contract'

type PreviewReadRole = 'STUDENT' | 'TEACHER' | 'ADMIN'

function resolveTeacherPreviewInstallationIds(
  database: DBAdapter,
  organizationId: string
): readonly string[] {
  const installationIds = new Set<string>()
  const rows = database.prepare(
    'SELECT references_json FROM preview_release_projection ORDER BY release_id'
  ).all() as Array<{ references_json?: unknown }>
  for (const row of rows) {
    if (typeof row.references_json !== 'string') continue
    try {
      const references = parsePreviewCanonicalJson(row.references_json) as unknown as PreviewCanonicalReferenceSet
      assertCanonicalReferenceSet(references)
      if (
        references.source_ref.namespace === 'preview_publish_set'
        && references.source_ref.delivery_mode === 'PREVIEW_ONLY'
        && references.source_ref.scope.organization_id === organizationId
      ) {
        installationIds.add(references.source_ref.scope.installation_id)
      }
    } catch {
      // The query handler validates each release again; an invalid row must not
      // expand a teacher's scope.
    }
  }
  return Object.freeze([...installationIds].sort())
}

/**
 * Resolve installation scope from the trusted user-to-principal projection.
 * Renderer fields and role labels never participate in this decision.
 */
export function resolveAuthorizedPreviewInstallationIds(
  database: DBAdapter,
  input: { userId: string; organizationId: string; role?: PreviewReadRole; now?: Date }
): readonly string[] {
  if (input.role === 'TEACHER') {
    return resolveTeacherPreviewInstallationIds(database, input.organizationId)
  }
  const now = input.now ?? new Date()
  const installationIds = new Set<string>()
  for (const binding of listPrincipalBindings(database)) {
    if (binding.user_id !== input.userId || binding.organization_id !== input.organizationId) continue
    try {
      assertPrincipalMappingUsable(binding, now)
    } catch {
      continue
    }
    installationIds.add(binding.target_installation_id)
  }
  return Object.freeze([...installationIds].sort())
}
