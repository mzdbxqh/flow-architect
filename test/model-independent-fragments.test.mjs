import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const schemasDir = join(__dirname, '../references/schemas');

async function loadContract() {
  return await import('../scripts/lib/process-draft-contract.mjs');
}

async function loadSchema(name) {
  return JSON.parse(await readFile(join(schemasDir, name), 'utf8'));
}

// ── 黑盒测试：三类 Schema 均显式拒绝绘图字段 ──

describe('模型无关事实合同 — 禁止绘图字段', () => {
  const FORBIDDEN_FIELDS = ['x', 'y', 'width', 'height', 'waypoints', 'bpmn_xml', 'bpmn_di', 'html', 'svg', 'coordinates', 'position', 'bounds'];

  it('三个子 Schema 的序列化 JSON 不包含绘图字段', async () => {
    const schemaNames = [
      'process-card-fragment.schema.json',
      'activity-fragment.schema.json',
      'control-flow-fragment.schema.json',
    ];

    for (const name of schemaNames) {
      const schema = await loadSchema(name);
      const serialized = JSON.stringify(schema);

      for (const field of FORBIDDEN_FIELDS) {
        assert.ok(
          !serialized.includes(`"${field}"`),
          `Schema ${name} 不应包含绘图字段 "${field}"`
        );
      }
    }
  });

  it('公共信封 Schema 不包含绘图字段', async () => {
    const schema = await loadSchema('semantic-fragment.schema.json');
    const serialized = JSON.stringify(schema);

    for (const field of FORBIDDEN_FIELDS) {
      assert.ok(
        !serialized.includes(`"${field}"`),
        `semantic-fragment.schema.json 不应包含绘图字段 "${field}"`
      );
    }
  });
});

// ── 模型无关三类事实 ──

describe('模型无关事实 — 三类 task_kind', () => {
  it('PROCESS_CARD 任务：合法片段通过验证', async () => {
    const { validateSemanticFragmentV2 } = await loadContract();
    const fragment = {
      schema_version: '2.0.0',
      task_kind: 'PROCESS_CARD',
      batch_id: 'EB-001',
      batch_sha256: 'a'.repeat(64),
      payload: {
        facts: [{
          fact_id: 'F-001',
          kind: 'PROCESS_NAME',
          process_key: 'purchase',
          subject_key: 'process-name',
          label: '采购审批流程',
          attributes: {},
          certainty: 'EXPLICIT',
          evidence_refs: ['B-001'],
        }],
        uncertainties: [],
      },
    };
    const result = await validateSemanticFragmentV2(fragment);
    assert.equal(result.valid, true, `PROCESS_CARD 片段应通过: ${JSON.stringify(result.errors)}`);
  });

  it('ACTIVITY_CATALOG 任务：合法片段通过验证', async () => {
    const { validateSemanticFragmentV2 } = await loadContract();
    const fragment = {
      schema_version: '2.0.0',
      task_kind: 'ACTIVITY_CATALOG',
      batch_id: 'EB-001',
      batch_sha256: 'a'.repeat(64),
      payload: {
        facts: [{
          fact_id: 'F-001',
          kind: 'ACTIVITY',
          process_key: 'purchase',
          subject_key: 'review-request',
          label: '审核采购申请',
          attributes: {},
          certainty: 'EXPLICIT',
          evidence_refs: ['B-001'],
        }],
        uncertainties: [],
      },
    };
    const result = await validateSemanticFragmentV2(fragment);
    assert.equal(result.valid, true, `ACTIVITY_CATALOG 片段应通过: ${JSON.stringify(result.errors)}`);
  });

  it('CONTROL_FLOW 任务：合法片段通过验证', async () => {
    const { validateSemanticFragmentV2 } = await loadContract();
    const fragment = {
      schema_version: '2.0.0',
      task_kind: 'CONTROL_FLOW',
      batch_id: 'EB-001',
      batch_sha256: 'a'.repeat(64),
      payload: {
        facts: [{
          fact_id: 'F-001',
          kind: 'FLOW',
          process_key: 'purchase',
          subject_key: 'submit-to-review',
          label: '提交申请到审核',
          attributes: {
            source_subject_key: 'submit-request',
            target_subject_key: 'review-request',
          },
          certainty: 'EXPLICIT',
          evidence_refs: ['B-001'],
        }],
        uncertainties: [],
      },
    };
    const result = await validateSemanticFragmentV2(fragment);
    assert.equal(result.valid, true, `CONTROL_FLOW 片段应通过: ${JSON.stringify(result.errors)}`);
  });

  it('缺少 task_kind 时拒绝', async () => {
    const { validateSemanticFragmentV2 } = await loadContract();
    const fragment = {
      schema_version: '2.0.0',
      batch_id: 'EB-001',
      batch_sha256: 'a'.repeat(64),
      payload: {},
    };
    const result = await validateSemanticFragmentV2(fragment);
    assert.equal(result.valid, false, '缺少 task_kind 应拒绝');
  });

  it('缺少 payload 时拒绝', async () => {
    const { validateSemanticFragmentV2 } = await loadContract();
    const fragment = {
      schema_version: '2.0.0',
      task_kind: 'PROCESS_CARD',
      batch_id: 'EB-001',
      batch_sha256: 'a'.repeat(64),
    };
    const result = await validateSemanticFragmentV2(fragment);
    assert.equal(result.valid, false, '缺少 payload 应拒绝');
  });

  it('无效 task_kind 时拒绝', async () => {
    const { validateSemanticFragmentV2 } = await loadContract();
    const fragment = {
      schema_version: '2.0.0',
      task_kind: 'INVALID_KIND',
      batch_id: 'EB-001',
      batch_sha256: 'a'.repeat(64),
      payload: {},
    };
    const result = await validateSemanticFragmentV2(fragment);
    assert.equal(result.valid, false, '无效 task_kind 应拒绝');
  });
});

