/**
 * Enforce visual finding policy.
 *
 * For VISUAL_ONLY parse mode (PNG, JPEG, scanned PDF):
 * - Cap INFERRED_RELATION confidence at 0.6
 * - Change BPMN_ELEMENT locator types to IMAGE_REGION
 *
 * @param {{ findings: object[], parseMode: string }} params
 * @returns {{ findings: object[], changed: number }} The enforced findings and count of changes.
 */
export function enforceVisualFindingPolicy({ findings, parseMode }) {
  if (!Array.isArray(findings)) {
    throw new Error('findings must be an array');
  }
  if (typeof parseMode !== 'string') {
    throw new Error('parseMode must be a string');
  }

  const isVisualOnly = parseMode === 'VISUAL_ONLY';
  let changed = 0;

  const enforced = findings.map((finding) => {
    const result = { ...finding };

    if (isVisualOnly) {
      // Cap confidence at 0.6 for VISUAL_ONLY
      if (typeof result.confidence === 'number' && result.confidence > 0.6) {
        result.confidence = 0.6;
        changed++;
      }

      // Change BPMN_ELEMENT locator types to IMAGE_REGION
      if (Array.isArray(result.evidence)) {
        const needsLocatorChange = result.evidence.some(
          (e) => e.locator_type === 'BPMN_ELEMENT'
        );
        if (needsLocatorChange) {
          result.evidence = result.evidence.map((e) => {
            if (e.locator_type === 'BPMN_ELEMENT') {
              return { ...e, locator_type: 'IMAGE_REGION' };
            }
            return e;
          });
          changed++;
        }
      }
    }

    // Set business_confirmation_required for low confidence
    if (typeof result.confidence === 'number' && result.confidence < 0.8) {
      result.business_confirmation_required = true;
    }

    return result;
  });

  return { findings: enforced, changed };
}
