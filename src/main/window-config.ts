export interface WindowConfigEnv {
  [key: string]: string | undefined
  SVETS_E2E?: string
  SVETS_E2E_VIEWPORT?: string
}

export interface AppWindowConfig {
  width: number
  height: number
  minWidth: number
  minHeight: number
  useContentSize: true
}

export const PRODUCTION_WINDOW_CONFIG: AppWindowConfig = {
  width: 1280,
  height: 720,
  minWidth: 1024,
  minHeight: 640,
  useContentSize: true
}

const E2E_VIEWPORTS = new Map<string, { width: number; height: number }>([
  ['1366x768', { width: 1366, height: 768 }],
  ['1280x720', { width: 1280, height: 720 }],
  ['375x812', { width: 375, height: 812 }]
])

export function resolveAppWindowConfig(env: WindowConfigEnv = process.env): AppWindowConfig {
  if (env.SVETS_E2E === '1' && env.SVETS_E2E_VIEWPORT) {
    const viewport = E2E_VIEWPORTS.get(env.SVETS_E2E_VIEWPORT)
    if (!viewport) {
      throw new Error(`Unsupported SVETS_E2E_VIEWPORT: ${env.SVETS_E2E_VIEWPORT}`)
    }
    return {
      ...PRODUCTION_WINDOW_CONFIG,
      width: viewport.width,
      height: viewport.height,
      minWidth: viewport.width,
      minHeight: viewport.height
    }
  }
  return PRODUCTION_WINDOW_CONFIG
}