// ── 证据引用规则 ──

describe('模型无关事实 — 证据引用', () => {
  it('每个事实必须引用当前 batch（evidence_refs 不为空）', async () => {
    const { validateSemanticFragmentV2 } = await loadContract();
    const fragment = {
      schema_version: '2.0.0',
      task_kind: 'PROCESS_CARD',
      batch_id: 'EB-001',
      batch_sha256: 'a'.repeat(64),
      payload: {
        facts: [{
          fact_id: 'F-001',
          kind: 'PROCESS_NAME',
          process_key: 'purchase',
          subject_key: 'process-name',
          label: '采购审批',
          attributes: {},
          certainty: 'EXPLICIT',
          evidence_refs: [], // 空引用
        }],
        uncertainties: [],
      },
    };
    const result = await validateSemanticFragmentV2(fragment);
    assert.equal(result.valid, false, '空 evidence_refs 应拒绝');
  });

  it('INFERRED 事实必须有 uncertainty（NEEDS_CONTEXT）', async () => {
    const { validateSemanticFragmentV2 } = await loadContract();
    const fragment = {
      schema_version: '2.0.0',
      task_kind: 'PROCESS_CARD',
      batch_id: 'EB-001',
      batch_sha256: 'a'.repeat(64),
      payload: {
        facts: [{
          fact_id: 'F-001',
          kind: 'PROCESS_NAME',
          process_key: 'purchase',
          subject_key: 'process-name',
          label: '采购审批',
          attributes: {},
          certainty: 'INFERRED',
          evidence_refs: ['B-001'],
        }],
        uncertainties: [{
          kind: 'NEEDS_CONTEXT',
          text: '从上下文推断的流程名称',
          related_fact_ids: ['F-001'],
          evidence_refs: ['B-001'],
        }],
      },
    };
    const result = await validateSemanticFragmentV2(fragment);
    assert.equal(result.valid, true, 'INFERRED + NEEDS_CONTEXT 应通过');
  });
});

// ── 控制流条件只允许结构化字段 ──

describe('控制流条件 — 只允许结构化字段', () => {
  it('CONTROL_FLOW 条件只能输出结构化字段', async () => {
    const { validateSemanticFragmentV2 } = await loadContract();
    const fragment = {
      schema_version: '2.0.0',
      task_kind: 'CONTROL_FLOW',
      batch_id: 'EB-001',
      batch_sha256: 'a'.repeat(64),
      payload: {
        facts: [{
          fact_id: 'F-001',
          kind: 'CONDITION',
          process_key: 'purchase',
          subject_key: 'approval-condition',
          label: '审批通过',
          attributes: {
            source_subject_key: 'approval',
            source_output: '审批结论',
            operator: 'EQUALS',
            value: '通过',
          },
          certainty: 'EXPLICIT',
          evidence_refs: ['B-001'],
        }],
        uncertainties: [],
      },
    };
    const result = await validateSemanticFragmentV2(fragment);
    assert.equal(result.valid, true, '结构化条件应通过');
  });

  it('CONTROL_FLOW 条件属性只允许预定义字段', async () => {
    const controlFlowSchema = await loadSchema('control-flow-fragment.schema.json');
    const conditionFact = controlFlowSchema.properties.facts.items;
    const conditionAttrs = conditionFact.properties.attributes;

    // 条件属性的 additionalProperties 应为 false
    assert.equal(conditionAttrs.additionalProperties, false,
      '条件属性应禁止额外字段');
    assert.ok(conditionAttrs.properties.operator,
      '条件属性应包含 operator');
    assert.ok(conditionAttrs.properties.value,
      '条件属性应包含 value');
    assert.ok(conditionAttrs.properties.source_output,
      '条件属性应包含 source_output');
  });
});

