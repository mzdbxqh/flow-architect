/**
 * Creates locator factory functions for a given source file.
 *
 * Locators are used in findings to point to exact locations in source
 * artifacts with a short excerpt for human readability.
 *
 * @param {string} filePath - Absolute path to the source file.
 * @param {string} content  - Full text content of the source file.
 * @returns {{ lineLocator, pageLocator, bpmnElementLocator }}
 */
export function createSourceLocator(filePath, content) {
  const lines = content.split('\n');

  /**
   * Create a LINE locator pointing at a 1-indexed line number.
   * @param {number} lineNumber - 1-indexed line number.
   * @param {number} [contextLines=1] - Number of lines of context around the target.
   * @returns {{ locator_type: string, locator: string, excerpt: string }}
   */
  function lineLocator(lineNumber, contextLines = 1) {
    const start = Math.max(0, lineNumber - 1 - contextLines);
    const end = Math.min(lines.length, lineNumber + contextLines);
    const excerpt = lines.slice(start, end).join('\n').slice(0, 200);
    return {
      locator_type: 'LINE',
      locator: `${filePath}:${lineNumber}`,
      excerpt,
    };
  }

  /**
   * Create a PAGE locator for a specific page number (1-indexed).
   * @param {number} pageNumber - 1-indexed page number.
   * @param {string} [pageText=''] - Extracted text content of the page.
   * @returns {{ locator_type: string, locator: string, excerpt: string }}
   */
  function pageLocator(pageNumber, pageText = '') {
    return {
      locator_type: 'PAGE',
      locator: `${filePath}:page-${pageNumber}`,
      excerpt: pageText.slice(0, 200),
    };
  }

  /**
   * Create a BPMN_ELEMENT locator for a specific BPMN element.
   * @param {string} elementId - The BPMN element ID.
   * @param {string} [elementName=''] - Human-readable element name.
   * @returns {{ locator_type: string, locator: string, excerpt: string }}
   */
  function bpmnElementLocator(elementId, elementName = '') {
    return {
      locator_type: 'BPMN_ELEMENT',
      locator: `${filePath}#${elementId}`,
      excerpt: elementName || elementId,
    };
  }

  return { lineLocator, pageLocator, bpmnElementLocator };
}
