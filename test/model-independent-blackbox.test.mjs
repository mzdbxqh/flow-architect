/**
 * MiMo 跨模型黑盒合同测试
 *
 * 验证三份真实 captured 输出：
 * 1. task fixture SHA 与 captured 记录一致
 * 2. model_id 精确为 mimo-v2.5-pro
 * 3. output 通过 validateSemanticFragmentV2 及 evidence_refs 边界校验
 * 4. 递归检查对象键，禁止绘图/布局字段
 * 5. 对照 oracle 比较规范化语义投影
 * 6. captured fixture 不含端点、令牌、请求头、供应商原始响应或 chain-of-thought
 * 7. 无真实 captured fixture 时测试必须失败
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = join(__dirname, 'fixtures/model-independent');

async function loadJson(relPath) {
  return JSON.parse(await readFile(join(fixturesDir, relPath), 'utf8'));
}

async function loadContract() {
  return await import('../scripts/lib/process-draft-contract.mjs');
}

/**
 * 递归收集对象的所有键名
 */
function collectKeys(obj) {
  const keys = new Set();
  if (obj === null || typeof obj !== 'object') return keys;
  for (const [key, value] of Object.entries(obj)) {
    keys.add(key);
    if (typeof value === 'object' && value !== null) {
      for (const childKey of collectKeys(value)) {
        keys.add(childKey);
      }
    }
  }
  return keys;
}

// ── 三份 captured fixture 定义 ──

const CAPTURED_FILES = [
  { name: 'PROCESS_CARD', captured: 'mimo-v2.5-pro-process-card.json', task: 'process-card-task.json' },
  { name: 'ACTIVITY_CATALOG', captured: 'mimo-v2.5-pro-activity.json', task: 'activity-task.json' },
  { name: 'CONTROL_FLOW', captured: 'mimo-v2.5-pro-control-flow.json', task: 'control-flow-task.json' },
];

// ── 前置检查：captured 文件必须存在 ──

describe('MiMo 黑盒 — captured 文件存在性', () => {
  for (const { name, captured } of CAPTURED_FILES) {
    it(`${name}: captured 文件必须存在且可解析`, async () => {
      const data = await loadJson(`captured/${captured}`);
      assert.ok(data, `${captured} 应可解析`);
      assert.ok(data.output, `${captured} 应包含 output`);
      assert.equal(data.model_id, 'mimo-v2.5-pro', `${captured} model_id 应为 mimo-v2.5-pro`);
    });
  }
});

// ── task fixture SHA 一致性 ──

describe('MiMo 黑盒 — task fixture SHA 一致性', () => {
  for (const { name, captured, task } of CAPTURED_FILES) {
    it(`${name}: task_sha256 与实际文件 SHA 一致`, async () => {
      const capturedData = await loadJson(`captured/${captured}`);
      const taskContent = await readFile(join(fixturesDir, task), 'utf8');
      const actualSha = createHash('sha256').update(taskContent).digest('hex');
      assert.equal(capturedData.task_sha256, actualSha,
        `${captured} 的 task_sha256 应与 ${task} 的实际 SHA 一致`);
    });
  }
});

// ── model_id 和 attempt_count ──

describe('MiMo 黑盒 — 模型标识与 attempt 计数', () => {
  for (const { name, captured } of CAPTURED_FILES) {
    it(`${name}: model_id 精确为 mimo-v2.5-pro`, async () => {
      const data = await loadJson(`captured/${captured}`);
      assert.equal(data.model_id, 'mimo-v2.5-pro');
    });

    it(`${name}: attempt_count 在 1~3 范围内`, async () => {
      const data = await loadJson(`captured/${captured}`);
      assert.ok(data.attempt_count >= 1 && data.attempt_count <= 3,
        `attempt_count 应在 1~3，实际: ${data.attempt_count}`);
    });
  }
});

// ── Schema 验证：output 通过 validateSemanticFragmentV2 ──

