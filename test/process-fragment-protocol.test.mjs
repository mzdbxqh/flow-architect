import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('Process Fragment Protocol V2', () => {
  let protocol;

  it('协议文档存在且可读', async () => {
    protocol = await readFile(
      join(__dirname, '../references/process-fragment-protocol.md'),
      'utf8'
    );
    assert.ok(protocol.length > 0, '协议文档不应为空');
  });

  describe('三种小任务模板', () => {
    it('包含 PROCESS_CARD 任务模板', async () => {
      assert.ok(protocol.includes('PROCESS_CARD'), '应包含 PROCESS_CARD 任务类型');
    });

    it('包含 ACTIVITY_CATALOG 任务模板', async () => {
      assert.ok(protocol.includes('ACTIVITY_CATALOG'), '应包含 ACTIVITY_CATALOG 任务类型');
    });

    it('包含 CONTROL_FLOW 任务模板', async () => {
      assert.ok(protocol.includes('CONTROL_FLOW'), '应包含 CONTROL_FLOW 任务类型');
    });

    it('包含 task_kind 字段说明', async () => {
      assert.ok(protocol.includes('task_kind'), '应包含 task_kind 字段说明');
    });
  });

  describe('证据定位', () => {
    it('说明每个事实必须引用当前 batch', async () => {
      assert.ok(protocol.includes('当前 batch') || protocol.includes('current batch'),
        '应说明事实引用当前 batch');
    });

    it('说明 evidence_refs 不能为空', async () => {
      assert.ok(protocol.includes('evidence_refs'), '应说明 evidence_refs');
    });
  });

  describe('UNKNOWN/CONFLICT 规则', () => {
    it('说明 MISSING 状态规则', async () => {
      assert.ok(protocol.includes('MISSING'), '应说明 MISSING 状态');
    });

    it('说明 CONFLICT 状态规则', async () => {
      assert.ok(protocol.includes('CONFLICT'), '应说明 CONFLICT 状态');
    });

    it('说明 INFERRED 状态必须提供推断依据', async () => {
      assert.ok(protocol.includes('INFERRED'), '应说明 INFERRED 状态');
      assert.ok(protocol.includes('推断依据') || protocol.includes('reasoning'),
        '应说明 INFERRED 需要推断依据');
    });
  });

  describe('稳定 subject key', () => {
    it('说明 subject_key 规则', async () => {
      assert.ok(protocol.includes('subject_key'), '应说明 subject_key');
    });
  });

  describe('模型边界', () => {
    it('说明不画图', async () => {
      assert.ok(protocol.includes('不画图') || protocol.includes('不生成') || protocol.includes('not generate'),
        '应说明模型不画图');
    });

    it('说明不输出 XML/HTML/坐标', async () => {
      const hasXmlBoundary = protocol.includes('XML') || protocol.includes('xml');
      const hasHtmlBoundary = protocol.includes('HTML') || protocol.includes('html');
      assert.ok(hasXmlBoundary || hasHtmlBoundary, '应说明不输出 XML/HTML');
    });

    it('说明不能判断时输出 uncertainty', async () => {
      assert.ok(protocol.includes('uncertainty') || protocol.includes('不确定性'),
        '应说明不确定性输出规则');
    });

    it('说明每次只处理一个任务类型', async () => {
      assert.ok(protocol.includes('一个任务') || protocol.includes('one task') || protocol.includes('单'),
        '应说明单任务限制');
    });
  });

  describe('V2-only（无 V1 兼容）', () => {
    it('不包含 V1 兼容输出说明', async () => {
      const hasV1Compat = protocol.includes('V1 兼容') || protocol.includes('V1 输出仍然被接受');
      assert.ok(!hasV1Compat, '协议不应包含 V1 兼容说明');
    });

    it('不包含 schema_version 1.0.0 的示例', async () => {
      assert.ok(!protocol.includes('"schema_version": "1.0.0"'),
        '协议不应包含 V1 schema_version 示例');
    });

    it('payload 示例不含 task_kind/batch_id/batch_sha256', async () => {
      // 在 V2 payload 结构描述中，payload 内不应有 task_kind/batch_id/batch_sha256
      // 查找 payload 块
      const payloadSection = protocol.substring(
        protocol.indexOf('"payload"'),
        protocol.indexOf('```', protocol.indexOf('"payload"'))
      );
      assert.ok(!payloadSection.includes('"task_kind"'),
        'payload 示例内不应含 task_kind');
      assert.ok(!payloadSection.includes('"batch_id"'),
        'payload 示例内不应含 batch_id');
      assert.ok(!payloadSection.includes('"batch_sha256"'),
        'payload 示例内不应含 batch_sha256');
    });
  });
});
