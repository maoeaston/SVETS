/**
 * Closed source set for the preview IPC boundary.  Command definitions and
 * read policies remain the owners of their payload/authorization contracts;
 * this file owns only the channel inventory consumed by registration checks.
 */
export const PREVIEW_READ_CHANNELS = Object.freeze([
  'preview:listSources',
  'preview:getRelease',
  'preview:getSession',
  'preview:listSessionQuestions'
] as const)

export const PREVIEW_MUTATION_CHANNELS = Object.freeze([
  'preview:enrollPrincipal',
  'preview:rotatePrincipal',
  'preview:releasePack',
  'preview:revokePack'
] as const)

export const PREVIEW_CHANNELS = Object.freeze([
  ...PREVIEW_READ_CHANNELS,
  ...PREVIEW_MUTATION_CHANNELS
] as const)

const unique = new Set(PREVIEW_CHANNELS)
if (unique.size !== PREVIEW_CHANNELS.length) throw new Error('duplicate preview IPC channel')
