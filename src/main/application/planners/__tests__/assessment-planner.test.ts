import { describe, expect, it } from 'vitest'
import type { StrategyInput } from '../../../../shared/types/strategy'
import {
  baseStrategyInput,
  seedCaller,
  seedQuestionBank,
  seedStudent
} from '../../../db/test-helpers'
import {
  ASSESSMENT_PLAN_VERSIONS,
  ASSESSMENT_RESULT_RECIPE_VERSIONS,
  AssessmentPlanner,
  loadAssessmentPlannerSnapshot
} from '../assessment-planner'
import {
  ASSESSMENT_TEST_APP_VERSION,
  ASSESSMENT_TEST_TIME,
  acceptAssessmentCommand,
  createAssessmentBatchHarness
} from './assessment-test-support'

function seedStrategy(db: Parameters<typeof seedCaller>[0], over: Partial<StrategyInput> = {}): string {
  db.prepare(
    `DELETE FROM strategy_config
      WHERE strategy_type = 'BASELINE_ASSESSMENT' AND job_code = 'SUPERMARKET_SHELVER' AND version = 1`
  ).run()
  const strategy = baseStrategyInput(over)
  db.prepare(
    `INSERT INTO strategy_config (
       strategy_id, strategy_type, job_code, strategy_name, online_question_count, offline_question_count,
       max_score, competent_threshold, conditional_threshold, module_veto_threshold, emotion_collapse_threshold,
       question_policy_json, scoring_policy_json, supports_redline_halt, allows_emotion_interrupt,
       requires_offline_scoring, version, is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    strategy.strategyId, strategy.strategyType, strategy.jobCode, strategy.strategyName,
    strategy.onlineQuestionCount, strategy.offlineQuestionCount, strategy.maxScore,
    strategy.competentThreshold, strategy.conditionalThreshold, strategy.moduleVetoThreshold,
    strategy.emotionCollapseThreshold, JSON.stringify(strategy.questionPolicy), JSON.stringify(strategy.scoringPolicy),
    strategy.supportsRedlineHalt ? 1 : 0, strategy.allowsEmotionInterrupt ? 1 : 0,
    strategy.requiresOfflineScoring ? 1 : 0, strategy.version, strategy.isActive ? 1 : 0
  )
  return strategy.strategyId
}

function seedJobSkillStrategy(db: Parameters<typeof seedCaller>[0]): string {
  const strategyId = 'm5b9-job-skill-snapshot-strategy'
  const questions = [
    ['m5b9-job-online', 'TRUE_FALSE', 'SCORED_ITEM'],
    ['m5b9-job-offline', 'OFFLINE_OPERATION', 'SCORED_ITEM'],
    ['m5b9-job-observation', 'TRUE_FALSE', 'OBSERVATION_ONLY']
  ] as const
  const insertQuestion = db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, job_module_code, question_type, item_usage,
        content_json, scoring_rule_json, status)
     VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', 'M1', ?, ?,
             '{"seed":true}', '{"seed":true}', 'ACTIVE')`
  )
  for (const [questionId, questionType, itemUsage] of questions) {
    insertQuestion.run(questionId, questionType, itemUsage)
  }
  db.prepare(
    `DELETE FROM strategy_config
      WHERE strategy_type = 'JOB_SKILL_ASSESSMENT' AND job_code = 'SUPERMARKET_SHELVER' AND version = 1`
  ).run()
  db.prepare(
    `INSERT INTO strategy_config (
       strategy_id, strategy_type, job_code, strategy_name, online_question_count, offline_question_count,
       max_score, competent_threshold, conditional_threshold, module_veto_threshold, emotion_collapse_threshold,
       question_policy_json, scoring_policy_json, supports_redline_halt, allows_emotion_interrupt,
       requires_offline_scoring, version, is_active
     ) VALUES (?, 'JOB_SKILL_ASSESSMENT', 'SUPERMARKET_SHELVER', 'M5B-9 frozen snapshot', 1, 1,
               2, 80, 60, 0.5, 3, ?, '{"schema_version":"scoring-policy-v1.2"}', 1, 1, 1, 1, 1)`
  ).run(strategyId, JSON.stringify({
    schema_version: 'question-policy-v1.2',
    bank_domain: 'JOB_SPECIFIC',
    selection_mode: 'FIXED_SET',
    job_module_quotas: { M1: { online: 1, offline: 1 } },
    fixed_scored_question_ids: ['m5b9-job-online', 'm5b9-job-offline'],
    embedded_observation_question_ids: ['m5b9-job-observation'],
    fallback_strategy: 'BLOCK'
  }))
  return strategyId
}

