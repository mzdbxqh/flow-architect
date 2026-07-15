import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const execFileAsync = promisify(execFile);

describe('Stable Read-Only Dry-Run', () => {
  let tempDir;
  let fixturesDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dryrun-test-'));
    fixturesDir = join(__dirname, 'fixtures/process-draft/sources');
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should not create any files in dry-run mode', async () => {
    const runDir = join(tempDir, 'dryrun-no-files');
    const cacheDir = join(tempDir, 'dryrun-no-files-cache');
    const mdPath = join(fixturesDir, 'sample.md');

    await execFileAsync('node', [
      join(__dirname, '../scripts/prepare-process-draft.mjs'),
      '--input', mdPath,
      '--run-dir', runDir,
      '--cache-dir', cacheDir,
      '--title', '测试',
      '--dry-run',
    ]);

    // 验证 run 目录不存在
    try {
      await stat(runDir);
      assert.fail('Run directory should not exist in dry-run mode');
    } catch (err) {
      assert.ok(err.code === 'ENOENT', 'Run directory should not exist');
    }

    // 验证 cache 目录不存在
    try {
      await stat(cacheDir);
      assert.fail('Cache directory should not exist in dry-run mode');
    } catch (err) {
      assert.ok(err.code === 'ENOENT', 'Cache directory should not exist');
    }
  });

  it('should produce byte-stable output for same inputs', async () => {
    const mdPath = join(fixturesDir, 'sample.md');

    const { stdout: stdout1 } = await execFileAsync('node', [
      join(__dirname, '../scripts/prepare-process-draft.mjs'),
      '--input', mdPath,
      '--run-dir', join(tempDir, 'stable1'),
      '--title', '稳定性测试',
      '--dry-run',
    ]);

    const { stdout: stdout2 } = await execFileAsync('node', [
      join(__dirname, '../scripts/prepare-process-draft.mjs'),
      '--input', mdPath,
      '--run-dir', join(tempDir, 'stable2'),
      '--title', '稳定性测试',
      '--dry-run',
    ]);

    // 提取计划哈希
    const hash1 = stdout1.match(/计划哈希: ([a-f0-9]+)/)?.[1];
    const hash2 = stdout2.match(/计划哈希: ([a-f0-9]+)/)?.[1];

    assert.ok(hash1, 'Run 1 should have plan hash');
    assert.ok(hash2, 'Run 2 should have plan hash');
    assert.equal(hash1, hash2, 'Same inputs should produce same plan hash');
  });

  it('should produce different plan hash for different inputs', async () => {
    const mdPath = join(fixturesDir, 'sample.md');
    const docxPath = join(fixturesDir, 'sample.docx');

    const { stdout: stdout1 } = await execFileAsync('node', [
      join(__dirname, '../scripts/prepare-process-draft.mjs'),
      '--input', mdPath,
      '--run-dir', join(tempDir, 'diff1'),
      '--title', '不同输入测试',
      '--dry-run',
    ]);

    const { stdout: stdout2 } = await execFileAsync('node', [
      join(__dirname, '../scripts/prepare-process-draft.mjs'),
      '--input', docxPath,
      '--run-dir', join(tempDir, 'diff2'),
      '--title', '不同输入测试',
      '--dry-run',
    ]);

    const hash1 = stdout1.match(/计划哈希: ([a-f0-9]+)/)?.[1];
    const hash2 = stdout2.match(/计划哈希: ([a-f0-9]+)/)?.[1];

    assert.ok(hash1, 'Run 1 should have plan hash');
    assert.ok(hash2, 'Run 2 should have plan hash');
    assert.notEqual(hash1, hash2, 'Different inputs should produce different plan hash');
  });

  it('should display cache key and versions in dry-run output', async () => {
    const mdPath = join(fixturesDir, 'sample.md');

    const { stdout } = await execFileAsync('node', [
      join(__dirname, '../scripts/prepare-process-draft.mjs'),
      '--input', mdPath,
      '--run-dir', join(tempDir, 'display'),
      '--title', '显示测试',
      '--dry-run',
    ]);

    assert.ok(stdout.includes('Dry-Run'), 'Should show dry-run mode');
    assert.ok(stdout.includes('缓存键:'), 'Should show cache key');
    assert.ok(stdout.includes('抽取器版本:'), 'Should show extractor version');
    assert.ok(stdout.includes('协议版本:'), 'Should show protocol version');
    assert.ok(stdout.includes('预计批次:'), 'Should show estimated batches');
  });

  it('should show output file paths in dry-run mode', async () => {
    const mdPath = join(fixturesDir, 'sample.md');

    const { stdout } = await execFileAsync('node', [
      join(__dirname, '../scripts/prepare-process-draft.mjs'),
      '--input', mdPath,
      '--run-dir', join(tempDir, 'paths'),
      '--title', '路径测试',
      '--dry-run',
    ]);

    assert.ok(stdout.includes('input-manifest.json'), 'Should mention manifest');
    assert.ok(stdout.includes('evidence-index.json'), 'Should mention evidence index');
    assert.ok(stdout.includes('queue.json'), 'Should mention queue');
  });
});
