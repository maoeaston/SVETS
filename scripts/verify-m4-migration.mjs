import { spawnSync } from 'node:child_process'

const files = [
  'src/main/db/__tests__/migration-startup.test.ts',
  'src/main/db/__tests__/migration-backup.test.ts',
  'src/main/db/__tests__/schema-m4-safety-rekey.test.ts',
  'src/main/db/__tests__/safety-rekey-migration.test.ts',
  'src/main/db/__tests__/migrations.test.ts',
  'src/main/db/__tests__/schema-report-framework.test.ts'
]

console.log('[db:m4:verify] Running temporary DB/data-root M4 schema, startup, backup, and migration checks')
const result = spawnSync('npm', ['test', '--', ...files], { stdio: 'inherit', shell: false })
process.exit(result.status ?? 1)
