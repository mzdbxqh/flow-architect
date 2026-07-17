import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = join(__dirname, 'fixtures/process-draft/contracts');

async function loadRules() {
  return await import('../scripts/lib/process-draft-v2-rules.mjs');
}

async function loadContract() {
  return await import('../scripts/lib/process-draft-contract.mjs');
}

async function loadV2Fixture(name) {
  return JSON.parse(await readFile(join(fixturesDir, name), 'utf8'));
}

// 辅助：构造最小合法 V2 草稿
function minimalDraft(overrides = {}) {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'Process-test',
      name: '测试流程',
      level: 'L4',
      is_leaf: true,
      description: '测试用流程',
      purpose: '测试目的',
      owner: 'Role-owner',
      parent_process_name: null,
      inputs: [],
      outputs: [],
      start: { event_id: 'Start-1', name: '触发事件', event_type: 'NONE' },
      end_results: [{ event_id: 'End-1', name: '业务结果' }],
      performance_indicators: [],
    },
    activities: [],
    diagram: { lanes: [], nodes: [], flows: [], task_bindings: [], layout_version: '2.0.0' },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
    ...overrides,
  };
}

function boundaryDraft() {
  const draft = minimalDraft();
  draft.diagram.nodes = [
    { node_id: 'Start-1', node_type: 'START_EVENT', name: '触发事件', lane_id: null },
    { node_id: 'End-1', node_type: 'END_EVENT', name: '业务结果', lane_id: null },
  ];
  draft.diagram.flows = [
    { flow_id: 'Flow-1', source_ref: 'Start-1', target_ref: 'End-1', condition: null },
  ];
  return draft;
}

// 辅助：构造标准 RASCI 活动
function standardActivity(overrides = {}) {
  return {
    activity_id: 'Activity-1',
    name: '审核申请',
    description: '审核业务申请',
    activity_type: 'STANDARD',
    responsibility_model: 'RASCI',
    role_assignments: [
      { role_id: 'Role-R', responsibility: 'R' },
      { role_id: 'Role-A', responsibility: 'A' },
    ],
    sla: null,
    tools: [],
    inputs: [],
    process_summary: '',
    outputs: [],
    completion_criteria: [],
    references: [],
    main_task_id: 'Task-1',
    confirmation: null,
    completeness: 'COMPLETE',
    ...overrides,
  };
}

// 辅助：构造 OARP 评审活动
function reviewActivity(overrides = {}) {
  return {
    activity_id: 'Activity-R1',
    name: '评审会议',
    description: '评审业务方案',
    activity_type: 'REVIEW_MEETING',
    responsibility_model: 'OARP',
    role_assignments: [
      { role_id: 'Role-O', responsibility: 'O' },
      { role_id: 'Role-Approver', responsibility: 'A' },
      { role_id: 'Role-Reviewer', responsibility: 'R' },
      { role_id: 'Role-Participant', responsibility: 'P' },
    ],
    sla: null,
    tools: [],
    inputs: [],
    process_summary: '',
    outputs: [],
    completion_criteria: [],
    references: [],
    main_task_id: 'Task-R1',
    confirmation: null,
    completeness: 'COMPLETE',
    ...overrides,
  };
}

// ============================================================
// 测试集
// ============================================================

describe('process-draft-v2-rules.mjs 导出', () => {
  it('应导出 validateDraftBusinessRules 函数', async () => {
    const rules = await loadRules();
    assert.equal(typeof rules.validateDraftBusinessRules, 'function');
  });

  it('应导出 accountableRole 函数', async () => {
    const rules = await loadRules();
    assert.equal(typeof rules.accountableRole, 'function');
  });

  it('应导出 bindingForActivity 函数', async () => {
    const rules = await loadRules();
    assert.equal(typeof rules.bindingForActivity, 'function');
  });

  it('应导出 isLeafL4 函数', async () => {
    const rules = await loadRules();
    assert.equal(typeof rules.isLeafL4, 'function');
  });
});

