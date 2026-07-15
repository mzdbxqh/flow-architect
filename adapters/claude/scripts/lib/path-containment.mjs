import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve a path to its real (symlink-free) location.
 * For non-existent paths, resolves the parent directory and appends the basename.
 *
 * @param {string} filePath - The path to resolve.
 * @returns {string} The resolved real path.
 */
function safeRealpath(filePath) {
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    // 文件不存在时，解析父目录的真实路径
    const dir = path.dirname(resolved);
    const base = path.basename(resolved);
    try {
      return path.join(fs.realpathSync(dir), base);
    } catch {
      // 父目录也不存在，返回绝对路径
      return resolved;
    }
  }
}

/**
 * Check whether `filePath` resolves to a real path that is inside `root`.
 *
 * Both paths are resolved to their real (symlink-free) locations via `fs.realpathSync`.
 * For non-existent paths, the parent directory is resolved instead.
 *
 * @param {string} filePath - The path to check.
 * @param {string} root - The root directory that must contain the path.
 * @returns {boolean} True if the real path of filePath starts within root.
 */
export function isPathContained(filePath, root) {
  const realFile = safeRealpath(filePath);
  const realRoot = safeRealpath(root);
  return realFile === realRoot || realFile.startsWith(realRoot + path.sep);
}
