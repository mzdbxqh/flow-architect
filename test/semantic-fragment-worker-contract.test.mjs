import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('Semantic Fragment Worker Contract', () => {
  describe('Worker Protocol Document', () => {
    it('should exist and contain required sections', async () => {
      const content = await readFile(
        join(__dirname, '../agents/flow-architect-extract-process-fragment-worker.md'),
        'utf8'
      );

      assert.ok(content.includes('单批次限制'), 'Should mention single batch limit');
      assert.ok(content.includes('prompt-injection'), 'Should mention prompt injection boundary');
      assert.ok(content.includes('JSON'), 'Should mention JSON-only output');
      assert.ok(content.includes('evidence_refs'), 'Should mention evidence references');
      assert.ok(content.includes('certainty'), 'Should mention certainty rules');
    });
  });

  describe('Worker Input Constraints', () => {
    it('should accept only one batch per invocation', async () => {
      const protocol = await readFile(
        join(__dirname, '../references/process-fragment-protocol.md'),
        'utf8'
      );

      assert.ok(protocol.includes('只处理一个 batch'), 'Protocol should specify single batch');
      assert.ok(protocol.includes('不得读取其他 batch'), 'Should forbid reading other batches');
    });

    it('should forbid reading run final directory', async () => {
      const protocol = await readFile(
        join(__dirname, '../references/process-fragment-protocol.md'),
        'utf8'
      );

      assert.ok(protocol.includes('final') && protocol.includes('禁止'),
        'Should forbid reading final directory');
    });
  });

  describe('Worker Output Contract', () => {
    it('should require JSON-only output', async () => {
      const protocol = await readFile(
        join(__dirname, '../references/process-fragment-protocol.md'),
        'utf8'
      );

      assert.ok(protocol.includes('JSON'), 'Protocol should require JSON output');
    });

    it('should require evidence_refs from current batch only', async () => {
      const protocol = await readFile(
        join(__dirname, '../references/process-fragment-protocol.md'),
        'utf8'
      );

      assert.ok(protocol.includes('当前 batch'), 'Should reference current batch only');
    });

    it('should require INFERRED to provide reasoning', async () => {
      const protocol = await readFile(
        join(__dirname, '../references/process-fragment-protocol.md'),
        'utf8'
      );

      assert.ok(protocol.includes('INFERRED'), 'Should mention INFERRED status');
      assert.ok(protocol.includes('推断依据'), 'Should require reasoning for INFERRED');
    });
  });

  describe('Accept Semantic Fragment', () => {
    function v2Fragment(overrides = {}) {
      return {
        schema_version: '2.0.0',
        task_kind: 'ACTIVITY_CATALOG',
        batch_id: 'EB-test',
        batch_sha256: 'a'.repeat(64),
        payload: {
          facts: [{
            fact_id: 'F-001',
            kind: 'ACTIVITY',
            process_key: 'test',
            subject_key: 'test',
            label: 'Test',
            attributes: {},
            certainty: 'EXPLICIT',
            evidence_refs: ['B-001'],
          }],
          uncertainties: [],
        },
        ...overrides,
      };
    }

    function validBatch(batchId = 'EB-test') {
      return {
        batch_id: batchId,
        batch_sha256: 'a'.repeat(64),
        blocks: [{
          block_id: 'B-001',
          source_format: 'md',
          modality: 'TEXT',
          locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
          heading_path: [],
          content_sha256: 'b'.repeat(64),
        }],
        total_chars: 100,
        modality_mix: ['TEXT'],
      };
    }

    it('should validate V2 fragment against batch', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const result = await acceptSemanticFragment({ fragment: v2Fragment(), batch: validBatch() });
      assert.equal(result.accepted, true, 'Valid V2 fragment should be accepted');
    });

    it('should reject V1 fragment', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const fragment = {
        schema_version: '1.0.0',
        batch_id: 'EB-test',
        batch_sha256: 'a'.repeat(64),
        facts: [],
        uncertainties: [],
      };
      const result = await acceptSemanticFragment({ fragment, batch: validBatch() });
      assert.equal(result.accepted, false, 'V1 fragment should be rejected');
    });

    it('should reject fragment with wrong batch_id', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const fragment = v2Fragment({ batch_id: 'EB-wrong' });
      const result = await acceptSemanticFragment({ fragment, batch: validBatch() });
      assert.equal(result.accepted, false, 'Wrong batch_id should be rejected');
    });

    it('should reject fragment with evidence_refs not in batch', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const fragment = v2Fragment();
      fragment.payload.facts[0].evidence_refs = ['B-999'];
      const result = await acceptSemanticFragment({ fragment, batch: validBatch() });
      assert.equal(result.accepted, false, 'Invalid evidence_refs should be rejected');
    });

    it('should reject fragment with duplicate fact IDs', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const fragment = v2Fragment();
      fragment.payload.facts.push({
        fact_id: 'F-001',
        kind: 'ACTIVITY',
        process_key: 'test',
        subject_key: 'test',
        label: 'Test 2',
        attributes: {},
        certainty: 'EXPLICIT',
        evidence_refs: ['B-001'],
      });
      const result = await acceptSemanticFragment({ fragment, batch: validBatch() });
      assert.equal(result.accepted, false, 'Duplicate fact IDs should be rejected');
    });
  });

  describe('Accept with Queue (runDir)', () => {
    let tempDir;

    before(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'accept-queue-test-'));
    });

    after(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    function validFragment(batchId = 'EB-001', kind = 'ACTIVITY_CATALOG') {
      // 每个 task_kind 使用对应的 fact kind
      const factKindMap = {
        'PROCESS_CARD': 'PROCESS_NAME',
        'ACTIVITY_CATALOG': 'ACTIVITY',
        'CONTROL_FLOW': 'FLOW',
      };
      return {
        schema_version: '2.0.0',
        task_kind: kind,
        batch_id: batchId,
        batch_sha256: 'a'.repeat(64),
        payload: {
          facts: [{
            fact_id: 'F-001',
            kind: factKindMap[kind],
            process_key: 'test',
            subject_key: 'test',
            label: '测试事实',
            attributes: {},
            certainty: 'EXPLICIT',
            evidence_refs: ['B-001'],
          }],
          uncertainties: [],
        },
      };
    }

    function validBatch(batchId = 'EB-001') {
      return {
        batch_id: batchId,
        batch_sha256: 'a'.repeat(64),
        blocks: [{ block_id: 'B-001' }],
        total_chars: 100,
        modality_mix: ['TEXT'],
      };
    }

    function v2QueueEntry(batchId = 'EB-001', kind = 'ACTIVITY_CATALOG') {
      // 按照修复目标：task ID 使用 <batch>-card/-activity/-flow 格式
      const suffixMap = {
        'PROCESS_CARD': 'card',
        'ACTIVITY_CATALOG': 'activity',
        'CONTROL_FLOW': 'flow',
      };
      return {
        batch_id: batchId,
        task_kind: kind,
        task_id: `${batchId}-${suffixMap[kind]}`,
        batch_sha256: 'a'.repeat(64),
        status: 'PENDING',
      };
    }

    async function setupRunDir(runDir, queue) {
      await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
      await writeFile(
        join(runDir, 'stages', 'semantic', 'queue.json'),
        JSON.stringify(queue)
      );
    }

    it('应拒绝: queue 文件缺失', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'no-queue-' + Date.now());
      await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });

      const result = await acceptSemanticFragment({
        fragment: validFragment(),
        batch: validBatch(),
        runDir,
      });

      assert.equal(result.accepted, false, 'queue 缺失时应拒绝');
      assert.ok(result.errors.some(e => e.includes('Queue') || e.includes('queue')),
        '错误应提及 queue');
    });

    it('应拒绝: task 未在 queue 中登记', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'not-registered-' + Date.now());
      const queue = {
        schema_version: '2.0.0',
        batches: [v2QueueEntry('EB-OTHER')],
        total_batches: 1,
        total_tasks: 1,
        total_blocks: 1,
      };
      await setupRunDir(runDir, queue);

      const result = await acceptSemanticFragment({
        fragment: validFragment('EB-001'),
        batch: validBatch('EB-001'),
        runDir,
      });

      assert.equal(result.accepted, false, 'task 未登记时应拒绝');
    });

    it('应拒绝: queue 中 hash 与 batch hash 不匹配', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'hash-mismatch-' + Date.now());
      const entry = v2QueueEntry();
      entry.batch_sha256 = 'f'.repeat(64);
      const queue = {
        schema_version: '2.0.0',
        batches: [entry],
        total_batches: 1,
        total_tasks: 1,
        total_blocks: 1,
      };
      await setupRunDir(runDir, queue);

      const result = await acceptSemanticFragment({
        fragment: validFragment(),
        batch: validBatch(),
        runDir,
      });

      assert.equal(result.accepted, false, 'hash 不匹配时应拒绝');
      assert.ok(result.errors.some(e => e.includes('hash') || e.includes('Hash') || e.includes('mismatch')),
        '错误应提及 hash 不匹配');
    });

    it('应无半状态: 验证失败时 fragment 文件和 queue 都不被修改', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'no-half-state-' + Date.now());
      const entry = v2QueueEntry();
      entry.batch_sha256 = 'f'.repeat(64);  // 不匹配
      const queue = {
        schema_version: '2.0.0',
        batches: [entry],
        total_batches: 1,
        total_tasks: 1,
        total_blocks: 1,
      };
      await setupRunDir(runDir, queue);

      const result = await acceptSemanticFragment({
        fragment: validFragment(),
        batch: validBatch(),
        runDir,
      });

      assert.equal(result.accepted, false, '应拒绝');

      // fragment 目录应为空
      const fragDir = join(runDir, 'stages', 'semantic', 'fragments');
      const fragFiles = await readdir(fragDir);
      assert.equal(fragFiles.length, 0, 'fragment 文件不应被写入');

      // queue 状态仍为 PENDING
      const queueAfter = JSON.parse(
        await readFile(join(runDir, 'stages', 'semantic', 'queue.json'), 'utf8')
      );
      assert.equal(queueAfter.batches[0].status, 'PENDING', 'queue 状态不应改变');
    });

    it('应成功: queue 存在、task 已登记、hash 匹配', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'success-' + Date.now());
      const queue = {
        schema_version: '2.0.0',
        batches: [v2QueueEntry()],
        total_batches: 1,
        total_tasks: 1,
        total_blocks: 1,
      };
      await setupRunDir(runDir, queue);

      const result = await acceptSemanticFragment({
        fragment: validFragment(),
        batch: validBatch(),
        runDir,
      });

      assert.equal(result.accepted, true, '应验收通过');

      // fragment 文件应已写入（使用 task_id）
      const fragContent = JSON.parse(
        await readFile(join(runDir, 'stages', 'semantic', 'fragments', 'EB-001-activity.json'), 'utf8')
      );
      assert.equal(fragContent.batch_id, 'EB-001');
      assert.equal(fragContent.task_kind, 'ACTIVITY_CATALOG');

      // queue 状态应更新为 ACCEPTED
      const queueAfter = JSON.parse(
        await readFile(join(runDir, 'stages', 'semantic', 'queue.json'), 'utf8')
      );
      assert.equal(queueAfter.batches[0].status, 'ACCEPTED', 'queue 状态应为 ACCEPTED');
    });

    it('同 batch 三任务分别验收且文件不冲突', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'three-tasks-' + Date.now());

      const kinds = ['PROCESS_CARD', 'ACTIVITY_CATALOG', 'CONTROL_FLOW'];
      const queueEntries = kinds.map(kind => v2QueueEntry('EB-multi', kind));
      const queue = {
        schema_version: '2.0.0',
        batches: queueEntries,
        total_batches: 1,
        total_tasks: 3,
        total_blocks: 1,
      };
      await setupRunDir(runDir, queue);

      const batch = {
        batch_id: 'EB-multi',
        batch_sha256: 'a'.repeat(64),
        blocks: [{ block_id: 'B-001' }],
        total_chars: 100,
        modality_mix: ['TEXT'],
      };

      for (const kind of kinds) {
        const fragment = validFragment('EB-multi', kind);
        const result = await acceptSemanticFragment({ fragment, batch, runDir });
        assert.equal(result.accepted, true, `${kind} 应验收通过`);
      }

      // 三个 fragment 文件应互不覆盖
      const fragDir = join(runDir, 'stages', 'semantic', 'fragments');
      const fragFiles = await readdir(fragDir);
      assert.equal(fragFiles.length, 3, '应有 3 个 fragment 文件');
      assert.ok(fragFiles.includes('EB-multi-card.json'), '应有 card fragment');
      assert.ok(fragFiles.includes('EB-multi-activity.json'), '应有 activity fragment');
      assert.ok(fragFiles.includes('EB-multi-flow.json'), '应有 flow fragment');
    });
  });
});
