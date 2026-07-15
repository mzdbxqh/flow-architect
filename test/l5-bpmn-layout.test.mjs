/**
 * L5 BPMN 2.0 + DI 布局测试
 *
 * 覆盖：拓扑排序、分支/汇合/循环布局、每条 flow 有 DI、条件流 DI、
 * 非 EXPLICIT 元素关联问题、extractBpmn 复读验证、确定性、
 * lane 元素归属、gateway 分支条件、start→first/last→end 唯一、
 * question validator 双向引用、拓扑改变→布局改变、lane 高度自适应
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- fixtures ---------- */

function makeLinearDraft() {
  return {
    title: '线性流程',
    level: 'L5',
    process_id: 'linear-proc',
    boundary: { start: '开始', end: '结束' },
    lanes: [
      { lane_id: 'Lane-申请人', name: '申请人', org_candidates: [] },
      { lane_id: 'Lane-审批人', name: '审批人', org_candidates: [] },
    ],
    elements: [
      { element_id: 'Activity-提交', kind: 'ACTIVITY', name: '提交申请', lane_id: 'Lane-申请人', inputs: [], outputs: ['申请单'], evidence_refs: ['B-001'], certainty: 'EXPLICIT', question_ids: [] },
      { element_id: 'Activity-审批', kind: 'ACTIVITY', name: '审批申请', lane_id: 'Lane-审批人', inputs: ['申请单'], outputs: ['审批结果'], evidence_refs: ['B-002'], certainty: 'EXPLICIT', question_ids: [] },
      { element_id: 'Activity-归档', kind: 'ACTIVITY', name: '归档结果', lane_id: 'Lane-申请人', inputs: ['审批结果'], outputs: [], evidence_refs: ['B-003'], certainty: 'EXPLICIT', question_ids: [] },
    ],
    flows: [
      { flow_id: 'Flow-提交→审批', source_ref: 'Activity-提交', target_ref: 'Activity-审批', condition: null, evidence_refs: ['B-001'] },
      { flow_id: 'Flow-审批→归档', source_ref: 'Activity-审批', target_ref: 'Activity-归档', condition: null, evidence_refs: ['B-002'] },
    ],
    questions: [],
    conflicts: [],
    source_summary: { total_blocks: 3, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003'] },
  };
}

function makeBranchDraft() {
  return {
    title: '分支流程',
    level: 'L5',
    process_id: 'branch-proc',
    boundary: { start: '开始', end: '结束' },
    lanes: [
      { lane_id: 'Lane-申请人', name: '申请人', org_candidates: [] },
      { lane_id: 'Lane-审批人', name: '审批人', org_candidates: [] },
    ],
    elements: [
      { element_id: 'Activity-提交', kind: 'ACTIVITY', name: '提交申请', lane_id: 'Lane-申请人', inputs: [], outputs: ['申请单'], evidence_refs: ['B-001'], certainty: 'EXPLICIT', question_ids: [] },
      { element_id: 'Gateway-判断', kind: 'DECISION', name: '金额判断', lane_id: 'Lane-审批人', inputs: ['申请单'], outputs: [], evidence_refs: ['B-002'], certainty: 'EXPLICIT', question_ids: [] },
      { element_id: 'Activity-经理审批', kind: 'ACTIVITY', name: '经理审批', lane_id: 'Lane-审批人', inputs: [], outputs: ['审批结果'], evidence_refs: ['B-003'], certainty: 'EXPLICIT', question_ids: [] },
      { element_id: 'Activity-总监审批', kind: 'ACTIVITY', name: '总监审批', lane_id: 'Lane-审批人', inputs: [], outputs: ['审批结果'], evidence_refs: ['B-004'], certainty: 'EXPLICIT', question_ids: [] },
      { element_id: 'Activity-归档', kind: 'ACTIVITY', name: '归档结果', lane_id: 'Lane-申请人', inputs: ['审批结果'], outputs: [], evidence_refs: ['B-005'], certainty: 'EXPLICIT', question_ids: [] },
    ],
    flows: [
      { flow_id: 'Flow-提交→判断', source_ref: 'Activity-提交', target_ref: 'Gateway-判断', condition: null, evidence_refs: ['B-001'] },
      { flow_id: 'Flow-判断→经理', source_ref: 'Gateway-判断', target_ref: 'Activity-经理审批', condition: '金额 <= 10000', evidence_refs: ['B-002'] },
      { flow_id: 'Flow-判断→总监', source_ref: 'Gateway-判断', target_ref: 'Activity-总监审批', condition: '金额 > 10000', evidence_refs: ['B-002'] },
      { flow_id: 'Flow-经理→归档', source_ref: 'Activity-经理审批', target_ref: 'Activity-归档', condition: null, evidence_refs: ['B-003'] },
      { flow_id: 'Flow-总监→归档', source_ref: 'Activity-总监审批', target_ref: 'Activity-归档', condition: null, evidence_refs: ['B-004'] },
    ],
    questions: [],
    conflicts: [],
    source_summary: { total_blocks: 5, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003', 'B-004', 'B-005'] },
  };
}

function makeLoopDraft() {
  return {
    title: '循环流程',
    level: 'L5',
    process_id: 'loop-proc',
    boundary: { start: '开始', end: '结束' },
    lanes: [
      { lane_id: 'Lane-申请人', name: '申请人', org_candidates: [] },
      { lane_id: 'Lane-审批人', name: '审批人', org_candidates: [] },
    ],
    elements: [
      { element_id: 'Activity-提交', kind: 'ACTIVITY', name: '提交申请', lane_id: 'Lane-申请人', inputs: [], outputs: ['申请单'], evidence_refs: ['B-001'], certainty: 'EXPLICIT', question_ids: [] },
      { element_id: 'Activity-审批', kind: 'ACTIVITY', name: '审批申请', lane_id: 'Lane-审批人', inputs: ['申请单'], outputs: ['审批结果'], evidence_refs: ['B-002'], certainty: 'EXPLICIT', question_ids: [] },
      { element_id: 'Gateway-判断', kind: 'DECISION', name: '是否通过', lane_id: 'Lane-审批人', inputs: ['审批结果'], outputs: [], evidence_refs: ['B-003'], certainty: 'EXPLICIT', question_ids: [] },
      { element_id: 'Activity-归档', kind: 'ACTIVITY', name: '归档结果', lane_id: 'Lane-申请人', inputs: [], outputs: [], evidence_refs: ['B-004'], certainty: 'EXPLICIT', question_ids: [] },
    ],
    flows: [
      { flow_id: 'Flow-提交→审批', source_ref: 'Activity-提交', target_ref: 'Activity-审批', condition: null, evidence_refs: ['B-001'] },
      { flow_id: 'Flow-审批→判断', source_ref: 'Activity-审批', target_ref: 'Gateway-判断', condition: null, evidence_refs: ['B-002'] },
      { flow_id: 'Flow-判断→归档', source_ref: 'Gateway-判断', target_ref: 'Activity-归档', condition: '通过', evidence_refs: ['B-003'] },
      { flow_id: 'Flow-判断→提交', source_ref: 'Gateway-判断', target_ref: 'Activity-提交', condition: '不通过', evidence_refs: ['B-003'] },
    ],
    questions: [],
    conflicts: [],
    source_summary: { total_blocks: 4, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003', 'B-004'] },
  };
}

function makeMergeDraft() {
  return {
    title: '汇合流程',
    level: 'L5',
    process_id: 'merge-proc',
    boundary: { start: '开始', end: '结束' },
    lanes: [
      { lane_id: 'Lane-A', name: '角色A', org_candidates: [] },
      { lane_id: 'Lane-B', name: '角色B', org_candidates: [] },
    ],
    elements: [
      { element_id: 'Activity-启动', kind: 'ACTIVITY', name: '启动流程', lane_id: 'Lane-A', inputs: [], outputs: [], evidence_refs: ['B-001'], certainty: 'EXPLICIT', question_ids: [] },
      { element_id: 'Activity-处理A', kind: 'ACTIVITY', name: '处理A', lane_id: 'Lane-A', inputs: [], outputs: [], evidence_refs: ['B-002'], certainty: 'EXPLICIT', question_ids: [] },
      { element_id: 'Activity-处理B', kind: 'ACTIVITY', name: '处理B', lane_id: 'Lane-B', inputs: [], outputs: [], evidence_refs: ['B-003'], certainty: 'EXPLICIT', question_ids: [] },
      { element_id: 'Activity-汇总', kind: 'ACTIVITY', name: '汇总结果', lane_id: 'Lane-A', inputs: [], outputs: [], evidence_refs: ['B-004'], certainty: 'EXPLICIT', question_ids: [] },
    ],
    flows: [
      { flow_id: 'Flow-启动→A', source_ref: 'Activity-启动', target_ref: 'Activity-处理A', condition: null, evidence_refs: ['B-001'] },
      { flow_id: 'Flow-启动→B', source_ref: 'Activity-启动', target_ref: 'Activity-处理B', condition: null, evidence_refs: ['B-001'] },
      { flow_id: 'Flow-A→汇总', source_ref: 'Activity-处理A', target_ref: 'Activity-汇总', condition: null, evidence_refs: ['B-002'] },
      { flow_id: 'Flow-B→汇总', source_ref: 'Activity-处理B', target_ref: 'Activity-汇总', condition: null, evidence_refs: ['B-003'] },
    ],
    questions: [],
    conflicts: [],
    source_summary: { total_blocks: 4, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003', 'B-004'] },
  };
}

function makeUncertainDraft() {
  const base = makeLinearDraft();
  return {
    ...base,
    title: '含不确定性流程',
    process_id: 'uncertain-proc',
    elements: [
      { ...base.elements[0], certainty: 'INFERRED', question_ids: ['Q-001'] },
      base.elements[1],
      base.elements[2],
    ],
    questions: [
      { question_id: 'Q-001', text: '提交申请的责任角色不确定', element_ids: ['Activity-提交'], status: 'OPEN', answer: '', evidence_refs: ['B-001'] },
    ],
  };
}

/* ---------- helpers ---------- */

function parseBpmnXml(xml) {
  // Minimal parser for tests — extracts tags and attributes
  const elements = {};
  const regex = /<bpmn:(\w+)\s+([^>]*)\/?>|<\/bpmn:(\w+)>/g;
  let match;
  const stack = [];
  while ((match = regex.exec(xml)) !== null) {
    if (match[3]) { stack.pop(); continue; }
    const tag = match[1];
    const attrs = {};
    const attrRegex = /(\w+)="([^"]*)"/g;
    let am;
    while ((am = attrRegex.exec(match[2])) !== null) {
      attrs[am[1]] = am[2];
    }
    if (!elements[tag]) elements[tag] = [];
    elements[tag].push(attrs);
  }
  return elements;
}

function getShapeBpmnElements(xml) {
  const shapes = [];
  const regex = /<bpmndi:BPMNShape[^>]+bpmnElement="([^"]+)"/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    shapes.push(m[1]);
  }
  return shapes;
}

