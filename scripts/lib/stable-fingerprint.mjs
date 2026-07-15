import { createHash } from 'node:crypto';

/**
 * Produce a stable SHA-256 fingerprint for a finding.
 *
 * The fingerprint is computed over:
 *   - rule_id
 *   - artifact_refs (sorted)
 *   - target_refs (sorted)
 *   - evidence locators (each entry: artifact_id + locator_type + locator)
 *
 * Deliberately EXCLUDES recommendation text so that fingerprint stability
 * survives wording-only changes to recommendations.
 *
 * @param {object} finding - A finding object conforming to finding-set schema.
 * @returns {string} Hex-encoded SHA-256 fingerprint.
 */
export function stableFindingFingerprint(finding) {
  const canonical = {
    rule_id: finding.rule_id,
    artifact_refs: [...(finding.artifact_refs ?? [])].sort(),
    target_refs: [...(finding.target_refs ?? [])].sort(),
    evidence: (finding.evidence ?? []).map(e => ({
      artifact_id: e.artifact_id,
      locator_type: e.locator_type,
      locator: e.locator,
    })),
  };

  // Deterministic JSON: keys are already in insertion order which is
  // deterministic for object literals, arrays are explicitly sorted above.
  const payload = JSON.stringify(canonical);
  return createHash('sha256').update(payload).digest('hex');
}
