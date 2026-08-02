import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const PREVIEW_IPC_INVENTORY_SCHEMA_VERSION = 'preview-contract-ipc-inventory-v1'

const FILES = Object.freeze({
  previewChannels: 'src/main/ipc/preview-channel-definitions.ts',
  feedbackChannels: 'src/main/ipc/feedback-channel-definitions.ts',
  previewReadDefinitions: 'src/main/application/query/preview-read-definitions.ts',
  feedbackReadDefinitions: 'src/main/application/query/feedback-read-definitions.ts',
  principalCommands: 'src/main/application/command/preview-principal-command-definitions.ts',
  releaseCommands: 'src/main/application/command/preview-release-command-definitions.ts',
  feedbackCommands: 'src/main/application/command/preview-feedback-command-definitions.ts',
  runtimeExecutor: 'src/main/application/runtime/m5b-domain-executor.ts',
  handlerRegistry: 'src/main/ipc/handler-registry.ts',
  preload: 'src/preload/index.ts'
})

function sourcePath(projectRoot, relativePath) {
  return join(resolve(projectRoot), relativePath)
}

function readSource(projectRoot, relativePath) {
  return readFileSync(sourcePath(projectRoot, relativePath), 'utf8')
}

function extractBracketBody(source, startIndex) {
  const opening = source.indexOf('[', startIndex)
  if (opening < 0) throw new Error(`array opening bracket not found at ${startIndex}`)
  let depth = 0
  let quote = null
  let escaped = false
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '[') depth += 1
    if (character === ']') {
      depth -= 1
      if (depth === 0) return source.slice(opening + 1, index)
    }
  }
  throw new Error(`array closing bracket not found at ${startIndex}`)
}

function extractNamedArray(source, name, expression = 'Object\\.freeze') {
  const marker = new RegExp(`export\\s+const\\s+${name}\\b[\\s\\S]*?${expression}\\s*\\(\\s*\\[`)
  const match = marker.exec(source)
  if (!match || match.index === undefined) throw new Error(`source array ${name} not found`)
  return extractBracketBody(source, match.index + match[0].length - 1)
}

function extractRuntimeSet(source, name) {
  const marker = new RegExp(`const\\s+${name}\\b[\\s\\S]*?new\\s+Set\\s*\\(\\s*\\[`)
  const match = marker.exec(source)
  if (!match || match.index === undefined) throw new Error(`runtime set ${name} not found`)
  return extractBracketBody(source, match.index + match[0].length - 1)
}

