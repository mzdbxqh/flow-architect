import { createHash } from 'node:crypto';

export function createReviewFinding({
  ruleId,
  category,
  severity,
  artifactId,
  targetRef,
  locatorType = 'LINE',
  locator = targetRef,
  excerpt = '',
  observation,
  expected,
  actual,
  recommendation,
  confidence = 0.9,
  businessConfirmationRequired = false,
}) {
  const fingerprint = createHash('sha256')
    .update(`${ruleId}\u0000${artifactId}\u0000${targetRef}\u0000${observation}`)
    .digest('hex');
  return {
    finding_id: fingerprint.slice(0, 16),
    rule_id: ruleId,
    category,
    severity,
    verdict: 'FAIL',
    artifact_refs: [artifactId],
    target_refs: [targetRef],
    evidence: [{
      artifact_id: artifactId,
      locator_type: locatorType,
      locator,
      excerpt,
      observation,
    }],
    expected,
    actual,
    recommendation,
    confidence,
    business_confirmation_required: businessConfirmationRequired,
    source_rule_refs: [ruleId],
    fingerprint,
  };
}