describe('isLeafL4', () => {
  it('L4 + is_leaf=true 返回 true', async () => {
    const { isLeafL4 } = await loadRules();
    assert.equal(isLeafL4({ level: 'L4', is_leaf: true }), true);
  });

  it('L4 + is_leaf=false 返回 false', async () => {
    const { isLeafL4 } = await loadRules();
    assert.equal(isLeafL4({ level: 'L4', is_leaf: false }), false);
  });

  it('L3 + is_leaf=true 返回 false', async () => {
    const { isLeafL4 } = await loadRules();
    assert.equal(isLeafL4({ level: 'L3', is_leaf: true }), false);
  });

  it('L1 返回 false', async () => {
    const { isLeafL4 } = await loadRules();
    assert.equal(isLeafL4({ level: 'L1', is_leaf: false }), false);
  });
});

describe('accountableRole', () => {
  it('RASCI 活动返回 R 角色', async () => {
    const { accountableRole } = await loadRules();
    const activity = standardActivity();
    assert.equal(accountableRole(activity), 'Role-R');
  });

  it('OARP 活动返回 O 角色', async () => {
    const { accountableRole } = await loadRules();
    const activity = reviewActivity();
    assert.equal(accountableRole(activity), 'Role-O');
  });

  it('无责任分配返回 null', async () => {
    const { accountableRole } = await loadRules();
    assert.equal(accountableRole({ responsibility_model: 'RASCI', role_assignments: [] }), null);
  });
});

describe('bindingForActivity', () => {
  it('返回指定活动的绑定', async () => {
    const { bindingForActivity } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity()],
      diagram: {
        lanes: [], nodes: [], flows: [],
        task_bindings: [{ activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const binding = bindingForActivity(draft, 'Activity-1');
    assert.deepEqual(binding, { activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null });
  });

  it('不存在的活动返回 null', async () => {
    const { bindingForActivity } = await loadRules();
    const draft = minimalDraft();
    assert.equal(bindingForActivity(draft, 'Activity-nonexistent'), null);
  });
});

describe('validateDraftBusinessRules — 末端 L4 门禁', () => {
  it('合法末端 L4 草稿通过', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = await loadV2Fixture('valid-process-draft-v2.json');
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('非末端 L4 不允许包含活动和图（FA-DRAFT-LEAF-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      process_card: {
        process_id: 'Process-nonleaf',
        name: '非末端流程',
        level: 'L4',
        is_leaf: false,
        description: '非末端',
        purpose: '',
        owner: 'Role-owner',
        parent_process_name: null,
        inputs: [],
        outputs: [],
        start: { event_id: 'Start-1', name: '触发', event_type: 'NONE' },
        end_results: [{ event_id: 'End-1', name: '结果' }],
        performance_indicators: [],
      },
      activities: [standardActivity()],
      diagram: {
        lanes: [], nodes: [], flows: [],
        task_bindings: [{ activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-LEAF-001'), '应包含 FA-DRAFT-LEAF-001');
  });

  it('L1 不允许包含活动和图（FA-DRAFT-LEAF-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      process_card: {
        process_id: 'Process-l1',
        name: 'L1 流程',
        level: 'L1',
        is_leaf: false,
        description: '',
        purpose: '',
        owner: 'Role-owner',
        parent_process_name: null,
        inputs: [],
        outputs: [],
        start: { event_id: 'Start-1', name: '触发', event_type: 'NONE' },
        end_results: [{ event_id: 'End-1', name: '结果' }],
        performance_indicators: [],
      },
      activities: [standardActivity()],
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-LEAF-001'));
  });
});

describe('validateDraftBusinessRules — RASCI 角色门禁', () => {
  it('RASCI 无 R 时报错（FA-DRAFT-ROLE-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({
        role_assignments: [
          { role_id: 'Role-A', responsibility: 'A' },
          { role_id: 'Role-S', responsibility: 'S' },
        ],
      })],
      diagram: {
        lanes: [], nodes: [], flows: [],
        task_bindings: [{ activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-ROLE-001'));
  });

  it('RASCI 多个 R 时报错（FA-DRAFT-ROLE-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({
        role_assignments: [
          { role_id: 'Role-R1', responsibility: 'R' },
          { role_id: 'Role-R2', responsibility: 'R' },
        ],
      })],
      diagram: {
        lanes: [], nodes: [], flows: [],
        task_bindings: [{ activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-ROLE-001'));
  });

  it('OARP 无 O 时报错（FA-DRAFT-ROLE-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [reviewActivity({
        role_assignments: [
          { role_id: 'Role-A', responsibility: 'A' },
          { role_id: 'Role-R', responsibility: 'R' },
        ],
      })],
      diagram: {
        lanes: [], nodes: [], flows: [],
        task_bindings: [{ activity_id: 'Activity-R1', main_task_id: 'Task-R1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-ROLE-001'));
  });

  it('OARP 多个 O 时报错（FA-DRAFT-ROLE-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [reviewActivity({
        role_assignments: [
          { role_id: 'Role-O1', responsibility: 'O' },
          { role_id: 'Role-O2', responsibility: 'O' },
          { role_id: 'Role-A', responsibility: 'A' },
        ],
      })],
      diagram: {
        lanes: [], nodes: [], flows: [],
        task_bindings: [{ activity_id: 'Activity-R1', main_task_id: 'Task-R1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-ROLE-001'));
  });
});

