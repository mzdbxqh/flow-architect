/**
 * Finalize a review by computing the gate decision, review verdict, and report.
 *
 * @param {object} params
 * @param {Array<{ stage_id: string, status: string, decision?: string|null, findings?: object[], outputs?: object[], warnings?: string[], blocking_reason?: string|null, degradation?: string|null, producer?: object, evidence?: string[] }>} params.stageResults
 * @param {string} params.route - The review route (INTEGRATED, ARCHITECTURE_ONLY, DIAGRAM_ONLY).
 * @param {string} params.runId - The run identifier.
 * @param {string} params.runDir - Absolute path to the run directory.
 * @returns {{ gate: object, verdict: object, report: object }}
 */
export function finalizeReview({ stageResults, route, runId, runDir }) {
  if (!Array.isArray(stageResults)) {
    throw new Error('stageResults must be an array');
  }
  if (!route) {
    throw new Error('route is required');
  }

  const SUCCESS_STATUSES = new Set(['SUCCEEDED', 'SUCCEEDED_WITH_WARNINGS']);

  // --- Gate: validate schema + evidence + required stages ---
  const gate = computeGate(stageResults, route, SUCCESS_STATUSES);

  // --- Collect all findings from successful stages ---
  const allFindings = [];
  const stageIds = new Set();
  for (const stage of stageResults) {
    if (stage && SUCCESS_STATUSES.has(stage.status)) {
      stageIds.add(stage.stage_id);
      if (Array.isArray(stage.findings)) {
        for (const f of stage.findings) {
          allFindings.push(f);
        }
      }
    }
  }

  // --- Deduplicate by fingerprint ---
  const byFingerprint = new Map();
  for (const finding of allFindings) {
    const fp = finding.fingerprint;
    if (!fp) {
      byFingerprint.set(`_no_fp_${byFingerprint.size}`, finding);
      continue;
    }
    const existing = byFingerprint.get(fp);
    if (!existing) {
      byFingerprint.set(fp, finding);
    } else {
      const existingEvidenceCount = Array.isArray(existing.evidence) ? existing.evidence.length : 0;
      const newEvidenceCount = Array.isArray(finding.evidence) ? finding.evidence.length : 0;
      if (newEvidenceCount > existingEvidenceCount) {
        byFingerprint.set(fp, finding);
      }
    }
  }
  const uniqueFindings = Array.from(byFingerprint.values());

  // --- Severity counts ---
  let blockerCount = 0;
  let criticalCount = 0;
  let majorCount = 0;
  let minorCount = 0;
  let infoCount = 0;
  let bcrCount = 0;

  for (const f of uniqueFindings) {
    switch (f.severity) {
      case 'BLOCKER': blockerCount++; break;
      case 'CRITICAL': criticalCount++; break;
      case 'MAJOR': majorCount++; break;
      case 'MINOR': minorCount++; break;
      case 'INFO': infoCount++; break;
    }
    if (f.business_confirmation_required) bcrCount++;
  }

  // --- Compute review verdict ---
  let reviewVerdict;
  if (!gate.passed) {
    // Gate failed: insufficient evidence
    reviewVerdict = 'INSUFFICIENT_EVIDENCE';
  } else if (blockerCount > 0 || criticalCount > 0) {
    reviewVerdict = 'FAIL';
  } else if (majorCount > 0 || minorCount > 0) {
    reviewVerdict = 'CONDITIONAL_PASS';
  } else {
    reviewVerdict = 'PASS';
  }

  // --- Scope limitations ---
  const scopeLimitations = computeScopeLimitations(route);

  // --- Report ---
  const report = buildReport({
    route,
    reviewVerdict,
    uniqueFindings,
    blockerCount,
    criticalCount,
    majorCount,
    minorCount,
    infoCount,
    bcrCount,
    scopeLimitations,
    stageResults,
    stageIds,
  });

  // --- Verdict object (conforms to review-verdict schema) ---
  const verdict = {
    schema_version: '1.0.0',
    run_id: runId,
    route,
    review_verdict: reviewVerdict,
    scope_limitations: scopeLimitations,
    total_findings: uniqueFindings.length,
    blocker_count: blockerCount,
    critical_count: criticalCount,
    major_count: majorCount,
    minor_count: minorCount,
    info_count: infoCount,
    business_confirmation_required_count: bcrCount,
    summary: report.conclusion,
  };

  return { gate, verdict, report };
}

// ---- Internal helpers ----

/**
 * Compute the gate decision.
 */
