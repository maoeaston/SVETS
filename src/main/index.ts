import { app, shell, BrowserWindow, dialog, protocol } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  startApplicationRuntime,
  type ApplicationRuntime
} from './application/runtime/application-runtime'
import { createFailClosedPreviewTrustContexts } from './application/runtime/preview-trust-context'
import {
  createInternalMutationCapability,
  prepareInternalDirectory
} from './application/runtime/internal-mutation-capability'
import { initDatabase, closeDatabase, getDatabase } from './db/connection'
import { SqliteAdapter } from './db/sqlite-adapter'
import { registerAppAssetProtocol } from './protocol/app-asset'
import { registerIpcHandlers } from './ipc'
import { describeStartupFailure } from './startup-error'
import { resolveAppWindowConfig } from './window-config'
import { ActivationService, type ActivationServicePort } from './activation/activation-service'
import { createE2eActivationBypass } from './activation/e2e-bypass'
import contentPack from '../../scripts/config/database-content-pack.json'
import packageMetadata from '../../package.json'

// 注册 app:// 为 privileged scheme。必须在 app.whenReady() 之前调用，且整个进程只能调一次。
// 没有这一步，<img src="app://asset/..."> 会被 Chromium 当作不安全协议直接拦截。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

// Explicitly set the app name so userData resolves to ~/.config/xc-career-guide/
// regardless of how Electron is launched. Without this, launching out/main/index.js
// directly (Playwright, future CI, packaged app paths) makes app.getName() return
// "Electron" and userData falls into ~/.config/Electron/, colliding with other apps.
app.setName('xc-career-guide')

const e2eUserDataPath = process.env['SVETS_E2E'] === '1' ? process.env['SVETS_USER_DATA_DIR'] : undefined
if (e2eUserDataPath) {
  prepareInternalDirectory(createInternalMutationCapability({
    owner: 'electron-main:e2e-user-data-root',
    phase: 'PRE_DB_INIT',
    dataRoot: e2eUserDataPath
  }), e2eUserDataPath)
  app.setPath('userData', e2eUserDataPath)
}

let applicationRuntime: ApplicationRuntime | null = null
let activationService: ActivationServicePort | null = null

function closeApplicationResources(): void {
  applicationRuntime?.dispose()
  applicationRuntime = null
  closeDatabase()
}

function createWindow(): void {
  const windowConfig = resolveAppWindowConfig()
  const mainWindow = new BrowserWindow({
    ...windowConfig,
    show: false,
    autoHideMenuBar: true,
    title: '炫灿-职途向导系统',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.xuancan.career-guide')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const appVersion = app.isPackaged ? app.getVersion() : packageMetadata.version
  const activationOptions = {
    appVersion,
    questionBankVersion: contentPack.version
  }
  const activationBypassEnabled = !app.isPackaged
    && process.env['SVETS_E2E'] === '1'
    && process.env['SVETS_E2E_ACTIVATION_BYPASS'] === '1'
  const activationStorageRoot = join(app.getPath('userData'), 'activation')
  prepareInternalDirectory(createInternalMutationCapability({
    owner: 'electron-main:activation-state-directory',
    phase: 'PRE_DB_INIT',
    dataRoot: activationStorageRoot
  }), activationStorageRoot)
  activationService = activationBypassEnabled
    ? createE2eActivationBypass(activationOptions)
    : new ActivationService({
        ...activationOptions,
        storageRoot: activationStorageRoot,
        initialServerUrl: process.env['SVETS_ACTIVATION_SERVER_URL']
          ?? (app.isPackaged ? '' : 'http://127.0.0.1:4318'),
        packaged: app.isPackaged
      })
  await activationService.initialize()

  initDatabase()
  const dataRoot = join(app.getPath('userData'), 'data')
  applicationRuntime = await startApplicationRuntime({
    runtime: {
      db: new SqliteAdapter(getDatabase()),
      dataRoot,
      dependencies: {
        previewTrustContexts: createFailClosedPreviewTrustContexts()
      }
    },
    registerBoundary: (runtime) => registerIpcHandlers(runtime, activationService!)
  })
  registerAppAssetProtocol()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error: unknown) => {
  closeApplicationResources()
  console.error('[startup] cause:', error instanceof Error ? error.stack ?? error.message : error)
  const failure = describeStartupFailure(error)
  console.error(failure.logMessage)
  dialog.showErrorBox(failure.title, failure.message)
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeApplicationResources()
    app.quit()
  }
})

app.on('before-quit', closeApplicationResources)
