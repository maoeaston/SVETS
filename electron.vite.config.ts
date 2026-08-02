import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { copyFileSync, mkdirSync } from 'fs'

// 构建时将 schema 和当前题库内容包复制到 out/main/。
function copyDatabaseContentPlugin() {
  return {
    name: 'copy-database-content',
    closeBundle() {
      mkdirSync('out/main', { recursive: true })
      copyFileSync('src/main/db/schema.sql', 'out/main/schema.sql')
      mkdirSync('out/main/content', { recursive: true })
      copyFileSync(
        'doc/features/question-bank-import-base-ability-v02.sql',
        'out/main/content/question-bank-base-ability.sql'
      )
      copyFileSync(
        'doc/features/question-bank-import.sql',
        'out/main/content/question-bank-job-specific.sql'
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyDatabaseContentPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [vue()]
  }
})
