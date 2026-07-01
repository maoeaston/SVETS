// 数据库适配器接口（端口）。
// 生产环境由 SqliteAdapter（better-sqlite3）实现，测试环境由 MemoryAdapter（sql.js/WASM）实现。
// handler 层只依赖此接口，测试时注入 MemoryAdapter，完全不触碰原生模块，规避 ABI 编译问题。
//
// 注意：这是端口适配，不是 ORM（AGENTS.md 禁止 ORM）。SQL 仍手写，触发器与约束仍由 schema 强制。

export interface DBStatement {
  /** 执行 INSERT/UPDATE/DELETE；返回值不保证（handler 不依赖返回字段）。 */
  run(...params: unknown[]): unknown
  /** 查询单行；无结果返回 undefined。 */
  get(...params: unknown[]): unknown
  /** 查询多行；返回行数组。 */
  all(...params: unknown[]): unknown[]
}

export interface DBAdapter {
  /** 预编译 SQL（每次调用返回新的 statement 包装；MVP 不做缓存，与现有 auth.ts 模式一致）。 */
  prepare(sql: string): DBStatement
  /** 包裹事务：返回的函数被调用时在事务内执行 fn，任一抛错回滚。 */
  transaction<T>(fn: () => T): () => T
  /** 执行多条 SQL（建表、schema 加载等），无绑定参数。 */
  exec(sql: string): void
}
