/**
 * 澄清议题渲染器
 *
 * 从流程草稿生成 Markdown 格式的澄清议题。
 */

/**
 * 渲染澄清议题
 *
 * @param {object} draft - 流程草稿（V2 格式）
 * @returns {string} Markdown 格式的议题
 */
export function renderClarificationAgenda(draft) {
  if (draft.schema_version !== '2.0.0') {
    throw new Error('仅支持 schema_version 2.0.0 的流程草稿');
  }

  const lines = [];

  // 只读取 V2 字段
  const processName = draft.process_card.name;
  const processId = draft.process_card.process_id;
  const processLevel = draft.process_card.level;
  const boundaryStart = draft.process_card.start?.name || '开始';
  const boundaryEnd = draft.process_card.end_results?.map(e => e.name).join(', ') || '结束';
  const diagramLanes = draft.diagram.lanes || [];
  const diagramFlows = draft.diagram.flows || [];
  const activities = draft.activities || [];
  const questions = draft.questions || [];

  // 标题
  lines.push(`# ${processName} - 待确认议题`);
  lines.push('');
  lines.push(`流程 ID: ${processId}`);
  lines.push(`层级: ${processLevel}`);
  lines.push('');

  // 摘要
  lines.push('## 流程摘要');
  lines.push('');
  lines.push(`- **边界**: ${boundaryStart} → ${boundaryEnd}`);
  lines.push(`- **泳道**: ${diagramLanes.map(l => l.name).join(', ')}`);
  lines.push(`- **活动**: ${activities.length} 个`);
  lines.push(`- **流转**: ${diagramFlows.length} 个`);
  lines.push('');

  // 待确认问题
  const openQuestions = questions.filter(q => q.status === 'OPEN');
  const confirmedQuestions = questions.filter(q => q.status === 'CONFIRMED');

  if (openQuestions.length > 0) {
    lines.push('## 待确认问题');
    lines.push('');

    // 按类别分组
    const categories = categorizeQuestions(openQuestions, draft);

    for (const [category, questions] of Object.entries(categories)) {
      if (questions.length === 0) continue;

      lines.push(`### ${category}`);
      lines.push('');

      for (const question of questions) {
        lines.push(`#### ${question.question_id}`);
        lines.push('');
        lines.push(`**问题**: ${question.text}`);
        lines.push('');

        const targetPaths = question.target_paths || question.element_ids || [];
        if (targetPaths.length > 0) {
          const targetNames = targetPaths
            .map(path => {
              // 尝试从活动或图节点中查找名称
              const activity = activities.find(a => (a.activity_id || a.element_id) === path);
              if (activity) return activity.name;
              const diagramNodes = draft.diagram?.nodes || [];
              const node = diagramNodes.find(n => n.node_id === path);
              if (node) return node.name;
              return path;
            })
            .join(', ');
          lines.push(`**关联目标**: ${targetNames}`);
          lines.push('');
        }

        if (question.answer) {
          lines.push(`**回答**: ${question.answer}`);
          lines.push('');
        }

        lines.push('---');
        lines.push('');
      }
    }
  }

  // 已确认问题
  if (confirmedQuestions.length > 0) {
    lines.push('## 已确认问题');
    lines.push('');

    for (const question of confirmedQuestions) {
      lines.push(`- **${question.question_id}**: ${question.text}`);
      if (question.answer) {
        lines.push(`  - 回答: ${question.answer}`);
      }
    }
    lines.push('');
  }

  // 不确定活动
  const uncertainActivities = activities.filter(a =>
    a.completeness !== 'COMPLETE'
  );

  if (uncertainActivities.length > 0) {
    lines.push('## 不确定活动');
    lines.push('');
    lines.push('以下活动的完整度状态需要确认：');
    lines.push('');

    for (const activity of uncertainActivities) {
      lines.push(`- **${activity.name}**: ${activity.completeness}`);
    }
    lines.push('');
  }

  // 证据来源
  const sourceSummary = draft.source_summary || { total_blocks: 0, formats: [] };
  lines.push('## 证据来源');
  lines.push('');
  lines.push(`- 总证据块: ${sourceSummary.total_blocks}`);
  lines.push(`- 文件格式: ${(sourceSummary.formats || []).join(', ')}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * 对问题进行分类
 */
function categorizeQuestions(questions, draft) {
  const categories = {
    '流程边界': [],
    '角色与泳道': [],
    '活动与判断': [],
    '输入输出': [],
    '规则与异常': [],
    '其他': [],
  };

  for (const question of questions) {
    const text = question.text.toLowerCase();

    if (text.includes('边界') || text.includes('开始') || text.includes('结束')) {
      categories['流程边界'].push(question);
    } else if (text.includes('角色') || text.includes('泳道') || text.includes('组织')) {
      categories['角色与泳道'].push(question);
    } else if (text.includes('活动') || text.includes('审批') || text.includes('判断')) {
      categories['活动与判断'].push(question);
    } else if (text.includes('输入') || text.includes('输出') || text.includes('文档')) {
      categories['输入输出'].push(question);
    } else if (text.includes('规则') || text.includes('条件') || text.includes('例外')) {
      categories['规则与异常'].push(question);
    } else {
      categories['其他'].push(question);
    }
  }

  return categories;
}
