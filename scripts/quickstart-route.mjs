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

const KNOWN_PARAMS = ['target_paths', 'output_dir'];

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
  const hasCreateKeyword = hasDraftKeyword || hasMeetingKeyword;
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
    if (hasDraftKeyword) candidateIds.push('create-process-draft');
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

  return {
    status,
    candidates,
    selected_method,
    normalized_task,
    missing,
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
