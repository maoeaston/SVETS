import { spawnSync } from 'node:child_process'

const args = [
  'test',
  '--',
  'src/main/db/__tests__/migrations.test.ts',
  'src/main/db/__tests__/schema-scoring-closure.test.ts'
]

console.log('[db:m2:verify] Running sql.js M2 migration and schema closure gate')

const result = spawnSync('npm', args, {
  stdio: 'inherit',
  shell: false
})

process.exit(result.status ?? 1)