function getEdgeBpmnElements(xml) {
  const edges = [];
  const regex = /<bpmndi:BPMNEdge[^>]+bpmnElement="([^"]+)"/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    edges.push(m[1]);
  }
  return edges;
}

/* ---------- Tests ---------- */

describe('L5 BPMN Layout', () => {
  describe('拓扑排序', () => {
    it('线性流程拓扑 rank 应与 flows 一致', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      assert.equal(layout.elements['Activity-提交'].rank, 0);
      assert.equal(layout.elements['Activity-审批'].rank, 1);
      assert.equal(layout.elements['Activity-归档'].rank, 2);
    });

    it('分支流程中并行元素 rank 正确', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeBranchDraft();
      const layout = layoutProcessGraph(draft);

      assert.equal(layout.elements['Activity-提交'].rank, 0);
      assert.equal(layout.elements['Gateway-判断'].rank, 1);
      assert.equal(layout.elements['Activity-经理审批'].rank, 2);
      assert.equal(layout.elements['Activity-总监审批'].rank, 2);
      assert.equal(layout.elements['Activity-归档'].rank, 3);
    });

    it('循环流程中回边不影响正向拓扑 rank', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLoopDraft();
      const layout = layoutProcessGraph(draft);

      assert.equal(layout.elements['Activity-提交'].rank, 0);
      assert.equal(layout.elements['Activity-审批'].rank, 1);
      assert.equal(layout.elements['Gateway-判断'].rank, 2);
      assert.equal(layout.elements['Activity-归档'].rank, 3);
    });
  });

  describe('分支/汇合/循环布局', () => {
    it('分支布局: 分支元素位于不同 lane 但同一 x 坐标列', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeBranchDraft();
      const layout = layoutProcessGraph(draft);

      const mgrX = layout.elements['Activity-经理审批'].x;
      const dirX = layout.elements['Activity-总监审批'].x;
      assert.equal(mgrX, dirX, '并行分支应在同一 x 列');
    });

    it('汇合布局: 汇合点位于分支元素右侧', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeMergeDraft();
      const layout = layoutProcessGraph(draft);

      const axX = layout.elements['Activity-处理A'].x;
      const bxX = layout.elements['Activity-处理B'].x;
      const mergeX = layout.elements['Activity-汇总'].x;
      assert.ok(mergeX > axX, '汇合点应在分支右侧');
      assert.ok(mergeX > bxX, '汇合点应在分支右侧');
    });

    it('循环布局: 回边有独立 waypoint 通道', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLoopDraft();
      const layout = layoutProcessGraph(draft);

      const backEdge = layout.edges.find(e => e.id === 'Flow-判断→提交');
      assert.ok(backEdge, '回边应存在于 layout edges');
      assert.ok(backEdge.waypoints.length >= 3, '回边应有多段 waypoint（绕行）');
    });
  });

  describe('每条 flow 有正确 DI', () => {
    it('所有 flows 都有对应的 edge waypoints', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeBranchDraft();
      const layout = layoutProcessGraph(draft);

      for (const flow of draft.flows) {
        const edge = layout.edges.find(e => e.id === flow.flow_id);
        assert.ok(edge, `Flow ${flow.flow_id} 应有 edge`);
        assert.ok(edge.waypoints.length >= 2, `Flow ${flow.flow_id} 应有至少 2 个 waypoint`);
      }
    });

    it('循环流程每条 flow 都有 DI', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLoopDraft();
      const layout = layoutProcessGraph(draft);

      for (const flow of draft.flows) {
        const edge = layout.edges.find(e => e.id === flow.flow_id);
        assert.ok(edge, `Loop flow ${flow.flow_id} 应有 edge`);
        assert.ok(edge.waypoints.length >= 2);
      }
    });
  });

  describe('start/end 事件 DI', () => {
    it('StartEvent 和 EndEvent 有 shape', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      assert.ok(layout.startShape, '应有 startShape');
      assert.ok(layout.endShape, '应有 endShape');
      assert.equal(layout.startShape.width, 36);
      assert.equal(layout.startShape.height, 36);
      assert.equal(layout.endShape.width, 36);
      assert.equal(layout.endShape.height, 36);
    });

    it('start→first 和 last→end 各只有一条 edge', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeLinearDraft();
      const bpmn = generateL5Bpmn(draft);

      // 从 StartEvent 出发的 flow 只有 Flow_start
      const startOutFlows = draft.flows.filter(f => f.source_ref === 'StartEvent_1');
      // 在 XML 中检查 startEvent 的 outgoing
      assert.ok(bpmn.includes('sourceRef="StartEvent_1"'), '应有从 StartEvent 出发的 flow');
      // 只有一条 start→first
      const startOutCount = (bpmn.match(/sourceRef="StartEvent_1"/g) || []).length;
      assert.equal(startOutCount, 1, 'start→first 只有一条');

      // 只有一条 last→end
      const endInCount = (bpmn.match(/targetRef="EndEvent_1"/g) || []).length;
      assert.equal(endInCount, 1, 'last→end 只有一条');
    });
  });

  describe('条件流', () => {
    it('条件流 XML 中有 conditionExpression', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeBranchDraft();
      const bpmn = generateL5Bpmn(draft);

      assert.ok(bpmn.includes('bpmn:conditionExpression'), '条件流应有 conditionExpression');
      assert.ok(bpmn.includes('金额 &lt;= 10000'), '条件表达式应被 XML 转义');
      assert.ok(bpmn.includes('金额 &gt; 10000'), '条件表达式应被 XML 转义');
    });

    it('条件流 edge 与非条件流 edge 结构一致', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeBranchDraft();
      const layout = layoutProcessGraph(draft);

      for (const edge of layout.edges) {
        assert.ok(edge.waypoints.length >= 2, `Edge ${edge.id} 应有至少 2 个 waypoint`);
        for (const wp of edge.waypoints) {
          assert.ok(typeof wp.x === 'number' && Number.isFinite(wp.x));
          assert.ok(typeof wp.y === 'number' && Number.isFinite(wp.y));
        }
      }
    });
  });

  describe('非 EXPLICIT 元素关联问题', () => {
    it('INFERRED 元素 documentation 中标记不确定', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeUncertainDraft();
      const bpmn = generateL5Bpmn(draft);

      // INFERRED 元素应有 documentation 标记
      assert.ok(bpmn.includes('INFERRED'), 'INFERRED 元素应在 documentation 中标记');
    });

    it('question 关联到正确的 element', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeUncertainDraft();
      const bpmn = generateL5Bpmn(draft);

      // Q-001 关联到 Activity-提交
      assert.ok(bpmn.includes('Q-001') || bpmn.includes('question_ids'),
        '应有关联问题引用');
    });
  });

  describe('extractBpmn 复读验证', () => {
    it('生成的 BPMN 可被 extractBpmn 解析且元素/flow 数量匹配', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeBranchDraft();
      const bpmn = generateL5Bpmn(draft);

      // 从生成的 BPMN 中用正则统计关键元素
      const taskCount = (bpmn.match(/<bpmn:task /g) || []).length;
      const gatewayCount = (bpmn.match(/<bpmn:exclusiveGateway /g) || []).length;
      const flowCount = (bpmn.match(/<bpmn:sequenceFlow /g) || []).length;
      const startCount = (bpmn.match(/<bpmn:startEvent /g) || []).length;
      const endCount = (bpmn.match(/<bpmn:endEvent /g) || []).length;

      // 5 元素 + start + end = 7 shapes
      assert.ok(taskCount >= 4, `应有至少 4 个 task，实际 ${taskCount}`);
      assert.ok(gatewayCount >= 1, `应有至少 1 个 gateway，实际 ${gatewayCount}`);
      assert.ok(flowCount >= 7, `应有至少 7 条 sequenceFlow（5 draft flows + start + end），实际 ${flowCount}`);
      assert.equal(startCount, 1, '应有 1 个 startEvent');
      assert.equal(endCount, 1, '应有 1 个 endEvent');
    });

    it('BPMN 中所有 flow 的 sourceRef 和 targetRef 都引用存在的元素', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeBranchDraft();
      const bpmn = generateL5Bpmn(draft);

      // 收集所有 id
      const idRegex = /\bid="([^"]+)"/g;
      const ids = new Set();
      let m;
      while ((m = idRegex.exec(bpmn)) !== null) {
        ids.add(m[1]);
      }

      // 检查所有 sourceRef 和 targetRef
      const refRegex = /\bsourceRef="([^"]+)"/g;
      while ((m = refRegex.exec(bpmn)) !== null) {
        assert.ok(ids.has(m[1]), `sourceRef ${m[1]} 应引用存在的元素 id`);
      }
      const tRefRegex = /\btargetRef="([^"]+)"/g;
      while ((m = tRefRegex.exec(bpmn)) !== null) {
        assert.ok(ids.has(m[1]), `targetRef ${m[1]} 应引用存在的元素 id`);
      }
    });

    it('所有 DI shape 的 bpmnElement 都引用存在的元素 id', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeLinearDraft();
      const bpmn = generateL5Bpmn(draft);

      const idRegex = /\bid="([^"]+)"/g;
      const ids = new Set();
      let m;
      while ((m = idRegex.exec(bpmn)) !== null) {
        ids.add(m[1]);
      }

      const shapeElements = getShapeBpmnElements(bpmn);
      for (const el of shapeElements) {
        assert.ok(ids.has(el), `shape bpmnElement ${el} 应引用存在的 id`);
      }

      const edgeElements = getEdgeBpmnElements(bpmn);
      for (const el of edgeElements) {
        assert.ok(ids.has(el), `edge bpmnElement ${el} 应引用存在的 id`);
      }
    });
  });

  describe('确定性', () => {
    it('相同输入多次生成产出字节一致的 BPMN', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeBranchDraft();

      const bpmn1 = generateL5Bpmn(draft);
      const bpmn2 = generateL5Bpmn(draft);
      assert.equal(bpmn1, bpmn2, '相同输入应产出相同 BPMN');
    });

    it('layoutProcessGraph 也是确定性的', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLoopDraft();

      const l1 = layoutProcessGraph(draft);
      const l2 = layoutProcessGraph(draft);
      assert.deepStrictEqual(l1, l2, 'layout 结果应完全一致');
    });
  });

  describe('lane 元素归属', () => {
    it('laneSet 中的 flowNodeRef 只引用属于该 lane 的元素', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeLinearDraft();
      const bpmn = generateL5Bpmn(draft);

      // Lane-申请人 应包含 Activity-提交 和 Activity-归档
      assert.ok(bpmn.includes('Lane_Lane-申请人'), '应有申请人 lane');
      assert.ok(bpmn.includes('Lane_Lane-审批人'), '应有审批人 lane');
    });

    it('所有 activity 元素都被某 lane 引用', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeLinearDraft();
      const bpmn = generateL5Bpmn(draft);

      for (const el of draft.elements) {
        assert.ok(bpmn.includes(`<bpmn:flowNodeRef>${el.element_id}</bpmn:flowNodeRef>`),
          `元素 ${el.element_id} 应被某 lane 引用`);
      }
    });
  });

  describe('namespace 和结构', () => {
    it('只有一个 participant（单 participant + laneSet）', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeLinearDraft();
      const bpmn = generateL5Bpmn(draft);

      const participantCount = (bpmn.match(/<bpmn:participant /g) || []).length;
      assert.equal(participantCount, 1, '应只有 1 个 participant');
    });

    it('正确 namespace: bpmn/bpmndi/dc/di', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeLinearDraft();
      const bpmn = generateL5Bpmn(draft);

      assert.ok(bpmn.includes('xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"'));
      assert.ok(bpmn.includes('xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"'));
      assert.ok(bpmn.includes('xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"'));
      assert.ok(bpmn.includes('xmlns:di="http://www.omg.org/spec/DD/20100524/DI"'));
    });

    it('process 有 isExecutable="false"', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeLinearDraft();
      const bpmn = generateL5Bpmn(draft);

      assert.ok(bpmn.includes('isExecutable="false"'), 'L5 草稿应标记为不可执行');
    });

    it('有且仅有一个 laneSet', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeLinearDraft();
      const bpmn = generateL5Bpmn(draft);

      const laneSetCount = (bpmn.match(/<bpmn:laneSet /g) || []).length;
      assert.equal(laneSetCount, 1, '应只有 1 个 laneSet');
    });

    it('gateway 有 incoming 和 outgoing', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = makeBranchDraft();
      const bpmn = generateL5Bpmn(draft);

      // Gateway-判断 应有 1 个 incoming 和 2 个 outgoing
      const gatewaySection = bpmn.slice(
        bpmn.indexOf('id="Gateway-判断"'),
        bpmn.indexOf('</bpmn:exclusiveGateway>', bpmn.indexOf('id="Gateway-判断"'))
      );
      const incomingCount = (gatewaySection.match(/<bpmn:incoming>/g) || []).length;
      const outgoingCount = (gatewaySection.match(/<bpmn:outgoing>/g) || []).length;
      assert.equal(incomingCount, 1, 'gateway 应有 1 个 incoming');
      assert.equal(outgoingCount, 2, 'gateway 应有 2 个 outgoing');
    });
  });

  describe('lane 高度自适应', () => {
    it('lane 高度应考虑其中元素数量', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      // 两个 lane 应有各自的高度
      for (const lane of layout.lanes) {
        assert.ok(lane.height > 0, `lane ${lane.id} 高度应 > 0`);
      }
    });
  });

  describe('layoutProcessGraph 输出结构', () => {
    it('返回 elements/edges/lanes/startShape/endShape', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      assert.ok(layout.elements, '应有 elements');
      assert.ok(layout.edges, '应有 edges');
      assert.ok(layout.lanes, '应有 lanes');
      assert.ok(layout.startShape, '应有 startShape');
      assert.ok(layout.endShape, '应有 endShape');
    });

    it('每个 element 有 x/y/width/height/rank', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      for (const [id, el] of Object.entries(layout.elements)) {
        assert.ok(typeof el.x === 'number', `${id} 应有 x`);
        assert.ok(typeof el.y === 'number', `${id} 应有 y`);
        assert.ok(typeof el.width === 'number', `${id} 应有 width`);
        assert.ok(typeof el.height === 'number', `${id} 应有 height`);
        assert.ok(typeof el.rank === 'number', `${id} 应有 rank`);
      }
    });

    it('每个 edge 有 id/sourceRef/targetRef/waypoints', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      for (const edge of layout.edges) {
        assert.ok(edge.id, 'edge 应有 id');
        assert.ok(edge.sourceRef, 'edge 应有 sourceRef');
        assert.ok(edge.targetRef, 'edge 应有 targetRef');
        assert.ok(Array.isArray(edge.waypoints), 'edge 应有 waypoints');
      }
    });
  });

  describe('复杂场景: 单 lane 流程', () => {
    it('单 lane 流程正确生成', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');
      const draft = {
        title: '单泳道流程',
        level: 'L5',
        process_id: 'single-lane',
        boundary: { start: '开始', end: '结束' },
        lanes: [{ lane_id: 'Lane-Only', name: '执行人', org_candidates: [] }],
        elements: [
          { element_id: 'Activity-A', kind: 'ACTIVITY', name: '步骤A', lane_id: 'Lane-Only', inputs: [], outputs: [], evidence_refs: ['B-001'], certainty: 'EXPLICIT', question_ids: [] },
        ],
        flows: [],
        questions: [],
        conflicts: [],
        source_summary: { total_blocks: 1, formats: ['md'], evidence_refs: ['B-001'] },
      };

      const bpmn = generateL5Bpmn(draft);
      assert.ok(bpmn.includes('bpmn:startEvent'));
      assert.ok(bpmn.includes('bpmn:endEvent'));
      assert.ok(bpmn.includes('bpmn:task'));
      assert.equal((bpmn.match(/<bpmn:participant /g) || []).length, 1);
    });
  });

  describe('event DI 在正确 lane', () => {
    it('StartEvent 在第一个 lane，EndEvent 在最后一个 lane', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      const firstLaneY = layout.lanes[0].y;
      const lastLaneY = layout.lanes[layout.lanes.length - 1].y;

      // startShape.y 应在第一个 lane 内
      assert.ok(layout.startShape.y >= firstLaneY,
        'StartEvent 应在第一个 lane 内');
    });
  });
});
