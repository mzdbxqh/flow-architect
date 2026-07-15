import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 解析路径到真实（无符号链接）位置。
 * 对于不存在的路径，解析父目录并追加文件名。
 */
function safeRealpath(filePath) {
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    const dir = path.dirname(resolved);
    const base = path.basename(resolved);
    try {
      return path.join(fs.realpathSync(dir), base);
    } catch {
      return resolved;
    }
  }
}

/**
 * Atomically write a JSON value to a file.
 *
 * 1. Resolves the target path and checks it is inside `allowedRoot` (if provided).
 * 2. Writes JSON to a random temp file in the same directory.
 * 3. Calls fsync on the temp file.
 * 4. Renames the temp file to the target path (atomic on POSIX).
 *
 * @param {string} filePath - Destination file path.
 * @param {*} value - Value to JSON-serialize.
 * @param {string} [allowedRoot] - If provided, the resolved path must be inside this root.
 */
export function writeJsonAtomic(filePath, value, allowedRoot) {
  const resolved = path.resolve(filePath);

  if (allowedRoot) {
    const resolvedRoot = path.resolve(allowedRoot);
    const realResolved = safeRealpath(resolved);
    const realRoot = safeRealpath(resolvedRoot);
    if (!realResolved.startsWith(realRoot + path.sep) && realResolved !== realRoot) {
      throw new Error(
        `Path containment violation: ${resolved} is not inside ${resolvedRoot}`
      );
    }
  }

  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });

  const json = JSON.stringify(value, null, 2) + '\n';
  const randomSuffix = crypto.randomBytes(6).toString('hex');
  const tmpPath = `${resolved}.tmp.${process.pid}.${randomSuffix}`;

  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, json, 0, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, resolved);
}