function computeGate(stageResults, route, SUCCESS_STATUSES) {
  const issues = [];

  // Determine required stages for the route
  const requiredStages = getRequiredStages(route);
  const completedStages = new Set();

  for (const stage of stageResults) {
    if (stage && SUCCESS_STATUSES.has(stage.status)) {
      completedStages.add(stage.stage_id);
    }
  }

  // Check required stages
  for (const req of requiredStages) {
    if (!completedStages.has(req)) {
      issues.push(`Required stage missing or failed: ${req}`);
    }
  }

  // Check for degradation in stages
  for (const stage of stageResults) {
    if (stage && stage.degradation) {
      issues.push(`Stage ${stage.stage_id} has degradation: ${stage.degradation}`);
    }
  }

  // Check evidence paths
  for (const stage of stageResults) {
    if (stage && SUCCESS_STATUSES.has(stage.status)) {
      if (Array.isArray(stage.evidence) && stage.evidence.length === 0) {
        issues.push(`Stage ${stage.stage_id} has no evidence paths`);
      }
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    completed_stages: Array.from(completedStages),
    required_stages: requiredStages,
  };
}

/**
 * Get the required stages for a route.
 */
function getRequiredStages(route) {
  switch (route) {
    case 'INTEGRATED':
      return [
        'extract-architecture',
        'review-l4', 'review-l5', 'review-l6', 'review-sop', 'review-hierarchy',
        'extract-diagram',
        'review-bpmn', 'review-visual',
        'review-consistency',
      ];
    case 'ARCHITECTURE_ONLY':
      return [
        'extract-architecture',
        'review-l4', 'review-l5', 'review-l6', 'review-sop', 'review-hierarchy',
      ];
    case 'DIAGRAM_ONLY':
      return [
        'extract-diagram',
        'review-bpmn', 'review-visual',
      ];
    default:
      return [];
  }
}

/**
 * Compute scope limitations based on route.
 */
function computeScopeLimitations(route) {
  switch (route) {
    case 'ARCHITECTURE_ONLY':
      return [
        'Diagram extraction not performed (no diagram artifacts)',
        'BPMN review not performed',
        'Visual review not performed',
        'Consistency review not performed',
      ];
    case 'DIAGRAM_ONLY':
      return [
        'Architecture extraction not performed (no architecture artifacts)',
        'L4 review not performed',
        'L5 review not performed',
        'L6 review not performed',
        'SOP review not performed',
        'Hierarchy review not performed',
        'Consistency review not performed',
      ];
    case 'INTEGRATED':
    default:
      return [];
  }
}

/**
 * Build the report object with all required sections.
 */
function buildReport({
  route, reviewVerdict, uniqueFindings,
  blockerCount, criticalCount, majorCount, minorCount, infoCount, bcrCount,
  scopeLimitations, stageResults, stageIds,
}) {
  // Architecture findings
  const architectureFindings = uniqueFindings.filter(f =>
    f.category === 'L4' || f.category === 'L5' || f.category === 'L6' ||
    f.category === 'SOP' || f.category === 'HIERARCHY'
  );

  // Diagram findings
  const diagramFindings = uniqueFindings.filter(f =>
    f.category === 'BPMN' || f.category === 'VISUAL'
  );

  // Consistency findings
  const consistencyFindings = uniqueFindings.filter(f =>
    f.category === 'CONSISTENCY'
  );

  // Unconfirmed items
  const unconfirmed = uniqueFindings.filter(f => f.business_confirmation_required);

  // Unreviewed objects (stages that were required but failed/blocked)
  const requiredStages = getRequiredStages(route);
  const completedStages = new Set();
  const failedStages = [];
  for (const stage of stageResults) {
    if (stage && (stage.status === 'SUCCEEDED' || stage.status === 'SUCCEEDED_WITH_WARNINGS')) {
      completedStages.add(stage.stage_id);
    }
  }
  for (const req of requiredStages) {
    if (!completedStages.has(req)) {
      failedStages.push(req);
    }
  }

  // Degradation
  const degradations = [];
  for (const stage of stageResults) {
    if (stage && stage.degradation) {
      degradations.push({ stage_id: stage.stage_id, degradation: stage.degradation });
    }
  }

  // Evidence paths
  const evidencePaths = [];
  for (const stage of stageResults) {
    if (stage && Array.isArray(stage.evidence)) {
      evidencePaths.push(...stage.evidence.map(p => ({ stage_id: stage.stage_id, path: p })));
    }
  }

  // Conclusion
  let conclusion;
  switch (reviewVerdict) {
    case 'PASS':
      conclusion = 'All checks passed with no violations found.';
      break;
    case 'CONDITIONAL_PASS':
      conclusion = `Minor or major issues found (${majorCount} major, ${minorCount} minor). Conditional pass - review recommended.`;
      break;
    case 'FAIL':
      conclusion = `Critical issues found (${blockerCount} blockers, ${criticalCount} critical). Fail - remediation required.`;
      break;
    case 'INSUFFICIENT_EVIDENCE':
      conclusion = 'Insufficient evidence to determine a verdict. Missing critical stages or evidence.';
      break;
    default:
      conclusion = 'Unknown verdict.';
  }

  return {
    scope_and_capabilities: {
      route,
      stages_completed: Array.from(completedStages),
      stages_required: requiredStages,
    },
    conclusion,
    findings_summary: {
      total: uniqueFindings.length,
      blocker: blockerCount,
      critical: criticalCount,
      major: majorCount,
      minor: minorCount,
      info: infoCount,
      business_confirmation_required: bcrCount,
    },
    architecture_issues: architectureFindings.map(f => ({
      finding_id: f.finding_id,
      rule_id: f.rule_id,
      severity: f.severity,
      summary: f.actual,
    })),
    diagram_issues: diagramFindings.map(f => ({
      finding_id: f.finding_id,
      rule_id: f.rule_id,
      severity: f.severity,
      summary: f.actual,
    })),
    consistency_issues: consistencyFindings.map(f => ({
      finding_id: f.finding_id,
      rule_id: f.rule_id,
      severity: f.severity,
      summary: f.actual,
    })),
    unconfirmed_items: unconfirmed.map(f => ({
      finding_id: f.finding_id,
      rule_id: f.rule_id,
      severity: f.severity,
      recommendation: f.recommendation,
    })),
    unreveiwed_objects: failedStages,
    degradation: degradations,
    evidence_paths: evidencePaths,
    scope_limitations: scopeLimitations,
  };
}
