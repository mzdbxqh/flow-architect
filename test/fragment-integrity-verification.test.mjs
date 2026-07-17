/**
 * 片段完整性验证测试
 *
 * 验收标准来自 phase2-integrity-correction-goal.md：
 * 1. accept 依赖注入 + queue 写失败回滚
 * 2. 共享 fragment 完整性验证函数
 * 3. merge/finalize 双入口调用共享验证
 * 4. prepare-process-draft 缓存恢复一致性
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// ──────────────────────────────────────────────
// 辅助工具
// ──────────────────────────────────────────────

function sha256hex(content) {
  return createHash('sha256').update(content).digest('hex');
}

function makeBatch(batchId, blockIds = ['B-001']) {
  const blocks = blockIds.map(id => ({
    block_id: id,
    source_format: 'md',
    modality: 'TEXT',
    locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
    heading_path: [],
    content_sha256: sha256hex(`content-${id}`),
  }));
  return {
    batch_id: batchId,
    batch_sha256: sha256hex(blocks.map(b => b.content_sha256).sort().join(',')),
    blocks,
    total_chars: 100,
    modality_mix: ['TEXT'],
  };
}

function makeFragment(batch, facts, uncertainties = [], taskKind = 'ACTIVITY_CATALOG') {
  return {
    schema_version: '2.0.0',
    task_kind: taskKind,
    batch_id: batch.batch_id,
    batch_sha256: batch.batch_sha256,
    payload: {
      facts,
      uncertainties,
    },
  };
}

function makeFact(factId, kind = 'ACTIVITY', label = '测试活动', evidenceRefs = ['B-001']) {
  return {
    fact_id: factId,
    kind,
    process_key: 'test',
    subject_key: factId.toLowerCase(),
    label,
    attributes: {},
    certainty: 'EXPLICIT',
    evidence_refs: evidenceRefs,
  };
}

/** 计算 writeJsonAtomic 格式的 fragment SHA-256 */
function fragmentSha256(fragment) {
  const content = JSON.stringify(fragment, null, 2) + '\n';
  return sha256hex(content);
}

/**
 * 创建完整的测试 runDir 结构
 * @param {string} runDir
 * @param {object} opts
 * @param {object} opts.queue - 自定义 queue（可选）
 * @param {object} opts.fragment - 自定义 fragment（可选，覆盖默认）
 * @param {object} opts.batch - 自定义 batch（可选）
 */
async function createRunDir(runDir, opts = {}) {
  const batch = opts.batch || makeBatch('EB-001');

  // 创建3个 fragment（每种 task_kind 一个）
  const fragments = {};
  const fragShas = {};

  const taskKinds = ['PROCESS_CARD', 'ACTIVITY_CATALOG', 'CONTROL_FLOW'];
  const taskSuffixes = { PROCESS_CARD: 'card', ACTIVITY_CATALOG: 'activity', CONTROL_FLOW: 'flow' };

  for (const taskKind of taskKinds) {
    let fragment;
    if (taskKind === 'ACTIVITY_CATALOG') {
      fragment = opts.fragment || makeFragment(batch, [makeFact('F-001', 'ACTIVITY', '提交申请')], [], taskKind);
    } else if (taskKind === 'PROCESS_CARD') {
      fragment = makeFragment(batch, [makeFact('F-001', 'PROCESS_NAME', '测试流程')], [], taskKind);
    } else {
      fragment = makeFragment(batch, [makeFact('F-001', 'FLOW', '流程')], [], taskKind);
    }
    fragments[taskKind] = fragment;
    fragShas[taskKind] = fragmentSha256(fragment);
  }

  await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
  await mkdir(join(runDir, 'stages', 'merge'), { recursive: true });
  await mkdir(join(runDir, 'evidence', 'batches'), { recursive: true });
  await mkdir(join(runDir, 'input'), { recursive: true });

  // 写 fragment 文件（每个 task_kind 一个）
  for (const taskKind of taskKinds) {
    const taskSuffix = taskSuffixes[taskKind];
    await writeFile(
      join(runDir, 'stages', 'semantic', 'fragments', `${batch.batch_id}-${taskSuffix}.json`),
      JSON.stringify(fragments[taskKind], null, 2) + '\n'
    );
  }

  // 写 batch 文件（供 finalize 重验 evidence refs）
  await writeFile(
    join(runDir, 'evidence', 'batches', `${batch.batch_id}.json`),
    JSON.stringify(batch, null, 2)
  );

  // 写 queue（V2: 每个 task_kind 一个 entry）
  const queue = opts.queue || {
    schema_version: '2.0.0',
    batches: taskKinds.map(taskKind => ({
      batch_id: batch.batch_id,
      task_kind: taskKind,
      task_id: `${batch.batch_id}-${taskSuffixes[taskKind]}`,
      batch_sha256: batch.batch_sha256,
      total_chars: batch.total_chars,
      modality_mix: batch.modality_mix,
      block_count: batch.blocks.length,
      status: 'ACCEPTED',
      fragment_sha256: fragShas[taskKind],
    })),
    total_batches: 1,
    total_blocks: batch.blocks.length,
  };
  await writeFile(
    join(runDir, 'stages', 'semantic', 'queue.json'),
    JSON.stringify(queue, null, 2)
  );

  // 写 manifest
  await writeFile(
    join(runDir, 'input', 'input-manifest.json'),
    JSON.stringify({
      schema_version: '2.0.0',
      title: '测试流程',
      focus: null,
      artifacts: [],
      warnings: [],
      created_at: '2026-01-01T00:00:00Z',
    })
  );

  return { batch, fragment: fragments['ACTIVITY_CATALOG'], fragSha: fragShas['ACTIVITY_CATALOG'], queue };
}

