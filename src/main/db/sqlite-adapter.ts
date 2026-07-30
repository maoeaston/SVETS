// 生产环境 DBAdapter 实现：包装 better-sqlite3（Electron 主进程专用）。
// handler 层不直接依赖 better-sqlite3 的类型，只依赖 DBAdapter 接口，便于测试替换。

import Database from 'better-sqlite3'
import type { DBAdapter, DBStatement } from './interface'

export class SqliteAdapter implements DBAdapter {
  constructor(private readonly db: Database.Database) {}

  prepare(sql: string): DBStatement {
    // prepare 默认 BindParameters = unknown[]，可直接 spread 传入。
    const stmt = this.db.prepare(sql)
    return {
      run: (...params: unknown[]) => stmt.run(...params),
      get: (...params: unknown[]) => stmt.get(...params) as unknown,
      all: (...params: unknown[]) => stmt.all(...params) as unknown[]
    }
  }

  transaction<T>(fn: () => T): () => T {
    return this.db.transaction(fn) as () => T
  }

  immediateTransaction<T>(fn: () => T): () => T {
    const transaction = this.db.transaction(fn)
    return () => {
      if (this.db.inTransaction) {
        throw new Error('[DB] BEGIN IMMEDIATE transaction cannot be nested')
      }
      return transaction.immediate() as T
    }
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }
}
