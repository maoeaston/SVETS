import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildJobSkillPhase4Contracts,
  buildJobSkillRuntimeRows,
  collectQuestionAssetReferences,
  verifyJobSkillPhase4Contracts
} from '../lib/job-skill-phase4-contract.mjs'

const root = resolve(import.meta.dirname, '../..')

describe('job skill shelver phase 4 runtime contract', () => {
  it('reconciles all 298 source questions with 11 review-only approved replacement versions', () => {
    const { authority, gate } = buildJobSkillPhase4Contracts({ root })

    expect(authority.summary).toEqual({
      source_total: 298,
      retained_total: 298,
      rejected_total: 0,
      pilot_pending_total: 24,
      approved_unchanged_total: 31,
      initial_rereview_passed_total: 21,
      preserved_without_semantic_change_total: 66,
      targeted_rereview_passed_total: 145,
      rejected_replacement_review_passed_total: 11
    })
    expect(authority.questions).toHaveLength(298)
    expect(new Set(authority.questions.map((question) => question.source_question_id)).size).toBe(298)
    expect(authority.questions.filter((question) => question.runtime_status === 'EXCLUDED_REJECTED')).toHaveLength(0)
    expect(authority.questions.filter((question) => question.runtime_status === 'DRAFT')).toHaveLength(298)
    expect(authority.questions.filter((question) => question.resolution === 'REJECTED_REPLACEMENT_REVIEW_PASSED')).toHaveLength(11)
    expect(gate.review_gate).toMatchObject({ targeted_total: 145, passed: 145, returned: 0 })
    expect(gate.replacement_review_gate).toMatchObject({ replacement_total: 11, passed: 11, returned: 0 })
  })

  it('keeps compilation open but activation and session creation closed while assets and Pilot are pending', () => {
    const { gate } = buildJobSkillPhase4Contracts({ root })

    expect(gate.status).toBe('BLOCKED_ASSET_DELIVERY_AND_PILOT_GATE')
    expect(gate.authority).toMatchObject({
      may_compile_draft_seed: true,
      may_generate_activation_sql: false,
      may_activate: false,
      may_create_session: false,
      phase_4_executed: true
    })
    expect(gate.asset_gate).toMatchObject({ total: 270, approved: 0, unresolved: 270 })
    expect(gate.blockers.map((blocker) => blocker.code)).toEqual([
      'PILOT_GATE_PENDING',
      'ASSET_DELIVERY_INCOMPLETE'
    ])
  })

  it('compiles exactly 298 current-version DRAFT rows and binds delivery references by source ID', () => {
    const rows = buildJobSkillRuntimeRows({ root })

    expect(rows).toHaveLength(298)
    expect(new Set(rows.map((row) => row.question_id)).size).toBe(298)
    expect(rows.every((row) => row.status === 'DRAFT')).toBe(true)
    expect(rows.find((row) => row.question_id === 'M2_OP_031_V6')?.version).toBe(6)
    expect(rows.some((row) => row.question_id === 'M2_OP_031_V5')).toBe(false)
    expect(rows.find((row) => row.question_id === 'M1_OP_042_V4')?.version).toBe(4)
    expect(rows.find((row) => row.question_id === 'M4_OP_043_V2')?.content_json.source.source_question_id).toBe('M4_OP_043')

    const bound = rows.filter((row) => collectQuestionAssetReferences(row).length > 0)
    expect(bound.length).toBeGreaterThan(0)
    expect(rows.find((row) => row.question_id === 'M1_TF_015_V2')?.media_asset_id)
      .toBe('asset_vid_a_01_m1_tf_015')
  })

  it('scans every runtime asset reference surface exactly once', () => {
    const refs = collectQuestionAssetReferences({
      media_asset_id: 'asset_media',
      tool_asset_ids_json: JSON.stringify(['asset_tool', 'asset_duplicate']),
      content_json: {
        presentation: { assets: [{ asset_id: 'asset_presentation' }] },
        interaction: {
          config: {
            options: [{ image_asset_id: 'asset_option' }],
            items: [{ image_asset_id: 'asset_item' }],
            zones: [{ image_asset_id: 'asset_zone' }]
          }
        },
        variants: [{ media_asset_id: 'asset_variant' }],
        administration: {
          script_asset_id: 'asset_script',
          sealed_config_asset_id: 'asset_sealed'
        },
        offline_setup: { asset_ids: ['asset_setup', 'asset_duplicate'] }
      }
    })

    expect(refs).toEqual([
      'asset_duplicate',
      'asset_item',
      'asset_media',
      'asset_option',
      'asset_presentation',
      'asset_script',
      'asset_sealed',
      'asset_setup',
      'asset_tool',
      'asset_variant',
      'asset_zone'
    ])
  })

  it('rebuilds deterministically and verifies committed artifacts byte-for-byte', () => {
    const built = buildJobSkillPhase4Contracts({ root })
    const verified = verifyJobSkillPhase4Contracts({ root })

    expect(verified).toEqual(built)
    expect(JSON.parse(readFileSync(resolve(root, 'doc/features/job-skill-shelver-runtime-authority-v1.json'), 'utf8')))
      .toEqual(built.authority)
    expect(JSON.parse(readFileSync(resolve(root, 'doc/features/job-skill-shelver-phase4-activation-gate-v1.json'), 'utf8')))
      .toEqual(built.gate)
  })
})