// ──────────────────────────────────────────────
// 测试 1: acceptSemanticFragment 依赖注入与原子性
// ──────────────────────────────────────────────

describe('acceptSemanticFragment 原子性 (依赖注入)', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'accept-atomicity-'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('RED: 新 fragment 场景 — queue 写失败时 fragment 不存在且 queue 不变', async () => {
    const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
    const runDir = join(tempDir, 'new-frag-queue-fail');
    const batch = makeBatch('EB-NEW');

    // queue 中有该 batch，状态 PENDING
    await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
    const queue = {
      schema_version: '2.0.0',
      batches: [{
        batch_id: 'EB-NEW',
        task_kind: 'ACTIVITY_CATALOG',
        task_id: 'EB-NEW-activity',
        batch_sha256: batch.batch_sha256,
        total_chars: 100,
        modality_mix: ['TEXT'],
        block_count: 1,
        status: 'PENDING',
        fragment_sha256: null,
      }],
      total_batches: 1,
      total_blocks: 1,
    };
    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const fragment = makeFragment(batch, [makeFact('F-001')], [], 'ACTIVITY_CATALOG');

    // 故障注入：queue 写入时抛出错误
    const failingWriteQueue = async () => {
      throw new Error('INJECTED: queue write failure');
    };

    let result;
    try {
      result = await acceptSemanticFragment({
        fragment,
        batch,
        runDir,
        _writeQueue: failingWriteQueue,  // 依赖注入点
      });
    } catch (err) {
      // 如果函数抛出，也算作失败
      result = { accepted: false, errors: [err.message] };
    }

    assert.equal(result.accepted, false, 'queue 写失败时应返回/抛出失败');

    // fragment 文件不应存在
    const fragPath = join(runDir, 'stages', 'semantic', 'fragments', 'EB-NEW.json');
    try {
      await stat(fragPath);
      assert.fail('fragment 文件不应在 queue 写失败后存在');
    } catch (err) {
      assert.equal(err.code, 'ENOENT', 'fragment 文件应不存在');
    }

    // queue 字节不变
    const queueAfter = await readFile(queuePath, 'utf8');
    assert.equal(queueAfter, JSON.stringify(queue, null, 2), 'queue 字节应与调用前一致');
  });

  it('RED: 已有 fragment 场景 — queue 写失败时旧 fragment 按字节恢复', async () => {
    const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
    const runDir = join(tempDir, 'existing-frag-queue-fail');
    const batch = makeBatch('EB-EXIST');

    // 先创建旧 fragment
    const oldFragment = makeFragment(batch, [makeFact('F-OLD', 'ACTIVITY', '旧活动')], [], 'ACTIVITY_CATALOG');
    const oldContent = JSON.stringify(oldFragment, null, 2) + '\n';

    await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
    const fragPath = join(runDir, 'stages', 'semantic', 'fragments', 'EB-EXIST-activity.json');
    await writeFile(fragPath, oldContent);

    const queue = {
      schema_version: '2.0.0',
      batches: [{
        batch_id: 'EB-EXIST',
        task_kind: 'ACTIVITY_CATALOG',
        task_id: 'EB-EXIST-activity',
        batch_sha256: batch.batch_sha256,
        total_chars: 100,
        modality_mix: ['TEXT'],
        block_count: 1,
        status: 'ACCEPTED',
        fragment_sha256: sha256hex(oldContent),
      }],
      total_batches: 1,
      total_blocks: 1,
    };
    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    // 新 fragment（不同内容）
    const newFragment = makeFragment(batch, [makeFact('F-NEW', 'ACTIVITY', '新活动')], [], 'ACTIVITY_CATALOG');

    // 故障注入：queue 写入失败
    const failingWriteQueue = async () => {
      throw new Error('INJECTED: queue write failure');
    };

    let result;
    try {
      result = await acceptSemanticFragment({
        fragment: newFragment,
        batch,
        runDir,
        _writeQueue: failingWriteQueue,
      });
    } catch (err) {
      result = { accepted: false, errors: [err.message] };
    }

    assert.equal(result.accepted, false, 'queue 写失败时应返回/抛出失败');

    // 旧 fragment 必须按字节恢复
    const fragAfter = await readFile(fragPath, 'utf8');
    assert.equal(fragAfter, oldContent, '旧 fragment 必须按字节恢复');

    // queue 字节不变
    const queueAfter = await readFile(queuePath, 'utf8');
    assert.equal(queueAfter, JSON.stringify(queue, null, 2), 'queue 字节应与调用前一致');
  });

  it('RED: 成功路径 — queue 写入的 fragment_sha256 与落盘 fragment SHA-256 完全一致', async () => {
    const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
    const runDir = join(tempDir, 'success-sha256');
    const batch = makeBatch('EB-SHA');

    await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
    const queue = {
      schema_version: '2.0.0',
      batches: [{
        batch_id: 'EB-SHA',
        task_kind: 'ACTIVITY_CATALOG',
        task_id: 'EB-SHA-activity',
        batch_sha256: batch.batch_sha256,
        total_chars: 100,
        modality_mix: ['TEXT'],
        block_count: 1,
        status: 'PENDING',
        fragment_sha256: null,
      }],
      total_batches: 1,
      total_blocks: 1,
    };
    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const fragment = makeFragment(batch, [makeFact('F-001')], [], 'ACTIVITY_CATALOG');

    // 不注入故障，正常执行
    const result = await acceptSemanticFragment({ fragment, batch, runDir });
    assert.equal(result.accepted, true, '应成功验收');

    // 读取落盘 fragment
    const fragPath = join(runDir, 'stages', 'semantic', 'fragments', 'EB-SHA-activity.json');
    const fragContent = await readFile(fragPath, 'utf8');
    const expectedSha = sha256hex(fragContent);

    // 读取 queue 中的 fragment_sha256
    const queueAfter = JSON.parse(await readFile(queuePath, 'utf8'));
    assert.equal(
      queueAfter.batches[0].fragment_sha256,
      expectedSha,
      'queue 中的 fragment_sha256 必须与落盘 fragment 的 SHA-256 完全一致'
    );
  });
});