function strings(body) {
  return [...body.matchAll(/(['"])([^'"\n]+)\1/g)].map((match) => match[2])
}

function uniqueSorted(values, label) {
  const sorted = [...values].sort()
  const unique = new Set(sorted)
  if (unique.size !== sorted.length) throw new Error(`${label} contains duplicate channels`)
  return sorted
}

function calls(source, expression) {
  return [...source.matchAll(expression)].map((match) => match[1])
}

function sourceDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function equalJson(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(String(label) + ' mismatch')
  }
}

export function loadPreviewContractIpcInventoryFixture(projectRoot = process.cwd()) {
  return JSON.parse(readFileSync(
    join(resolve(projectRoot), 'scripts/fixtures/preview-contract-ipc-inventory-v1.json'),
    'utf8'
  ))
}

export function validatePreviewContractIpcInventory(projectRoot = process.cwd()) {
  const fixture = loadPreviewContractIpcInventoryFixture(projectRoot)
  const actual = scanPreviewContractIpcInventory(projectRoot)
  if (actual.schema_version !== fixture.schema_version) throw new Error('IPC inventory schema version mismatch')
  equalJson(actual.source_files, fixture.source_files, 'IPC inventory source files')
  for (const key of ['source_sets', 'command_sources', 'read_definitions', 'runtime_mutation_sets']) {
    equalJson(actual[key], fixture[key], 'IPC inventory ' + key)
  }
  equalJson(actual.handler_installs, fixture.source_sets.channels, 'central handler installs')
  equalJson(actual.preload_invokes, fixture.source_sets.channels, 'preload allowlist')
  if (actual.source_digest !== fixture.source_digest) throw new Error('IPC inventory source digest mismatch')
  if (fixture.counts.channels !== fixture.source_sets.channels.length) throw new Error('IPC inventory channel count fixture drift')
  if (fixture.counts.reads !== fixture.source_sets.reads.length) throw new Error('IPC inventory read count fixture drift')
  if (fixture.counts.mutations !== fixture.source_sets.mutations.length) throw new Error('IPC inventory mutation count fixture drift')
  equalJson(Object.keys(fixture.owner_map).sort(), fixture.source_sets.channels, 'IPC inventory owner map')
  for (const channel of fixture.source_sets.channels) {
    const owner = fixture.owner_map[channel]
    const source = owner.mode === 'READ'
      ? [...actual.read_definitions.preview, ...actual.read_definitions.feedback].includes(channel)
      : actual.command_sources.mutations.includes(channel)
    if (!source) throw new Error('IPC inventory owner has no source for ' + channel)
    if (!actual.handler_installs.includes(channel) || !actual.preload_invokes.includes(channel)) {
      throw new Error('IPC inventory install boundary missing ' + channel)
    }
  }
  return Object.freeze({ fixture, actual })
}

export function scanPreviewContractIpcInventory(projectRoot = process.cwd()) {
  const root = resolve(projectRoot)
  const source = Object.fromEntries(
    Object.entries(FILES).map(([key, relativePath]) => [key, readSource(root, relativePath)])
  )

  const sourceSets = {
    preview_reads: uniqueSorted(strings(extractNamedArray(source.previewChannels, 'PREVIEW_READ_CHANNELS')), 'preview reads'),
    preview_mutations: uniqueSorted(strings(extractNamedArray(source.previewChannels, 'PREVIEW_MUTATION_CHANNELS')), 'preview mutations'),
    feedback_reads: uniqueSorted(strings(extractNamedArray(source.feedbackChannels, 'FEEDBACK_READ_CHANNELS')), 'feedback reads'),
    feedback_mutations: uniqueSorted(strings(extractNamedArray(source.feedbackChannels, 'FEEDBACK_MUTATION_CHANNELS')), 'feedback mutations')
  }
  sourceSets.reads = uniqueSorted([...sourceSets.preview_reads, ...sourceSets.feedback_reads], 'reads')
  sourceSets.mutations = uniqueSorted([...sourceSets.preview_mutations, ...sourceSets.feedback_mutations], 'mutations')
  sourceSets.channels = uniqueSorted([...sourceSets.reads, ...sourceSets.mutations], 'channels')

  const commandSources = {
    preview_principal: uniqueSorted(strings(extractNamedArray(source.principalCommands, 'PREVIEW_PRINCIPAL_COMMAND_TYPES')), 'principal commands'),
    preview_release: uniqueSorted(strings(extractNamedArray(source.releaseCommands, 'PREVIEW_RELEASE_COMMAND_TYPES')), 'release commands'),
    feedback: uniqueSorted(strings(extractNamedArray(source.feedbackCommands, 'PREVIEW_FEEDBACK_COMMAND_TYPES')), 'feedback commands')
  }
  commandSources.mutations = uniqueSorted([
    ...commandSources.preview_principal,
    ...commandSources.preview_release,
    ...commandSources.feedback
  ], 'command mutations')

  const readDefinitions = {
    preview: uniqueSorted(calls(source.previewReadDefinitions, /\bread\(\s*['"]([^'"]+)['"]/g), 'preview read definitions'),
    feedback: uniqueSorted(calls(source.feedbackReadDefinitions, /\bread\(\s*['"]([^'"]+)['"]/g), 'feedback read definitions')
  }
  readDefinitions.channels = uniqueSorted([...readDefinitions.preview, ...readDefinitions.feedback], 'read definitions')

  const runtimeMutationSets = {
    preview_principal: uniqueSorted(strings(extractRuntimeSet(source.runtimeExecutor, 'PREVIEW_PRINCIPAL_COMMANDS')), 'runtime principal commands'),
    preview_release: uniqueSorted(strings(extractRuntimeSet(source.runtimeExecutor, 'PREVIEW_RELEASE_COMMANDS')), 'runtime release commands'),
    feedback: uniqueSorted(strings(extractRuntimeSet(source.runtimeExecutor, 'PREVIEW_FEEDBACK_COMMANDS')), 'runtime feedback commands')
  }
  runtimeMutationSets.mutations = uniqueSorted([
    ...runtimeMutationSets.preview_principal,
    ...runtimeMutationSets.preview_release,
    ...runtimeMutationSets.feedback
  ], 'runtime mutations')

  const handlerInstalls = uniqueSorted(calls(source.handlerRegistry, /\binstall\(\s*['"]([^'"]+)['"]/g), 'handler installs')
  const preloadInvokes = uniqueSorted(calls(source.preload, /\bipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g), 'preload invokes')
  const relativeSourceFiles = Object.fromEntries(
    Object.entries(FILES).map(([key, relativePath]) => [key, relative(root, sourcePath(root, relativePath)).replaceAll('\\', '/')])
  )

  const digestInput = {
    schema_version: PREVIEW_IPC_INVENTORY_SCHEMA_VERSION,
    source_files: relativeSourceFiles,
    source_sets: sourceSets,
    command_sources: commandSources,
    read_definitions: readDefinitions,
    runtime_mutation_sets: runtimeMutationSets,
    handler_installs: handlerInstalls.filter((channel) => sourceSets.channels.includes(channel)),
    preload_invokes: preloadInvokes.filter((channel) => sourceSets.channels.includes(channel))
  }

  return Object.freeze({
    ...digestInput,
    source_digest: sourceDigest(digestInput),
    all_handler_installs: handlerInstalls,
    all_preload_invokes: preloadInvokes
  })
}
