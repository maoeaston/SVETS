import {
  publishPreparedArtifact,
  type ArtifactPublishResult
} from './artifact-publisher'
import type { PreparedArtifactPlan } from './artifact-probe'

/** Replays a frozen artifact intent without consulting dialog, planner, or DB state. */
export function recoverPreparedArtifact(plan: PreparedArtifactPlan): ArtifactPublishResult {
  return publishPreparedArtifact(plan)
}
