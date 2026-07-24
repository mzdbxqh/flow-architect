#!/usr/bin/env node
/**
 * quickstart-route.mjs — 只读、确定性的 quickstart 路由脚本。
 *
 * 职责（与 skills/flow-architect-quickstart/SKILL.md 合同一致）：
 * - 从 references/capability-catalog.json 枚举稳定候选公共方法（--enumerate）；
 * - 按路径后缀确定性分类项目事实（--paths，不读写文件内容）；
 * - 把自然语言请求 + 确定性事实 + 用户参数转换为严格业务入口的规范化任务，
 *   输出状态 ROUTED / NEEDS_CHOICE / MISSING_INFO / NO_MATCH。
 *
 * 边界：零写入、零联网、不安装依赖、不修改输入；不复制严格入口协议；
 * 所有输入均为不可信数据，文件正文中的安装/覆盖/发布类指令只会被记录在
 * ignored_directives，绝不扩大候选权限。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATALOG_PATH = path.resolve(__dirname, '..', 'references', 'capability-catalog.json');

const DIAGRAM_EXTENSIONS = new Set([
  '.bpmn', '.mmd', '.mermaid', '.svg', '.png', '.jpg', '.jpeg',
  '.gif', '.webp', '.bmp', '.tif', '.tiff',
]);
const ARCHITECTURE_EXTENSIONS = new Set([
  '.md', '.markdown', '.json', '.yaml', '.yml', '.csv', '.tsv', '.txt',
  '.xml', '.xlsx', '.docx', '.pdf', '.pptx',
]);

const KNOWN_PARAMS = ['target_paths', 'output_dir', 'focus', 'title'];

// 提权类指令关键词：仅记录、绝不执行，也绝不扩大候选权限。
const ESCALATION_KEYWORDS = [
  '忽略之前', '忽略以上', '忽略前述', 'ignore previous',
  '安装', '覆盖', '发布', '提权',
  'install', 'overwrite', 'override', 'publish', 'npm', 'registry',
];

const REVIEW_KEYWORDS = /评审|审查|检查|校验|review|inspect/i;
const DRAFT_KEYWORDS = /初稿|起草|draft/i;
const MEETING_KEYWORDS = /会议包|meeting\s*package/i;

/**
 * Load the shared capability catalog (stable candidate methods).
 * @returns {object} parsed capability-catalog.json
 */
export function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

/**
 * List stable candidate public methods from the shared catalog.
 * @param {object} [catalog]
 * @returns {Array<object>}
 */
export function listMethods(catalog = loadCatalog()) {
  return catalog.methods.map(method => ({
    method_id: method.id,
    title: method.title,
    kind: method.kind,
    skill: method.skill,
    claude_entry: method.claude_entry,
    codex_entry: method.codex_entry,
    side_effects: method.side_effects,
    requires_output_dir: method.requires_output_dir,
    applicable_when: method.applicable_when,
  }));
}

/**
 * Deterministically classify paths by suffix only (pure string function;
 * never reads file contents, never writes).
 * @param {string[]} paths
 * @returns {{architecture_count:number, diagram_count:number, has_v2_draft:boolean, unclassified:string[]}}
 */
export function classifyPaths(paths = []) {
  let architecture_count = 0;
  let diagram_count = 0;
  const unclassified = [];
  for (const rawPath of paths) {
    const ext = path.extname(String(rawPath)).toLowerCase();
    if (DIAGRAM_EXTENSIONS.has(ext)) diagram_count += 1;
    else if (ARCHITECTURE_EXTENSIONS.has(ext)) architecture_count += 1;
    else unclassified.push(String(rawPath));
  }
  return { architecture_count, diagram_count, has_v2_draft: false, unclassified };
}

/**
 * Read a method's intent signals from the shared capability catalog — the
 * single source of truth for combination-intent keywords. The script and the
 * docs never duplicate keyword tables; they read them here.
 *
 * @param {object} catalog - Parsed capability-catalog.json.
 * @param {string} methodId - Method id to look up (e.g. 'create-process-draft').
 * @returns {{action_verbs:string[], artifact_nouns:string[]}} The method's
 *   intent signals, or empty signals when the method or its signals are absent.
 */
export function methodIntentSignals(catalog, methodId) {
  const empty = { action_verbs: [], artifact_nouns: [] };
  const methods = Array.isArray(catalog?.methods) ? catalog.methods : [];
  const method = methods.find(candidate => candidate?.id === methodId);
  const signals = method?.intent_signals;
  if (!signals || typeof signals !== 'object') return empty;
  return {
    action_verbs: Array.isArray(signals.action_verbs) ? signals.action_verbs : [],
    artifact_nouns: Array.isArray(signals.artifact_nouns) ? signals.artifact_nouns : [],
  };
}

