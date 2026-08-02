import { PREVIEW_CONTRACT_REGISTRY } from './preview-contract-registry'

const QUERY_DESCRIPTORS = [
  { query_name: 'preview:listSources', projection_name: 'preview_release_projection', allowed_roles: ['TEACHER', 'ADMIN'] as const },
  { query_name: 'preview:getRelease', projection_name: 'preview_release_projection', allowed_roles: ['TEACHER', 'ADMIN'] as const },
  { query_name: 'preview:getSession', projection_name: 'preview_session_projection', allowed_roles: ['STUDENT', 'TEACHER', 'ADMIN'] as const },
  { query_name: 'preview:listSessionQuestions', projection_name: 'preview_session_question_projection', allowed_roles: ['STUDENT', 'TEACHER', 'ADMIN'] as const },
  { query_name: 'feedback:list', projection_name: 'preview_feedback_reference_projection', allowed_roles: ['TEACHER', 'ADMIN'] as const },
  { query_name: 'feedback:get', projection_name: 'preview_feedback_reference_projection', allowed_roles: ['TEACHER', 'ADMIN'] as const }
] as const

export const PREVIEW_QUERY_NAMES = Object.freeze(QUERY_DESCRIPTORS.map((descriptor) => descriptor.query_name))

let registered = false

export function registerPreviewQueryContract(): void {
  if (registered) return
  registered = true
  for (const descriptor of QUERY_DESCRIPTORS) {
    PREVIEW_CONTRACT_REGISTRY.registerQuery({
      query_name: descriptor.query_name,
      projection_name: descriptor.projection_name,
      allowed_roles: descriptor.allowed_roles,
      includes_private_identity_map: false
    })
  }
}
