import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const packet = readFileSync(resolve(root, 'doc/features/job-skill-shelver-298-question-content-review-packet-remaining-274-v1.md'), 'utf8')

describe('job skill shelver remaining 274 content review packet', () => {
  it('contains exactly 274 numbered review sections', () => {
    const sections = packet.match(/^### \d+\. M[1-6]_/gm) ?? []
    expect(sections).toHaveLength(274)
  })

  it('contains all required reviewer fields for every question', () => {
    expect(packet.match(/^- 内容结论：/gm)).toHaveLength(274)
    expect(packet.match(/^- 题干：/gm)).toHaveLength(274)
    expect(packet.match(/^- 职业真实性：/gm)).toHaveLength(274)
    expect(packet.match(/^- 安全内容：/gm)).toHaveLength(274)
    expect(packet.match(/原始记录 hash/g)).toHaveLength(274)
  })

  it('excludes the 24 Pilot source records from review sections', () => {
    const excluded = [
      'M1_SC_001', 'M1_SC_004', 'M1_SC_007', 'M1_OP_033',
      'M2_SC_002', 'M2_SC_003', 'M2_SC_005', 'M2_OP_027',
      'M3_SC_001', 'M3_SC_005', 'M3_SC_019', 'M3_OP_043',
      'M4_SC_001', 'M4_SC_003', 'M4_SC_005', 'M4_OP_029',
      'M5_SC_001', 'M5_SC_002', 'M5_SC_009', 'M5_OP_039',
      'M6_SC_003', 'M6_SC_009', 'M6_SC_012', 'M6_OP_035'
    ]
    for (const questionId of excluded) {
      expect(packet).not.toMatch(new RegExp(`^### \\d+\\. ${questionId.replaceAll('_', '\\_')}(?: |$)`, 'm'))
    }
  })

  it('records the expected module and type totals', () => {
    expect(packet).toContain('| M1 | 11 | 12 | 6 | 15 | 44 |')
    expect(packet).toContain('| M2 | 9 | 10 | 4 | 14 | 37 |')
    expect(packet).toContain('| M3 | 21 | 12 | 6 | 15 | 54 |')
    expect(packet).toContain('| M4 | 9 | 10 | 5 | 20 | 44 |')
    expect(packet).toContain('| M5 | 17 | 12 | 6 | 16 | 51 |')
    expect(packet).toContain('| M6 | 11 | 12 | 7 | 14 | 44 |')
    expect(packet).toContain('| 合计 | 78 | 68 | 34 | 94 | 274 |')
  })
})
