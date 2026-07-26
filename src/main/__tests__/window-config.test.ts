import { describe, expect, it } from 'vitest'
import { PRODUCTION_WINDOW_CONFIG, resolveAppWindowConfig } from '../window-config'

describe('main window config', () => {
  it('uses production content-size bounds that allow 1280x720', () => {
    expect(resolveAppWindowConfig({})).toEqual(PRODUCTION_WINDOW_CONFIG)
    expect(PRODUCTION_WINDOW_CONFIG).toMatchObject({
      width: 1280,
      height: 720,
      minWidth: 1024,
      minHeight: 640,
      useContentSize: true
    })
  })

  it('only accepts fixed E2E content viewports when SVETS_E2E is enabled', () => {
    expect(resolveAppWindowConfig({ SVETS_E2E: '1', SVETS_E2E_VIEWPORT: '1366x768' }))
      .toMatchObject({ width: 1366, height: 768, minWidth: 1366, minHeight: 768 })
    expect(resolveAppWindowConfig({ SVETS_E2E: '1', SVETS_E2E_VIEWPORT: '1280x720' }))
      .toMatchObject({ width: 1280, height: 720, minWidth: 1280, minHeight: 720 })
    expect(resolveAppWindowConfig({ SVETS_E2E: '1', SVETS_E2E_VIEWPORT: '375x812' }))
      .toMatchObject({ width: 375, height: 812, minWidth: 375, minHeight: 812 })
  })

  it('ignores viewport override outside E2E mode', () => {
    expect(resolveAppWindowConfig({ SVETS_E2E_VIEWPORT: '375x812' })).toEqual(PRODUCTION_WINDOW_CONFIG)
    expect(resolveAppWindowConfig({ SVETS_E2E: '0', SVETS_E2E_VIEWPORT: '375x812' })).toEqual(PRODUCTION_WINDOW_CONFIG)
  })

  it('fails closed for unsupported E2E viewport values', () => {
    expect(() => resolveAppWindowConfig({ SVETS_E2E: '1', SVETS_E2E_VIEWPORT: '500x500' }))
      .toThrow('Unsupported SVETS_E2E_VIEWPORT')
  })
})
