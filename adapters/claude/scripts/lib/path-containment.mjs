import fs from 'node:fs';
import path from 'node:path';

/**
 * Check whether `filePath` resolves to a real path that is inside `root`.
 *
 * Both paths are resolved to their real (symlink-free) locations via `fs.realpathSync`.
 *
 * @param {string} filePath - The path to check.
 * @param {string} root - The root directory that must contain the path.
 * @returns {boolean} True if the real path of filePath starts within root.
 */
export function isPathContained(filePath, root) {
  const realFile = fs.realpathSync(path.resolve(filePath));
  const realRoot = fs.realpathSync(path.resolve(root));
  return realFile === realRoot || realFile.startsWith(realRoot + path.sep);
}
