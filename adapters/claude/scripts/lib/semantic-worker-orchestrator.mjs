/**
 * 确定性语义 worker 编排器（自动恢复）
 *
 * 本模块只包含确定性逻辑，自身不调用任何模型。worker 由宿主（Skill / harness）
 * 通过 fresh worker 派发；本模块负责「拿到 worker 原始输出后该怎么办」的判定与编排：
 *
 * 1. 评估单个 worker 原始输出，判定 ACCEPT / RETRY / FAIL，并给出可审计的分类原因。
 * 2. 可恢复缺陷（JSON 不可解析 / Schema 失败 / INFERRED 缺 uncertainty / 验收合同缺陷）
 *    用 fresh worker 重试，最多 maxAttempts（默认 3）次；**绝不手工修补模型 JSON**。
 * 3. 可机械规范化的问题（process_key / 事件 / 角色 键不一致）交由对齐层
 *    （semantic-alignment.alignFragments）在合并阶段处理，编排器**不重试、不失败**。
 * 4. 业务语义冲突（certainty=CONFLICT）**不得靠重试掩盖**，必须形成问题（issue）并 FAIL。
 * 5. 生成运行报告：每个 task 记录 attempt_count、失败原因与最终 fragment hash。
 *
 * 无半状态保证：编排器只在判定 ACCEPT 后才调用验收函数写盘；验收函数本身 fail-closed
 * 且原子（验证失败不写 fragment、不改 queue）。重试耗尽或业务冲突时从未写盘。
 */

import { createHash } from 'node:crypto';
import { validateSemanticFragment } from './process-draft-contract.mjs';

/**
 * 延迟加载验收函数。
 *
 * accept-semantic-fragment.mjs 在模块顶层即解析 CLI 参数（parseArgs, strict），
 * 若在编排器顶层静态 import，会把当前进程（如 evaluate-worker-output.mjs CLI）的
 * 命令行参数泄漏给该模块顶层 parseArgs 而报错。故仅在真正需要持久化时动态加载。
 */
async function loadAcceptFunction() {
  const mod = await import('../accept-semantic-fragment.mjs');
  return mod.acceptSemanticFragment;
}

/** 单个 task 的默认最大尝试次数（含首次）。 */
export const MAX_ATTEMPTS = 3;

/** task_kind → queue task_id 后缀（与 accept-semantic-fragment / 验收合同一致）。 */
export const TASK_KIND_SUFFIX = Object.freeze({
  PROCESS_CARD: 'card',
  ACTIVITY_CATALOG: 'activity',
  CONTROL_FLOW: 'flow',
});

/**
 * 可恢复缺陷分类：用 fresh worker 重试，不手工修补 JSON。
 * - JSON_PARSE：输出不是合法 JSON（或顶层非对象）
 * - SCHEMA：不符合 semantic-fragment Schema（公共信封 / payload 子 Schema / fact_id 唯一 / dangling refs）
 * - INFERRED_MISSING_UNCERTAINTY：INFERRED 事实缺少对应的 NEEDS_CONTEXT uncertainty
 * - CONTRACT：批次匹配 / evidence_refs 等验收合同缺陷（机械缺陷，fresh worker 可修复，非业务冲突）
 */
export const RETRY_CATEGORIES = Object.freeze([
  'JSON_PARSE',
  'SCHEMA',
  'INFERRED_MISSING_UNCERTAINTY',
  'CONTRACT',
]);

/**
 * 不可重试、必须形成问题的分类。
 * - BUSINESS_CONFLICT：业务语义冲突（certainty=CONFLICT），重试无法掩盖，必须形成问题交业务确认。
 */
export const ISSUE_CATEGORIES = Object.freeze(['BUSINESS_CONFLICT']);

const INFERRED_MISSING_RE = /INFERRED fact .* missing NEEDS_CONTEXT uncertainty/;

/**
 * 计算 fragment 的规范化 SHA-256（与 accept-semantic-fragment 写盘内容及 queue.fragment_sha256 一致）。
 *
 * @param {object} fragment - V2 语义片段对象
 * @returns {string} 64 位十六进制 SHA-256
 */
