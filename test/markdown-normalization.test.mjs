import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// RED: these imports will fail until the module is created
let normalizeEvidenceToMarkdown, renderMarkdownChunk;
try {
  const mod = await import('../scripts/lib/markdown-normalizer.mjs');
  normalizeEvidenceToMarkdown = mod.normalizeEvidenceToMarkdown;
  renderMarkdownChunk = mod.renderMarkdownChunk;
} catch {
  test('markdown-normalizer module exists', () => {
    assert.fail('scripts/lib/markdown-normalizer.mjs does not exist yet');
  });
}

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// --- renderMarkdownChunk ---

test('renderMarkdownChunk 包含 YAML frontmatter 头部', () => {
  const metadata = {
    artifact_id: 'A-001',
    source_sha256: 'abc123',
    source_format: 'md',
    chunk_id: 'C-001',
    content_sha256: 'def456',
    sequence: 1,
    locator: { type: 'heading', path: ['Section 1'] },
    converter_version: '1.0.0',
    modality: 'TEXT',
  };
  const chunk = renderMarkdownChunk({ metadata, content: 'Hello world' });
  assert.match(chunk, /^---\n/);
  assert.match(chunk, /artifact_id: A-001/);
  assert.match(chunk, /source_sha256: abc123/);
  assert.match(chunk, /chunk_id: C-001/);
  assert.match(chunk, /content_sha256:/);
});

test('renderMarkdownChunk 正文中的 --- 不改变头部边界', () => {
  const metadata = {
    artifact_id: 'A-002',
    source_sha256: 'sha',
    source_format: 'md',
    chunk_id: 'C-002',
    content_sha256: 'csha',
    sequence: 1,
    locator: {},
    converter_version: '1.0.0',
    modality: 'TEXT',
  };
  const chunk = renderMarkdownChunk({ metadata, content: 'Before\n---\nAfter' });
  // Frontmatter must start at the very beginning and close properly
  assert.ok(chunk.startsWith('---\n'), 'Must start with frontmatter delimiter');
  // The second --- closes the frontmatter (the content --- comes after)
  const secondDash = chunk.indexOf('\n---\n', 4);
  assert.ok(secondDash > 0, 'Must have closing frontmatter delimiter');
  // Content after frontmatter should contain the original ---
  const body = chunk.slice(secondDash + 5);
  assert.match(body, /---/, 'Body should retain original ---');
});

// --- normalizeEvidenceToMarkdown for Markdown ---

test('Markdown 文件归一化产生带定位的分片', async () => {
  const runDir = path.join(__dirname, 'fixtures', 'tmp-normalize-md');
  fs.mkdirSync(runDir, { recursive: true });

  const blocks = [
    {
      block_id: 'B-001',
      modality: 'TEXT',
      content: '# Title\n\nFirst paragraph.\n\n## Sub\n\nSecond paragraph.',
      locator: { type: 'heading', path: ['Title'] },
      content_sha256: 'hash1',
    },
  ];

  const result = await normalizeEvidenceToMarkdown({
    artifact: { path: '/test.md', format: 'md' },
    artifactSha256: 'art-sha-001',
    blocks,
    runDir,
    converterVersion: '1.0.0',
  });

  assert.ok(result.artifact_id);
  assert.equal(result.artifact_sha256, 'art-sha-001');
  assert.ok(Array.isArray(result.chunks));
  assert.ok(result.chunks.length > 0);

  for (const chunk of result.chunks) {
    assert.ok(chunk.chunk_id);
    assert.ok(chunk.path.startsWith('chunks/'));
    assert.ok(chunk.content_sha256);
    assert.ok(chunk.locator);
    assert.ok(chunk.modality);
  }

  // Clean up
  fs.rmSync(runDir, { recursive: true, force: true });
});

// --- Visual placeholder ---

test('PNG/JPEG 文件生成 VISUAL_REFINEMENT_UNAVAILABLE 占位块', async () => {
  const runDir = path.join(__dirname, 'fixtures', 'tmp-normalize-visual');
  fs.mkdirSync(runDir, { recursive: true });

  const blocks = [
    {
      block_id: 'B-VIS-001',
      modality: 'VISUAL',
      content: '',
      locator: { type: 'page', page: 1 },
      content_sha256: 'vhash',
    },
  ];

  const result = await normalizeEvidenceToMarkdown({
    artifact: { path: '/test.png', format: 'png' },
    artifactSha256: 'art-sha-vis',
    blocks,
    runDir,
    converterVersion: '1.0.0',
  });

  assert.ok(result.chunks.length > 0);
  const visChunk = result.chunks[0];
  assert.equal(visChunk.modality, 'VISUAL');
  assert.match(visChunk.content_sha256, /VISUAL_PLACEHOLDER/);

  // Clean up
  fs.rmSync(runDir, { recursive: true, force: true });
});