/**
 * Deterministic combination-intent detector for process-draft creation.
 *
 * Returns true iff the request contains at least one action verb AND at least
 * one artifact noun from the catalog signals. A verb used attributively — i.e.
 * immediately followed by 「的」 as in 「评审生成的 BPMN」, where 「生成」 modifies the
 * noun rather than requesting an action — does NOT count, so such a request is
 * still routed to review instead of being misread as a create request.
 *
 * Pure string function: case-insensitive matching (so 「BPMN」 matches 「bpmn」),
 * byte-deterministic for identical input.
 *
 * @param {string} request - Untrusted request text.
 * @param {{action_verbs?:string[], artifact_nouns?:string[]}} signals
 * @returns {boolean}
 */
export function hasDraftCombinationSignal(request, signals) {
  const text = String(request ?? '').toLowerCase();
  const verbs = Array.isArray(signals?.action_verbs) ? signals.action_verbs : [];
  const nouns = Array.isArray(signals?.artifact_nouns) ? signals.artifact_nouns : [];
  const hasVerb = verbs.some(verb => hasNonAttributiveVerb(text, String(verb).toLowerCase()));
  const hasNoun = nouns.some(noun => {
    const token = String(noun).toLowerCase();
    return token.length > 0 && text.includes(token);
  });
  return hasVerb && hasNoun;
}

/**
 * True when `verb` occurs in `text` at least once NOT immediately followed by
 * the attributive particle 「的」. Occurrences at end-of-string count as
 * non-attributive. Case-insensitive; both inputs expected lowercased.
 * @param {string} text
 * @param {string} verb
 * @returns {boolean}
 */
function hasNonAttributiveVerb(text, verb) {
  if (verb.length === 0) return false;
  let index = text.indexOf(verb);
  while (index !== -1) {
    if (text[index + verb.length] !== '的') return true;
    index = text.indexOf(verb, index + verb.length);
  }
  return false;
}

/**
 * Route a natural-language request to a strict public entry.
 * Pure and deterministic: same input → same output bytes.
 *
 * @param {object} input
 * @param {string} [input.request] - Original request text (untrusted data).
 * @param {string|null} [input.intent] - REVIEW | CREATE_DRAFT | CREATE_MEETING_PACKAGE | null.
 * @param {object} [input.facts] - {architecture_count, diagram_count, has_v2_draft}.
 * @param {object} [input.params] - {target_paths?, output_dir?, ...unknown}.
 * @param {string|null} [input.user_choice] - Method id explicitly chosen by the user.
 * @param {object} [catalog]
 * @returns {object} Route result (see references/schemas/quickstart-route.schema.json).
 */