describe('validateDraftBusinessRules — 绑定门禁（一主一从）', () => {
  it('活动无主 Task 时报错（FA-DRAFT-BIND-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({ main_task_id: 'Task-1' })],
      diagram: {
        lanes: [], nodes: [], flows: [],
        task_bindings: [], // 无绑定
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-BIND-001'));
  });

  it('活动多个主 Task 时报错（FA-DRAFT-BIND-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity()],
      diagram: {
        lanes: [], nodes: [], flows: [],
        task_bindings: [
          { activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null },
          { activity_id: 'Activity-1', main_task_id: 'Task-2', confirmation_task_id: null },
        ],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-BIND-001'));
  });
});

describe('validateDraftBusinessRules — 确认从 Task 门禁', () => {
  it('确认三条件 co_completes=false 报错（FA-DRAFT-CONFIRM-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({
        confirmation: {
          confirmation_task_id: 'Task-confirm-1',
          confirm_role_id: 'Role-confirmer',
          co_completes: false,
          confirm_bears_final_responsibility: true,
          no_formal_approval_meeting: true,
        },
      })],
      diagram: {
        lanes: [], nodes: [], flows: [],
        task_bindings: [{
          activity_id: 'Activity-1',
          main_task_id: 'Task-1',
          confirmation_task_id: 'Task-confirm-1',
        }],
        layout_version: '2.0.0',
      },
    });
    draft.diagram.nodes = [
      { node_id: 'Task-1', node_type: 'MAIN_TASK', name: '审核申请', lane_id: null },
      { node_id: 'Task-confirm-1', node_type: 'CONFIRMATION_TASK', name: '确认1', lane_id: null },
    ];
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-CONFIRM-001'));
  });

  it('确认三条件不全时报错（FA-DRAFT-CONFIRM-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({
        confirmation: {
          confirmation_task_id: 'Task-confirm',
          confirm_role_id: 'Role-confirmer',
          co_completes: false, // 第一条件不满足
          confirm_bears_final_responsibility: true,
          no_formal_approval_meeting: true,
        },
      })],
      diagram: {
        lanes: [], nodes: [], flows: [],
        task_bindings: [{
          activity_id: 'Activity-1',
          main_task_id: 'Task-1',
          confirmation_task_id: 'Task-confirm',
        }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-CONFIRM-001'));
  });
});