describe('M5B-9 assessment prepared planner', () => {
  it('freezes all ten command and result recipe identities', () => {
    const commands = Object.keys(ASSESSMENT_PLAN_VERSIONS).sort()
    expect(commands).toEqual([
      'assessment:abortSession',
      'assessment:calculateResult',
      'assessment:createSession',
      'assessment:emotionInterrupt',
      'assessment:emotionResume',
      'assessment:pauseSitting',
      'assessment:recordEmotionCollapse',
      'assessment:startNextSitting',
      'assessment:startSession',
      'assessment:submitAnswer'
    ])
    expect(Object.keys(ASSESSMENT_RESULT_RECIPE_VERSIONS).sort()).toEqual(commands)
  })

  it('plans a deterministic session snapshot before any projector is applied', async () => {
    const harness = await createAssessmentBatchHarness()
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const strategyId = seedStrategy(harness.database)
      seedQuestionBank(harness.database)
      const command = acceptAssessmentCommand({
        harness, slot: 1, commandType: 'assessment:createSession', actor: { userId: teacherId, role: 'TEACHER' },
        target: {
          aggregate_type: 'ASSESSMENT_SESSION', student_id: studentId, strategy_id: strategyId,
          strategy_version: 1, task_code: 'SHELVE_TASK'
        }
      })
      const snapshot = loadAssessmentPlannerSnapshot(harness.database, command.envelope, {
        timestamp: ASSESSMENT_TEST_TIME,
        appVersion: ASSESSMENT_TEST_APP_VERSION
      })
      const plan = new AssessmentPlanner().plan({ envelope: command.envelope, snapshot })
      expect(plan.events).toHaveLength(1)
      expect(plan.events[0]).toMatchObject({
        eventType: 'SESSION_STARTED',
        eventSequence: 1,
        payload: {
          event_payload_version: 2,
          session_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          business_session_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          batch_context: {
            root_command_type: 'assessment:createSession',
            root_command_id: command.envelope.commandId,
            child_ordinal: 0
          }
        }
      })
      const payload = plan.events[0]?.payload
      const sessionQuestions = payload?.session_questions as Array<Record<string, unknown>>
      expect(sessionQuestions).toHaveLength(50)
      expect(Object.keys(sessionQuestions[0] ?? {}).sort()).toEqual([
        'bank_domain',
        'item_usage',
        'job_module_code',
        'module_type',
        'question_id',
        'question_order',
        'question_phase',
        'question_type',
        'session_question_id'
      ])
      expect(sessionQuestions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          question_phase: 'ONLINE',
          bank_domain: 'BASE_ABILITY',
          item_usage: 'SCORED_ITEM',
          job_module_code: null
        }),
        expect.objectContaining({
          question_phase: 'OFFLINE',
          bank_domain: 'BASE_ABILITY',
          question_type: 'OFFLINE_OPERATION',
          item_usage: 'SCORED_ITEM',
          job_module_code: null
        })
      ]))
      expect(harness.database.prepare('SELECT COUNT(*) AS count FROM assessment_session').get()).toEqual({ count: 0 })
    } finally {
      harness.close()
    }
  })

  it('freezes JOB_SKILL observation question facts without a live question-bank projection read', async () => {
    const harness = await createAssessmentBatchHarness()
    try {
      const teacherId = seedCaller(harness.database, 'TEACHER')
      const studentId = seedStudent(harness.database)
      const strategyId = seedJobSkillStrategy(harness.database)
      const command = acceptAssessmentCommand({
        harness,
        slot: 2,
        commandType: 'assessment:createSession',
        actor: { userId: teacherId, role: 'TEACHER' },
        target: {
          aggregate_type: 'ASSESSMENT_SESSION',
          student_id: studentId,
          strategy_id: strategyId,
          strategy_version: 1,
          task_code: 'SHELVE_TASK'
        }
      })
      const snapshot = loadAssessmentPlannerSnapshot(harness.database, command.envelope, {
        timestamp: ASSESSMENT_TEST_TIME,
        appVersion: ASSESSMENT_TEST_APP_VERSION
      })
      const plan = new AssessmentPlanner().plan({ envelope: command.envelope, snapshot })
      expect(plan.events[0]?.payload).toMatchObject({
        question_ids: ['m5b9-job-online', 'm5b9-job-offline', 'm5b9-job-observation'],
        session_questions: [
          {
            question_id: 'm5b9-job-online',
            question_order: 1,
            question_phase: 'ONLINE',
            bank_domain: 'JOB_SPECIFIC',
            module_type: null,
            question_type: 'TRUE_FALSE',
            item_usage: 'SCORED_ITEM',
            job_module_code: 'M1'
          },
          {
            question_id: 'm5b9-job-offline',
            question_order: 2,
            question_phase: 'OFFLINE',
            bank_domain: 'JOB_SPECIFIC',
            module_type: null,
            question_type: 'OFFLINE_OPERATION',
            item_usage: 'SCORED_ITEM',
            job_module_code: 'M1'
          },
          {
            question_id: 'm5b9-job-observation',
            question_order: 3,
            question_phase: 'OBSERVATION',
            bank_domain: 'JOB_SPECIFIC',
            module_type: null,
            question_type: 'TRUE_FALSE',
            item_usage: 'OBSERVATION_ONLY',
            job_module_code: 'M1'
          }
        ],
        online_questions: [{
          question_id: 'm5b9-job-online',
          question_order: 1,
          module_type: 'M1',
          question_type: 'TRUE_FALSE'
        }]
      })
    } finally {
      harness.close()
    }
  })
})
