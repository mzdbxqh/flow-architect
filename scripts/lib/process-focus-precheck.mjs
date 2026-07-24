/**
 * 流程焦点只读预检（Process Focus Read-Only Precheck）
 *
 * 在严格流程初稿入口创建 runDir 之前，对输入材料做【完全不落盘】的候选流程发现：
 * - 复用 source-evidence-extractor 的内存抽取（只读，预检前后文件系统零变化）；
 * - 仅从「标题路径」识别候选流程键/名称/层级/证据定位，避免扫描正文造成误判；
 * - 单候选可自动继续；多候选且无 focus 时由入口转交一个证据驱动问题，不创建 runDir；
 * - 用户选择后，focus 作为显式参数进入 manifest、缓存键与后续批次过滤。
 *
 * 设计要点（确定性、可读、可共享）：
 * - 候选键由 canonicalProcessKey 归一化，保证预检候选键与后续 merge 分组键、缓存键口径一致；
 * - has_complete_l5 仅依据结构化证据（活动表 + 控制流 + 结束事件）判定，绝不据正文自述；
 * - 全部函数为纯/只读：不写文件、不创建目录、不联网。
 */

import { extractArtifactEvidence } from './source-evidence-extractor.mjs';

/**
 * 预检阶段可安全内存抽取的文本类格式（轻量、无重型依赖，且为抽取器实际支持的格式）。
 * 二进制格式（docx/xlsx/pptx/pdf/图片）不在预检阶段投机抽取：
 * 它们不产生 Markdown 标题结构，按本文「标题路径」口径不会贡献候选流程。
 */
const PREFLIGHT_FORMATS = new Set(['md', 'bpmn', 'svg', 'mermaid']);

/**
 * 候选流程编号模式：1~4 个大写字母 + 连字符 + 数字（可带 .数字 子编号）。
 * 例如 CM-1、CM-1.4、PR-2。（?:\.\d+）? 贪婪匹配，确保 "CM-1.4" 作为整体被识别，
 * 而不会被误拆成 "CM-1"。
 */
const PROCESS_CODE_RE = /\b([A-Z]{1,4}-\d+(?:\.\d+)?)\b/g;

/**
 * 归一化候选流程键（共享规范键）。
 *
 * 预检候选键、merge 分组键与缓存键应使用同一口径，避免「用户选了 CM-1.4，
 * 却在后续阶段匹配不到对应分组」。当前实现为去首尾空白并统一大写；
 * 该函数为唯一规范键来源，后续阶段应复用而非各自实现。
 *
 * @param {string} raw - 原始候选编号（如 "cm-1.4 "）。
 * @returns {string} 规范键（如 "CM-1.4"）；空输入返回 'default'。
 */
export function canonicalProcessKey(raw) {
  const text = String(raw ?? '').trim().toUpperCase();
  return text.length > 0 ? text : 'default';
}

/**
 * 从一段文本中抽取候选流程编号（贪婪、去重、保持出现顺序）。
 * @param {string} text
 * @returns {string[]} 规范键数组。
 */
export function extractCandidateCodes(text) {
  const codes = [];
  const seen = new Set();
  for (const match of String(text ?? '').matchAll(PROCESS_CODE_RE)) {
    const key = canonicalProcessKey(match[1]);
    if (!seen.has(key)) {
      seen.add(key);
      codes.push(key);
    }
  }
  return codes;
}

/**
 * 判定一个证据块是否归属于某候选流程（按其标题路径中是否出现该候选编号）。
 * 仅匹配「完整编号 token」，避免 CM-1 误配 CM-1.4。
 *
 * @param {object} block - 证据块（含 heading_path）。
 * @param {string} processKey - 规范候选键。
 * @returns {boolean}
 */
export function blockMatchesProcessKey(block, processKey) {
  const target = canonicalProcessKey(processKey);
  const headingPath = Array.isArray(block?.heading_path) ? block.heading_path : [];
  return headingPath.some(segment => extractCandidateCodes(segment).includes(target));
}

