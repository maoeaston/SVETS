import { describe, expect, it } from 'vitest'
import {
  buildBaseAbilityGate,
  loadBaseAbilityRowsFromSql
} from '../lib/base-ability-42plus8-gate.mjs'

const projectRoot = process.cwd()

describe('base ability 42+8 activation gate', () => {
  it('从 BASE_ABILITY 导入 SQL 读取 96 条候选题', async () => {
    const rows = await loadBaseAbilityRowsFromSql(projectRoot)
    expect(rows).toHaveLength(96)
    expect(rows.every((row) => row.bank_domain === 'BASE_ABILITY')).toBe(true)
    expect(rows.every((row) => row.job_module_code === null)).toBe(true)
  })

  it('确认 42+8 候选供给足够但激活仍关闭', async () => {
    const document = await buildBaseAbilityGate(projectRoot)

    const draftAuthorityGate = document.gates.find((gate) => gate.gate_id === 'draft_authority_42plus8')
    const reviewGate = document.gates.find((gate) => gate.gate_id === 'draft_contract_professional_review')
    expect(draftAuthorityGate).toMatchObject({ status: 'PASSED' })
    expect(draftAuthorityGate.details).toMatchObject({
      selected_total: 50,
      selected_online_total: 42,
      selected_offline_total: 8,
      deferred_total: 46,
      activation_authority_granted: false
    })
    expect(Object.values(draftAuthorityGate.details.online_by_module)).toEqual([7, 7, 7, 7, 7, 7])
    expect(reviewGate).toMatchObject({ status: 'BLOCKED' })
    expect(document.summary).toMatchObject({
      selected_total: 50,
      selected_online_total: 42,
      selected_offline_total: 8,
      deferred_total: 46
    })
    expect(document.authority.draft_authority_sha256).toMatch(/^sha256:[a-f0-9]{64}$/)

    expect(document).toMatchObject({
      schema_version: 'base-ability-42plus8-activation-gate-v1',
      status: 'BLOCKED_DRAFT_REVIEW_RENDERER_MATERIAL_AND_TRIAL_GATE',
      activation_authority_granted: false,
      summary: {
        source_question_total: 96,
        draft_total: 96,
        active_total: 0,
        online_candidate_total: 87,
        offline_candidate_total: 8,
        observation_only_total: 1,
        no_score_total: 96,
        media_asset_bound_total: 0,
        tool_asset_bound_total: 0
      }
    })
    expect(document.summary.question_type_counts.SOFTWARE_TASK).toBeGreaterThan(0)
    expect(document.gates.find((gate) => gate.gate_id === 'candidate_supply_42plus8')).toMatchObject({
      status: 'PASSED'
    })
    expect(document.gates.find((gate) => gate.gate_id === 'active_question_status')).toMatchObject({
      status: 'BLOCKED'
    })
    expect(document.gates.find((gate) => gate.gate_id === 'scoring_contract')).toMatchObject({
      status: 'BLOCKED'
    })
  })
})
