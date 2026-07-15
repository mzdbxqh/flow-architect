import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const execFileAsync = promisify(execFile);

describe('Process Draft Prepare', () => {
  let tempDir;
  let fixturesDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'prepare-test-'));
    fixturesDir = join(__dirname, 'fixtures/process-draft/sources');
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should generate all required output files', async () => {
    const runDir = join(tempDir, 'run1');
    const mdPath = join(fixturesDir, 'sample.md');

    const { stdout } = await execFileAsync('node', [
      join(__dirname, '../scripts/prepare-process-draft.mjs'),
      '--input', mdPath,
      '--run-dir', runDir,
      '--title', '测试流程',
    ]);

    assert.ok(stdout.includes('完成'), 'Should complete successfully');

    // Check output files exist
    await assertFileExists(join(runDir, 'input/input-manifest.json'));
    await assertFileExists(join(runDir, 'evidence/evidence-index.json'));
    await assertFileExists(join(runDir, 'stages/semantic/queue.json'));
  });

  it('should produce deterministic output for same input', async () => {
    const runDir1 = join(tempDir, 'det1');
    const runDir2 = join(tempDir, 'det2');
    const mdPath = join(fixturesDir, 'sample.md');

    await execFileAsync('node', [
      join(__dirname, '../scripts/prepare-process-draft.mjs'),
      '--input', mdPath, '--run-dir', runDir1, '--title', '测试',
    ]);

    await execFileAsync('node', [
      join(__dirname, '../scripts/prepare-process-draft.mjs'),
      '--input', mdPath, '--run-dir', runDir2, '--title', '测试',
    ]);

    const manifest1 = await readFile(join(runDir1, 'input/input-manifest.json'), 'utf8');
    const manifest2 = await readFile(join(runDir2, 'input/input-manifest.json'), 'utf8');

    // Compare without timestamps
    const m1 = JSON.parse(manifest1);
    const m2 = JSON.parse(manifest2);
    delete m1.created_at;
    delete m2.created_at;

    assert.deepEqual(m1, m2, 'Same input should produce same manifest (except timestamp)');
  });

  it('should support dry-run mode', async () => {
    const runDir = join(tempDir, 'dryrun');
    const mdPath = join(fixturesDir, 'sample.md');

    const { stdout } = await execFileAsync('node', [
      join(__dirname, '../scripts/prepare-process-draft.mjs'),
      '--input', mdPath,
      '--run-dir', runDir,
      '--title', '测试',
      '--dry-run',
    ]);

    assert.ok(stdout.includes('Dry-Run'), 'Should show dry-run mode');
    assert.ok(stdout.includes('计划哈希'), 'Should show plan hash');

    // Should not create files
    try {
      await stat(join(runDir, 'input/input-manifest.json'));
      assert.fail('Should not create files in dry-run mode');
    } catch (err) {
      assert.ok(err.code === 'ENOENT', 'File should not exist');
    }
  });

  it('should accept multiple input files', async () => {
    const runDir = join(tempDir, 'multi');
    const mdPath = join(fixturesDir, 'sample.md');

    const { stdout } = await execFileAsync('node', [
      join(__dirname, '../scripts/prepare-process-draft.mjs'),
      '--input', mdPath,
      '--input', mdPath, // Same file twice for test
      '--run-dir', runDir,
      '--title', '多输入测试',
    ]);

    assert.ok(stdout.includes('完成'), 'Should complete with multiple inputs');
  });

  it('should fail without required parameters', async () => {
    try {
      await execFileAsync('node', [
        join(__dirname, '../scripts/prepare-process-draft.mjs'),
      ]);
      assert.fail('Should fail without parameters');
    } catch (err) {
      assert.ok(err.stderr.includes('必须指定'), 'Should show error message');
    }
  });
});

async function assertFileExists(path) {
  try {
    await stat(path);
  } catch (err) {
    assert.fail(`File should exist: ${path}`);
  }
}