/**
 * 解析 Markdown 表格块为 { header, rows }。
 * 仅识别以 '|' 开头的行；第二行若为分隔行（---）则跳过。
 * @param {string} content
 * @returns {{header:string[], rows:string[][]}}
 */
function parseMarkdownTable(content) {
  const lines = String(content ?? '').split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('|'));
  if (lines.length === 0) return { header: [], rows: [] };

  const splitRow = (line) => line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());

  const header = splitRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    // 分隔行（如 --- / :--: ）跳过
    if (cells.every(cell => /^:?-{2,}:?$/.test(cell))) continue;
    rows.push(cells);
  }
  return { header, rows };
}

/**
 * 在所有证据块的表格中，按候选编号查找其层级（"层级"/"level" 列）。
 * @param {object[]} allBlocks
 * @param {string} processKey
 * @returns {string|null}
 */
function findLevelFromTables(allBlocks, processKey) {
  const target = canonicalProcessKey(processKey);
  for (const block of allBlocks) {
    if (block.modality !== 'TABLE') continue;
    const { header, rows } = parseMarkdownTable(block.content);
    const levelCol = header.findIndex(cell => /层级|level/i.test(cell));
    if (levelCol === -1) continue;
    for (const row of rows) {
      const first = canonicalProcessKey(row[0] || '');
      const rowCodes = extractCandidateCodes(row[0] || '');
      if (first === target || rowCodes.includes(target)) {
        const value = (row[levelCol] || '').trim();
        const levelMatch = value.match(/L[0-9]+/i);
        if (levelMatch) return levelMatch[0].toUpperCase();
        if (value) return value;
      }
    }
  }
  return null;
}

/**
 * 从候选流程的标题文本推导可读名称：
 * 去除中文序号前缀（如 "七、"）、候选编号、以及结尾括号说明（如 "（L5，…）"）。
 * @param {string} headingText
 * @param {string} processKey
 * @returns {string}
 */
function deriveNameFromHeading(headingText, processKey) {
  let name = String(headingText ?? '').trim();
  // 去除中文数字序号前缀：一、 / 七、 / 十二、
  name = name.replace(/^[一二三四五六七八九十百千]+、\s*/, '');
  // 去除候选编号本身（精确匹配完整编号）
  const code = canonicalProcessKey(processKey);
  name = name.replace(new RegExp(`\\b${escapeRegExp(code)}\\b`, 'g'), '');
  // 去除结尾括号说明（全角与半角）
  name = name.replace(/（[^）]*）\s*$/g, '').replace(/\([^)]*\)\s*$/g, '');
  return name.trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判定候选流程是否具备完整 L5 活动证据。
 * 仅依据结构化证据，三者齐备才算完整：
 * 1. 活动表：表头含「活动」与「角色」，且至少 2 行数据；
 * 2. 控制流：表头含「来源」与「目标」，或标题含「控制流/顺序流」；
 * 3. 结束事件：标题含「结束事件」（或「开始与结束」）。
 * 绝不依据正文自述（如「缺活动」「缺控制流」）判定，避免被材料描述误导。
 *
 * @param {object[]} candidateBlocks - 归属该候选的证据块。
 * @returns {boolean}
 */
function hasCompleteL5Evidence(candidateBlocks) {
  let hasActivityTable = false;
  let hasControlFlow = false;
  let hasEndEvent = false;

  for (const block of candidateBlocks) {
    const headingText = Array.isArray(block.heading_path) && block.heading_path.length > 0
      ? block.heading_path[block.heading_path.length - 1]
      : '';

    if (/控制流|顺序流/.test(headingText)) hasControlFlow = true;
    if (/结束事件|开始与结束/.test(headingText)) hasEndEvent = true;

    if (block.modality === 'TABLE') {
      const { header, rows } = parseMarkdownTable(block.content);
      const headerText = header.join('|');
      if (/活动/.test(headerText) && /角色/.test(headerText) && rows.length >= 2) {
        hasActivityTable = true;
      }
      if (/来源/.test(headerText) && /目标/.test(headerText)) {
        hasControlFlow = true;
      }
    }
  }

  return hasActivityTable && hasControlFlow && hasEndEvent;
}

