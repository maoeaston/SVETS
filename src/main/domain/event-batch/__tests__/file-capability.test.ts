import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DurableFileCapability,
  FileCapabilityError,
  probeRequiredFileCapabilities
} from '../file-capability'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'svets-m5b-file-capability-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('M5B durable file capability', () => {
  it('passes exclusive-create, identity, sync, directory barrier, hard-link no-clobber, and replace KATs', () => {
    const root = tempRoot()
    expect(probeRequiredFileCapabilities(root, 'kat-1')).toEqual({
      supported: true,
      exclusiveCreate: true,
      sameFileIdentity: true,
      fileSync: true,
      directoryBarrier: true,
      hardLinkNoClobber: true,
      atomicReplace: true
    })
    expect(existsSync(join(root, '.m5b-capability-kat-1'))).toBe(false)
  })

  it('appends exact bytes on one identity and reports stable offsets/hash', () => {
    const root = tempRoot()
    const capability = new DurableFileCapability(root)
    capability.ensureDirectory('event-log/segments')
    const handle = capability.createExclusive('event-log/segments/probe.jsonl', Buffer.from('a\n'))
    expect(capability.appendExact(handle, Buffer.from('bb\n'))).toEqual({ offsetStart: 2, offsetEnd: 5 })
    capability.syncFile(handle)
    expect(capability.hashHandle(handle)).toBe(createHash('sha256').update('a\nbb\n').digest('hex'))
    expect(readFileSync(handle.absolutePath, 'utf8')).toBe('a\nbb\n')
    capability.close(handle)
  })

  it('fails closed before append when descriptor/path identity drifts', () => {
    const root = tempRoot()
    const capability = new DurableFileCapability(root)
    capability.ensureDirectory('event-log/segments')
    const handle = capability.createExclusive('event-log/segments/active.jsonl')
    const parked = join(root, 'event-log/segments/parked.jsonl')
    renameSync(handle.absolutePath, parked)
    writeFileSync(handle.absolutePath, 'foreign', { flag: 'wx' })

    expect(() => capability.appendExact(handle, Buffer.from('must-not-write'))).toThrow(/identity changed/)
    expect(readFileSync(handle.absolutePath, 'utf8')).toBe('foreign')
    expect(readFileSync(parked, 'utf8')).toBe('')
    capability.close(handle)
  })

  it('rejects symlink components, hard-link aliases, traversal, and a pre-existing no-clobber target', () => {
    const root = tempRoot()
    const capability = new DurableFileCapability(root)
    capability.ensureDirectory('real')
    symlinkSync(join(root, 'real'), join(root, 'alias'))
    expect(() => capability.resolveRelative('alias/file')).toThrow(/symlink/)
    expect(() => capability.resolveRelative('../outside')).toThrow(/path escapes data root/)
    expect(() => capability.resolveRelative('real/../other')).toThrow(/invalid relative path/)
    expect(() => capability.resolveRelative('C:/foreign')).toThrow(/invalid relative path/)
    expect(() => capability.resolveRelative('real/\u0000foreign')).toThrow(/invalid relative path/)

    const source = capability.createExclusive('real/source', Buffer.from('source'))
    capability.close(source)
    linkSync(join(root, 'real/source'), join(root, 'real/alias-source'))
    expect(() => capability.openAppend('real/source')).toThrow(/hard link/)
    unlinkSync(join(root, 'real/alias-source'))

    writeFileSync(join(root, 'real/occupied'), 'foreign', { flag: 'wx' })
    expect(() => capability.linkNoClobber('real/source', 'real/occupied')).toThrow(/already exists/)
    expect(readFileSync(join(root, 'real/occupied'), 'utf8')).toBe('foreign')
  })

  it('treats file or directory sync failure as unsupported instead of degrading durability', () => {
    const root = tempRoot()
    const fileSyncFailure = new DurableFileCapability(root, {
      syncFile: () => { throw new Error('file sync unsupported') },
      syncDirectory: () => undefined
    })
    expect(() => fileSyncFailure.createExclusive('file-sync-probe')).toThrowError(FileCapabilityError)

    const secondRoot = tempRoot()
    const directorySync = vi.fn(() => { throw new Error('directory sync unsupported') })
    expect(() => probeRequiredFileCapabilities(secondRoot, 'kat-fail', {
      syncFile: () => undefined,
      syncDirectory: directorySync
    })).toThrow(/directory barrier failed/)
    expect(directorySync).toHaveBeenCalled()
    expect(existsSync(join(secondRoot, '.m5b-capability-kat-fail'))).toBe(true)
  })

  it('atomically replaces only the named target and preserves unrelated files', () => {
    const root = tempRoot()
    const capability = new DurableFileCapability(root)
    capability.ensureDirectory('index')
    const current = capability.createExclusive('index/current.json', Buffer.from('old'))
    capability.close(current)
    const temp = capability.createExclusive('index/temp.json', Buffer.from('new'))
    capability.close(temp)
    writeFileSync(join(root, 'index/unrelated'), 'keep', { flag: 'wx' })

    capability.atomicReplace('index/temp.json', 'index/current.json')
    expect(readFileSync(join(root, 'index/current.json'), 'utf8')).toBe('new')
    expect(readFileSync(join(root, 'index/unrelated'), 'utf8')).toBe('keep')
  })

  it('refuses an atomic replace when the expected target identity was swapped with same bytes', () => {
    const root = tempRoot()
    const capability = new DurableFileCapability(root)
    capability.ensureDirectory('index')
    const current = capability.createExclusive('index/current.json', Buffer.from('same'))
    capability.close(current)
    const temp = capability.createExclusive('index/temp.json', Buffer.from('new'))
    capability.close(temp)
    renameSync(join(root, 'index/current.json'), join(root, 'index/parked.json'))
    writeFileSync(join(root, 'index/current.json'), 'same', { flag: 'wx' })

    expect(() => capability.atomicReplace('index/temp.json', 'index/current.json', current.identity))
      .toThrow(/changed before atomic replace/)
    expect(readFileSync(join(root, 'index/current.json'), 'utf8')).toBe('same')
    expect(readFileSync(join(root, 'index/temp.json'), 'utf8')).toBe('new')
  })
})
