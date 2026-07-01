// 测试用 DBAdapter 实现：基于 sql.js（SQLite 编译为 WASM）。
// 完全不触碰 better-sqlite3 原生模块，规避 Node/Electron ABI 不匹配问题。
// sql.js 是真正的 SQLite，CHECK 约束、触发器、partial unique index 行为与生产一致。
//
// 仅被测试代码引用；不进入 Electron 生产打包。

import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { join } from 'path'
import type { DBAdapter, DBStatement } from './interface'

let sqlPromise: Promise<SqlJsStatic> | null = null

function ensureSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    // vitest 从项目根运行，process.cwd() 稳定（不依赖 __dirname / ESM）。
    sqlPromise = initSqlJs({
      locateFile: (f) => join(process.cwd(), 'node_modules', 'sql.js', 'dist', f)
    })
  }
  return sqlPromise
}

export class MemoryAdapter implements DBAdapter {
  private constructor(private readonly db: SqlJsDatabase) {}

  /** 异步工厂：需先加载 WASM。测试用 beforeAll(await createTestDb())。 */
  static async create(): Promise<MemoryAdapter> {
    const SQL = await ensureSqlJs()
    const db = new SQL.Database()
    return new MemoryAdapter(db)
  }

  prepare(sql: string): DBStatement {
    return {
      run: (...params: unknown[]) => {
        // db.run 自动 finalize；无需手动 free
        this.db.run(sql, params as never)
        return undefined
      },
      get: (...params: unknown[]) => {
        const stmt = this.db.prepare(sql)
        stmt.bind(params as never)
        const hasRow = stmt.step()
        const row = hasRow ? stmt.getAsObject() : undefined
        stmt.free()
        return row
      },
      all: (...params: unknown[]) => {
        const stmt = this.db.prepare(sql)
        stmt.bind(params as never)
        const rows: unknown[] = []
        while (stmt.step()) rows.push(stmt.getAsObject())
        stmt.free()
        return rows
      }
    }
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.db.exec('BEGIN')
      try {
        const result = fn()
        this.db.exec('COMMIT')
        return result
      } catch (err) {
        try {
          this.db.exec('ROLLBACK')
        } catch {
          // 回滚本身失败时不再掩盖原始错误
        }
        throw err
      }
    }
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  /** 关闭并释放 WASM 内存。仅测试清理用，不进 DBAdapter 接口（生命周期不属于查询端口）。 */
  close(): void {
    this.db.close()
  }
}
