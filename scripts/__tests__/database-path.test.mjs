import { describe, expect, it } from 'vitest'
import { resolveDefaultDbPath } from '../lib/database-path.mjs'

describe('resolveDefaultDbPath', () => {
  it('按 Linux、Windows 和 macOS 约定生成应用数据库路径', () => {
    expect(resolveDefaultDbPath({
      platform: 'linux', homeDir: '/home/dev', appName: 'xc-career-guide'
    })).toBe('/home/dev/.config/xc-career-guide/data/xc-career-guide.db')
    expect(resolveDefaultDbPath({
      platform: 'win32', homeDir: 'C:/Users/dev', appName: 'xc-career-guide'
    })).toBe('C:/Users/dev/AppData/Roaming/xc-career-guide/data/xc-career-guide.db')
    expect(resolveDefaultDbPath({
      platform: 'darwin', homeDir: '/Users/dev', appName: 'xc-career-guide'
    })).toBe('/Users/dev/Library/Application Support/xc-career-guide/data/xc-career-guide.db')
  })
})