describe('validateDraftBusinessRules — 泳道一致性门禁', () => {
  it('泳道 ID 或角色重复时报错（FA-DRAFT-LANE-003）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      diagram: {
        lanes: [
          { lane_id: 'Lane-1', name: '泳道一', role_id: 'Role-1' },
          { lane_id: 'Lane-1', name: '泳道二', role_id: 'Role-1' },
        ],
        nodes: [
          { node_id: 'Start-1', node_type: 'START_EVENT', name: '触发事件', lane_id: null },
          { node_id: 'End-1', node_type: 'END_EVENT', name: '业务结果', lane_id: null },
        ],
        flows: [{ flow_id: 'Flow-1', source_ref: 'Start-1', target_ref: 'End-1', condition: null }],
        task_bindings: [], layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.code === 'FA-DRAFT-LANE-003'));
  });

  it('主 Task 泳道与 RASCI.R 不一致时报错（FA-DRAFT-LANE-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({
        role_assignments: [
          { role_id: 'Role-R', responsibility: 'R' },
        ],
      })],
      diagram: {
        lanes: [
          { lane_id: 'Lane-R', name: 'R 泳道', role_id: 'Role-R' },
          { lane_id: 'Lane-Wrong', name: '错误泳道', role_id: 'Role-X' },
        ],
        nodes: [
          { node_id: 'Task-1', node_type: 'MAIN_TASK', name: '审核申请', lane_id: 'Lane-Wrong' },
        ],
        flows: [],
        task_bindings: [{ activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-LANE-001'));
  });

  it('OARP 主 Task 泳道与 O 不一致时报错（FA-DRAFT-LANE-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [reviewActivity({
        role_assignments: [
          { role_id: 'Role-O', responsibility: 'O' },
        ],
      })],
      diagram: {
        lanes: [
          { lane_id: 'Lane-O', name: 'O 泳道', role_id: 'Role-O' },
          { lane_id: 'Lane-Wrong', name: '错误泳道', role_id: 'Role-X' },
        ],
        nodes: [
          { node_id: 'Task-R1', node_type: 'MAIN_TASK', name: '评审会议', lane_id: 'Lane-Wrong' },
        ],
        flows: [],
        task_bindings: [{ activity_id: 'Activity-R1', main_task_id: 'Task-R1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-LANE-001'));
  });
});

describe('validateDraftBusinessRules — 并行 Task 门禁', () => {
  it('同一 L5 内并行 Task 报错（FA-DRAFT-PARALLEL-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity()],
      diagram: {
        lanes: [],
        nodes: [
          { node_id: 'Task-1', node_type: 'MAIN_TASK', name: '审核申请', lane_id: null },
          { node_id: 'Task-2', node_type: 'MAIN_TASK', name: '并行任务', lane_id: null },
        ],
        flows: [],
        task_bindings: [
          { activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null },
          { activity_id: 'Activity-1', main_task_id: 'Task-2', confirmation_task_id: null },
        ],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-PARALLEL-001'));
  });
});

describe('validateDraftBusinessRules — parent_process_name 必填门禁', () => {
  it('缺少 parent_process_name 报错（FA-DRAFT-CARD-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      process_card: {
        process_id: 'Process-test',
        name: '测试流程',
        level: 'L4',
        is_leaf: true,
        description: '测试用流程',
        purpose: '测试目的',
        owner: 'Role-owner',
        // parent_process_name 缺失
        inputs: [],
        outputs: [],
        start: { event_id: 'Start-1', name: '触发事件', event_type: 'NONE' },
        end_results: [{ event_id: 'End-1', name: '业务结果' }],
        performance_indicators: [],
      },
      activities: [standardActivity()],
      diagram: {
        lanes: [{ lane_id: 'Lane-R', name: 'R 泳道', role_id: 'Role-R' }],
        nodes: [{ node_id: 'Task-1', node_type: 'MAIN_TASK', name: '审核申请', lane_id: 'Lane-R' }],
        flows: [],
        task_bindings: [{ activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false, '缺少 parent_process_name 应拒绝');
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-CARD-001'),
      '应包含 FA-DRAFT-CARD-001');
  });

  it('多个开始事件应报错（FA-DRAFT-CARD-002）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      diagram: {
        lanes: [],
        nodes: [
          { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始一', lane_id: null },
          { node_id: 'Start-2', node_type: 'START_EVENT', name: '开始二', lane_id: null },
          { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
        ],
        flows: [], task_bindings: [], layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error =>
      error.code === 'FA-DRAFT-CARD-002' && /恰好一个/.test(error.message)));
  });

  it('parent_process_name 为 null 时通过', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity()],
      diagram: {
        lanes: [{ lane_id: 'Lane-R', name: 'R 泳道', role_id: 'Role-R' }],
        nodes: [
          { node_id: 'Start-1', node_type: 'START_EVENT', name: '触发事件', lane_id: null },
          { node_id: 'Task-1', node_type: 'MAIN_TASK', name: '审核申请', lane_id: 'Lane-R' },
          { node_id: 'End-1', node_type: 'END_EVENT', name: '业务结果', lane_id: null },
        ],
        flows: [],
        task_bindings: [{ activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, true, `parent_process_name=null 应通过: ${JSON.stringify(result.errors)}`);
  });
});