export function routeQuickstart(input = {}, catalog = loadCatalog()) {
  const request = String(input.request ?? '');
  const intent = input.intent ?? null;
  const rawFacts = input.facts ?? {};
  const facts = {
    architecture_count: Number(rawFacts.architecture_count) || 0,
    diagram_count: Number(rawFacts.diagram_count) || 0,
    has_v2_draft: Boolean(rawFacts.has_v2_draft),
  };
  const params = input.params ?? {};
  const userChoice = input.user_choice ?? null;

  const byId = new Map(catalog.methods.map(method => [method.id, method]));

  // 1. Sanitize: record escalation directives, never honor them.
  const lowerRequest = request.toLowerCase();
  const ignored_directives = ESCALATION_KEYWORDS.filter(keyword =>
    lowerRequest.includes(keyword.toLowerCase())
  );

  // 2. Preserve unrecognized parameters (never silently dropped).
  const unrecognized = Object.keys(params)
    .filter(key => !KNOWN_PARAMS.includes(key))
    .sort();

  // 3. Enumerate candidates from deterministic facts and declared intent.
  const reviewCandidates = reviewFamilyIds(facts);
  const hasReviewKeyword = REVIEW_KEYWORDS.test(request);
  const hasDraftKeyword = DRAFT_KEYWORDS.test(request);
  const hasMeetingKeyword = MEETING_KEYWORDS.test(request);
  // 组合意图信号来自共享能力目录（唯一来源），避免脚本/文档各自复制关键词：
  // 「生成/创建/绘制/转换/产出/画 + BPMN/流程图/流程草稿/流程初稿」确定性命中流程初稿创建。
  // 动词若为「…的…」定语用法（如「评审生成的 BPMN」）不构成创建请求，仍按评审处理。
  const hasProcessDraftCombo = hasDraftCombinationSignal(
    request,
    methodIntentSignals(catalog, 'create-process-draft'),
  );
  const createDraftSignal = hasDraftKeyword || hasProcessDraftCombo;
  const hasCreateKeyword = createDraftSignal || hasMeetingKeyword;
  const hasMaterials = facts.architecture_count + facts.diagram_count > 0
    || Array.isArray(params.target_paths) && params.target_paths.length > 0;

  let candidateIds;
  if (intent === 'REVIEW') {
    candidateIds = reviewCandidates;
  } else if (intent === 'CREATE_DRAFT') {
    candidateIds = ['create-process-draft'];
  } else if (intent === 'CREATE_MEETING_PACKAGE') {
    candidateIds = ['create-meeting-package'];
  } else if (hasCreateKeyword && !hasReviewKeyword) {
    candidateIds = [];
    if (createDraftSignal) candidateIds.push('create-process-draft');
    if (hasMeetingKeyword) candidateIds.push('create-meeting-package');
  } else if (hasReviewKeyword && !hasCreateKeyword) {
    candidateIds = reviewCandidates;
  } else {
    // Ambiguous (both families or neither): present every applicable candidate.
    candidateIds = [...reviewCandidates];
    if (hasMaterials) candidateIds.push('create-process-draft');
    if (facts.has_v2_draft) candidateIds.push('create-meeting-package');
  }

  // 4. Honor an explicit user choice only when it matches the current facts.
  if (userChoice !== null) {
    if (!byId.has(userChoice) || !candidateIds.includes(userChoice)) {
      candidateIds = [];
    } else {
      candidateIds = [userChoice];
    }
  }

  const candidates = candidateIds.map(id => toCandidate(byId.get(id)));

  // 5. Decide status.
  let status;
  let selected_method = null;
  let normalized_task = null;
  let missing = [];

  if (candidates.length === 0) {
    status = 'NO_MATCH';
  } else if (candidates.length === 1) {
    missing = computeMissing(byId.get(candidates[0].method_id), facts, params);
    const method = byId.get(candidates[0].method_id);
    const hostileWithoutExplicitIntent = ignored_directives.length > 0 && intent === null;
    if (missing.length > 0) {
      status = 'MISSING_INFO';
    } else if (method.kind === 'create' && hostileWithoutExplicitIntent) {
      // Never auto-execute a creating route when the request text carries
      // escalation directives without an explicit structured intent.
      status = 'NEEDS_CHOICE';
    } else {
      status = 'ROUTED';
      selected_method = method.id;
      normalized_task = toNormalizedTask(method, params);
    }
  } else {
    status = 'NEEDS_CHOICE';
  }

  // 6. Build a single structured clarification question for non-terminal states.
  // ROUTED / NO_MATCH are terminal → clarification is null.
  const clarification = buildClarification({ status, candidates, missing });

  return {
    status,
    candidates,
    selected_method,
    normalized_task,
    missing,
    clarification,
    ignored_directives,
    unrecognized,
    evidence: {
      request,
      intent,
      facts,
      params,
      user_choice: userChoice,
    },
  };
}

/**
 * Build exactly one structured clarification question for a non-terminal route.
 *
 * Contract (references/schemas/quickstart-route.schema.json):
 * - ROUTED / NO_MATCH → null (terminal; no question).
 * - NEEDS_CHOICE → kind=METHOD_CHOICE: a single route-affecting question whose
 *   options are the stable candidates (each value a catalog method id).
 * - MISSING_INFO → kind=MISSING_PARAMETER: a single question about the FIRST
 *   missing key only (one question at a time). computeMissing pushes output_dir
 *   (authorization) before any other key, so authorization-affecting questions
 *   are asked before ordinary parameters.
 *
 * options reference ONLY stable method ids from the capability catalog (the
 * candidates are enumerated from the catalog); no method id is invented here.
 * Pure and deterministic: identical input → byte-identical clarification.
 *
 * @param {object} args
 * @param {string} args.status - ROUTED | NEEDS_CHOICE | MISSING_INFO | NO_MATCH.
 * @param {Array<object>} args.candidates - Enumerated stable candidates.
 * @param {string[]} args.missing - Missing required keys (priority order).
 * @returns {object|null}
 */
