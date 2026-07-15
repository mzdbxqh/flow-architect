import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Generate a filesystem-safe UTC run ID.
 * Format: YYYYMMDDTHHmmss-<8-hex-chars>
 * @returns {string}
 */
export function generateRunId() {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', 'T');
  const hex = crypto.randomBytes(4).toString('hex');
  return `${ts}-${hex}`;
}

/**
 * Create a run directory structure with input/, stages/, and final/ subdirectories,
 * and a placeholder input-manifest.json.
 *
 * @param {{ baseDir: string, runId?: string }} params
 * @param {string} params.baseDir - Absolute path to the directory where runs are stored.
 * @param {string} [params.runId] - Optional run ID. If omitted, one is generated.
 * @returns {{ runDir: string, runId: string }} The absolute path to the run directory and the run ID.
 * @throws {Error} If the run directory already exists.
 */
export function createRun({ baseDir, runId }) {
  if (!baseDir || typeof baseDir !== 'string') {
    throw new Error('baseDir is required and must be a string');
  }

  const id = runId || generateRunId();
  const runDir = path.join(baseDir, id);

  if (fs.existsSync(runDir)) {
    throw new Error(`Run directory already exists: ${runDir}`);
  }

  // Create directory structure
  const dirs = [
    runDir,
    path.join(runDir, 'input'),
    path.join(runDir, 'stages'),
    path.join(runDir, 'final'),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write placeholder input-manifest.json
  const placeholder = {
    schema_version: '1.0.0',
    run_id: id,
    artifacts: [],
    warnings: [],
  };

  fs.writeFileSync(
    path.join(runDir, 'input', 'input-manifest.json'),
    JSON.stringify(placeholder, null, 2) + '\n',
    'utf8'
  );

  return { runDir, runId: id };
}
