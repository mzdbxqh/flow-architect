import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdtemp, rm, symlink, mkdir, readlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('Path Containment & Symlink Protection', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'containment-test-'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('isPathContained', () => {
    it('should accept path inside root', async () => {
      const { isPathContained } = await import('../scripts/lib/path-containment.mjs');
      const root = join(tempDir, 'root');
      await mkdir(root, { recursive: true });
      const file = join(root, 'sub', 'file.txt');
      await mkdir(join(root, 'sub'), { recursive: true });
      await writeFile(file, 'test');

      assert.ok(isPathContained(file, root), 'Path inside root should be contained');
    });

    it('should reject path outside root', async () => {
      const { isPathContained } = await import('../scripts/lib/path-containment.mjs');
      const root = join(tempDir, 'root2');
      await mkdir(root, { recursive: true });
      const outside = join(tempDir, 'outside', 'file.txt');

      assert.ok(!isPathContained(outside, root), 'Path outside root should not be contained');
    });

    it('should reject symlink that escapes root', async () => {
      const { isPathContained } = await import('../scripts/lib/path-containment.mjs');
      const root = join(tempDir, 'root3');
      const escape = join(tempDir, 'escape');
      await mkdir(root, { recursive: true });
      await mkdir(escape, { recursive: true });
      await writeFile(join(escape, 'secret.txt'), 'secret');

      // 创建一个从 root 内指向 root 外的符号链接
      const symlinkPath = join(root, 'escape-link');
      await symlink(escape, symlinkPath);

      // isPathContained 应该解析符号链接的真实路径
      const targetPath = join(symlinkPath, 'secret.txt');
      assert.ok(!isPathContained(targetPath, root),
        'Symlink escaping root should not be contained');
    });

    it('should accept symlink inside root pointing to file inside root', async () => {
      const { isPathContained } = await import('../scripts/lib/path-containment.mjs');
      const root = join(tempDir, 'root4');
      await mkdir(root, { recursive: true });
      await writeFile(join(root, 'real.txt'), 'data');

      const symlinkPath = join(root, 'link.txt');
      await symlink(join(root, 'real.txt'), symlinkPath);

      assert.ok(isPathContained(symlinkPath, root),
        'Symlink inside root pointing inside root should be contained');
    });

    it('should handle same-prefix but different path (prefix escape)', async () => {
      const { isPathContained } = await import('../scripts/lib/path-containment.mjs');
      const root = join(tempDir, 'mydir');
      await mkdir(root, { recursive: true });

      // /tmp/.../mydir-evil 应该不在 /tmp/.../mydir 内
      const evilDir = join(tempDir, 'mydir-evil');
      await mkdir(evilDir, { recursive: true });
      await writeFile(join(evilDir, 'file.txt'), 'evil');

      assert.ok(!isPathContained(join(evilDir, 'file.txt'), root),
        'Same-prefix escape should not be contained');
    });
  });

  describe('writeJsonAtomic containment', () => {
    it('should write JSON atomically inside allowed root', async () => {
      const { writeJsonAtomic } = await import('../scripts/lib/atomic-json.mjs');
      const root = join(tempDir, 'atomic-root');
      await mkdir(root, { recursive: true });
      const filePath = join(root, 'test.json');

      writeJsonAtomic(filePath, { test: true }, root);

      const content = JSON.parse(await readFile(filePath, 'utf8'));
      assert.deepEqual(content, { test: true });
    });

    it('should reject write outside allowed root', async () => {
      const { writeJsonAtomic } = await import('../scripts/lib/atomic-json.mjs');
      const root = join(tempDir, 'atomic-root2');
      await mkdir(root, { recursive: true });
      const outsidePath = join(tempDir, 'outside-atomic.json');

      assert.throws(
        () => writeJsonAtomic(outsidePath, { test: true }, root),
        /Path containment violation/,
        'Should reject write outside root'
      );
    });

    it('should reject write through symlink escaping root', async () => {
      const { writeJsonAtomic } = await import('../scripts/lib/atomic-json.mjs');
      const root = join(tempDir, 'atomic-root3');
      const escape = join(tempDir, 'atomic-escape');
      await mkdir(root, { recursive: true });
      await mkdir(escape, { recursive: true });

      // 创建符号链接
      const symlinkPath = join(root, 'escape-link');
      await symlink(escape, symlinkPath);

      const targetPath = join(symlinkPath, 'evil.json');
      assert.throws(
        () => writeJsonAtomic(targetPath, { evil: true }, root),
        /Path containment violation/,
        'Should reject write through escaping symlink'
      );
    });
  });

  describe('Atomic Write Integrity', () => {
    it('should not leave partial files on write', async () => {
      const { writeJsonAtomic } = await import('../scripts/lib/atomic-json.mjs');
      const root = join(tempDir, 'atomic-integrity');
      await mkdir(root, { recursive: true });
      const filePath = join(root, 'integrity.json');

      writeJsonAtomic(filePath, { data: 'x'.repeat(10000) }, root);

      // 文件应该完整写入
      const content = JSON.parse(await readFile(filePath, 'utf8'));
      assert.equal(content.data.length, 10000, 'Full content should be written');
    });

    it('should produce deterministic output for same value', async () => {
      const { writeJsonAtomic } = await import('../scripts/lib/atomic-json.mjs');
      const root = join(tempDir, 'atomic-deterministic');
      await mkdir(root, { recursive: true });

      const value = { b: 2, a: 1, nested: { z: 3, y: 4 } };
      const path1 = join(root, 'det1.json');
      const path2 = join(root, 'det2.json');

      writeJsonAtomic(path1, value, root);
      writeJsonAtomic(path2, value, root);

      const content1 = await readFile(path1, 'utf8');
      const content2 = await readFile(path2, 'utf8');

      assert.equal(content1, content2, 'Same value should produce same JSON output');
    });
  });

  describe('Symlink Containment in RunDir', () => {
    it('should not allow runDir to be a symlink escaping containment', async () => {
      const { isPathContained } = await import('../scripts/lib/path-containment.mjs');
      const allowed = join(tempDir, 'allowed');
      const escape = join(tempDir, 'escape-dir');
      await mkdir(allowed, { recursive: true });
      await mkdir(escape, { recursive: true });

      const symlinkRunDir = join(allowed, 'run');
      await symlink(escape, symlinkRunDir);

      // isPathContained 应该解析符号链接
      const realPath = join(symlinkRunDir, 'output.json');
      assert.ok(!isPathContained(realPath, allowed),
        'Symlinked runDir escaping should not be contained');
    });

    it('should allow runDir as symlink inside allowed root', async () => {
      const { isPathContained } = await import('../scripts/lib/path-containment.mjs');
      const root = join(tempDir, 'root-inner');
      const realDir = join(root, 'real-run');
      await mkdir(realDir, { recursive: true });

      const symlinkRunDir = join(root, 'run-link');
      await symlink(realDir, symlinkRunDir);

      const realPath = join(symlinkRunDir, 'output.json');
      assert.ok(isPathContained(realPath, root),
        'Symlink inside root should be contained');
    });
  });
});