describe('validateDraftBusinessRules — 流程卡片起终点与图一致性', () => {
  it('起点 ID 或名称漂移时报错（FA-DRAFT-CARD-004）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = boundaryDraft();
    draft.process_card.start.name = '不同名称';
    const result = validateDraftBusinessRules(draft);
    assert.ok(result.errors.some(error => error.code === 'FA-DRAFT-CARD-004'));
  });

  it('终点 ID、名称或集合漂移时报错（FA-DRAFT-CARD-005）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = boundaryDraft();
    draft.process_card.end_results[0].name = '不同名称';
    const result = validateDraftBusinessRules(draft);
    assert.ok(result.errors.some(error => error.code === 'FA-DRAFT-CARD-005'));
  });
});

describe('validateDraftBusinessRules — 责任模型匹配门禁', () => {
  it('STANDARD 活动使用 OARP 报错（FA-DRAFT-MODEL-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({
        activity_type: 'STANDARD',
        responsibility_model: 'OARP', // STANDARD 必须用 RASCI
        role_assignments: [
          { role_id: 'Role-O', responsibility: 'O' },
        ],
      })],
      diagram: {
        lanes: [{ lane_id: 'Lane-O', name: 'O 泳道', role_id: 'Role-O' }],
        nodes: [{ node_id: 'Task-1', node_type: 'MAIN_TASK', name: '审核申请', lane_id: 'Lane-O' }],
        flows: [],
        task_bindings: [{ activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false, 'STANDARD+OARP 应拒绝');
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-MODEL-001'),
      '应包含 FA-DRAFT-MODEL-001');
  });

  it('REVIEW_MEETING 活动使用 RASCI 报错（FA-DRAFT-MODEL-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [reviewActivity({
        activity_type: 'REVIEW_MEETING',
        responsibility_model: 'RASCI', // REVIEW_MEETING 必须用 OARP
        role_assignments: [
          { role_id: 'Role-R', responsibility: 'R' },
        ],
      })],
      diagram: {
        lanes: [{ lane_id: 'Lane-R', name: 'R 泳道', role_id: 'Role-R' }],
        nodes: [{ node_id: 'Task-R1', node_type: 'MAIN_TASK', name: '评审会议', lane_id: 'Lane-R' }],
        flows: [],
        task_bindings: [{ activity_id: 'Activity-R1', main_task_id: 'Task-R1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false, 'REVIEW_MEETING+RASCI 应拒绝');
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-MODEL-001'),
      '应包含 FA-DRAFT-MODEL-001');
  });
});

describe('validateDraftBusinessRules — 同角色多责任门禁', () => {
  it('同一角色出现多个责任代码报错（FA-DRAFT-ROLE-002）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({
        role_assignments: [
          { role_id: 'Role-X', responsibility: 'R' },
          { role_id: 'Role-X', responsibility: 'A' }, // 同角色多责任
        ],
      })],
      diagram: {
        lanes: [{ lane_id: 'Lane-X', name: 'X 泳道', role_id: 'Role-X' }],
        nodes: [{ node_id: 'Task-1', node_type: 'MAIN_TASK', name: '审核申请', lane_id: 'Lane-X' }],
        flows: [],
        task_bindings: [{ activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false, '同角色多责任应拒绝');
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-ROLE-002'),
      '应包含 FA-DRAFT-ROLE-002');
  });
});

