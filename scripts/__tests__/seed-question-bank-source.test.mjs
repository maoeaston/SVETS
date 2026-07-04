import { describe, expect, it } from 'vitest'
import {
  buildQuestionBankDraftUpsertSql,
  mapSourceRow,
  parseCsv,
  summarizeQuestionRows
} from '../lib/question-bank-source-seed.mjs'

const BASE_CTX = {
  jobCode: 'SUPERMARKET_SHELVER',
  importBatchId: 'batch_20260704_001',
  sourceFile: '通用基础能力评估题库.xlsx',
  importedAt: '2026-07-04T01:00:00.000Z',
  importedBy: 'codex',
  counters: new Map()
}

describe('question-bank source seed helper', () => {
  it('解析 CSV 时支持逗号、双引号和换行字段', () => {
    const rows = parseCsv(
      [
        '模块标题,题型标题,考察点,题目,素材内容描述,能力维度标签,考察难度,计分规则,备注',
        '认知理解能力,单项选择题,货架识别,"请选择正确货架, 并说明原因","第一行素材描述',
        '第二行素材描述",认知理解,中级,"答案为 ""B""",需要人工复核'
      ].join('\n')
    )

    expect(rows).toEqual([
      {
        模块标题: '认知理解能力',
        题型标题: '单项选择题',
        考察点: '货架识别',
        题目: '请选择正确货架, 并说明原因',
        素材内容描述: '第一行素材描述\n第二行素材描述',
        能力维度标签: '认知理解',
        考察难度: '中级',
        计分规则: '答案为 "B"',
        备注: '需要人工复核'
      }
    ])
  })

  it('映射模块、题型、难度并生成稳定 question_id', () => {
    const mapped = mapSourceRow(
      {
        模块标题: '认知理解能力',
        题型标题: '单项选择题',
        考察点: '货架识别',
        题目: '请选择正确货架',
        素材内容描述: '货架全景图',
        能力维度标签: '认知理解，规则执行',
        考察难度: '中级',
        计分规则: '答案为 B',
        备注: '需要人工复核'
      },
      {
        ...BASE_CTX,
        counters: new Map(),
        sourceRow: 12
      }
    )

    expect(mapped.question_id).toBe('Q_BASE_COGNITION_SC_001')
    expect(mapped.module_type).toBe('COGNITION')
    expect(mapped.question_type).toBe('SINGLE_CHOICE')
    expect(mapped.difficulty_level).toBe(3)
    expect(mapped.status).toBe('DRAFT')
    expect(mapped.content_json).toMatchObject({
      question_type: 'SINGLE_CHOICE',
      prompt: '请选择正确货架',
      assessment_point: '货架识别',
      media_brief: '货架全景图',
      ability_tags: ['COGNITION', 'RULE_EXECUTION'],
      source: {
        import_batch_id: 'batch_20260704_001',
        source_file: '通用基础能力评估题库.xlsx',
        source_row: 12,
        imported_at: '2026-07-04T01:00:00.000Z',
        imported_by: 'codex'
      }
    })
  })

  it('未知模块时报错并带源行号', () => {
    expect(() =>
      mapSourceRow(
        {
          模块标题: '未知模块',
          题型标题: '判断题',
          考察点: '货架识别',
          题目: '题干',
          素材内容描述: '',
          能力维度标签: '认知理解',
          考察难度: '低级',
          计分规则: '',
          备注: ''
        },
        {
          ...BASE_CTX,
          counters: new Map(),
          sourceRow: 9
        }
      )
    ).toThrow(/source row 9/i)
  })

  it('重复导入同一 CSV 时 question_id 序列稳定', () => {
    const row = {
      模块标题: '认知理解能力',
      题型标题: '单项选择题',
      考察点: '货架识别',
      题目: '请选择正确货架',
      素材内容描述: '货架全景图',
      能力维度标签: '认知理解',
      考察难度: '中级',
      计分规则: '答案为 B',
      备注: ''
    }

    const first = mapSourceRow(row, {
      ...BASE_CTX,
      counters: new Map(),
      sourceRow: 5
    })
    const second = mapSourceRow(row, {
      ...BASE_CTX,
      counters: new Map(),
      sourceRow: 5
    })

    expect(first.question_id).toBe('Q_BASE_COGNITION_SC_001')
    expect(second.question_id).toBe('Q_BASE_COGNITION_SC_001')
  })

  it('生成 DRAFT UPSERT SQL', () => {
    const rows = [
      mapSourceRow(
        {
          模块标题: '规则执行能力',
          题型标题: '判断题',
          考察点: '异常处理规则',
          题目: '看到破损纸箱时，应先报告老师。',
          素材内容描述: '破损纸箱场景',
          能力维度标签: '规则执行',
          考察难度: '低级',
          计分规则: '正确',
          备注: ''
        },
        {
          ...BASE_CTX,
          counters: new Map(),
          sourceRow: 20
        }
      )
    ]

    const sql = buildQuestionBankDraftUpsertSql(rows)

    expect(sql).toContain('INSERT INTO question_bank')
    expect(sql).toContain('ON CONFLICT(question_id) DO UPDATE SET')
    expect(sql).toContain("'SUPERMARKET_SHELVER'")
    expect(sql).toContain("'DRAFT'")
    expect(sql).toContain("'Q_BASE_RULE_EXECUTION_TF_001'")
  })

  it('按模块和题型汇总导入摘要', () => {
    const rows = [
      mapSourceRow(
        {
          模块标题: '规则执行能力',
          题型标题: '判断题',
          考察点: '异常处理规则',
          题目: '看到破损纸箱时，应先报告老师。',
          素材内容描述: '破损纸箱场景',
          能力维度标签: '规则执行',
          考察难度: '低级',
          计分规则: '正确',
          备注: ''
        },
        {
          ...BASE_CTX,
          counters: new Map(),
          sourceRow: 20
        }
      ),
      mapSourceRow(
        {
          模块标题: '规则执行能力',
          题型标题: '判断题',
          考察点: '补货顺序',
          题目: '先检查货架标签再补货。',
          素材内容描述: '货架标签场景',
          能力维度标签: '规则执行',
          考察难度: '高级',
          计分规则: '正确',
          备注: ''
        },
        {
          ...BASE_CTX,
          counters: new Map([['RULE_EXECUTION::TRUE_FALSE', 1]]),
          sourceRow: 21
        }
      )
    ]

    expect(summarizeQuestionRows(rows)).toEqual({
      total: 2,
      byModule: {
        RULE_EXECUTION: 2
      },
      byType: {
        TRUE_FALSE: 2
      }
    })
  })
})
