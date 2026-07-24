import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  hashFile,
  hashRecord,
  semanticHash,
  semanticHashContract
} from './lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '..')
const rel = {
  sourceManifest: 'doc/features/job-skill-shelver-298-source-manifest-v1.json',
  source: 'doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json',
  pilotCandidates: 'doc/features/job-skill-shelver-pilot-revision-candidates-v3.json',
  pilotGate: 'doc/features/job-skill-shelver-pilot-activation-manifest-v3.json',
  firstReviewDecisions: 'doc/features/job-skill-shelver-298-merged-review-decisions-2026-07-19.json',
  revisionCandidates: 'doc/features/job-skill-shelver-298-question-revision-candidates-v1.json',
  rereviewGate: 'doc/features/job-skill-shelver-298-semantic-change-rereview-merged-gate-2026-07-20.json',
  replacementV2Candidates: 'doc/features/job-skill-shelver-298-rejected-replacement-candidates-v2.json',
  replacementV3Candidates: 'doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v3.json',
  replacementV4Candidates: 'doc/features/job-skill-shelver-298-rejected-replacement-targeted-candidates-v4.json',
  replacementGate: 'doc/features/job-skill-shelver-298-rejected-replacement-targeted-v4-rereview-merged-gate-v1.json',
  output: 'doc/features/job-skill-shelver-298-disposition-authority-v1.json'
}

const paths = Object.fromEntries(Object.entries(rel).map(([key, path]) => [key, resolve(root, path)]))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function assertUnique(values, label) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index)
  assert(duplicates.length === 0, `${label} duplicates: ${[...new Set(duplicates)].join(', ')}`)
}

export function verifySourceManifest(manifest, baseRoot = root) {
  assert(manifest.schema_version === 'job-skill-shelver-298-source-manifest-v1', 'Unexpected source manifest schema')
  assert(manifest.status === 'ACCEPTED_INPUT_HASHES', 'Source manifest is not accepted')
  assert(Array.isArray(manifest.artifacts) && manifest.artifacts.length === 9, 'Source manifest must contain 9 accepted artifacts')
  assertUnique(manifest.artifacts.map((artifact) => artifact.artifact_id), 'source manifest artifact_id')
  assertUnique(manifest.artifacts.map((artifact) => artifact.path), 'source manifest path')
  for (const artifact of manifest.artifacts) {
    assert(artifact.immutable === true, `${artifact.artifact_id} must be immutable`)
    const actual = hashFile(resolve(baseRoot, artifact.path))
    assert(actual === artifact.sha256, `${artifact.path} hash mismatch: ${actual} != ${artifact.sha256}`)
  }
}

function verifyRecordHash(record, field, label) {
  const { [field]: actual, ...body } = record
  assert(actual === hashRecord(body), `${label} ${field} mismatch`)
}

function candidateSemantics(candidate) {
  return {
    question_type: candidate.question_type,
    content: candidate.proposed_question.content,
    scoring_rule: candidate.proposed_question.scoring_rule,
    safety_sensitive: candidate.proposed_question.safety_sensitive,
    safety_stop_conditions: candidate.proposed_question.safety_stop_conditions,
    sensory_tags: candidate.proposed_question.sensory_tags
  }
}

function pilotSemantics(candidate) {
  return {
    question_type: candidate.question_type,
    prompt: candidate.prompt,
    target_construct: candidate.target_construct,
    options: candidate.options,
    candidate_answer: candidate.candidate_answer,
    presentation: candidate.presentation,
    rubric: candidate.rubric,
    safety: candidate.safety
  }
}

function fileRef(path, role) {
  return { path, sha256: hashFile(resolve(root, path)), role }
}