describe('MiMo 黑盒 — Schema 验证', () => {
  for (const { name, captured } of CAPTURED_FILES) {
    it(`${name}: output 通过 validateSemanticFragmentV2`, async () => {
      const { validateSemanticFragmentV2 } = await loadContract();
      const data = await loadJson(`captured/${captured}`);
      const result = await validateSemanticFragmentV2(data.output);
      assert.equal(result.valid, true,
        `${name} output 应通过 Schema 验证: ${JSON.stringify(result.errors)}`);
    });
  }
});

// ── evidence_refs 边界校验 ──

describe('MiMo 黑盒 — evidence_refs 引用边界', () => {
  const BATCH_BLOCK_IDS = new Set(['B-001', 'B-002', 'B-003', 'B-004']);

  for (const { name, captured } of CAPTURED_FILES) {
    it(`${name}: evidence_refs 只引用当前 batch 的 block_id`, async () => {
      const data = await loadJson(`captured/${captured}`);
      const { facts = [], uncertainties = [] } = data.output.payload || {};

      for (const fact of facts) {
        for (const ref of fact.evidence_refs || []) {
          assert.ok(BATCH_BLOCK_IDS.has(ref),
            `事实 ${fact.fact_id} 引用了不存在的 block_id: ${ref}`);
        }
      }

      for (const unc of uncertainties) {
        for (const ref of unc.evidence_refs || []) {
          assert.ok(BATCH_BLOCK_IDS.has(ref),
            `不确定性引用了不存在的 block_id: ${ref}`);
        }
      }
    });
  }
});

// ── 递归禁止字段检查 ──

describe('MiMo 黑盒 — 禁止绘图/布局字段（递归键检查）', () => {
  const FORBIDDEN_KEYS = new Set([
    'x', 'y', 'width', 'height', 'bounds', 'position', 'coordinates',
    'waypoints', 'bpmn_xml', 'bpmn_di', 'xml', 'html', 'svg', 'layout', 'di',
  ]);

  for (const { name, captured } of CAPTURED_FILES) {
    it(`${name}: output 递归键不含禁止字段`, async () => {
      const data = await loadJson(`captured/${captured}`);
      const allKeys = collectKeys(data.output);
      const violations = [...allKeys].filter(k => FORBIDDEN_KEYS.has(k));
      assert.deepEqual(violations, [],
        `${name} output 不应包含禁止字段，发现: ${violations.join(', ')}`);
    });
  }
});

// ── captured fixture 不含敏感信息 ──

