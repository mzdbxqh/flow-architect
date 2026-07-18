#!/usr/bin/env node
/**
 * test-with-runtime.mjs — 测试运行时 bootstrap 包装器
 *
 * 流程：
 * 1. 解析和校验命令行参数（早于任何临时目录或运行时安装）
 * 2. 使用 runtime manager 的 plan/install 协议建立独立缓存
 * 3. 用真实 npm ci 安装所有组件（core, pdf, docx, xlsx, pptx）
 * 4. 设置 FLOW_ARCHITECT_CACHE_DIR 环境变量
 * 5. 运行测试子进程
 * 6. 透传退出码、signal；结束后清理临时目录
 *
 * 禁止手工伪造 runtime-state.json、READY 或 lock SHA。
 * 禁止写入用户正式缓存。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInstallPlan, installRuntime } from './lib/runtime-manager.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '..');

// ─── 参数解析和校验（必须早于运行时安装）────────────────────────────────────

function parseAndValidateArgs() {
  const args = process.argv.slice(2);
  let testCmd;
  let testArgs;
  let childCwd = PLUGIN_ROOT;

  // 检查首参数是否是 --cwd（仅首参数触发包装器语法，避免误解析自定义命令参数中的 --cwd）
  if (args.length > 0 && args[0] === '--cwd') {
    // 参数校验：--cwd 必须有值
    if (1 >= args.length) {
      console.error('缺少 --cwd 参数');
      process.exit(1);
    }

    const cwdValue = args[1];
    // 参数校验：-- 后必须有命令
    const separatorIndex = args.indexOf('--', 2);
    if (separatorIndex === -1) {
      console.error('缺少 -- 分隔符');
      process.exit(1);
    }

    if (separatorIndex + 1 >= args.length) {
      console.error('缺少命令');
      process.exit(1);
    }

    // 解析 cwd 路径（相对于公开子仓根）
    childCwd = path.resolve(PLUGIN_ROOT, cwdValue);

    // 提取 -- 后的命令和参数
    testCmd = args[separatorIndex + 1];
    testArgs = args.slice(separatorIndex + 2);
  } else if (args.length > 0) {
    // 检查第一个参数是否是测试文件
    const firstArg = args[0];
    if (firstArg.endsWith('.test.mjs') || firstArg.endsWith('.mjs')) {
      // 用户指定了测试文件，使用 node --test 运行
      testCmd = process.execPath;
      testArgs = ['--test', '--test-concurrency=1', ...args];
    } else {
      // 用户指定了自定义命令
      testCmd = args[0];
      testArgs = args.slice(1);
    }
  } else {
    // 默认运行全量测试：确定性枚举测试文件并排序
    const testDir = path.join(PLUGIN_ROOT, 'test');
    const testFiles = fs.readdirSync(testDir)
      .filter(file => file.endsWith('.test.mjs'))
      .sort()
      .map(file => path.join('test', file));

    if (testFiles.length === 0) {
      console.error('未找到测试文件');
      process.exit(1);
    }

    testCmd = process.execPath;
    testArgs = ['--test', '--test-concurrency=1', ...testFiles];
  }

  return { testCmd, testArgs, childCwd };
}

// ─── 主流程 ─────────────────────────────────────────────────────────────

async function main() {
  // 1. 先解析和校验参数（早于运行时安装）
  const { testCmd, testArgs, childCwd } = parseAndValidateArgs();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-architect-test-runtime-'));

  // 确保退出时清理临时目录
  const cleanup = () => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  const cacheDir = path.join(tmpDir, 'cache');

  try {
    // 2. 使用 runtime manager 的 plan/install 协议建立缓存
    const allComponents = ['core', 'pdf', 'docx', 'xlsx', 'pptx'];
    const plan = buildInstallPlan({
      pluginRoot: PLUGIN_ROOT,
      cacheDir,
      components: allComponents,
      env: {},
    });

    const result = await installRuntime(plan, {
      acceptedPlanSha256: plan.plan_sha256,
      // 使用真实 npm ci executor
      now: () => new Date(),
      processInfo: {
        nodeVersion: process.version,
        npmVersion: '',
        platform: process.platform,
        arch: process.arch,
      },
    });

    if (result.overall === 'BLOCKED') {
      console.error('Runtime bootstrap failed: core component not READY');
      process.exit(1);
    }

    // 3. 构建测试子进程环境
    const testEnv = {
      ...process.env,
      FLOW_ARCHITECT_CACHE_DIR: cacheDir,
    };

    // 4. 运行测试子进程，透传 stdio
    const child = spawn(testCmd, testArgs, {
      cwd: childCwd,
      env: testEnv,
      stdio: ['inherit', 'inherit', 'inherit'],
      shell: false,
    });

    // 5. 透传退出码和 signal
    child.on('close', (code, signal) => {
      if (signal) {
        // 被 signal 终止
        process.kill(process.pid, signal);
      } else {
        process.exit(code ?? 1);
      }
    });

    child.on('error', (err) => {
      console.error(`测试子进程启动失败: ${err.message}`);
      process.exit(1);
    });
  } catch (err) {
    console.error(`Runtime bootstrap 失败: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
  // 注意：cleanup 通过 process.on('exit') 自动执行
}

main();
