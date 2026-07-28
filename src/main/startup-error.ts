import { DatabaseStartupUpgradeError } from './db/migration-startup'
import { StartupRecoveryRequiredError } from './domain/legacy-upgrade-recovery'

export function normalizeStartupUpgradeError(error: unknown): unknown {
  if (error instanceof DatabaseStartupUpgradeError) {
    return new StartupRecoveryRequiredError(error.code, error.message, error.cause)
  }
  return error
}

export function describeStartupFailure(error: unknown): {
  logMessage: string
  title: string
  message: string
} {
  if (error instanceof StartupRecoveryRequiredError) {
    return {
      logMessage: `[startup] ${error.code}: ${error.message}`,
      title: '数据库需要恢复',
      message: '数据库或历史事件日志无法安全升级。应用未打开业务窗口，也未启用业务操作。'
    }
  }

  return {
    logMessage: '[startup] Database initialization failed',
    title: '启动失败',
    message: '应用无法安全初始化本地数据。请保留当前数据文件并联系维护人员。'
  }
}