describe('MiMo 黑盒 — 敏感信息检查', () => {
  const SENSITIVE_PATTERNS = [
    /https?:\/\/[^\s"']+api[^\s"']*/i,
    /https?:\/\/[^\s"']+endpoint[^\s"']*/i,
    /bearer\s+[a-zA-Z0-9_-]+/i,
    /\bsk-[a-zA-Z0-9_-]{20,}/,
    /token["']?\s*[:=]\s*["'][a-zA-Z0-9_-]+/i,
    /chain.of.thought/i,
    /reasoning_trace/i,
  ];

  for (const { name, captured } of CAPTURED_FILES) {
    it(`${name}: 不含端点、令牌、请求头或 chain-of-thought`, async () => {
      const data = await loadJson(`captured/${captured}`);
      const serialized = JSON.stringify(data);

      for (const pattern of SENSITIVE_PATTERNS) {
        assert.ok(!pattern.test(serialized),
          `${name} 不应匹配敏感模式 ${pattern}`);
      }

      // 额外检查：不含明确的供应商原始响应字段
      const forbiddenMetaKeys = ['request_headers', 'vendor_response', 'raw_response', 'api_key', 'secret'];
      const allKeys = collectKeys(data);
      const metaViolations = [...allKeys].filter(k => forbiddenMetaKeys.includes(k));
      assert.deepEqual(metaViolations, [],
        `${name} 不应包含供应商元数据键: ${metaViolations.join(', ')}`);
    });
  }
});

// ── Oracle 语义投影比较 ──

describe('MiMo 黑盒 — Oracle 语义投影', () => {
  it('PROCESS_CARD: 包含必需的事实类型和数量', async () => {
    const oracle = await loadJson('oracle.json');
    const data = await loadJson('captured/mimo-v2.5-pro-process-card.json');
    const facts = data.output.payload.facts;

    // 检查必需的 kind 类型存在
    for (const kind of oracle.PROCESS_CARD.required_kinds) {
      const matching = facts.filter(f => f.kind === kind);
      assert.ok(matching.length > 0,
        `PROCESS_CARD 应包含 kind="${kind}" 的事实`);
    }

    // 检查至少有 min_facts 个事实
    assert.ok(facts.length >= oracle.PROCESS_CARD.min_facts,
      `PROCESS_CARD 应至少有 ${oracle.PROCESS_CARD.min_facts} 个事实，实际: ${facts.length}`);

    // 检查 START_EVENT 和 END_EVENT 数量
    const startEvents = facts.filter(f => f.kind === 'START_EVENT');
    const endEvents = facts.filter(f => f.kind === 'END_EVENT');
    assert.equal(startEvents.length, oracle.PROCESS_CARD.expected_start_event_count,
      `应恰好 ${oracle.PROCESS_CARD.expected_start_event_count} 个 START_EVENT`);
    assert.equal(endEvents.length, oracle.PROCESS_CARD.expected_end_event_count,
      `应恰好 ${oracle.PROCESS_CARD.expected_end_event_count} 个 END_EVENT`);

    // 检查所有事实有 evidence_refs
    for (const fact of facts) {
      assert.ok(fact.evidence_refs && fact.evidence_refs.length > 0,
        `事实 ${fact.fact_id} 应有 evidence_refs`);
    }

    // 检查 process_key 一致
    const processKeys = new Set(facts.map(f => f.process_key));
    assert.equal(processKeys.size, 1, '所有事实的 process_key 应一致');
  });

  it('ACTIVITY_CATALOG: 包含必需的事实类型和 L5 活动名称', async () => {
    const oracle = await loadJson('oracle.json');
    const data = await loadJson('captured/mimo-v2.5-pro-activity.json');
    const facts = data.output.payload.facts;

    // 检查必需的 kind 类型存在
    for (const kind of oracle.ACTIVITY_CATALOG.required_kinds) {
      const matching = facts.filter(f => f.kind === kind);
      assert.ok(matching.length > 0,
        `ACTIVITY_CATALOG 应包含 kind="${kind}" 的事实`);
    }

    // 检查至少有 min_activity_facts 个 ACTIVITY
    const activities = facts.filter(f => f.kind === 'ACTIVITY');
    assert.ok(activities.length >= oracle.ACTIVITY_CATALOG.min_activity_facts,
      `ACTIVITY_CATALOG 应包含至少 ${oracle.ACTIVITY_CATALOG.min_activity_facts} 个 ACTIVITY，实际: ${activities.length}`);

    // 检查所有事实有 evidence_refs
    for (const fact of facts) {
      assert.ok(fact.evidence_refs && fact.evidence_refs.length > 0,
        `事实 ${fact.fact_id} 应有 evidence_refs`);
    }

    // 检查 process_key 一致
    const processKeys = new Set(facts.map(f => f.process_key));
    assert.equal(processKeys.size, 1, '所有事实的 process_key 应一致');
  });

  it('CONTROL_FLOW: 包含必需的事实类型和精确数量', async () => {
    const oracle = await loadJson('oracle.json');
    const data = await loadJson('captured/mimo-v2.5-pro-control-flow.json');
    const facts = data.output.payload.facts;

    // 检查必需的 kind 类型存在
    for (const kind of oracle.CONTROL_FLOW.required_kinds) {
      const matching = facts.filter(f => f.kind === kind);
      assert.ok(matching.length > 0,
        `CONTROL_FLOW 应包含 kind="${kind}" 的事实`);
    }

    // 检查至少有 min_facts 个事实
    assert.ok(facts.length >= oracle.CONTROL_FLOW.min_facts,
      `CONTROL_FLOW 应至少有 ${oracle.CONTROL_FLOW.min_facts} 个事实`);

    // 检查精确数量
    const startEvents = facts.filter(f => f.kind === 'START_EVENT');
    const endEvents = facts.filter(f => f.kind === 'END_EVENT');
    const xorGateways = facts.filter(f => f.kind === 'GATEWAY_XOR');
    const flows = facts.filter(f => f.kind === 'FLOW');

    assert.equal(startEvents.length, oracle.CONTROL_FLOW.expected_start_event_count,
      `应恰好 ${oracle.CONTROL_FLOW.expected_start_event_count} 个 START_EVENT`);
    assert.equal(endEvents.length, oracle.CONTROL_FLOW.expected_end_event_count,
      `应恰好 ${oracle.CONTROL_FLOW.expected_end_event_count} 个 END_EVENT`);
    assert.equal(xorGateways.length, oracle.CONTROL_FLOW.expected_gateway_xor_count,
      `应恰好 ${oracle.CONTROL_FLOW.expected_gateway_xor_count} 个 GATEWAY_XOR`);
    assert.equal(flows.length, oracle.CONTROL_FLOW.expected_flow_count,
      `应恰好 ${oracle.CONTROL_FLOW.expected_flow_count} 个 FLOW`);

    // 检查所有事实有 evidence_refs
    for (const fact of facts) {
      assert.ok(fact.evidence_refs && fact.evidence_refs.length > 0,
        `事实 ${fact.fact_id} 应有 evidence_refs`);
    }

    // 检查 process_key 一致
    const processKeys = new Set(facts.map(f => f.process_key));
    assert.equal(processKeys.size, 1, '所有事实的 process_key 应一致');

    // 检查泳道标签精确匹配 oracle（证据 B-004）
    const lanes = facts.filter(f => f.kind === 'LANE');
    assert.ok(lanes.length >= oracle.CONTROL_FLOW.min_lane_count,
      `应至少 ${oracle.CONTROL_FLOW.min_lane_count} 个泳道`);
    const laneLabels = lanes.map(f => f.label).sort();
    const expectedLanes = [...oracle.CONTROL_FLOW.expected_lanes].sort();
    assert.deepEqual(laneLabels, expectedLanes,
      `泳道标签应精确匹配 oracle：${expectedLanes.join(', ')}`);
  });
});

// ── batch_id 和 batch_sha256 一致性 ──

describe('MiMo 黑盒 — batch 一致性', () => {
  const EXPECTED_BATCH_ID = 'EB-procurement-demo';
  const EXPECTED_BATCH_SHA = 'c9eb4c5318d11343244d1fb869cd2f6d23a6267199a325223577051433739261';

  for (const { name, captured } of CAPTURED_FILES) {
    it(`${name}: batch_id 和 batch_sha256 与任务一致`, async () => {
      const data = await loadJson(`captured/${captured}`);
      assert.equal(data.output.batch_id, EXPECTED_BATCH_ID,
        `${name} batch_id 应为 ${EXPECTED_BATCH_ID}`);
      assert.equal(data.output.batch_sha256, EXPECTED_BATCH_SHA,
        `${name} batch_sha256 应为 ${EXPECTED_BATCH_SHA}`);
    });
  }
});

// ── task_kind 精确匹配 ──

describe('MiMo 黑盒 — task_kind 精确匹配', () => {
  for (const { name, captured } of CAPTURED_FILES) {
    it(`${name}: output.task_kind 精确为 ${name}`, async () => {
      const data = await loadJson(`captured/${captured}`);
      assert.equal(data.output.task_kind, name,
        `${captured} 的 task_kind 应为 ${name}`);
    });
  }
});
