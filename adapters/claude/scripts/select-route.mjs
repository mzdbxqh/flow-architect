/**
 * Route constants for review flows.
 * @readonly
 * @enum {string}
 */
export const Route = Object.freeze({
  INTEGRATED: 'INTEGRATED',
  ARCHITECTURE_ONLY: 'ARCHITECTURE_ONLY',
  DIAGRAM_ONLY: 'DIAGRAM_ONLY',
  NEEDS_INPUT: 'NEEDS_INPUT',
});

/**
 * Select the review route based on artifact presence and optional explicit override.
 *
 * @param {{ explicit?: string|null, architectureCount: number, diagramCount: number }} params
 * @param {string|null} [params.explicit] - Explicit route override (INTEGRATED, ARCHITECTURE_ONLY, DIAGRAM_ONLY). Null or undefined to auto-detect.
 * @param {number} params.architectureCount - Number of architecture-family artifacts present.
 * @param {number} params.diagramCount - Number of diagram-family artifacts present.
 * @returns {{ route: string, reason: string }} The selected route and reason.
 */
export function selectRoute({ explicit, architectureCount, diagramCount } = {}) {
  const arch = Number(architectureCount) || 0;
  const diag = Number(diagramCount) || 0;

  // If explicit route is provided, validate it
  if (explicit) {
    if (explicit === Route.INTEGRATED) {
      if (arch > 0 && diag > 0) {
        return { route: Route.INTEGRATED, reason: 'Explicit: both artifact families present' };
      }
      // Explicit INTEGRATED but missing one side
      return {
        route: Route.NEEDS_INPUT,
        reason: `Explicit INTEGRATED requested but ${arch === 0 ? 'architecture' : 'diagram'} artifacts missing`,
      };
    }

    if (explicit === Route.ARCHITECTURE_ONLY) {
      if (arch > 0) {
        return { route: Route.ARCHITECTURE_ONLY, reason: 'Explicit: architecture-only review' };
      }
      return { route: Route.NEEDS_INPUT, reason: 'Explicit ARCHITECTURE_ONLY requested but architecture artifacts missing' };
    }

    if (explicit === Route.DIAGRAM_ONLY) {
      if (diag > 0) {
        return { route: Route.DIAGRAM_ONLY, reason: 'Explicit: diagram-only review' };
      }
      return { route: Route.NEEDS_INPUT, reason: 'Explicit DIAGRAM_ONLY requested but diagram artifacts missing' };
    }

    return { route: Route.NEEDS_INPUT, reason: `Unknown explicit route: ${explicit}` };
  }

  // Auto-detect based on artifact counts
  if (arch > 0 && diag > 0) {
    return { route: Route.INTEGRATED, reason: 'Both architecture and diagram artifacts present' };
  }

  if (arch > 0) {
    return { route: Route.ARCHITECTURE_ONLY, reason: 'Only architecture artifacts present' };
  }

  if (diag > 0) {
    return { route: Route.DIAGRAM_ONLY, reason: 'Only diagram artifacts present' };
  }

  return { route: Route.NEEDS_INPUT, reason: 'No architecture or diagram artifacts found' };
}