// ──────────────────────────────────────────────
// 测试 2: 共享 fragment 完整性验证函数
// ──────────────────────────────────────────────

describe('共享 fragment 完整性验证函数 (verifyFragmentIntegrity)', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'integrity-verify-'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('RED: 合法 ACCEPTED 应通过验证', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'valid-accepted');
    const { batch, fragment } = await createRunDir(runDir);

    const result = await verifyFragmentIntegrity({ runDir, batchId: batch.batch_id });
    assert.equal(result.valid, true, '合法 ACCEPTED 应通过');
  });

  it('RED: 合法 CACHED 应通过验证', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'valid-cached');
    const { batch } = await createRunDir(runDir);

    // 修改 queue 为 CACHED
    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    const queue = JSON.parse(await readFile(queuePath, 'utf8'));
    queue.batches[0].status = 'CACHED';
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = await verifyFragmentIntegrity({ runDir, batchId: batch.batch_id });
    assert.equal(result.valid, true, '合法 CACHED 应通过');
  });

  it('RED: queue 状态为 PENDING 时应失败', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'pending-status');
    const { batch } = await createRunDir(runDir);

    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    const queue = JSON.parse(await readFile(queuePath, 'utf8'));
    queue.batches[0].status = 'PENDING';
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = await verifyFragmentIntegrity({ runDir, batchId: batch.batch_id });
    assert.equal(result.valid, false, 'PENDING 应失败');
    assert.ok(result.errors.some(e => e.includes('ACCEPTED') || e.includes('CACHED') || e.includes('status')),
      '错误应提及状态要求');
  });

  it('RED: fragment 文件缺失时应失败', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'frag-missing');
    const { batch } = await createRunDir(runDir);

    // 删除 fragment 文件（V2: 每个 task_kind 一个文件）
    const { unlink } = await import('node:fs/promises');
    const fragDir = join(runDir, 'stages', 'semantic', 'fragments');
    const files = await readdir(fragDir);
    for (const f of files) {
      if (f.startsWith(batch.batch_id)) {
        await unlink(join(fragDir, f));
      }
    }

    const result = await verifyFragmentIntegrity({ runDir, batchId: batch.batch_id });
    assert.equal(result.valid, false, 'fragment 缺失应失败');
    assert.ok(result.errors.some(e => e.includes('缺失') || e.includes('missing') || e.includes('存在')),
      '错误应提及文件缺失');
  });

  it('RED: fragment 内容被篡改（fragment_sha256 不匹配）时应失败', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'tampered-frag');
    const { batch } = await createRunDir(runDir);

    // 篡改 fragment 内容（V2: activity fragment 文件）
    const fragPath = join(runDir, 'stages', 'semantic', 'fragments', `${batch.batch_id}-activity.json`);
    const frag = JSON.parse(await readFile(fragPath, 'utf8'));
    frag.payload.facts[0].label = '篡改后的标签';
    await writeFile(fragPath, JSON.stringify(frag, null, 2));

    const result = await verifyFragmentIntegrity({ runDir, batchId: batch.batch_id });
    assert.equal(result.valid, false, '篡改 fragment 应失败');
    assert.ok(result.errors.some(e => e.includes('SHA-256') || e.includes('sha256') || e.includes('hash') || e.includes('哈希')),
      '错误应提及哈希不匹配');
  });

  it('RED: fragment 的 batch_id 与 queue 不匹配时应失败', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'batch-id-mismatch');
    const { batch } = await createRunDir(runDir);

    // 修改 fragment 的 batch_id（V2: activity fragment 文件）
    const fragPath = join(runDir, 'stages', 'semantic', 'fragments', `${batch.batch_id}-activity.json`);
    const frag = JSON.parse(await readFile(fragPath, 'utf8'));
    frag.batch_id = 'EB-FAKE';
    await writeFile(fragPath, JSON.stringify(frag, null, 2));

    const result = await verifyFragmentIntegrity({ runDir, batchId: batch.batch_id });
    assert.equal(result.valid, false, 'batch_id 不匹配应失败');
  });

  it('RED: fragment 的 batch_sha256 与 queue 不匹配时应失败', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'batch-sha-mismatch');
    const { batch } = await createRunDir(runDir);

    const fragPath = join(runDir, 'stages', 'semantic', 'fragments', `${batch.batch_id}-activity.json`);
    const frag = JSON.parse(await readFile(fragPath, 'utf8'));
    frag.batch_sha256 = 'x'.repeat(64);
    await writeFile(fragPath, JSON.stringify(frag, null, 2));

    const result = await verifyFragmentIntegrity({ runDir, batchId: batch.batch_id });
    assert.equal(result.valid, false, 'batch_sha256 不匹配应失败');
  });

  it('RED: evidence_ref 指向不存在的 block 时应失败', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'invalid-evidence-ref');
    const batch = makeBatch('EB-REF', ['B-001', 'B-002']);

    // fragment 的 evidence_ref 引用 batch 中不存在的 block
    const fragment = makeFragment(batch, [
      makeFact('F-001', 'ACTIVITY', '活动1', ['B-001']),
      makeFact('F-002', 'ACTIVITY', '活动2', ['B-999']),  // 不存在
    ]);
    await createRunDir(runDir, { batch, fragment });

    const result = await verifyFragmentIntegrity({ runDir, batchId: batch.batch_id });
    assert.equal(result.valid, false, '无效 evidence_ref 应失败');
    assert.ok(result.errors.some(e => e.includes('B-999') || e.includes('evidence_ref') || e.includes('block')),
      '错误应提及无效的 evidence_ref');
  });

  it('RED: evidence_ref 指向另一个 batch 的 block 时应失败', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'cross-batch-ref');
    const batch = makeBatch('EB-CROSS', ['B-001']);

    // fragment 的 evidence_ref 引用其他 batch 的 block（通过 batch 文件重验）
    const fragment = makeFragment(batch, [
      makeFact('F-001', 'ACTIVITY', '活动', ['B-OTHER']),  // 其他 batch 的 block
    ]);
    await createRunDir(runDir, { batch, fragment });

    const result = await verifyFragmentIntegrity({ runDir, batchId: batch.batch_id });
    assert.equal(result.valid, false, '跨 batch evidence_ref 应失败');
  });

  it('RED: 缺少 fragment_sha256 的 ACCEPTED 项应失败', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'missing-frag-sha');
    const { batch } = await createRunDir(runDir);

    // 移除 queue 中的 fragment_sha256
    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    const queue = JSON.parse(await readFile(queuePath, 'utf8'));
    delete queue.batches[0].fragment_sha256;
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = await verifyFragmentIntegrity({ runDir, batchId: batch.batch_id });
    assert.equal(result.valid, false, '缺少 fragment_sha256 的 ACCEPTED 应失败');
    assert.ok(result.errors.some(e => e.includes('fragment_sha256')),
      '错误应提及 fragment_sha256');
  });

  it('RED: 缺少 fragment_sha256 的 CACHED 项应失败', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'missing-frag-sha-cached');
    const { batch } = await createRunDir(runDir);

    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    const queue = JSON.parse(await readFile(queuePath, 'utf8'));
    queue.batches[0].status = 'CACHED';
    delete queue.batches[0].fragment_sha256;
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = await verifyFragmentIntegrity({ runDir, batchId: batch.batch_id });
    assert.equal(result.valid, false, '缺少 fragment_sha256 的 CACHED 应失败');
  });

  it('RED: 批次不存在于 queue 时应失败', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'batch-not-in-queue');
    await createRunDir(runDir);

    const result = await verifyFragmentIntegrity({ runDir, batchId: 'EB-NONEXIST' });
    assert.equal(result.valid, false, '不存在的 batch 应失败');
  });

  it('RED: 验证整个 queue 的所有批次（无 batchId 参数）', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'verify-all');
    await createRunDir(runDir);

    const result = await verifyFragmentIntegrity({ runDir });
    assert.equal(result.valid, true, '合法 queue 应全部通过');
    // V2: 每个 batch 有 3 个 task entry，所以 checked 应为 3
    assert.equal(result.checked, 3, '应检查 3 个 task 条目（每个 batch 3 种 task_kind）');
  });
});