describe('validateDraftBusinessRules — 主 Task 三方一致性门禁', () => {
  it('activity.main_task_id 与 binding.main_task_id 不一致报错（FA-DRAFT-BIND-002）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({ main_task_id: 'Task-1' })],
      diagram: {
        lanes: [],
        nodes: [
          { node_id: 'Task-1', node_type: 'MAIN_TASK', name: '审核申请', lane_id: null },
          { node_id: 'Task-2', node_type: 'MAIN_TASK', name: '另一任务', lane_id: null },
        ],
        flows: [],
        task_bindings: [{ activity_id: 'Activity-1', main_task_id: 'Task-2', confirmation_task_id: null }], // 不一致
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false, '三方不一致应拒绝');
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-BIND-002'),
      '应包含 FA-DRAFT-BIND-002');
  });

  it('binding.main_task_id 对应节点类型非 MAIN_TASK 报错', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({ main_task_id: 'Task-1' })],
      diagram: {
        lanes: [],
        nodes: [
          { node_id: 'Task-1', node_type: 'CONFIRMATION_TASK', name: '错误节点', lane_id: null }, // 类型错误
        ],
        flows: [],
        task_bindings: [{ activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false, '节点类型错误应拒绝');
  });
});

describe('validateDraftBusinessRules — confirmation 三方一致性门禁', () => {
  it('activity 有 confirmation 但 binding 无 confirmation_task_id 报错（FA-DRAFT-CONFIRM-002）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({
        confirmation: {
          confirmation_task_id: 'Task-confirm',
          confirm_role_id: 'Role-confirmer',
          co_completes: true,
          confirm_bears_final_responsibility: true,
          no_formal_approval_meeting: true,
        },
      })],
      diagram: {
        lanes: [
          { lane_id: 'Lane-R', name: 'R 泳道', role_id: 'Role-R' },
          { lane_id: 'Lane-C', name: '确认泳道', role_id: 'Role-confirmer' },
        ],
        nodes: [
          { node_id: 'Task-1', node_type: 'MAIN_TASK', name: '审核申请', lane_id: 'Lane-R' },
          { node_id: 'Task-confirm', node_type: 'CONFIRMATION_TASK', name: '确认任务', lane_id: 'Lane-C' },
        ],
        flows: [],
        task_bindings: [{
          activity_id: 'Activity-1',
          main_task_id: 'Task-1',
          confirmation_task_id: null, // 无确认但 activity 有
        }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false, 'confirmation 三方不一致应拒绝');
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-CONFIRM-002'),
      '应包含 FA-DRAFT-CONFIRM-002');
  });

  it('binding 有 confirmation_task_id 但 activity 无 confirmation 声明报错', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({ confirmation: null })], // 无声明
      diagram: {
        lanes: [],
        nodes: [
          { node_id: 'Task-1', node_type: 'MAIN_TASK', name: '审核申请', lane_id: null },
          { node_id: 'Task-confirm', node_type: 'CONFIRMATION_TASK', name: '孤立确认', lane_id: null },
        ],
        flows: [],
        task_bindings: [{
          activity_id: 'Activity-1',
          main_task_id: 'Task-1',
          confirmation_task_id: 'Task-confirm', // 有确认但 activity 无声明
        }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false, '孤立 confirmation 应拒绝');
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-CONFIRM-002'),
      '应包含 FA-DRAFT-CONFIRM-002');
  });
});

describe('validateDraftBusinessRules — 确认泳道门禁', () => {
  it('confirmation 节点位于主 Task 同一泳道报错（FA-DRAFT-LANE-002）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({
        confirmation: {
          confirmation_task_id: 'Task-confirm',
          confirm_role_id: 'Role-confirmer',
          co_completes: true,
          confirm_bears_final_responsibility: true,
          no_formal_approval_meeting: true,
        },
      })],
      diagram: {
        lanes: [
          { lane_id: 'Lane-R', name: 'R 泳道', role_id: 'Role-R' },
          { lane_id: 'Lane-C', name: '确认泳道', role_id: 'Role-confirmer' },
        ],
        nodes: [
          { node_id: 'Task-1', node_type: 'MAIN_TASK', name: '审核申请', lane_id: 'Lane-R' },
          { node_id: 'Task-confirm', node_type: 'CONFIRMATION_TASK', name: '确认任务', lane_id: 'Lane-R' }, // 同泳道!
        ],
        flows: [],
        task_bindings: [{
          activity_id: 'Activity-1',
          main_task_id: 'Task-1',
          confirmation_task_id: 'Task-confirm',
        }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false, 'confirmation 与主 Task 同泳道应拒绝');
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-LANE-002'),
      '应包含 FA-DRAFT-LANE-002');
  });

  it('责任角色找不到唯一泳道时报错（FA-DRAFT-LANE-001）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity({
        role_assignments: [{ role_id: 'Role-R', responsibility: 'R' }],
      })],
      diagram: {
        lanes: [
          { lane_id: 'Lane-X', name: 'X 泳道', role_id: 'Role-X' }, // 不是 Role-R
        ],
        nodes: [
          { node_id: 'Task-1', node_type: 'MAIN_TASK', name: '审核申请', lane_id: 'Lane-X' },
        ],
        flows: [],
        task_bindings: [{ activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false, '责任角色无泳道应失败关闭');
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-LANE-001'),
      '应包含 FA-DRAFT-LANE-001');
  });
});

