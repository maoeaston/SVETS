import { spawnSync } from 'node:child_process'

const files = [
  'src/main/db/__tests__/schema-report-framework.test.ts',
  'src/main/db/__tests__/report-migration.test.ts',
  'src/main/db/__tests__/migrations.test.ts',
  'src/main/domain/__tests__/legacy-upgrade-recovery.test.ts'
]

console.log('[db:f7:verify] Running isolated fresh-schema, legacy-upgrade, and pre-reconcile checks')
const result = spawnSync('npx', ['vitest', 'run', ...files], { stdio: 'inherit', shell: false })
process.exit(result.status ?? 1)