/**
 * 发现候选流程（只读、不落盘）。
 *
 * 对可安全内存抽取的输入复用 extractArtifactEvidence 做内存抽取，
 * 仅从标题路径识别候选流程，输出稳定候选键、名称、层级与证据定位。
 *
 * @param {object} params
 * @param {Array<{path:string, format:string}>} params.inputs - 输入文件列表。
 * @param {string|null} [params.focus] - 用户已显式选择的焦点（可选）。
 * @returns {Promise<{
 *   candidates: Array<{
 *     process_key:string, display_code:string, name:string, level:string|null,
 *     evidence_locator:{heading_path:string[], line_start:number|null, line_end:number|null, block_count:number},
 *     has_complete_l5:boolean
 *   }>,
 *   selected_process_key: string|null,
 *   total_blocks: number
 * }>}
 */
export async function discoverProcessCandidates({ inputs, focus = null } = {}) {
  const allBlocks = [];

  for (const input of inputs || []) {
    const format = String(input?.format ?? '').toLowerCase();
    if (!PREFLIGHT_FORMATS.has(format)) continue;
    try {
      const result = await extractArtifactEvidence({
        artifact: { path: input.path, format },
        runDir: null, // 只读：抽取器不写盘，runDir 不参与抽取
      });
      for (const block of result.blocks) allBlocks.push(block);
    } catch {
      // 预检抽取失败不阻断入口：该输入不贡献候选，后续真实抽取会给出正式警告。
    }
  }

  // 按候选编号聚合归属块（仅按标题路径，避免 CM-1 误配 CM-1.4）。
  const byCode = new Map(); // processKey -> { display_code, headings:Map<headingText, locators[]>, blocks:[] }
  for (const block of allBlocks) {
    const headingPath = Array.isArray(block.heading_path) ? block.heading_path : [];
    const codes = new Set();
    for (const segment of headingPath) {
      for (const code of extractCandidateCodes(segment)) codes.add(code);
    }
    for (const code of codes) {
      if (!byCode.has(code)) byCode.set(code, { displayCode: code, headings: [], blocks: [] });
      const entry = byCode.get(code);
      entry.blocks.push(block);
      const headingText = headingPath[headingPath.length - 1] || '';
      if (headingText && !entry.headings.includes(headingText)) entry.headings.push(headingText);
    }
  }

  const candidates = [];
  for (const [processKey, entry] of byCode) {
    const sectionHeading = entry.headings.find(h => extractCandidateCodes(h).includes(processKey)) || entry.headings[0] || '';

    // 证据定位：覆盖该候选全部归属块的行范围。
    let lineStart = null;
    let lineEnd = null;
    for (const block of entry.blocks) {
      const loc = block.locator || {};
      if (typeof loc.line_start === 'number') {
        lineStart = lineStart === null ? loc.line_start : Math.min(lineStart, loc.line_start);
      }
      if (typeof loc.line_end === 'number') {
        lineEnd = lineEnd === null ? loc.line_end : Math.max(lineEnd, loc.line_end);
      }
    }

    // 层级：优先标题中的 Lx，回退到表格「层级」列。
    let level = null;
    for (const headingText of entry.headings) {
      const m = String(headingText).match(/L[0-9]+/i);
      if (m) { level = m[0].toUpperCase(); break; }
    }
    if (!level) level = findLevelFromTables(allBlocks, processKey);

    // 名称：标题推导，回退到表格「名称」列，再回退到标题原文。
    let name = deriveNameFromHeading(sectionHeading, processKey);
    if (!name) name = findNameFromTables(allBlocks, processKey) || sectionHeading || processKey;

    candidates.push({
      process_key: processKey,
      display_code: entry.displayCode,
      name,
      level,
      evidence_locator: {
        heading_path: sectionHeading ? [sectionHeading] : [],
        line_start: lineStart,
        line_end: lineEnd,
        block_count: entry.blocks.length,
      },
      has_complete_l5: hasCompleteL5Evidence(entry.blocks),
      // 内部使用：归属块（不进入对外 JSON 序列化时可裁剪）。
      _blocks: entry.blocks,
    });
  }

  // 按文档出现顺序（行起点升序）稳定排序。
  candidates.sort((a, b) => {
    const la = a.evidence_locator.line_start ?? Number.MAX_SAFE_INTEGER;
    const lb = b.evidence_locator.line_start ?? Number.MAX_SAFE_INTEGER;
    if (la !== lb) return la - lb;
    return a.process_key < b.process_key ? -1 : 1;
  });

  return {
    candidates,
    selected_process_key: focus ? canonicalProcessKey(focus) : null,
    total_blocks: allBlocks.length,
  };
}

