import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

/**
 * 写入 batch 文件到 evidence/batches/ 目录
 * 共享验证函数需要读取 batch 文件来重验 evidence_refs
 */
async function writeBatchFile(runDir, batchId, blockIds, batchSha256) {
  await mkdir(join(runDir, 'evidence', 'batches'), { recursive: true });
  const blocks = blockIds.map(id => ({
    block_id: id,
    source_format: 'md',
    modality: 'TEXT',
    locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
    heading_path: [],
    content_sha256: 'b'.repeat(64),
  }));
  await writeFile(
    join(runDir, 'evidence', 'batches', `${batchId}.json`),
    JSON.stringify({ batch_id: batchId, batch_sha256: batchSha256, blocks, total_chars: 100, modality_mix: ['TEXT'] })
  );
}

describe('Merge/Finalize Integrity', () => {
  describe('完整性重验', () => {
    let tempDir;

    before(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'integrity-test-'));
    });

    after(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('应验证 fragment 内容哈希与 queue 中记录的 fragment_sha256', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'hash-verify-' + Date.now());
      await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
      await mkdir(join(runDir, 'stages', 'merge'), { recursive: true });
      await mkdir(join(runDir, 'input'), { recursive: true });
      await mkdir(join(runDir, 'evidence', 'blocks'), { recursive: true });

      // 创建 fragment
      const fragment = {
        schema_version: '2.0.0',
        batch_id: 'EB-001',
        batch_sha256: 'a'.repeat(64),
        task_kind: 'ACTIVITY_CATALOG',
        payload: {
          facts: [{
            fact_id: 'F-001',
            kind: 'ACTIVITY',
            process_key: 'test',
            subject_key: 'submit',
            label: '提交申请',
            attributes: { role: '申请人' },
            certainty: 'EXPLICIT',
            evidence_refs: ['B-001'],
          }, {
            fact_id: 'F-002',
            kind: 'ROLE',
            process_key: 'test',
            subject_key: 'applicant',
            label: '申请人',
            attributes: {},
            certainty: 'EXPLICIT',
            evidence_refs: ['B-001'],
          }],
          uncertainties: [],
        },
      };

      // 计算 fragment 内容哈希
      const fragmentContent = JSON.stringify(fragment, null, 2) + '\n';
      const fragmentSha256 = createHash('sha256').update(fragmentContent).digest('hex');

      // 创建 queue 记录 fragment_sha256
      const queue = {
        schema_version: '1.0.0',
        batches: [{
          batch_id: 'EB-001',
          task_id: 'EB-001-activity',
          task_kind: 'ACTIVITY_CATALOG',
          batch_sha256: 'a'.repeat(64),
          status: 'ACCEPTED',
          fragment_sha256: fragmentSha256,
        }],
        total_batches: 1,
        total_blocks: 1,
      };
      await writeFile(
        join(runDir, 'stages', 'semantic', 'queue.json'),
        JSON.stringify(queue)
      );

      // 写入 fragment 文件（V2: 使用 task_id 而非 batch_id）
      await writeFile(
        join(runDir, 'stages', 'semantic', 'fragments', 'EB-001-activity.json'),
        fragmentContent
      );

      // 创建 process-draft
      await writeFile(join(runDir, 'stages', 'merge', 'process-draft.json'), JSON.stringify({
        schema_version: '2.0.0',
        process_card: {
          process_id: 'test',
          name: '测试流程',
          level: 'L4',
          is_leaf: true,
          description: '测试流程',
          purpose: '测试',
          owner: 'Role-owner',
          parent_process_name: null,
          inputs: [],
          outputs: [],
          start: { event_id: 'Start-1', name: '开始', event_type: 'NONE' },
          end_results: [{ event_id: 'End-1', name: '结束' }],
          performance_indicators: [],
        },
        activities: [{
          activity_id: 'Activity-001',
          name: '提交申请',
          description: '提交申请',
          activity_type: 'STANDARD',
          responsibility_model: 'RASCI',
          role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
          sla: null,
          tools: [],
          inputs: [],
          process_summary: '',
          outputs: ['申请单'],
          completion_criteria: [],
          references: [],
          main_task_id: 'Task-001',
          confirmation: null,
          completeness: 'COMPLETE',
        }],
        diagram: {
          lanes: [{ lane_id: 'Lane-001', name: '申请人', role_id: 'Role-001' }],
          nodes: [
            { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: 'Lane-001' },
            { node_id: 'Task-001', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-001' },
            { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: 'Lane-001' },
          ],
          flows: [
            { flow_id: 'Flow-1', source_ref: 'Start-1', target_ref: 'Task-001', condition: null },
            { flow_id: 'Flow-2', source_ref: 'Task-001', target_ref: 'End-1', condition: null },
          ],
          task_bindings: [{ activity_id: 'Activity-001', main_task_id: 'Task-001', confirmation_task_id: null }],
          layout_version: '2.0.0',
        },
        questions: [{
          question_id: 'Q-001',
          text: '测试问题',
          target_paths: ['Task-001'],
          status: 'OPEN',
          answer: '',
          evidence_refs: ['B-001'],
        }],
        provenance: {},
        source_summary: { total_blocks: 1, formats: ['md'], evidence_refs: ['B-001'] },
      }));

      // 创建 manifest 和 evidence
      await writeFile(join(runDir, 'input', 'input-manifest.json'), JSON.stringify({
        schema_version: '1.0.0',
        title: '测试流程',
        focus: null,
        artifacts: [{ file_path: 'test.md', format: 'md', sha256: 'a'.repeat(64) }],
        warnings: [],
        created_at: '2026-01-01T00:00:00Z',
      }));

      await writeFile(join(runDir, 'evidence', 'evidence-index.json'), JSON.stringify({
        schema_version: '1.0.0',
        total_blocks: 1,
        blocks: [{
          block_id: 'B-001',
          source_format: 'md',
          modality: 'TEXT',
          locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
          heading_path: [],
          content_sha256: 'b'.repeat(64),
        }],
        warnings: [],
      }));

      // 写入 batch 文件
      await writeBatchFile(runDir, 'EB-001', ['B-001'], 'a'.repeat(64));

      // Finalize 应该成功
      const result = await finalizeProcessDraft({ runDir, revision: 'r01' });
      assert.ok(result.success, '应成功 finalize');
    });

    it('应失败当 fragment 内容被篡改但 batch hash 不变时', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'tampered-fragment-' + Date.now());
      await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
      await mkdir(join(runDir, 'stages', 'merge'), { recursive: true });
      await mkdir(join(runDir, 'input'), { recursive: true });
      await mkdir(join(runDir, 'evidence', 'blocks'), { recursive: true });

      // 创建原始 fragment
      const originalFragment = {
        schema_version: '1.0.0',
        batch_id: 'EB-001',
        batch_sha256: 'a'.repeat(64),
        facts: [{
          fact_id: 'F-001',
          kind: 'ACTIVITY',
          process_key: 'test',
          subject_key: 'submit',
          label: '提交申请',
          attributes: { role: '申请人' },
          certainty: 'EXPLICIT',
          evidence_refs: ['B-001'],
        }, {
          fact_id: 'F-002',
          kind: 'ROLE',
          process_key: 'test',
          subject_key: 'applicant',
          label: '申请人',
          attributes: {},
          certainty: 'EXPLICIT',
          evidence_refs: ['B-001'],
        }],
        uncertainties: [],
      };

      // 计算原始 fragment 内容哈希
      const originalContent = JSON.stringify(originalFragment, null, 2) + '\n';
      const originalSha256 = createHash('sha256').update(originalContent).digest('hex');

      // 创建篡改后的 fragment（修改 label）
      const tamperedFragment = {
        ...originalFragment,
        facts: originalFragment.facts.map(f =>
          f.fact_id === 'F-001' ? { ...f, label: '篡改后的申请' } : f
        ),
      };

      // 写入篡改后的 fragment 文件
      const tamperedContent = JSON.stringify(tamperedFragment, null, 2) + '\n';
      await writeFile(
        join(runDir, 'stages', 'semantic', 'fragments', 'EB-001-activity.json'),
        tamperedContent
      );

      // 创建 queue 记录原始 fragment_sha256（但实际文件已被篡改）
      const queue = {
        schema_version: '1.0.0',
        batches: [{
          batch_id: 'EB-001',
          task_id: 'EB-001-activity',
          task_kind: 'ACTIVITY_CATALOG',
          batch_sha256: 'a'.repeat(64),
          status: 'ACCEPTED',
          fragment_sha256: originalSha256, // 使用原始哈希
        }],
        total_batches: 1,
        total_blocks: 1,
      };
      await writeFile(
        join(runDir, 'stages', 'semantic', 'queue.json'),
        JSON.stringify(queue)
      );

      // 创建 process-draft
      await writeFile(join(runDir, 'stages', 'merge', 'process-draft.json'), JSON.stringify({
        schema_version: '2.0.0',
        process_card: {
          process_id: 'test',
          name: '测试流程',
          level: 'L4',
          is_leaf: true,
          description: '测试流程',
          purpose: '测试',
          owner: 'Role-owner',
          parent_process_name: null,
          inputs: [],
          outputs: [],
          start: { event_id: 'Start-1', name: '开始', event_type: 'NONE' },
          end_results: [{ event_id: 'End-1', name: '结束' }],
          performance_indicators: [],
        },
        activities: [{
          activity_id: 'Activity-001',
          name: '提交申请',
          description: '提交申请',
          activity_type: 'STANDARD',
          responsibility_model: 'RASCI',
          role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
          sla: null,
          tools: [],
          inputs: [],
          process_summary: '',
          outputs: ['申请单'],
          completion_criteria: [],
          references: [],
          main_task_id: 'Task-001',
          confirmation: null,
          completeness: 'COMPLETE',
        }],
        diagram: {
          lanes: [{ lane_id: 'Lane-001', name: '申请人', role_id: 'Role-001' }],
          nodes: [
            { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: 'Lane-001' },
            { node_id: 'Task-001', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-001' },
            { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: 'Lane-001' },
          ],
          flows: [
            { flow_id: 'Flow-1', source_ref: 'Start-1', target_ref: 'Task-001', condition: null },
            { flow_id: 'Flow-2', source_ref: 'Task-001', target_ref: 'End-1', condition: null },
          ],
          task_bindings: [{ activity_id: 'Activity-001', main_task_id: 'Task-001', confirmation_task_id: null }],
          layout_version: '2.0.0',
        },
        questions: [{
          question_id: 'Q-001',
          text: '测试问题',
          target_paths: ['Task-001'],
          status: 'OPEN',
          answer: '',
          evidence_refs: ['B-001'],
        }],
        provenance: {},
        source_summary: { total_blocks: 1, formats: ['md'], evidence_refs: ['B-001'] },
      }));

      // 创建 manifest 和 evidence
      await writeFile(join(runDir, 'input', 'input-manifest.json'), JSON.stringify({
        schema_version: '1.0.0',
        title: '测试流程',
        focus: null,
        artifacts: [{ file_path: 'test.md', format: 'md', sha256: 'a'.repeat(64) }],
        warnings: [],
        created_at: '2026-01-01T00:00:00Z',
      }));

      await writeFile(join(runDir, 'evidence', 'evidence-index.json'), JSON.stringify({
        schema_version: '1.0.0',
        total_blocks: 1,
        blocks: [{
          block_id: 'B-001',
          source_format: 'md',
          modality: 'TEXT',
          locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
          heading_path: [],
          content_sha256: 'b'.repeat(64),
        }],
        warnings: [],
      }));

      // 写入 batch 文件
      await writeBatchFile(runDir, 'EB-001', ['B-001'], 'a'.repeat(64));

      // Finalize 应该失败
      try {
        await finalizeProcessDraft({ runDir, revision: 'r01' });
        assert.fail('应失败当 fragment 内容被篡改时');
      } catch (err) {
        assert.ok(
          err.message.includes('hash') || err.message.includes('Hash') || err.message.includes('不匹配'),
          '错误应提及 hash 不匹配: ' + err.message
        );
      }
    });

    it('应失败当缺少 fragment_sha256 的旧 ACCEPTED 队列项时', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'missing-fragment-sha256-' + Date.now());
      await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
      await mkdir(join(runDir, 'stages', 'merge'), { recursive: true });
      await mkdir(join(runDir, 'input'), { recursive: true });
      await mkdir(join(runDir, 'evidence', 'blocks'), { recursive: true });

      // 创建 fragment
      const fragment = {
        schema_version: '2.0.0',
        batch_id: 'EB-001',
        batch_sha256: 'a'.repeat(64),
        task_kind: 'ACTIVITY_CATALOG',
        payload: {
          facts: [{
            fact_id: 'F-001',
            kind: 'ACTIVITY',
            process_key: 'test',
            subject_key: 'submit',
            label: '提交申请',
            attributes: { role: '申请人' },
            certainty: 'EXPLICIT',
            evidence_refs: ['B-001'],
          }, {
            fact_id: 'F-002',
            kind: 'ROLE',
            process_key: 'test',
            subject_key: 'applicant',
            label: '申请人',
            attributes: {},
            certainty: 'EXPLICIT',
            evidence_refs: ['B-001'],
          }],
          uncertainties: [],
        },
      };

      await writeFile(
        join(runDir, 'stages', 'semantic', 'fragments', 'EB-001.json'),
        JSON.stringify(fragment, null, 2) + '\n'
      );

      // 创建 queue 记录但缺少 fragment_sha256（旧格式）
      const queue = {
        schema_version: '1.0.0',
        batches: [{
          batch_id: 'EB-001',
          task_id: 'EB-001-activity',
          task_kind: 'ACTIVITY_CATALOG',
          batch_sha256: 'a'.repeat(64),
          status: 'ACCEPTED',
          // 缺少 fragment_sha256
        }],
        total_batches: 1,
        total_blocks: 1,
      };
      await writeFile(
        join(runDir, 'stages', 'semantic', 'queue.json'),
        JSON.stringify(queue)
      );

      // 创建 process-draft
      await writeFile(join(runDir, 'stages', 'merge', 'process-draft.json'), JSON.stringify({
        schema_version: '2.0.0',
        process_card: {
          process_id: 'test',
          name: '测试流程',
          level: 'L4',
          is_leaf: true,
          description: '测试流程',
          purpose: '测试',
          owner: 'Role-owner',
          parent_process_name: null,
          inputs: [],
          outputs: [],
          start: { event_id: 'Start-1', name: '开始', event_type: 'NONE' },
          end_results: [{ event_id: 'End-1', name: '结束' }],
          performance_indicators: [],
        },
        activities: [{
          activity_id: 'Activity-001',
          name: '提交申请',
          description: '提交申请',
          activity_type: 'STANDARD',
          responsibility_model: 'RASCI',
          role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
          sla: null,
          tools: [],
          inputs: [],
          process_summary: '',
          outputs: ['申请单'],
          completion_criteria: [],
          references: [],
          main_task_id: 'Task-001',
          confirmation: null,
          completeness: 'COMPLETE',
        }],
        diagram: {
          lanes: [{ lane_id: 'Lane-001', name: '申请人', role_id: 'Role-001' }],
          nodes: [
            { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: 'Lane-001' },
            { node_id: 'Task-001', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-001' },
            { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: 'Lane-001' },
          ],
          flows: [
            { flow_id: 'Flow-1', source_ref: 'Start-1', target_ref: 'Task-001', condition: null },
            { flow_id: 'Flow-2', source_ref: 'Task-001', target_ref: 'End-1', condition: null },
          ],
          task_bindings: [{ activity_id: 'Activity-001', main_task_id: 'Task-001', confirmation_task_id: null }],
          layout_version: '2.0.0',
        },
        questions: [{
          question_id: 'Q-001',
          text: '测试问题',
          target_paths: ['Task-001'],
          status: 'OPEN',
          answer: '',
          evidence_refs: ['B-001'],
        }],
        provenance: {},
        source_summary: { total_blocks: 1, formats: ['md'], evidence_refs: ['B-001'] },
      }));

      // 创建 manifest 和 evidence
      await writeFile(join(runDir, 'input', 'input-manifest.json'), JSON.stringify({
        schema_version: '1.0.0',
        title: '测试流程',
        focus: null,
        artifacts: [{ file_path: 'test.md', format: 'md', sha256: 'a'.repeat(64) }],
        warnings: [],
        created_at: '2026-01-01T00:00:00Z',
      }));

      await writeFile(join(runDir, 'evidence', 'evidence-index.json'), JSON.stringify({
        schema_version: '1.0.0',
        total_blocks: 1,
        blocks: [{
          block_id: 'B-001',
          source_format: 'md',
          modality: 'TEXT',
          locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
          heading_path: [],
          content_sha256: 'b'.repeat(64),
        }],
        warnings: [],
      }));

      // 写入 batch 文件
      await writeBatchFile(runDir, 'EB-001', ['B-001'], 'a'.repeat(64));

      // Finalize 应该失败（缺少 fragment_sha256 时 fail closed）
      try {
        await finalizeProcessDraft({ runDir, revision: 'r01' });
        assert.fail('应失败当缺少 fragment_sha256 时');
      } catch (err) {
        assert.ok(
          err.message.includes('fragment_sha256') || err.message.includes('缺失') || err.message.includes('缺少'),
          '错误应提及 fragment_sha256 缺失: ' + err.message
        );
      }
    });

    it('应验证 fragment 的 batch_id/batch_sha256 与 queue 匹配', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'batch-mismatch-' + Date.now());
      await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
      await mkdir(join(runDir, 'stages', 'merge'), { recursive: true });
      await mkdir(join(runDir, 'input'), { recursive: true });
      await mkdir(join(runDir, 'evidence', 'blocks'), { recursive: true });

      // 创建 fragment（batch_id 不匹配）
      const fragment = {
        schema_version: '1.0.0',
        batch_id: 'EB-WRONG', // 不匹配
        batch_sha256: 'a'.repeat(64),
        facts: [{
          fact_id: 'F-001',
          kind: 'ACTIVITY',
          process_key: 'test',
          subject_key: 'submit',
          label: '提交申请',
          attributes: { role: '申请人' },
          certainty: 'EXPLICIT',
          evidence_refs: ['B-001'],
        }, {
          fact_id: 'F-002',
          kind: 'ROLE',
          process_key: 'test',
          subject_key: 'applicant',
          label: '申请人',
          attributes: {},
          certainty: 'EXPLICIT',
          evidence_refs: ['B-001'],
        }],
        uncertainties: [],
      };

      const fragmentContent = JSON.stringify(fragment, null, 2) + '\n';
      await writeFile(
        join(runDir, 'stages', 'semantic', 'fragments', 'EB-001-activity.json'),
        fragmentContent
      );

      // 计算 fragment 内容哈希
      const fragmentSha256 = createHash('sha256').update(fragmentContent).digest('hex');

      // 创建 queue 记录（包含 fragment_sha256 以便验证能进行到 batch_id 检查）
      const queue = {
        schema_version: '1.0.0',
        batches: [{
          batch_id: 'EB-001',
          task_id: 'EB-001-activity',
          task_kind: 'ACTIVITY_CATALOG',
          batch_sha256: 'a'.repeat(64),
          status: 'ACCEPTED',
          fragment_sha256: fragmentSha256,
        }],
        total_batches: 1,
        total_blocks: 1,
      };
      await writeFile(
        join(runDir, 'stages', 'semantic', 'queue.json'),
        JSON.stringify(queue)
      );

      // 创建 process-draft
      await writeFile(join(runDir, 'stages', 'merge', 'process-draft.json'), JSON.stringify({
        schema_version: '2.0.0',
        process_card: {
          process_id: 'test',
          name: '测试流程',
          level: 'L4',
          is_leaf: true,
          description: '测试流程',
          purpose: '测试',
          owner: 'Role-owner',
          parent_process_name: null,
          inputs: [],
          outputs: [],
          start: { event_id: 'Start-1', name: '开始', event_type: 'NONE' },
          end_results: [{ event_id: 'End-1', name: '结束' }],
          performance_indicators: [],
        },
        activities: [{
          activity_id: 'Activity-001',
          name: '提交申请',
          description: '提交申请',
          activity_type: 'STANDARD',
          responsibility_model: 'RASCI',
          role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
          sla: null,
          tools: [],
          inputs: [],
          process_summary: '',
          outputs: ['申请单'],
          completion_criteria: [],
          references: [],
          main_task_id: 'Task-001',
          confirmation: null,
          completeness: 'COMPLETE',
        }],
        diagram: {
          lanes: [{ lane_id: 'Lane-001', name: '申请人', role_id: 'Role-001' }],
          nodes: [
            { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: 'Lane-001' },
            { node_id: 'Task-001', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-001' },
            { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: 'Lane-001' },
          ],
          flows: [
            { flow_id: 'Flow-1', source_ref: 'Start-1', target_ref: 'Task-001', condition: null },
            { flow_id: 'Flow-2', source_ref: 'Task-001', target_ref: 'End-1', condition: null },
          ],
          task_bindings: [{ activity_id: 'Activity-001', main_task_id: 'Task-001', confirmation_task_id: null }],
          layout_version: '2.0.0',
        },
        questions: [{
          question_id: 'Q-001',
          text: '测试问题',
          target_paths: ['Task-001'],
          status: 'OPEN',
          answer: '',
          evidence_refs: ['B-001'],
        }],
        provenance: {},
        source_summary: { total_blocks: 1, formats: ['md'], evidence_refs: ['B-001'] },
      }));

      // 创建 manifest 和 evidence
      await writeFile(join(runDir, 'input', 'input-manifest.json'), JSON.stringify({
        schema_version: '1.0.0',
        title: '测试流程',
        focus: null,
        artifacts: [{ file_path: 'test.md', format: 'md', sha256: 'a'.repeat(64) }],
        warnings: [],
        created_at: '2026-01-01T00:00:00Z',
      }));

      await writeFile(join(runDir, 'evidence', 'evidence-index.json'), JSON.stringify({
        schema_version: '1.0.0',
        total_blocks: 1,
        blocks: [{
          block_id: 'B-001',
          source_format: 'md',
          modality: 'TEXT',
          locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
          heading_path: [],
          content_sha256: 'b'.repeat(64),
        }],
        warnings: [],
      }));

      // 写入 batch 文件
      await writeBatchFile(runDir, 'EB-001', ['B-001'], 'a'.repeat(64));

      // Finalize 应该失败
      try {
        await finalizeProcessDraft({ runDir, revision: 'r01' });
        assert.fail('应失败当 batch_id 不匹配时');
      } catch (err) {
        assert.ok(
          err.message.includes('batch') || err.message.includes('Batch') || err.message.includes('不匹配'),
          '错误应提及 batch 不匹配: ' + err.message
        );
      }
    });
  });
});
