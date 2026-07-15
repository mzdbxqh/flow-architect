/**
 * 澄清议题渲染器
 *
 * 从流程草稿生成 Markdown 格式的澄清议题。
 */

/**
 * 渲染澄清议题
 *
 * @param {object} draft - 流程草稿
 * @returns {string} Markdown 格式的议题
 */
export function renderClarificationAgenda(draft) {
  const lines = [];

  // 标题
  lines.push(`# ${draft.title} - 待确认议题`);
  lines.push('');
  lines.push(`流程 ID: ${draft.process_id}`);
  lines.push(`层级: ${draft.level}`);
  lines.push('');

  // 摘要
  lines.push('## 流程摘要');
  lines.push('');
  lines.push(`- **边界**: ${draft.boundary.start} → ${draft.boundary.end}`);
  lines.push(`- **泳道**: ${draft.lanes.map(l => l.name).join(', ')}`);
  lines.push(`- **元素**: ${draft.elements.length} 个`);
  lines.push(`- **流转**: ${draft.flows.length} 个`);
  lines.push('');

  // 待确认问题
  const openQuestions = draft.questions.filter(q => q.status === 'OPEN');
  const confirmedQuestions = draft.questions.filter(q => q.status === 'CONFIRMED');

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

        if (question.element_ids.length > 0) {
          const elementNames = question.element_ids
            .map(id => {
              const element = draft.elements.find(e => e.element_id === id);
              return element ? element.name : id;
            })
            .join(', ');
          lines.push(`**关联元素**: ${elementNames}`);
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

  // 冲突
  if (draft.conflicts.length > 0) {
    lines.push('## 信息冲突');
    lines.push('');

    for (const conflict of draft.conflicts) {
      lines.push(`### ${conflict.conflict_id}`);
      lines.push('');
      lines.push(conflict.description);
      lines.push('');
    }
  }

  // 不确定元素
  const uncertainElements = draft.elements.filter(e =>
    e.certainty !== 'EXPLICIT' && e.certainty !== 'NOT_APPLICABLE'
  );

  if (uncertainElements.length > 0) {
    lines.push('## 不确定元素');
    lines.push('');
    lines.push('以下元素的确定性状态需要确认：');
    lines.push('');

    for (const element of uncertainElements) {
      lines.push(`- **${element.name}** (${element.kind}): ${element.certainty}`);
    }
    lines.push('');
  }

  // 证据来源
  lines.push('## 证据来源');
  lines.push('');
  lines.push(`- 总证据块: ${draft.source_summary.total_blocks}`);
  lines.push(`- 文件格式: ${draft.source_summary.formats.join(', ')}`);
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
