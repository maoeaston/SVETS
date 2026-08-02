import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  loadPreviewContractIpcInventoryFixture,
  scanPreviewContractIpcInventory,
  validatePreviewContractIpcInventory
} from '../lib/preview-contract-ipc-inventory.mjs'

const projectRoot = process.cwd()

describe('PREVIEW_CONTRACT_V1 IPC source inventory', () => {
  it('matches the closed 17-channel set across source owners, runtime, handler install, and preload', () => {
    const result = validatePreviewContractIpcInventory(projectRoot)
    expect(result.actual.source_sets.channels).toHaveLength(17)
    expect(result.actual.source_sets.reads).toHaveLength(6)
    expect(result.actual.source_sets.mutations).toHaveLength(11)
    expect(result.actual.source_digest).toBe(result.fixture.source_digest)
  })

  it('derives the inventory from source rather than trusting only fixture counts', () => {
    const fixture = loadPreviewContractIpcInventoryFixture(projectRoot)
    fixture.source_sets.channels.push('preview:unregistered')
    expect(() => {
      const actual = scanPreviewContractIpcInventory(projectRoot)
      if (JSON.stringify(actual.source_sets.channels) !== JSON.stringify(fixture.source_sets.channels)) {
        throw new Error('closed source set mismatch')
      }
    }).toThrow('closed source set mismatch')
  })

  it('keeps the committed fixture digest tied to the scanned source files', () => {
    const fixtureText = readFileSync(
      join(projectRoot, 'scripts/fixtures/preview-contract-ipc-inventory-v1.json'),
      'utf8'
    )
    expect(fixtureText).toContain('"source_digest": "' + loadPreviewContractIpcInventoryFixture(projectRoot).source_digest + '"')
  })
})