function buildReplacementBySourceId({ v2Candidates, v3Candidates, v4Candidates, gate, sourceById }) {
  assert(gate.status === 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY', 'Replacement review gate is not passed')
  assert(gate.summary?.cumulative_replacement_review?.total === 11, 'Replacement review gate must cover 11 questions')
  assert(gate.summary?.cumulative_replacement_review?.passed_review_only_no_activation_authority === 11, 'Replacement review gate must pass 11 questions')
  assert(gate.summary?.cumulative_replacement_review?.return_for_revision === 0, 'Replacement review gate must not contain returns')
  assert(gate.authority?.activation_authority_granted === false, 'Replacement review gate must not grant activation authority')
  assert(gate.authority?.authority_amendment_executed === false, 'Replacement review gate must require a separate authority amendment')

  const candidateById = new Map()
  for (const candidateSet of [v2Candidates, v3Candidates, v4Candidates]) {
    for (const candidate of candidateSet.questions ?? []) {
      assert(!candidateById.has(candidate.question_id), `Replacement candidate duplicate: ${candidate.question_id}`)
      verifyRecordHash(candidate, 'candidate_record_hash', candidate.question_id)
      assert(candidate.activation_authority === 'NONE', `${candidate.question_id} must not grant activation authority`)
      candidateById.set(candidate.question_id, candidate)
    }
  }

  const replacements = new Map()
  const references = gate.cumulative_passed_references
  assert(Array.isArray(references) && references.length === 11, 'Replacement review gate must list 11 cumulative passed references')
  assertUnique(references.map((reference) => reference.question_id), 'replacement current question_id')
  for (const reference of references) {
    const candidate = candidateById.get(reference.question_id)
    assert(candidate, `Replacement gate candidate missing: ${reference.question_id}`)
    assert(candidate.candidate_record_hash === reference.candidate_record_hash, `${reference.question_id} replacement candidate hash mismatch`)
    assert(candidate.new_semantic_hash === reference.semantic_hash, `${reference.question_id} replacement semantic hash mismatch`)
    assert(reference.activation_authority === 'NONE', `${reference.question_id} replacement reference grants activation authority`)
    assert(sourceById.has(candidate.source_question_id), `${reference.question_id} replacement source is not in the immutable 298 set`)
    assert(!replacements.has(candidate.source_question_id), `Replacement source duplicate: ${candidate.source_question_id}`)
    replacements.set(candidate.source_question_id, candidate)
  }
  assert(replacements.size === 11, 'Replacement source coverage must equal 11')
  return replacements
}

export function buildAuthority({ write = true } = {}) {
  const sourceManifest = readJson(paths.sourceManifest)
  verifySourceManifest(sourceManifest)

  const sourceQuestions = readJson(paths.source)
  const pilotCandidates = readJson(paths.pilotCandidates)
  const pilotGate = readJson(paths.pilotGate)
  const firstReview = readJson(paths.firstReviewDecisions)
  const revisionCandidates = readJson(paths.revisionCandidates)
  const rereviewGate = readJson(paths.rereviewGate)
  const replacementV2Candidates = readJson(paths.replacementV2Candidates)
  const replacementV3Candidates = readJson(paths.replacementV3Candidates)
  const replacementV4Candidates = readJson(paths.replacementV4Candidates)
  const replacementGate = readJson(paths.replacementGate)

  assert(Array.isArray(sourceQuestions) && sourceQuestions.length === 298, 'Source snapshot must contain 298 questions')
  assert(pilotCandidates.questions?.length === 24, 'Pilot candidate set must contain 24 questions')
  assert(pilotGate.scope?.question_ids?.length === 24 || pilotGate.questions?.length === 24, 'Pilot gate must cover 24 questions')
  assert(firstReview.questions?.length === 274, 'First review decision set must contain 274 questions')
  assert(revisionCandidates.questions?.length === 263, 'Revision candidate set must contain 263 questions')
  assert(rereviewGate.questions?.length === 232, 'Re-review gate must contain 232 questions')

  const { candidate_set_hash: candidateSetHash, ...candidateSetBody } = revisionCandidates
  assert(candidateSetHash === hashRecord(candidateSetBody), 'Revision candidate_set_hash mismatch')
  assert(rereviewGate.candidate_set.candidate_set_hash === candidateSetHash, 'Re-review gate candidate_set_hash mismatch')
  assert(rereviewGate.candidate_set.candidate_set_file_hash === hashFile(paths.revisionCandidates), 'Re-review gate candidate file hash mismatch')

  for (const candidate of revisionCandidates.questions) {
    verifyRecordHash(candidate, 'candidate_record_hash', candidate.question_id)
  }
  for (const candidate of pilotCandidates.questions) {
    verifyRecordHash(candidate, 'candidate_record_hash', candidate.question_id)
  }

  const sourceById = new Map(sourceQuestions.map((question) => [question.question_id, question]))
  const firstReviewById = new Map(firstReview.questions.map((question) => [question.question_id, question]))
  const candidateBySourceId = new Map(revisionCandidates.questions.map((question) => [question.source_question_id, question]))
  const rereviewByQuestionId = new Map(rereviewGate.questions.map((question) => [question.question_id, question]))
  const replacementBySourceId = buildReplacementBySourceId({
    v2Candidates: replacementV2Candidates,
    v3Candidates: replacementV3Candidates,
    v4Candidates: replacementV4Candidates,
    gate: replacementGate,
    sourceById
  })
  const pilotBySourceId = new Map(pilotCandidates.questions.map((question) => {
    const basedOn = question.provenance.based_on_question_id
    const sourceQuestionId = sourceById.has(basedOn) ? basedOn : basedOn.replace(/_V\d+$/, '')
    assert(sourceById.has(sourceQuestionId), `${question.question_id} cannot be traced to a 298 source ID`)
    return [sourceQuestionId, question]
  }))

  assertUnique(sourceQuestions.map((question) => question.question_id), 'source question_id')
  assertUnique([...pilotBySourceId.keys()], 'pilot source question_id')
  assert(pilotBySourceId.size === 24, 'Pilot source set must contain 24 unique source IDs')
  assert([...pilotBySourceId.keys()].every((questionId) => sourceById.has(questionId)), 'Pilot source ID missing from 298 snapshot')

  const nonPilotIds = firstReview.questions.map((question) => question.question_id)
  assertUnique(nonPilotIds, 'non-Pilot review question_id')
  assert(nonPilotIds.every((questionId) => sourceById.has(questionId)), 'Non-Pilot review ID missing from source snapshot')
  assert(nonPilotIds.every((questionId) => !pilotBySourceId.has(questionId)), 'Pilot and non-Pilot sets overlap')
  assert(new Set([...pilotBySourceId.keys(), ...nonPilotIds]).size === 298, 'Pilot + non-Pilot sets must cover 298 source questions')

  const questions = sourceQuestions.map((source) => {
    const sourceRecordHash = hashRecord(source)
    const module = source.question_id.slice(0, 2)
    const pilot = pilotBySourceId.get(source.question_id)
    if (pilot) {
      return {
        source_question_id: source.question_id,
        source_question_version: source.version,
        source_record_hash: sourceRecordHash,
        module,
        question_type: source.question_type,
        branch: 'PILOT',
        disposition: 'PILOT_PENDING_GATE',
        current_question_id: pilot.question_id,
        current_question_version: pilot.question_version,
        semantic_hash: semanticHash(pilotSemantics(pilot)),
        candidate_record_hash: pilot.candidate_record_hash,
        review_gate_status: 'PENDING',
        activation_authority: 'NONE'
      }
    }

    const decision = firstReviewById.get(source.question_id)
    assert(decision, `${source.question_id} missing first review decision`)
    assert(decision.source_record_hash === sourceRecordHash, `${source.question_id} first review source hash mismatch`)

    if (decision.merged_decision === 'REJECTED') {
      assert(!candidateBySourceId.has(source.question_id), `${source.question_id} rejected source has an initial revision candidate`)
      const replacement = replacementBySourceId.get(source.question_id)
      assert(replacement, `${source.question_id} rejected source is missing its approved replacement`)
      return {
        source_question_id: source.question_id,
        source_question_version: source.version,
        source_record_hash: sourceRecordHash,
        module,
        question_type: replacement.question_type,
        branch: 'NON_PILOT',
        disposition: 'REPLACEMENT_REVIEW_PASSED_PENDING_ACTIVATION',
        current_question_id: replacement.question_id,
        current_question_version: replacement.question_version,
        semantic_hash: replacement.new_semantic_hash,
        candidate_record_hash: replacement.candidate_record_hash,
        review_gate_status: 'PASSED_REVIEW_ONLY_NO_ACTIVATION_AUTHORITY',
        activation_authority: 'NONE'
      }
    }

    const candidate = candidateBySourceId.get(source.question_id)
    assert(candidate, `${source.question_id} missing retained candidate`)
    assert(candidate.source_record_hash === sourceRecordHash, `${source.question_id} candidate source hash mismatch`)

    if (decision.merged_decision === 'APPROVED_UNCHANGED') {
      return {
        source_question_id: source.question_id,
        source_question_version: source.version,
        source_record_hash: sourceRecordHash,
        module,
        question_type: source.question_type,
        branch: 'NON_PILOT',
        disposition: 'APPROVED_UNCHANGED_PENDING_ACTIVATION',
        current_question_id: candidate.question_id,
        current_question_version: candidate.question_version,
        semantic_hash: semanticHash(candidateSemantics(candidate)),
        candidate_record_hash: candidate.candidate_record_hash,
        review_gate_status: 'NOT_REQUIRED',
        activation_authority: 'NONE'
      }
    }

    assert(decision.merged_decision === 'REVISION_REQUIRED', `${source.question_id} unexpected merged decision`)
    const rereview = rereviewByQuestionId.get(candidate.question_id)
    assert(rereview, `${candidate.question_id} missing re-review gate record`)
    assert(rereview.candidate_record_hash === candidate.candidate_record_hash, `${candidate.question_id} re-review candidate hash mismatch`)
    const passed = rereview.rereview_gate_status === 'PASSED'
    assert(passed || rereview.rereview_gate_status === 'RETURN_FOR_REVISION', `${candidate.question_id} unexpected re-review status`)

    return {
      source_question_id: source.question_id,
      source_question_version: source.version,
      source_record_hash: sourceRecordHash,
      module,
      question_type: source.question_type,
      branch: 'NON_PILOT',
      disposition: passed ? 'REVISED_REREVIEW_PASSED_PENDING_ACTIVATION' : 'REVISED_RETURNED',
      current_question_id: candidate.question_id,
      current_question_version: candidate.question_version,
      semantic_hash: semanticHash(candidateSemantics(candidate)),
      candidate_record_hash: candidate.candidate_record_hash,
      review_gate_status: passed ? 'PASSED' : 'RETURN_FOR_REVISION',
      activation_authority: 'NONE'
    }
  })

  const byDisposition = Object.fromEntries([...new Set(questions.map((question) => question.disposition))]
    .sort()
    .map((disposition) => [disposition, questions.filter((question) => question.disposition === disposition).length]))
  const summary = {
    source_total: questions.length,
    pilot_total: questions.filter((question) => question.branch === 'PILOT').length,
    non_pilot_total: questions.filter((question) => question.branch === 'NON_PILOT').length,
    approved_unchanged: byDisposition.APPROVED_UNCHANGED_PENDING_ACTIVATION ?? 0,
    revised_total: (byDisposition.REVISED_REREVIEW_PASSED_PENDING_ACTIVATION ?? 0) + (byDisposition.REVISED_RETURNED ?? 0),
    rereview_passed: byDisposition.REVISED_REREVIEW_PASSED_PENDING_ACTIVATION ?? 0,
    rereview_returned: byDisposition.REVISED_RETURNED ?? 0,
    rejected: byDisposition.REJECTED ?? 0,
    replacement_review_passed: byDisposition.REPLACEMENT_REVIEW_PASSED_PENDING_ACTIVATION ?? 0,
    retained_total: questions.filter((question) => question.disposition !== 'REJECTED').length,
    by_disposition: byDisposition
  }

  assert(JSON.stringify(summary) === JSON.stringify({
    source_total: 298,
    pilot_total: 24,
    non_pilot_total: 274,
    approved_unchanged: 31,
    revised_total: 232,
    rereview_passed: 21,
    rereview_returned: 211,
    rejected: 0,
    replacement_review_passed: 11,
    retained_total: 298,
    by_disposition: {
      APPROVED_UNCHANGED_PENDING_ACTIVATION: 31,
      PILOT_PENDING_GATE: 24,
      REPLACEMENT_REVIEW_PASSED_PENDING_ACTIVATION: 11,
      REVISED_REREVIEW_PASSED_PENDING_ACTIVATION: 21,
      REVISED_RETURNED: 211
    }
  }), 'Authority summary mismatch')

  const inputFiles = [
    fileRef(rel.sourceManifest, 'SOURCE_MANIFEST'),
    fileRef(rel.pilotCandidates, 'PILOT_CANDIDATE'),
    fileRef(rel.pilotGate, 'PILOT_ACTIVATION_GATE'),
    fileRef(rel.firstReviewDecisions, 'FIRST_REVIEW_DECISIONS'),
    fileRef(rel.revisionCandidates, 'REVISION_CANDIDATES'),
    fileRef(rel.rereviewGate, 'REREVIEW_GATE'),
    fileRef(rel.replacementV2Candidates, 'REJECTED_REPLACEMENT_V2_CANDIDATES'),
    fileRef(rel.replacementV3Candidates, 'REJECTED_REPLACEMENT_V3_CANDIDATES'),
    fileRef(rel.replacementV4Candidates, 'REJECTED_REPLACEMENT_V4_CANDIDATES'),
    fileRef(rel.replacementGate, 'REJECTED_REPLACEMENT_MERGED_GATE')
  ]
  const semanticRootHash = hashRecord(questions.map((question) => ({
    source_question_id: question.source_question_id,
    current_question_id: question.current_question_id,
    disposition: question.disposition,
    semantic_hash: question.semantic_hash
  })))
  const base = {
    $schema: './job-skill-shelver-298-disposition-authority-v1.schema.json',
    schema_version: 'job-skill-shelver-298-disposition-authority-v1',
    authority_id: 'job-skill-shelver-298-disposition-authority-v1',
    status: 'BLOCKED_NO_RELEASE_AUTHORITY',
    generated_at: '2026-07-22T14:45:00+08:00',
    source_manifest: { path: rel.sourceManifest, sha256: hashFile(paths.sourceManifest) },
    input_files: inputFiles,
    semantic_hash_contract: semanticHashContract,
    summary,
    release_gate: {
      releaseable: false,
      may_generate_runtime_sql: false,
      blockers: [
        { code: 'PILOT_GATE_PENDING', count: 24, message: 'Pilot 24题尚未完成全部激活门禁。' },
        { code: 'REREVIEW_RETURNED', count: 211, message: '211道修订题仍需定点修正或复审。' }
      ]
    },
    questions,
    semantic_root_hash: semanticRootHash
  }
  const authority = { ...base, authority_hash: hashRecord(base) }

  if (write) {
    const tempPath = `${paths.output}.${process.pid}.tmp`
    writeFileSync(tempPath, `${JSON.stringify(authority, null, 2)}\n`)
    renameSync(tempPath, paths.output)
  }
  return authority
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const authority = buildAuthority()
  console.log(`[job-skill-298-authority] source=${authority.summary.source_total} retained=${authority.summary.retained_total} returned=${authority.summary.rereview_returned} releaseable=${authority.release_gate.releaseable}`)
}
