import { join } from 'node:path'

export function resolveDefaultDbPath({ platform, homeDir, appName }) {
  if (platform === 'win32') {
    return join(homeDir, 'AppData', 'Roaming', appName, 'data', `${appName}.db`)
  }
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', appName, 'data', `${appName}.db`)
  }
  return join(homeDir, '.config', appName, 'data', `${appName}.db`)
}
