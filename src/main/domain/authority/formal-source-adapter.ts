import type {
  PreviewPublishBinding,
  PreviewQuestionRef
} from '@shared/types/preview-contract'
import { PreviewContractError } from '../preview/preview-errors'
import { assertCanonicalReferenceSet } from '../preview/preview-canonical'

export interface FormalSourceAuthority {
  readonly source_namespace: 'official_publish_set'
  readonly bindings: readonly PreviewPublishBinding[]
  readonly authority_hash: string
}

export interface FormalSourceAdapterOptions {
  loadOfficialAuthority: () => FormalSourceAuthority
}

/**
 * Formal source access is deliberately a narrow adapter. It has no question
 * bank fallback and never reads preview projections or ACTIVE flags.
 */
export class FormalSourceAdapter {
  constructor(private readonly options: FormalSourceAdapterOptions) {}

  resolve(questionRef: PreviewQuestionRef): PreviewPublishBinding {
    const authority = this.options.loadOfficialAuthority()
    if (authority.source_namespace !== 'official_publish_set') {
      throw new PreviewContractError('PREVIEW_SOURCE_AUTHORITY_MISSING', 'official authority namespace is invalid')
    }
    const matches = authority.bindings.filter((binding) =>
      binding.delivery_mode === 'FORMAL_DEMO'
      && binding.source_ref.namespace === 'official_publish_set'
      && binding.question_ref.question_id === questionRef.question_id
      && binding.question_ref.question_version === questionRef.question_version
      && binding.question_ref.semantic_hash === questionRef.semantic_hash
      && binding.status === 'ACTIVE'
    )
    if (matches.length !== 1) throw new PreviewContractError('FORMAL_RELEASE_AUTHORITY_MISSING', 'formal source binding is missing or ambiguous')
    const binding = matches[0]
    assertCanonicalReferenceSet({
      source_ref: binding.source_ref,
      pack_ref: binding.pack_ref,
      strategy_ref: binding.strategy_ref,
      question_refs: [binding.question_ref],
      asset_refs: binding.asset_refs,
      renderer_refs: binding.renderer_refs,
      evidence_refs: binding.evidence_refs,
      manifest_ref: binding.manifest_ref,
      approval_ref: binding.approval_ref
    })
    return binding
  }

  resolveExact(questionRefs: readonly PreviewQuestionRef[]): readonly PreviewPublishBinding[] {
    return Object.freeze(questionRefs.map((questionRef) => this.resolve(questionRef)))
  }
}