// --- Index structure ---

test('归一化结果写入 index.json 和 chunks/ 目录', async () => {
  const runDir = path.join(__dirname, 'fixtures', 'tmp-normalize-index');
  fs.mkdirSync(runDir, { recursive: true });

  const blocks = [
    {
      block_id: 'B-IDX-001',
      modality: 'TEXT',
      content: 'Some content',
      locator: { type: 'paragraph', index: 1 },
      content_sha256: 'idx-hash',
    },
  ];

  const result = await normalizeEvidenceToMarkdown({
    artifact: { path: '/test.docx', format: 'docx' },
    artifactSha256: 'art-sha-idx',
    blocks,
    runDir,
    converterVersion: '1.0.0',
  });

  // Verify index.json exists
  const artifactDir = path.join(runDir, 'normalized', result.artifact_id);
  const indexPath = path.join(artifactDir, 'index.json');
  assert.ok(fs.existsSync(indexPath), 'index.json should exist');

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(index.artifact_sha256, 'art-sha-idx');
  assert.ok(Array.isArray(index.chunks));

  // Verify chunk files exist
  for (const chunk of index.chunks) {
    const chunkPath = path.join(artifactDir, chunk.path);
    assert.ok(fs.existsSync(chunkPath), `Chunk file ${chunk.path} should exist`);
    const chunkContent = fs.readFileSync(chunkPath, 'utf8');
    assert.match(chunkContent, /^---\nartifact_id:/);
  }

  // Clean up
  fs.rmSync(runDir, { recursive: true, force: true });
});

// --- Stable chunk_id ---

test('相同内容和定位产生稳定的 chunk_id', async () => {
  const runDir1 = path.join(__dirname, 'fixtures', 'tmp-normalize-stable1');
  const runDir2 = path.join(__dirname, 'fixtures', 'tmp-normalize-stable2');
  fs.mkdirSync(runDir1, { recursive: true });
  fs.mkdirSync(runDir2, { recursive: true });

  const blocks = [
    {
      block_id: 'B-STABLE',
      modality: 'TEXT',
      content: 'Stable content',
      locator: { type: 'paragraph', index: 1 },
      content_sha256: 'stable-hash',
    },
  ];

  const r1 = await normalizeEvidenceToMarkdown({
    artifact: { path: '/test.md', format: 'md' },
    artifactSha256: 'stable-art',
    blocks,
    runDir: runDir1,
    converterVersion: '1.0.0',
  });

  const r2 = await normalizeEvidenceToMarkdown({
    artifact: { path: '/test.md', format: 'md' },
    artifactSha256: 'stable-art',
    blocks,
    runDir: runDir2,
    converterVersion: '1.0.0',
  });

  assert.equal(r1.chunks[0].chunk_id, r2.chunks[0].chunk_id);

  fs.rmSync(runDir1, { recursive: true, force: true });
  fs.rmSync(runDir2, { recursive: true, force: true });
});

// --- Path containment ---

test('所有输出路径在 runDir/normalized 下', async () => {
  const runDir = path.join(__dirname, 'fixtures', 'tmp-normalize-contain');
  fs.mkdirSync(runDir, { recursive: true });

  const blocks = [
    {
      block_id: 'B-CONT',
      modality: 'TEXT',
      content: 'Contained content',
      locator: {},
      content_sha256: 'cont-hash',
    },
  ];

  const result = await normalizeEvidenceToMarkdown({
    artifact: { path: '/test.md', format: 'md' },
    artifactSha256: 'art-cont',
    blocks,
    runDir,
    converterVersion: '1.0.0',
  });

  const normalizedDir = path.join(runDir, 'normalized');
  for (const chunk of result.chunks) {
    const fullPath = path.join(path.join(normalizedDir, result.artifact_id), chunk.path);
    assert.ok(fullPath.startsWith(normalizedDir), `Path ${chunk.path} must be under normalized/`);
  }

  fs.rmSync(runDir, { recursive: true, force: true });
});
