import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { copyFileSync, mkdirSync } from 'fs'

// 构建时将 schema.sql 复制到 out/main/（connection.ts 用 __dirname 读取）
function copySchemaPlugin() {
  return {
    name: 'copy-schema-sql',
    closeBundle() {
      mkdirSync('out/main', { recursive: true })
      copyFileSync('src/main/db/schema.sql', 'out/main/schema.sql')
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copySchemaPlugin()],
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
