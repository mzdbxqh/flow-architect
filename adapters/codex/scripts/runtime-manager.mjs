#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkRuntime, buildInstallPlan, installRuntime, doctorRuntime, cacheRoot } from './lib/runtime-manager.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '..');

function fail(msg, exitCode = 2) {
  process.stderr.write(msg + '\n');
  process.exit(exitCode);
}

function jsonOut(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

const [command, ...rest] = process.argv.slice(2);

// 解析 --json / --components / --accept-plan
const args = { _: [] };
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--json') { args.json = true; continue; }
  if (rest[i] === '--components' && rest[i + 1]) { args.components = rest[++i]; continue; }
  if (rest[i] === '--accept-plan' && rest[i + 1]) { args.acceptPlan = rest[++i]; continue; }
  args._.push(rest[i]);
}

const pluginRoot = PLUGIN_ROOT;
const env = process.env;
const dir = cacheRoot({ env });
const cacheDir = dir;

if (!command || command === '--help') {
  fail('Usage: runtime-manager.mjs <check|plan|install|doctor> [--json] [--components a,b] [--accept-plan sha256]', 2);
}

if (command === 'check') {
  const result = checkRuntime({ pluginRoot, cacheDir, env });
  jsonOut(result);
  process.exit(result.exitCode);
}

if (command === 'plan') {
  const components = args.components ? args.components.split(',') : ['core'];
  const plan = buildInstallPlan({ pluginRoot, cacheDir, components, env });
  jsonOut(plan);
  process.exit(0);
}

if (command === 'install') {
  if (!args.components || !args.acceptPlan) {
    jsonOut({ code: 'INVALID_ARGUMENTS', error: 'install requires --components and --accept-plan' });
    process.exit(2);
  }
  const components = args.components.split(',');
  const plan = buildInstallPlan({ pluginRoot, cacheDir, components, env });
  try {
    // 获取 npm 版本
    let npmVersion = '';
    try {
      const npmVersionResult = spawnSync('npm', ['--version'], {
        encoding: 'utf8',
        shell: false
      });
      if (npmVersionResult.status === 0) {
        npmVersion = npmVersionResult.stdout.trim();
      } else {
        jsonOut({ error: 'Failed to get npm version' });
        process.exit(1);
      }
    } catch (err) {
      jsonOut({ error: 'Failed to get npm version' });
      process.exit(1);
    }

    const result = await installRuntime(plan, {
      acceptedPlanSha256: args.acceptPlan,
      processInfo: {
        nodeVersion: process.version,
        npmVersion,
        platform: process.platform,
        arch: process.arch
      }
    });
    jsonOut(result);
    process.exit(result.exitCode);
  } catch (err) {
    jsonOut({ error: err.message });
    process.exit(1);
  }
}

if (command === 'doctor') {
  const result = doctorRuntime({ pluginRoot, cacheDir, env, processInfo: { nodeVersion: process.version, platform: process.platform, arch: process.arch } });
  jsonOut(result);
  process.exit(result.overall === 'BLOCKED' ? 1 : 0);
}

fail(`Unknown command: ${command}`, 2);