export function computeFragmentSha256(fragment) {
  return createHash('sha256').update(JSON.stringify(fragment, null, 2) + '\n').digest('hex');
}

/**
 * 确定性评估单个 worker 原始输出。
 *
 * @param {string} rawText - worker 返回的原始文本
 * @param {object} [opts]
 * @param {object} [opts.batch] - 对应证据批次（保留参数，便于未来合同校验扩展）
 * @returns {Promise<{
 *   verdict: 'ACCEPT' | 'RETRY' | 'FAIL',
 *   category: string | null,
 *   reason: string | null,
 *   fragment: object | null,
 *   issues: object[],
 * }>}
 */
export async function evaluateWorkerOutput(rawText, { batch = null } = {}) {
  // 1. JSON 解析：不可解析 → 可恢复，用 fresh worker 重试（不手工修补）
  let fragment;
  try {
    fragment = JSON.parse(typeof rawText === 'string' ? rawText : String(rawText));
  } catch (err) {
    return {
      verdict: 'RETRY',
      category: 'JSON_PARSE',
      reason: `Worker 输出不是合法 JSON：${err.message}`,
      fragment: null,
      issues: [],
    };
  }

  if (fragment === null || typeof fragment !== 'object' || Array.isArray(fragment)) {
    return {
      verdict: 'RETRY',
      category: 'JSON_PARSE',
      reason: 'Worker 输出 JSON 顶层必须是对象',
      fragment: null,
      issues: [],
    };
  }

  // 2. Schema 验证（公共信封 + payload 子 Schema + fact_id 唯一 + dangling refs + INFERRED 规则）
  const schemaResult = await validateSemanticFragment(fragment);
  if (!schemaResult.valid) {
    const inferredErr = schemaResult.errors.find(e => INFERRED_MISSING_RE.test(e));
    if (inferredErr) {
      return {
        verdict: 'RETRY',
        category: 'INFERRED_MISSING_UNCERTAINTY',
        reason: inferredErr,
        fragment,
        issues: [],
      };
    }
    return {
      verdict: 'RETRY',
      category: 'SCHEMA',
      reason: schemaResult.errors.join('; '),
      fragment,
      issues: [],
    };
  }

  // 3. 业务语义冲突：certainty=CONFLICT 表示证据相互矛盾。
  //    这类冲突重试无法收敛，必须形成问题交业务确认，绝不以重试掩盖。
  const facts = fragment.payload?.facts || [];
  const conflictFacts = facts.filter(f => f.certainty === 'CONFLICT');
  if (conflictFacts.length > 0) {
    return {
      verdict: 'FAIL',
      category: 'BUSINESS_CONFLICT',
      reason: `检测到业务语义冲突事实：${conflictFacts.map(f => f.fact_id).join(', ')}（证据相互矛盾，需业务确认）`,
      fragment,
      issues: conflictFacts.map(f => ({
        kind: 'BUSINESS_CONFLICT',
        fact_id: f.fact_id,
        label: f.label,
        process_key: f.process_key,
        evidence_refs: f.evidence_refs || [],
        reason: '证据相互矛盾，不得以重试掩盖，须形成问题交业务确认',
      })),
    };
  }

  // 4. 通过：可机械规范化的问题（process_key / 事件 / 角色 键不一致）交由对齐层处理，
  //    编排器不以其为由重试或失败。
  return { verdict: 'ACCEPT', category: null, reason: null, fragment, issues: [] };
}

function makeResult({ taskId, batch, taskKind, status, attemptCount, failureReasons, fragmentSha256, issues }) {
  return {
    task_id: taskId ?? `${batch.batch_id}-${TASK_KIND_SUFFIX[taskKind] ?? 'task'}`,
    batch_id: batch.batch_id,
    task_kind: taskKind,
    status,
    attempt_count: attemptCount,
    failure_reasons: failureReasons,
    fragment_sha256: fragmentSha256,
    issues,
  };
}