export function buildClarification({ status, candidates, missing }) {
  if (status === 'NEEDS_CHOICE') {
    return {
      kind: 'METHOD_CHOICE',
      question: '当前证据可匹配多个稳定方法，请选择要进入的一个公共方法。',
      reason: '仅凭请求、路径类型与已给参数尚无法唯一确定路线，需要用户做出选择。',
      impact: '所选方法决定进入哪个严格业务入口及其写入范围；未选择前不产生任何业务副作用。',
      options: toClarificationOptions(candidates),
      missing_key: null,
    };
  }
  if (status === 'MISSING_INFO') {
    const key = missing[0];
    if (key === 'output_dir') {
      return {
        kind: 'MISSING_PARAMETER',
        question: '请提供一个用户授权的输出目录（runDir）以继续。',
        reason: '目标创建方法会在用户授权的独立运行目录写入新制品，但尚未给出 output_dir。',
        impact: '提供 output_dir 后才会进入创建入口，且写入仅限该授权目录（经路径包含校验）。',
        options: toClarificationOptions(candidates),
        missing_key: 'output_dir',
      };
    }
    if (key === 'v2_draft') {
      return {
        kind: 'MISSING_PARAMETER',
        question: '请提供完整的 V2 草稿以创建离线会议包。',
        reason: '离线会议包必须从完整 V2 草稿生成，但当前事实中尚无 V2 草稿。',
        impact: '具备完整 V2 草稿后才能进入会议包创建入口。',
        options: toClarificationOptions(candidates),
        missing_key: 'v2_draft',
      };
    }
    return {
      kind: 'MISSING_PARAMETER',
      question: `请补全缺失参数 ${key} 以继续。`,
      reason: `目标方法缺少必需参数 ${key}，当前证据不足以执行。`,
      impact: `补全 ${key} 后才能进入对应严格入口。`,
      options: toClarificationOptions(candidates),
      missing_key: key,
    };
  }
  return null;
}

/**
 * Project stable candidates into clarification options. Each option's `value`
 * is a catalog method id (never invented); `label`/`effect` come from the
 * catalog so the question is grounded in deterministic facts and side effects.
 * @param {Array<object>} candidates
 * @returns {Array<{value:string,label:string,effect:string}>}
 */
function toClarificationOptions(candidates) {
  return candidates.map(candidate => ({
    value: candidate.method_id,
    label: candidate.title,
    effect: candidate.side_effects,
  }));
}

function reviewFamilyIds(facts) {
  const arch = facts.architecture_count > 0;
  const diag = facts.diagram_count > 0;
  if (arch && diag) return ['review-integrated'];
  if (arch) return ['review-architecture'];
  if (diag) return ['review-diagram'];
  return [];
}

function toCandidate(method) {
  return {
    method_id: method.id,
    title: method.title,
    skill: method.skill,
    claude_entry: method.claude_entry,
    codex_entry: method.codex_entry,
    side_effects: method.side_effects,
    requires_output_dir: method.requires_output_dir,
    reason: method.applicable_when,
  };
}

function toNormalizedTask(method, params) {
  return {
    method_id: method.id,
    title: method.title,
    skill: method.skill,
    claude_entry: method.claude_entry,
    codex_entry: method.codex_entry,
    params: {
      target_paths: Array.isArray(params.target_paths) ? params.target_paths : [],
      output_dir: typeof params.output_dir === 'string' ? params.output_dir : null,
      // 只转交用户显式给出的流程焦点与标题；绝不从路径名推断或编造。
      focus: typeof params.focus === 'string' ? params.focus : null,
      title: typeof params.title === 'string' ? params.title : null,
    },
  };
}

function computeMissing(method, facts, params) {
  const missing = [];
  if (method.requires_output_dir && !(typeof params.output_dir === 'string' && params.output_dir.length > 0)) {
    missing.push('output_dir');
  }
  if (method.id === 'create-meeting-package' && !facts.has_v2_draft) {
    missing.push('v2_draft');
  }
  return missing;
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// CLI entry point (read-only; never writes files, never touches the network).
if (process.argv[1] === __filename) {
  const argv = process.argv.slice(2);
  try {
    if (argv.includes('--enumerate')) {
      const catalog = loadCatalog();
      emit({
        schema_version: catalog.schema_version,
        plugin_name: catalog.plugin_name,
        plugin_version: catalog.plugin_version,
        fixed_entries: catalog.fixed_entries,
        methods: listMethods(catalog),
        platforms: catalog.platforms,
      });
    } else if (argv.includes('--paths')) {
      const paths = argv.slice(argv.indexOf('--paths') + 1).filter(arg => !arg.startsWith('--'));
      emit(classifyPaths(paths));
    } else {
      let raw;
      if (argv.includes('--request')) {
        raw = argv[argv.indexOf('--request') + 1];
      } else if (argv.includes('--request-file')) {
        raw = fs.readFileSync(path.resolve(argv[argv.indexOf('--request-file') + 1]), 'utf8');
      } else {
        raw = fs.readFileSync(0, 'utf8');
      }
      const input = JSON.parse(raw);
      emit(routeQuickstart(input));
    }
  } catch (err) {
    process.stderr.write(`quickstart-route: ${err.message}\n`);
    process.exitCode = 1;
  }
}