// ── V1 语义片段必须被拒绝 ──

describe('V1 语义片段必须被拒绝', () => {
  it('V1 语义片段（schema_version=1.0.0）应被拒绝', async () => {
    const { validateSemanticFragment } = await loadContract();
    const v1Fragment = {
      schema_version: '1.0.0',
      batch_id: 'EB-001',
      batch_sha256: 'a'.repeat(64),
      facts: [{
        fact_id: 'F-001',
        kind: 'PROCESS_NAME',
        process_key: 'purchase',
        subject_key: 'process-name',
        label: '采购审批',
        attributes: {},
        certainty: 'EXPLICIT',
        evidence_refs: ['B-001'],
      }],
      uncertainties: [],
    };
    const result = await validateSemanticFragment(v1Fragment);
    assert.equal(result.valid, false, 'V1 语义片段应被拒绝');
  });

  it('V2 语义片段应被接受', async () => {
    const { validateSemanticFragment } = await loadContract();
    const v2Fragment = {
      schema_version: '2.0.0',
      task_kind: 'PROCESS_CARD',
      batch_id: 'EB-001',
      batch_sha256: 'a'.repeat(64),
      payload: {
        facts: [{
          fact_id: 'F-001',
          kind: 'PROCESS_NAME',
          process_key: 'purchase',
          subject_key: 'process-name',
          label: '采购审批',
          attributes: {},
          certainty: 'EXPLICIT',
          evidence_refs: ['B-001'],
        }],
        uncertainties: [],
      },
    };
    const result = await validateSemanticFragment(v2Fragment);
    assert.equal(result.valid, true, `V2 语义片段应被接受: ${JSON.stringify(result.errors)}`);
  });
});

// ── V2 payload 不得重复 envelope 字段 ──

describe('V2 payload 不得重复 envelope 字段', () => {
  it('子 Schema payload 只允许 facts 和 uncertainties', async () => {
    const processCardFragment = await loadSchema('process-card-fragment.schema.json');
    const activityFragment = await loadSchema('activity-fragment.schema.json');
    const controlFlowFragment = await loadSchema('control-flow-fragment.schema.json');

    for (const schema of [processCardFragment, activityFragment, controlFlowFragment]) {
      const props = Object.keys(schema.properties || {});
      assert.deepEqual(
        props.sort(),
        ['facts', 'uncertainties'].sort(),
        `子 Schema ${schema.$id} payload 应只包含 facts 和 uncertainties，当前: ${props.join(', ')}`
      );
    }
  });

  it('payload 不含 task_kind/batch_id/batch_sha256', async () => {
    const schemaNames = [
      'process-card-fragment.schema.json',
      'activity-fragment.schema.json',
      'control-flow-fragment.schema.json',
    ];
    for (const name of schemaNames) {
      const schema = await loadSchema(name);
      const props = Object.keys(schema.properties || {});
      assert.ok(!props.includes('task_kind'), `${name} payload 不应含 task_kind`);
      assert.ok(!props.includes('batch_id'), `${name} payload 不应含 batch_id`);
      assert.ok(!props.includes('batch_sha256'), `${name} payload 不应含 batch_sha256`);
    }
  });

  it('公共信封按 task_kind 绑定 payload', async () => {
    const envelope = await loadSchema('semantic-fragment.schema.json');
    // 信封应使用 if/then 按 task_kind 绑定 payload
    assert.ok(
      envelope.allOf || envelope.if || envelope.oneOf,
      '公共信封应按 task_kind 绑定 payload（需要 if/then 或 allOf/oneOf）'
    );
  });
});

// ── FRAGMENT_TASK_KINDS 枚举 ──

describe('FRAGMENT_TASK_KINDS 枚举', () => {
  it('导出三种任务类型', async () => {
    const { FRAGMENT_TASK_KINDS } = await loadContract();
    assert.deepEqual(FRAGMENT_TASK_KINDS, ['PROCESS_CARD', 'ACTIVITY_CATALOG', 'CONTROL_FLOW']);
  });
});
