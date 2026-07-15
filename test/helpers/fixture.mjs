import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve a path relative to the test/fixtures directory.
 * @param {string} relativePath - Path relative to test/fixtures (e.g. 'diagrams/valid.bpmn').
 * @returns {string} Absolute path to the fixture file.
 */
export function fixture(relativePath) {
  return path.join(__dirname, '..', 'fixtures', relativePath);
}

/**
 * Create a unique temporary directory for a test run.
 * @param {string} testName - Identifier used in the directory name.
 * @returns {string} Absolute path to the newly created temp directory.
 */
export function makeRunDir(testName) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flow-architect-' + testName + '-'));
}
