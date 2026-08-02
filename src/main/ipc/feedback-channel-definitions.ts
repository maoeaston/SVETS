/** Closed source set for feedback query and mutation channels. */
export const FEEDBACK_READ_CHANNELS = Object.freeze([
  'feedback:list',
  'feedback:get'
] as const)

export const FEEDBACK_MUTATION_CHANNELS = Object.freeze([
  'feedback:saveDraft',
  'feedback:submit',
  'feedback:reconcile',
  'feedback:delete',
  'feedback:purge',
  'feedback:repair',
  'feedback:export'
] as const)

export const FEEDBACK_CHANNELS = Object.freeze([
  ...FEEDBACK_READ_CHANNELS,
  ...FEEDBACK_MUTATION_CHANNELS
] as const)

const unique = new Set(FEEDBACK_CHANNELS)
if (unique.size !== FEEDBACK_CHANNELS.length) throw new Error('duplicate feedback IPC channel')
