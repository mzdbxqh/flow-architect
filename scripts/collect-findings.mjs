/**
 * Collect and merge findings from multiple stage results.
 *
 * Only reads from stages with status SUCCEEDED or SUCCEEDED_WITH_WARNINGS.
 * Deduplicates by fingerprint, keeping the entry with more evidence.
 *
 * @param {Array<{ stage_id: string, status: string, findings?: object[] }>} findingSets
 *   Array of stage result objects. Each may contain a `findings` array.
 * @returns {{ schema_version: string, findings: object[] }} Merged FindingSet.
 */
export function collectFindings(findingSets) {
  if (!Array.isArray(findingSets)) {
    throw new Error('findingSets must be an array');
  }

  const SUCCESS_STATUSES = new Set(['SUCCEEDED', 'SUCCEEDED_WITH_WARNINGS']);
  const byFingerprint = new Map();

  for (const stage of findingSets) {
    if (!stage || !SUCCESS_STATUSES.has(stage.status)) {
      continue;
    }

    const findings = stage.findings;
    if (!Array.isArray(findings)) {
      continue;
    }

    for (const finding of findings) {
      const fp = finding.fingerprint;
      if (!fp) {
        // No fingerprint: include as-is with a synthetic key
        const syntheticKey = `_no_fp_${byFingerprint.size}`;
        byFingerprint.set(syntheticKey, finding);
        continue;
      }

      const existing = byFingerprint.get(fp);
      if (!existing) {
        byFingerprint.set(fp, finding);
      } else {
        // Keep the one with more evidence entries
        const existingEvidenceCount = Array.isArray(existing.evidence) ? existing.evidence.length : 0;
        const newEvidenceCount = Array.isArray(finding.evidence) ? finding.evidence.length : 0;
        if (newEvidenceCount > existingEvidenceCount) {
          byFingerprint.set(fp, finding);
        }
      }
    }
  }

  return {
    schema_version: '1.0.0',
    findings: Array.from(byFingerprint.values()),
  };
}
