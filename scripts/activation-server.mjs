import { listenActivationServer } from './lib/activation-server.mjs'

const licenseKey = process.env.SVETS_ACTIVATION_LICENSE_KEY
if (!licenseKey) {
  console.error('[activation-server] SVETS_ACTIVATION_LICENSE_KEY is required')
  process.exit(1)
}

const port = Number(process.env.SVETS_ACTIVATION_PORT ?? '4318')
const deviceLimit = Number(process.env.SVETS_ACTIVATION_DEVICE_LIMIT ?? '10')
const validDays = Number(process.env.SVETS_ACTIVATION_VALID_DAYS ?? '30')

const instance = await listenActivationServer({
  host: process.env.SVETS_ACTIVATION_HOST ?? '127.0.0.1',
  port,
  licenseKey,
  organizationName: process.env.SVETS_ACTIVATION_ORGANIZATION ?? '学校演示授权',
  deviceLimit,
  validDays,
  licenseExpiresAt: process.env.SVETS_ACTIVATION_LICENSE_EXPIRES_AT ?? null
})

console.log(`[activation-server] listening at ${instance.url}`)
console.log(`[activation-server] deviceLimit=${deviceLimit} validDays=${validDays}`)

async function shutdown() {
  await instance.close()
  process.exit(0)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