// ──────────────────────────────────────────────
// 测试 3: merge 入口调用共享验证
// ──────────────────────────────────────────────

describe('merge 入口完整性验证 (mergeProcessFragments)', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'merge-integrity-'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('RED: fragment 内容被篡改但 batch hash 不变时应失败', async () => {
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const runDir = join(tempDir, 'merge-tampered');
    const { batch } = await createRunDir(runDir);

    // 篡改 fragment 但不改 batch hash（V2: activity fragment 文件）
    const fragPath = join(runDir, 'stages', 'semantic', 'fragments', `${batch.batch_id}-activity.json`);
    const frag = JSON.parse(await readFile(fragPath, 'utf8'));
    frag.payload.facts[0].label = '篡改后的活动';
    await writeFile(fragPath, JSON.stringify(frag, null, 2));

    // merge 应调用共享验证并检测到篡改
    try {
      await mergeProcessFragments({
        manifest: { title: '测试', focus: null },
        evidence: { blocks: [] },
        fragments: [frag],
        focus: null,
        runDir,  // 传入 runDir 让 merge 调用共享验证
        _verifyFragmentIntegrity: undefined,  // 使用默认实现
      });
      assert.fail('篡改 fragment 应导致 merge 失败');
    } catch (err) {
      assert.ok(
        err.message.includes('SHA-256') || err.message.includes('sha256') ||
        err.message.includes('hash') || err.message.includes('哈希') ||
        err.message.includes('integrity') || err.message.includes('完整性'),
        '错误应提及哈希不匹配或完整性: ' + err.message
      );
    }
  });

  it('RED: evidence_ref 指向不存在的 block 时应失败', async () => {
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const runDir = join(tempDir, 'merge-bad-ref');
    const batch = makeBatch('EB-BADREF', ['B-001']);

    const fragment = makeFragment(batch, [
      makeFact('F-001', 'ACTIVITY', '活动', ['B-999']),
    ]);
    await createRunDir(runDir, { batch, fragment });

    try {
      await mergeProcessFragments({
        manifest: { title: '测试', focus: null },
        evidence: { blocks: [] },
        fragments: [fragment],
        focus: null,
        runDir,
      });
      assert.fail('无效 evidence_ref 应导致 merge 失败');
    } catch (err) {
      assert.ok(
        err.message.includes('evidence_ref') || err.message.includes('B-999') ||
        err.message.includes('block') || err.message.includes('integrity') ||
        err.message.includes('完整性'),
        '错误应提及无效 evidence_ref: ' + err.message
      );
    }
  });

  it('RED: 缺少 fragment_sha256 的 ACCEPTED 项应导致 merge 失败', async () => {
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const runDir = join(tempDir, 'merge-no-sha');
    const { batch, fragment } = await createRunDir(runDir);

    // 移除 fragment_sha256
    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    const queue = JSON.parse(await readFile(queuePath, 'utf8'));
    delete queue.batches[0].fragment_sha256;
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    try {
      await mergeProcessFragments({
        manifest: { title: '测试', focus: null },
        evidence: { blocks: [] },
        fragments: [fragment],
        focus: null,
        runDir,
      });
      assert.fail('缺少 fragment_sha256 应导致 merge 失败');
    } catch (err) {
      assert.ok(
        err.message.includes('fragment_sha256') || err.message.includes('完整性') ||
        err.message.includes('integrity'),
        '错误应提及 fragment_sha256: ' + err.message
      );
    }
  });

  it('RED: 合法 ACCEPTED 应通过 merge', async () => {
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const runDir = join(tempDir, 'merge-valid-accepted');
    const { batch, fragment } = await createRunDir(runDir);

    const result = await mergeProcessFragments({
      manifest: { title: '测试', focus: null },
      evidence: { blocks: batch.blocks },
      fragments: [fragment],
      focus: null,
      runDir,
    });

    assert.ok(result.process_draft, '应生成流程草稿');
    // V2: 检查 activities 而不是 elements
    assert.ok(result.process_draft.activities.length > 0, '应有活动');
  });

  it('RED: 合法 CACHED 应通过 merge', async () => {
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const runDir = join(tempDir, 'merge-valid-cached');
    const { batch, fragment } = await createRunDir(runDir);

    // 修改 queue 为 CACHED
    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    const queue = JSON.parse(await readFile(queuePath, 'utf8'));
    queue.batches[0].status = 'CACHED';
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = await mergeProcessFragments({
      manifest: { title: '测试', focus: null },
      evidence: { blocks: batch.blocks },
      fragments: [fragment],
      focus: null,
      runDir,
    });

    assert.ok(result.process_draft, 'CACHED 应通过 merge');
  });
});