/**
 * 以 fresh worker 重试编排单个语义任务。
 *
 * @param {object} params
 * @param {(ctx: {batch: object, taskKind: string, taskId: string, attempt: number}) => Promise<string>|string} params.invokeWorker
 *        派发 fresh worker 并返回其原始文本输出（由宿主实现，本模块不调用模型）。
 * @param {object} params.batch - 证据批次对象
 * @param {string} params.taskKind - PROCESS_CARD | ACTIVITY_CATALOG | CONTROL_FLOW
 * @param {string} [params.taskId] - queue task_id（缺省由 batch_id + 后缀派生）
 * @param {string} [params.runDir] - 运行目录（仅在 ACCEPT 后用于持久化）
 * @param {number} [params.maxAttempts=3] - 最大尝试次数
 * @param {Function} [params.accept] - 验收函数（可注入以便测试；缺省延迟加载 acceptSemanticFragment）
 * @returns {Promise<object>} 任务结果（见 buildRunReport 的 task 结构）
 */
export async function runSemanticTask({
  invokeWorker,
  batch,
  taskKind,
  taskId = null,
  runDir = null,
  maxAttempts = MAX_ATTEMPTS,
  accept = null,
}) {
  const acceptFn = accept ?? (await loadAcceptFunction());
  const failureReasons = [];
  let attempt = 0;
  let lastIssues = [];

  while (attempt < maxAttempts) {
    attempt += 1;
    const rawText = await invokeWorker({ batch, taskKind, taskId, attempt });
    const evaluation = await evaluateWorkerOutput(rawText, { batch });
    lastIssues = evaluation.issues || [];

    if (evaluation.verdict === 'FAIL') {
      // 业务语义冲突：形成问题，不重试，无半状态（从未写盘）
      failureReasons.push({ attempt, category: evaluation.category, reason: evaluation.reason });
      return makeResult({
        taskId, batch, taskKind,
        status: 'FAILED',
        attemptCount: attempt,
        failureReasons,
        fragmentSha256: null,
        issues: lastIssues,
      });
    }

    if (evaluation.verdict === 'RETRY') {
      // 可恢复缺陷：记录原因，用 fresh worker 重试（不手工修补 JSON）
      failureReasons.push({ attempt, category: evaluation.category, reason: evaluation.reason });
      continue;
    }

    // ACCEPT：通过验收合同后持久化。验收函数 fail-closed 且原子，验证失败不写盘、不改 queue。
    const acceptResult = await acceptFn({ fragment: evaluation.fragment, batch, runDir });
    if (!acceptResult.accepted) {
      failureReasons.push({
        attempt,
        category: 'CONTRACT',
        reason: (acceptResult.errors || []).join('; '),
      });
      continue;
    }

    return makeResult({
      taskId, batch, taskKind,
      status: 'ACCEPTED',
      attemptCount: attempt,
      failureReasons,
      fragmentSha256: computeFragmentSha256(evaluation.fragment),
      issues: [],
    });
  }

  // 重试耗尽：明确 FAILED，无半状态（从未写盘）
  return makeResult({
    taskId, batch, taskKind,
    status: 'FAILED',
    attemptCount: attempt,
    failureReasons,
    fragmentSha256: null,
    issues: lastIssues,
  });
}

/**
 * 汇总运行报告：每个 task 记录 attempt_count、失败原因与最终 fragment hash。
 *
 * @param {object[]} taskResults - runSemanticTask 返回值数组
 * @param {object} [opts]
 * @param {string|null} [opts.runId=null] - 运行标识（可选）
 * @returns {object} 运行报告
 */
export function buildRunReport(taskResults, { runId = null } = {}) {
  const tasks = taskResults.map(r => ({
    task_id: r.task_id,
    batch_id: r.batch_id,
    task_kind: r.task_kind,
    status: r.status,
    attempt_count: r.attempt_count,
    failure_reasons: r.failure_reasons,
    fragment_sha256: r.fragment_sha256,
    issues: r.issues || [],
  }));

  const accepted = tasks.filter(t => t.status === 'ACCEPTED');
  const failed = tasks.filter(t => t.status === 'FAILED');

  return {
    schema_version: '1.0.0',
    run_id: runId,
    total_tasks: tasks.length,
    accepted_count: accepted.length,
    failed_count: failed.length,
    total_attempts: tasks.reduce((sum, t) => sum + t.attempt_count, 0),
    issues: tasks.flatMap(t => t.issues.map(issue => ({ task_id: t.task_id, ...issue }))),
    tasks,
  };
}
