/**
 * Maps file extensions to their classification capabilities.
 *
 * Each value is an array of capability strings that describe:
 *   - kind:          DIAGRAM | ARCHITECTURE | MIXED
 *   - parse_mode:    STRUCTURED | SEMI_STRUCTURED | VISUAL_ONLY
 *   - capability:    Specific capability tag (e.g. BPMN_STRUCTURE, VISUAL_GEOMETRY)
 *
 * The first element is used as `kind`, second as `parse_mode`.
 */
export const formatCapabilities = {
  '.bpmn':    ['DIAGRAM', 'STRUCTURED', 'BPMN_STRUCTURE'],
  '.xml':     ['DIAGRAM', 'STRUCTURED', 'BPMN_STRUCTURE'],
  '.mmd':     ['DIAGRAM', 'STRUCTURED', 'MERMAID_STRUCTURE'],
  '.mermaid': ['DIAGRAM', 'STRUCTURED', 'MERMAID_STRUCTURE'],
  '.svg':     ['DIAGRAM', 'SEMI_STRUCTURED', 'VISUAL_GEOMETRY'],
  '.png':     ['DIAGRAM', 'VISUAL_ONLY'],
  '.jpg':     ['DIAGRAM', 'VISUAL_ONLY'],
  '.jpeg':    ['DIAGRAM', 'VISUAL_ONLY'],
  '.json':    ['ARCHITECTURE', 'STRUCTURED'],
  '.yaml':    ['ARCHITECTURE', 'STRUCTURED'],
  '.yml':     ['ARCHITECTURE', 'STRUCTURED'],
  '.csv':     ['ARCHITECTURE', 'STRUCTURED'],
  '.xlsx':    ['ARCHITECTURE', 'STRUCTURED'],
  '.md':      ['ARCHITECTURE', 'SEMI_STRUCTURED'],
  '.docx':    ['ARCHITECTURE', 'SEMI_STRUCTURED'],
  '.pdf':     ['MIXED', 'SEMI_STRUCTURED'],
};