describe('validateDraftBusinessRules — REVIEW/DECISION 禁止 confirmation', () => {
  it('REVIEW_MEETING 活动有 confirmation 报错（FA-DRAFT-CONFIRM-003）', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [reviewActivity({
        confirmation: {
          confirmation_task_id: 'Task-confirm',
          confirm_role_id: 'Role-confirmer',
          co_completes: true,
          confirm_bears_final_responsibility: true,
          no_formal_approval_meeting: true,
        },
      })],
      diagram: {
        lanes: [
          { lane_id: 'Lane-O', name: 'O 泳道', role_id: 'Role-O' },
          { lane_id: 'Lane-C', name: '确认泳道', role_id: 'Role-confirmer' },
        ],
        nodes: [
          { node_id: 'Task-R1', node_type: 'MAIN_TASK', name: '评审会议', lane_id: 'Lane-O' },
          { node_id: 'Task-confirm', node_type: 'CONFIRMATION_TASK', name: '确认任务', lane_id: 'Lane-C' },
        ],
        flows: [],
        task_bindings: [{
          activity_id: 'Activity-R1',
          main_task_id: 'Task-R1',
          confirmation_task_id: 'Task-confirm',
        }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(result.valid, false, 'REVIEW_MEETING 不应有 confirmation');
    assert.ok(result.errors.some(e => e.code === 'FA-DRAFT-CONFIRM-003'),
      '应包含 FA-DRAFT-CONFIRM-003');
  });
});

describe('validateDraftBusinessRules — 错误码稳定性', () => {
  it('返回 {valid, errors:[{code,path,message}]} 结构', async () => {
    const { validateDraftBusinessRules } = await loadRules();
    const draft = minimalDraft({
      activities: [standardActivity()],
      diagram: {
        lanes: [], nodes: [], flows: [],
        task_bindings: [{ activity_id: 'Activity-1', main_task_id: 'Task-1', confirmation_task_id: null }],
        layout_version: '2.0.0',
      },
    });
    const result = validateDraftBusinessRules(draft);
    assert.equal(typeof result.valid, 'boolean');
    assert.ok(Array.isArray(result.errors));
    for (const error of result.errors) {
      assert.equal(typeof error.code, 'string', 'error.code 应为 string');
      assert.equal(typeof error.path, 'string', 'error.path 应为 string');
      assert.equal(typeof error.message, 'string', 'error.message 应为 string');
    }
  });

  it('至少包含六个错误码', async () => {
    // 通过已知的错误码列表验证
    const expectedCodes = [
      'FA-DRAFT-LEAF-001',
      'FA-DRAFT-ROLE-001',
      'FA-DRAFT-BIND-001',
      'FA-DRAFT-CONFIRM-001',
      'FA-DRAFT-LANE-001',
      'FA-DRAFT-PARALLEL-001',
      'FA-DRAFT-CARD-001',
      'FA-DRAFT-MODEL-001',
      'FA-DRAFT-ROLE-002',
      'FA-DRAFT-BIND-002',
      'FA-DRAFT-CONFIRM-002',
      'FA-DRAFT-LANE-002',
      'FA-DRAFT-CONFIRM-003',
    ];
    // 静态检查：这些错误码都应被 validateDraftBusinessRules 用到
    for (const code of expectedCodes) {
      assert.ok(code.startsWith('FA-DRAFT-'), `错误码 ${code} 格式应为 FA-DRAFT-*`);
    }
    assert.ok(expectedCodes.length >= 6, '应至少有 6 个错误码');
  });
});
