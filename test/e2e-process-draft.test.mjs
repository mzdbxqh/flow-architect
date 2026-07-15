import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { extractBpmn } from '../scripts/extract-bpmn.mjs';
import { extractMeetingPackageHtml } from '../scripts/lib/meeting-package-html.mjs';

const execFileAsync = promisify(execFile);
const testDir = fileURLToPath(new URL('.', import.meta.url));
const packageDir = join(testDir, '..');
const fixtureDir = join(testDir, 'fixtures', 'process-draft', 'sources');
const node = process.execPath;

async function runScript(script, args) {
  return execFileAsync(node, [join(packageDir, 'scripts', script), ...args], {
    cwd: packageDir,
    maxBuffer: 20 * 1024 * 1024,
  });
}

test('多源材料经零 LLM CLI 流水线生成可复读的 L5 会议包', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flow-architect-e2e-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const runDir = join(root, 'run');
  const inputs = [
    'sample.md',
    'sample.docx',
    'sample.xlsx',
    'sample.pptx',
    'sample.pdf',
    'test.bpmn',
  ].map(name => join(fixtureDir, name));

  const prepareArgs = inputs.flatMap(input => ['--input', input]);
  prepareArgs.push('--run-dir', runDir, '--title', '多源采购审批流程');
  await runScript('prepare-process-draft.mjs', prepareArgs);

  const manifest = JSON.parse(await readFile(join(runDir, 'input', 'input-manifest.json'), 'utf8'));
  assert.deepEqual(
    new Set(manifest.artifacts.map(item => item.format)),
    new Set(['md', 'docx', 'xlsx', 'pptx', 'pdf', 'bpmn']),
    '六种真实输入都必须进入 manifest',
  );

  const batchDir = join(runDir, 'evidence', 'batches');
  const batchFiles = (await readdir(batchDir)).filter(name => name.endsWith('.json')).sort();
  assert.ok(batchFiles.length > 0, 'prepare 必须生成真实 batch');

  let maxBatchChars = 0;
  let visualBatches = 0;
  for (const [index, filename] of batchFiles.entries()) {
    const batchPath = join(batchDir, filename);
    const batch = JSON.parse(await readFile(batchPath, 'utf8'));
    const visualCount = batch.blocks.filter(block => block.modality === 'VISUAL_ASSET').length;
    maxBatchChars = Math.max(maxBatchChars, batch.total_chars);
    if (visualCount > 0) visualBatches++;

    assert.ok(batch.total_chars <= 12_000, `${batch.batch_id} 超过字符预算`);
    assert.ok(batch.blocks.length <= 12, `${batch.batch_id} 超过 block 预算`);
    assert.ok(visualCount <= 1, `${batch.batch_id} 超过视觉资产预算`);
    assert.ok(batch.blocks.every(block => block.artifact_sha256), 'batch block 必须保留源文件哈希');

    const evidenceRef = batch.blocks[0].block_id;
    const suffix = String(index + 1).padStart(3, '0');
    const facts = [];
    if (index === 0) {
      facts.push({
        fact_id: 'F-role-001',
        kind: 'ROLE',
        process_key: 'procurement-approval',
        subject_key: 'applicant',
        label: '申请人',
        attributes: {},
        certainty: 'EXPLICIT',
        evidence_refs: [evidenceRef],
      });
    }
    facts.push({
      fact_id: `F-activity-${suffix}`,
      kind: 'ACTIVITY',
      process_key: 'procurement-approval',
      subject_key: `activity-${suffix}`,
      label: `待确认活动 ${suffix}`,
      attributes: { inputs: [], outputs: [] },
      certainty: 'EXPLICIT',
      evidence_refs: [evidenceRef],
    });

    const fragment = {
      schema_version: '1.0.0',
      batch_id: batch.batch_id,
      batch_sha256: batch.batch_sha256,
      facts,
      uncertainties: [],
    };
    const fragmentPath = join(root, `${batch.batch_id}.fragment.json`);
    await writeFile(fragmentPath, `${JSON.stringify(fragment, null, 2)}\n`);
    await runScript('accept-semantic-fragment.mjs', [
      '--fragment', fragmentPath,
      '--batch', batchPath,
      '--run-dir', runDir,
    ]);
  }

  const acceptedQueue = JSON.parse(await readFile(join(runDir, 'stages', 'semantic', 'queue.json'), 'utf8'));
  assert.ok(acceptedQueue.batches.every(item => item.status === 'ACCEPTED'));
  assert.ok(acceptedQueue.batches.every(item => /^[a-f0-9]{64}$/.test(item.fragment_sha256)));

  await runScript('merge-process-fragments.mjs', ['--run-dir', runDir]);
  await runScript('finalize-process-draft.mjs', ['--run-dir', runDir, '--revision', 'r01']);

  const finalDir = join(runDir, 'final');
  const draft = JSON.parse(await readFile(join(finalDir, 'process-draft.json'), 'utf8'));
  const questions = JSON.parse(await readFile(join(finalDir, 'questions.json'), 'utf8'));
  const bpmn = await readFile(join(finalDir, 'process.bpmn'), 'utf8');
  const htmlName = (await readdir(finalDir)).find(name => name.endsWith('-r01.html'));
  assert.ok(htmlName, 'finalize 必须生成 r01 HTML');
  const html = await readFile(join(finalDir, htmlName), 'utf8');

  assert.ok(draft.questions.some(question => question.status === 'OPEN'), '缺少责任角色必须形成 OPEN 问题');
  assert.ok(questions.some(question => question.status === 'OPEN'));

  const diagram = extractBpmn(bpmn);
  assert.ok(diagram.elements.some(element => element.type === 'TASK'), '生成 BPMN 必须可由 extractBpmn 复读');
  assert.ok(diagram.flows.length >= draft.elements.length, '开始/结束连接必须可复读');

  const payload = extractMeetingPackageHtml(html);
  assert.equal(payload.bpmn_xml, bpmn, 'HTML BPMN payload 必须与独立文件按字节一致');
  assert.deepEqual(payload.questions, questions, 'HTML questions payload 必须与独立文件一致');
  assert.equal(payload.metadata.revision, 'r01');

  const extractedFormats = new Set(draft.source_summary.formats);
  const degradedFormats = manifest.artifacts
    .map(item => item.format)
    .filter(format => !extractedFormats.has(format));
  for (const format of degradedFormats) {
    assert.ok(
      manifest.warnings.some(warning => warning.toLowerCase().includes(format)),
      `${format} 未抽取时必须留下明确降级警告`,
    );
  }

  const metrics = {
    input_formats: [...new Set(manifest.artifacts.map(item => item.format))].sort(),
    extracted_formats: [...extractedFormats].sort(),
    degraded_formats: degradedFormats.sort(),
    batch_count: batchFiles.length,
    max_batch_chars: maxBatchChars,
    visual_batch_count: visualBatches,
    cache_hit_count: acceptedQueue.batches.filter(item => item.status === 'CACHED').length,
    question_count: draft.questions.length,
    html_bytes: Buffer.byteLength(html),
  };
  console.log(`FLOW_ARCHITECT_E2E_METRICS ${JSON.stringify(metrics)}`);
});