/**
 * 在所有表格中按候选编号查找其名称（"名称"/"name" 列）。
 * @param {object[]} allBlocks
 * @param {string} processKey
 * @returns {string|null}
 */
function findNameFromTables(allBlocks, processKey) {
  const target = canonicalProcessKey(processKey);
  for (const block of allBlocks) {
    if (block.modality !== 'TABLE') continue;
    const { header, rows } = parseMarkdownTable(block.content);
    const nameCol = header.findIndex(cell => /名称|name/i.test(cell));
    if (nameCol === -1) continue;
    for (const row of rows) {
      const rowCodes = extractCandidateCodes(row[0] || '');
      if (rowCodes.includes(target)) {
        const value = (row[nameCol] || '').trim();
        if (value) return value;
      }
    }
  }
  return null;
}

/**
 * 为多候选场景构建「一个」证据驱动的焦点问题（与 quickstart clarification 形状对齐）。
 *
 * 合同：
 * - 仅当候选数 > 1 时返回问题对象；否则返回 null（单候选自动继续，无需提问）。
 * - options 的 value 为候选规范键（来自材料本身，绝不自由生成）；
 * - label/effect 由候选的名称、层级与 has_complete_l5 确定性拼装，
 *   明确告知用户「只有哪个候选具备完整 L5 活动证据」。
 * - 纯函数：相同候选 → 字节一致的问题。
 *
 * @param {Array<object>} candidates - discoverProcessCandidates 返回的候选数组。
 * @returns {object|null}
 */
export function buildFocusClarification(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length <= 1) return null;

  const complete = list.filter(c => c.has_complete_l5).map(c => c.process_key);
  const completeNote = complete.length > 0
    ? `其中仅 ${complete.join('、')} 具备完整 L5 活动证据，可直接生成活动级流程图。`
    : '当前材料中没有任何候选具备完整 L5 活动证据。';

  const options = list.map(candidate => ({
    value: candidate.process_key,
    label: `${candidate.process_key} ${candidate.name}`.trim()
      + (candidate.level ? `（${candidate.level}）` : ''),
    effect: candidate.has_complete_l5
      ? '具备完整 L5 活动证据，将仅生成该流程的活动级流程图。'
      : '证据不完整，选择后将无法生成跨层级混合之外的活动级流程图。',
  }));

  return {
    kind: 'PROCESS_FOCUS_CHOICE',
    question: '材料包含多个候选流程，请选择一个焦点流程以生成活动级流程初稿。',
    reason: `只读预检识别到 ${list.length} 个候选流程：${list.map(c => c.process_key).join('、')}。${completeNote}`,
    impact: '未选择焦点前不会创建运行目录、不生成任何 BPMN；选定焦点后仅生成该流程的活动，避免跨层级混合。',
    options,
    missing_key: 'focus',
  };
}