// ──────────────────────────────────────────────
// 测试 4: finalize 入口调用共享验证
// ──────────────────────────────────────────────

describe('finalize 入口完整性验证 (finalizeProcessDraft)', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'finalize-integrity-'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function setupFinalizeRunDir(runDir, opts = {}) {
    const { batch, fragment } = await createRunDir(runDir, opts);

    // 创建 V2 process-draft (符合 process-card.schema.json)
    const draft = {
      schema_version: '2.0.0',
      process_card: {
        process_id: 'test',
        name: '测试流程',
        level: 'L4',
        is_leaf: true,
        description: '测试流程描述',
        purpose: '测试用途',
        owner: '测试负责人',
        parent_process_name: null,
        inputs: [],
        outputs: [],
        start: {
          event_id: 'Start-001',
          name: '提交申请',
          event_type: 'NONE',
        },
        end_results: [{ event_id: 'End-001', name: '提交申请' }],
        performance_indicators: [],
      },
      activities: [
        {
          activity_id: 'Activity-001',
          name: '提交申请',
          description: '提交申请',
          activity_type: 'STANDARD',
          responsibility_model: 'RASCI',
          role_assignments: [{ role_id: 'Lane-001', responsibility: 'R' }],
          sla: null,
          tools: [],
          inputs: [],
          outputs: [],
          process_summary: '提交申请流程',
          completion_criteria: [],
          references: [],
          main_task_id: 'Task-001',
          confirmation: null,
          completeness: 'COMPLETE',
        },
      ],
      diagram: {
        lanes: [{ lane_id: 'Lane-001', name: '申请人', role_id: 'Lane-001' }],
        nodes: [
          { node_id: 'Start-001', node_type: 'START_EVENT', name: '提交申请', lane_id: 'Lane-001' },
          { node_id: 'Task-001', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-001' },
          { node_id: 'End-001', node_type: 'END_EVENT', name: '提交申请', lane_id: 'Lane-001' },
        ],
        flows: [
          { flow_id: 'Flow-001', source_ref: 'Start-001', target_ref: 'Task-001', condition: null },
          { flow_id: 'Flow-002', source_ref: 'Task-001', target_ref: 'End-001', condition: null },
        ],
        task_bindings: [{ activity_id: 'Activity-001', main_task_id: 'Task-001', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
      questions: [{
        question_id: 'Q-001',
        text: '流程待确认',
        target_paths: ['Task-001'],
        status: 'OPEN',
        answer: '',
        evidence_refs: ['B-001'],
      }],
      provenance: {},
      source_summary: { total_blocks: 1, formats: ['md'], evidence_refs: ['B-001'] },
    };
    await writeFile(
      join(runDir, 'stages', 'merge', 'process-draft.json'),
      JSON.stringify(draft, null, 2)
    );

    return { batch, fragment, draft };
  }

  it('RED: fragment 内容被篡改但 batch hash 不变时应失败', async () => {
    const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
    const runDir = join(tempDir, 'finalize-tampered');
    await setupFinalizeRunDir(runDir);

    // 篡改 fragment（V2: activity fragment 文件）
    const fragPath = join(runDir, 'stages', 'semantic', 'fragments', 'EB-001-activity.json');
    const frag = JSON.parse(await readFile(fragPath, 'utf8'));
    frag.payload.facts[0].label = '篡改后的活动';
    await writeFile(fragPath, JSON.stringify(frag, null, 2));

    try {
      await finalizeProcessDraft({ runDir, revision: 'r01' });
      assert.fail('篡改 fragment 应导致 finalize 失败');
    } catch (err) {
      assert.ok(
        err.message.includes('SHA-256') || err.message.includes('sha256') ||
        err.message.includes('hash') || err.message.includes('哈希') ||
        err.message.includes('integrity') || err.message.includes('完整性'),
        '错误应提及哈希不匹配: ' + err.message
      );
    }
  });

  it('RED: evidence_ref 指向不存在的 block 时应失败', async () => {
    const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
    const runDir = join(tempDir, 'finalize-bad-ref');
    const batch = makeBatch('EB-BADREF', ['B-001']);

    const fragment = makeFragment(batch, [
      makeFact('F-001', 'ACTIVITY', '活动', ['B-999']),
    ]);
    await setupFinalizeRunDir(runDir, { batch, fragment });

    try {
      await finalizeProcessDraft({ runDir, revision: 'r01' });
      assert.fail('无效 evidence_ref 应导致 finalize 失败');
    } catch (err) {
      assert.ok(
        err.message.includes('evidence_ref') || err.message.includes('B-999') ||
        err.message.includes('block') || err.message.includes('integrity') ||
        err.message.includes('完整性'),
        '错误应提及无效 evidence_ref: ' + err.message
      );
    }
  });

  it('RED: 缺少 fragment_sha256 的 ACCEPTED 项应失败', async () => {
    const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
    const runDir = join(tempDir, 'finalize-no-sha');
    await setupFinalizeRunDir(runDir);

    // 移除 fragment_sha256
    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    const queue = JSON.parse(await readFile(queuePath, 'utf8'));
    delete queue.batches[0].fragment_sha256;
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    try {
      await finalizeProcessDraft({ runDir, revision: 'r01' });
      assert.fail('缺少 fragment_sha256 应导致 finalize 失败');
    } catch (err) {
      assert.ok(
        err.message.includes('fragment_sha256') || err.message.includes('完整性') ||
        err.message.includes('integrity'),
        '错误应提及 fragment_sha256: ' + err.message
      );
    }
  });

  it('RED: 合法 ACCEPTED 应通过 finalize', async () => {
    const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
    const runDir = join(tempDir, 'finalize-valid-accepted');
    await setupFinalizeRunDir(runDir);

    const result = await finalizeProcessDraft({ runDir, revision: 'r01' });
    assert.ok(result.success, '合法 ACCEPTED 应通过 finalize');
  });

  it('RED: 合法 CACHED 应通过 finalize', async () => {
    const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
    const runDir = join(tempDir, 'finalize-valid-cached');
    await setupFinalizeRunDir(runDir);

    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    const queue = JSON.parse(await readFile(queuePath, 'utf8'));
    // 修改所有 task entry 为 CACHED
    for (const batch of queue.batches) {
      batch.status = 'CACHED';
    }
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = await finalizeProcessDraft({ runDir, revision: 'r01' });
    assert.ok(result.success, '合法 CACHED 应通过 finalize');
  });
});

// ──────────────────────────────────────────────
// 测试 5: prepare-process-draft 缓存恢复一致性
// ──────────────────────────────────────────────

describe('prepare-process-draft 缓存恢复一致性', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cache-consistency-'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('RED: CACHED 条目的 fragment_sha256 必须与复制到 runDir 的 fragment 完全一致', async () => {
    // 此测试验证 prepare-process-draft 从缓存恢复时
    // fragment_sha256 与实际 fragment 内容一致
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'cache-consistent');
    const { batch } = await createRunDir(runDir);

    // 模拟缓存恢复：设置 CACHED 状态
    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    const queue = JSON.parse(await readFile(queuePath, 'utf8'));
    queue.batches[0].status = 'CACHED';
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    // 验证 fragment_sha256 与实际 fragment 一致
    const result = await verifyFragmentIntegrity({ runDir, batchId: batch.batch_id });
    assert.equal(result.valid, true, 'CACHED 条目的 fragment_sha256 应与 fragment 内容一致');
  });

  it('RED: 缓存污染时应检测到 fragment_sha256 不匹配', async () => {
    const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
    const runDir = join(tempDir, 'cache-polluted');
    const { batch } = await createRunDir(runDir);

    // 模拟缓存污染：fragment 内容被修改但 fragment_sha256 未更新（V2: activity fragment 文件）
    const fragPath = join(runDir, 'stages', 'semantic', 'fragments', `${batch.batch_id}-activity.json`);
    const frag = JSON.parse(await readFile(fragPath, 'utf8'));
    frag.payload.facts[0].label = '缓存污染后的内容';
    await writeFile(fragPath, JSON.stringify(frag, null, 2));

    // fragment_sha256 还是旧的
    const result = await verifyFragmentIntegrity({ runDir, batchId: batch.batch_id });
    assert.equal(result.valid, false, '缓存污染应被检测到');
    assert.ok(result.errors.some(e => e.includes('SHA-256') || e.includes('sha256') || e.includes('hash') || e.includes('哈希')),
      '错误应提及哈希不匹配');
  });
});
