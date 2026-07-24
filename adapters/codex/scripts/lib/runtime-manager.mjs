import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// ─── 校验工具 ──────────────────────────────────────────────────────────

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function safeSha256(filePath) {
  return fs.existsSync(filePath) ? sha256(fs.readFileSync(filePath)) : null;
}

function ensureContained(target, base) {
  const r = path.resolve(target);
  const b = path.resolve(base);
  if (!(r === b || r.startsWith(b + path.sep))) {
    throw new Error(`Path containment violation: ${target} is outside ${base}`);
  }
}

// ─── cacheRoot ─────────────────────────────────────────────────────────

export function cacheRoot({ env = {}, platform = process.platform, homedir } = {}) {
  if (env.FLOW_ARCHITECT_CACHE_DIR) return env.FLOW_ARCHITECT_CACHE_DIR;
  const home = homedir || os.homedir();
  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Caches', 'flow-architect');
    case 'win32':
      if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'flow-architect');
      return path.join(home, 'AppData', 'Local', 'flow-architect');
    case 'linux':
      if (env.XDG_CACHE_HOME) return path.join(env.XDG_CACHE_HOME, 'flow-architect');
      return path.join(home, '.cache', 'flow-architect');
    default:
      return path.join(home, '.cache', 'flow-architect');
  }
}

// ─── readManifest ──────────────────────────────────────────────────────

const VALID_COMPONENTS = ['core', 'pdf', 'docx', 'xlsx', 'pptx'];
const COMPONENT_ORDER = { core: 0, pdf: 1, docx: 2, xlsx: 3, pptx: 4 };

export function readManifest(pluginRoot) {
  const manifestPath = path.join(pluginRoot, 'runtime', 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Runtime manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.runtime_version) throw new Error('manifest missing runtime_version');
  if (!Array.isArray(manifest.components)) throw new Error('manifest missing components array');
  return manifest;
}

// ─── 内部辅助：组件包加载检查 ──────────────────────────────────────────

function tryLoadPackage(dir, pkgName, expectedVersion) {
  try {
    const pkgJsonPath = path.join(dir, pkgName, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    if (pkg.version !== expectedVersion) return false;
    const req = createRequire(path.join(dir, pkgName, 'package.json'));
    req(pkgName);
    return true;
  } catch {
    return false;
  }
}

function componentReadyFromDir(dir, component) {
  for (const [pkg, version] of Object.entries(component.packages)) {
    if (!tryLoadPackage(dir, pkg, version)) return false;
  }
  return true;
}

// 异步 smoke 校验：使用子进程加载模块，避免同一进程的 require/import 缓存掩盖文件损坏
async function componentReadyFromDirAsync(dir, component) {
  for (const [pkgName, version] of Object.entries(component.packages)) {
    try {
      const pkgJsonPath = path.join(dir, pkgName, 'package.json');
      if (!fs.existsSync(pkgJsonPath)) return false;
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      if (pkgJson.version !== version) return false;
      // 子进程独立的 require 缓存，确保检测到文件损坏
      const ok = await new Promise((resolve) => {
        const child = spawn(process.execPath, [
          '-e',
          `const r = require('node:module').createRequire(${JSON.stringify(pkgJsonPath)});\n` +
          `const loaded = r(${JSON.stringify(pkgName)});\n` +
          `if (!loaded || (typeof loaded !== 'object' && typeof loaded !== 'function')) { process.exit(1); }\n` +
          `process.exit(0);`
        ], { stdio: 'ignore', shell: false });
        child.on('close', (code) => resolve(code === 0));
        child.on('error', () => resolve(false));
      });
      if (!ok) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// ─── 内部辅助：读取缓存状态 ────────────────────────────────────────────

function readCacheState(cacheDir, runtimeVersion) {
  const statePath = path.join(cacheDir, 'runtimes', runtimeVersion, 'runtime-state.json');
  try {
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return { _corrupted: true };
  }
}

function checkComponentCached(cacheDir, state, component, runtimeVersion) {
  if (!state || state._corrupted) {
    return {
      status: state?._corrupted ? 'CORRUPT' : 'MISSING',
      missing_packages: Object.keys(component.packages),
      source: 'cache'
    };
  }

  const compState = state.components?.[component.name];
  if (!compState || compState.status !== 'READY') {
    return { status: 'MISSING', missing_packages: Object.keys(component.packages), source: 'cache' };
  }

  const compDir = path.join(cacheDir, 'runtimes', runtimeVersion, component.name);
  if (!fs.existsSync(compDir)) {
    return { status: 'MISSING', missing_packages: Object.keys(component.packages), source: 'cache' };
  }

  const lockPath = path.join(compDir, 'package-lock.json');
  const lockSha = safeSha256(lockPath);
  if (!lockSha || lockSha !== compState.lock_sha256) {
    return { status: 'CORRUPT', missing_packages: Object.keys(component.packages), source: 'cache' };
  }

  // smoke 校验：目录、精确版本与可加载性
  const nmDir = path.join(compDir, 'node_modules');
  if (!componentReadyFromDir(nmDir, component)) {
    return { status: 'MISSING', missing_packages: Object.keys(component.packages), source: 'cache' };
  }

  return { status: 'READY', source: 'cache' };
}

// ─── checkRuntime ──────────────────────────────────────────────────────

export function checkRuntime({ pluginRoot, cacheDir, env = {}, cacheOnly = false }) {
  const manifest = readManifest(pluginRoot);
  const runtimeVersion = manifest.runtime_version;
  const state = readCacheState(cacheDir, runtimeVersion);
  const components = [];

  for (const component of manifest.components) {
    // 1) 检查插件本地依赖（cacheOnly 模式跳过）
    if (!cacheOnly) {
      const localNm = path.join(pluginRoot, 'node_modules');
      if (fs.existsSync(localNm) && componentReadyFromDir(localNm, component)) {
        components.push({ name: component.name, status: 'READY', source: 'plugin' });
        continue;
      }
    }

    // 2) 检查缓存（仅当状态文件完好时）
    if (state && !state._corrupted && state.components?.[component.name]?.status === 'READY') {
      const cached = checkComponentCached(cacheDir, state, component, runtimeVersion);
      components.push({ name: component.name, ...cached });
      continue;
    }

    // 3) 损坏的 state 文件且无可用的插件本地依赖
    if (state && state._corrupted) {
      components.push({ name: component.name, status: 'CORRUPT', missing_packages: Object.keys(component.packages) });
      continue;
    }

    // 4) 缺失
    components.push({ name: component.name, status: 'MISSING', missing_packages: Object.keys(component.packages) });
  }

  const coreOk = components.find(c => c.name === 'core')?.status === 'READY';
  const optionalMissing = components.some(c => c.name !== 'core' && c.status !== 'READY');
  const overall = coreOk ? (optionalMissing ? 'DEGRADED' : 'READY') : 'BLOCKED';
  const exitCode = overall === 'BLOCKED' || overall === 'CORRUPT' ? 1 : 0;

  return { overall, exitCode, components };
}

// ─── buildInstallPlan ──────────────────────────────────────────────────

export function buildInstallPlan({ pluginRoot, cacheDir, components = ['core'], env = {} }) {
  const manifest = readManifest(pluginRoot);
  const runtimeVersion = manifest.runtime_version;
  const manifestNames = manifest.components.map(c => c.name);

  // 校验组件名
  for (const name of components) {
    if (!VALID_COMPONENTS.includes(name) || !manifestNames.includes(name) || name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error(`Unknown or invalid component: ${name}`);
    }
  }

  // core 始终包含；排序
  const deduped = [...new Set([...components, 'core'])];
  const sorted = deduped.sort((a, b) => COMPONENT_ORDER[a] - COMPONENT_ORDER[b]);

  const planComponents = sorted.map(name => {
    const mc = manifest.components.find(c => c.name === name);
    const lockPath = path.join(pluginRoot, 'runtime', 'components', name, 'package-lock.json');
    if (!fs.existsSync(lockPath)) throw new Error(`Lock file missing for component: ${name}`);
    return {
      name,
      required: mc.required,
      packages: { ...mc.packages },
      lock_path: lockPath,
      lock_sha256: safeSha256(lockPath)
    };
  });

  const plan = {
    plugin_root: pluginRoot,
    cache_dir: cacheDir,
    runtime_version: runtimeVersion,
    components: planComponents,
    temp_dir_pattern: path.join(cacheDir, 'runtimes', runtimeVersion, '.tmp-XXXX'),
    registry: 'https://registry.npmjs.org/',
    npm_command: 'npm ci --omit=dev --omit=optional --ignore-scripts'
  };

  // 凭据脱敏
  const sanitized = JSON.parse(JSON.stringify(plan));
  sanitized.registry = sanitized.registry.replace(/\/\/[^@]+@/g, '//');

  const planString = JSON.stringify(sanitized, null, 2);
  sanitized.plan_sha256 = sha256(planString);
  return sanitized;
}

// ─── installRuntime ────────────────────────────────────────────────────

export async function installRuntime(plan, options = {}) {
  const { acceptedPlanSha256, executeNpm, now, processInfo = {} } = options;

  // SHA 校验
  if (!acceptedPlanSha256) throw new Error('acceptedPlanSha256 is required');
  if (plan.plan_sha256 !== acceptedPlanSha256) throw new Error(`Plan SHA256 mismatch: expected ${acceptedPlanSha256}, got ${plan.plan_sha256}`);

  // 默认 executor：使用 ESM child process API，参数数组，禁止 shell
  const executor = executeNpm || ((componentDir, packages) => {
    return new Promise((resolve, reject) => {
      const child = spawn('npm', ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts'], {
        cwd: componentDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      });
      let stderr = '';
      child.stderr.on('data', d => { stderr += d; });
      child.on('close', code => {
        if (code !== 0) {
          // 脱敏 stderr：认证 URL 用户名/密码、npm_* token、token=...
          let sanitized = stderr.slice(0, 500);
          sanitized = sanitized.replace(/\/\/[^@]+@/g, '//'); // 认证 URL
          sanitized = sanitized.replace(/npm_[A-Za-z0-9_-]+/g, '[REDACTED]'); // npm_* token
          sanitized = sanitized.replace(/token=[A-Za-z0-9_-]+/g, 'token=[REDACTED]'); // token=...
          reject(new Error(`npm ci failed (exit ${code}): ${sanitized}`));
        } else {
          resolve();
        }
      });
      child.on('error', err => {
        reject(new Error(`npm ci spawn error: ${err.message}`));
      });
    });
  });

  const { cache_dir: cacheDir, plugin_root: pluginRoot, runtime_version: runtimeVersion, components: planComponents } = plan;
  const runtimesDir = path.join(cacheDir, 'runtimes', runtimeVersion);
  const lockFile = path.join(cacheDir, 'locks', `runtime-${runtimeVersion}.lock`);

  // 获取锁（并发保护）
  fs.mkdirSync(path.join(cacheDir, 'locks'), { recursive: true });
  let lockFd;
  try {
    lockFd = fs.openSync(lockFile, 'wx');
  } catch (e) {
    if (e.code === 'EEXIST') throw new Error('Runtime installation already in progress (lock file exists). Concurrent installs are not allowed.');
    throw e;
  }

  // 标记 state 是否已成功持久化（用于 finally 清理 backup）
  let statePersisted = false;
  // 记录所有 backup 目录，按创建顺序
  const backupsToClean = [];
  // 记录本次所有已发布的 {target,temp,backup}，供任意后续失败统一回滚
  const atomicOps = [];

  try {
    // 读取现有状态（幂等复用）
    const existingState = readCacheState(cacheDir, runtimeVersion);
    const hasExisting = existingState && !existingState._corrupted;

    // 确定哪些组件需要安装
    const componentsToInstall = [];
    const reusedComponents = [];

    for (const pc of planComponents) {
      if (hasExisting && existingState.components?.[pc.name]?.status === 'READY') {
        const compDir = path.join(runtimesDir, pc.name);
        const cachedLockSha = existingState.components[pc.name].lock_sha256;
        const currentLockSha = safeSha256(path.join(compDir, 'package-lock.json'));
        if (fs.existsSync(compDir) && cachedLockSha === pc.lock_sha256 && currentLockSha === pc.lock_sha256) {
          // 复用前必须重新做目录、state、精确版本与 smoke 校验
          // 使用异步 import() 绕过 require 缓存，确保检测到文件损坏
          const nmDir = path.join(compDir, 'node_modules');
          if (await componentReadyFromDirAsync(nmDir, { packages: pc.packages })) {
            reusedComponents.push(pc.name);
            continue;
          }
          // smoke 失败：标记需要替换，不得在新 temp 安装和校验成功前删除旧 target
        }
      }
      componentsToInstall.push(pc);
    }

    // 如果全部复用，直接返回（finally 统一释放锁）
    if (componentsToInstall.length === 0) {
      return buildCheckResultFromExisting(cacheDir, pluginRoot, existingState, runtimeVersion);
    }

    // 确保 runtimesDir 存在
    fs.mkdirSync(runtimesDir, { recursive: true });

    const installedNow = {};
    const timestamp = now ? now().toISOString() : new Date().toISOString();

    for (const pc of componentsToInstall) {
      const tempDir = path.join(runtimesDir, `.tmp-${pc.name}-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      try {
        // 路径包含校验
        ensureContained(tempDir, runtimesDir);

        // 复制 package.json 和 lock
        const srcDir = path.join(pluginRoot, 'runtime', 'components', pc.name);
        fs.copyFileSync(path.join(srcDir, 'package.json'), path.join(tempDir, 'package.json'));
        fs.copyFileSync(path.join(srcDir, 'package-lock.json'), path.join(tempDir, 'package-lock.json'));

        // 执行 executor
        await executor(tempDir, pc.packages);

        // 校验每个包可加载（精确版本与 smoke）
        const nmDir = path.join(tempDir, 'node_modules');
        for (const [pkg, version] of Object.entries(pc.packages)) {
          const pkgJsonPath = path.join(nmDir, pkg, 'package.json');
          if (!fs.existsSync(pkgJsonPath)) throw new Error(`Package ${pkg} not found after install`);
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
          if (pkgJson.version !== version) throw new Error(`Package ${pkg} version mismatch: expected ${version}, got ${pkgJson.version}`);
          const req = createRequire(pkgJsonPath);
          req(pkg);
        }

        // 原子发布：记录 target 和 backup
        const targetDir = path.join(runtimesDir, pc.name);
        const backupDir = path.join(runtimesDir, `.backup-${pc.name}-${Date.now()}`);
        let backupCreated = false;

        try {
          // 如果目标目录已存在，先备份
          if (fs.existsSync(targetDir)) {
            fs.renameSync(targetDir, backupDir);
            backupCreated = true;
            backupsToClean.push({ backupDir, targetDir });
          }

          // 将 temp 重命名到目标
          fs.renameSync(tempDir, targetDir);

          // 记录原子操作
          atomicOps.push({
            name: pc.name,
            targetDir,
            tempDir,
            backupDir: backupCreated ? backupDir : null,
            backupCreated
          });
        } catch (err) {
          // 回滚：如果 backup 存在，恢复它
          if (backupCreated && fs.existsSync(backupDir)) {
            try { fs.renameSync(backupDir, targetDir); } catch {}
          }
          // 删除 temp
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
          throw err;
        }

        installedNow[pc.name] = {
          status: 'READY',
          lock_sha256: pc.lock_sha256,
          packages: pc.packages,
          installed_at: timestamp,
          smoke: 'passed'
        };
      } catch (err) {
        // 清理当前 temp 目录
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}

        throw err;
      }
    }

    // 构建并写入 state：保留所有仍可验证的既有 READY 组件
    const mergedComponents = {};

    // 所有既有的 READY 组件（不论是否在本次 plan 中）
    if (hasExisting && existingState.components) {
      for (const [name, info] of Object.entries(existingState.components)) {
        if (info.status === 'READY') {
          mergedComponents[name] = info;
        }
      }
    }

    // 复用的组件覆盖为最新验证
    for (const name of reusedComponents) {
      if (existingState.components?.[name]) {
        mergedComponents[name] = existingState.components[name];
      }
    }

    // 新安装的组件
    for (const [name, info] of Object.entries(installedNow)) {
      mergedComponents[name] = info;
    }

    const stateObj = {
      runtime_version: runtimeVersion,
      plugin_compatibility: '>=0.1.2 <0.6.0',
      installed_at: timestamp,
      node_version: processInfo.nodeVersion || process.version,
      npm_version: processInfo.npmVersion || '',
      platform: processInfo.platform || process.platform,
      arch: processInfo.arch || process.arch,
      components: mergedComponents
    };

    // 路径包含校验
    ensureContained(runtimesDir, cacheDir);

    // 在提交 state 前构建返回结果，避免提交成功后再出现可回滚异常。
    const result = buildCheckResultFromExisting(cacheDir, pluginRoot, { components: mergedComponents }, runtimeVersion);

    // 原子写入 state
    const stateTmp = path.join(runtimesDir, `.tmp-state-${Date.now()}.json`);
    ensureContained(stateTmp, runtimesDir);
    fs.writeFileSync(stateTmp, JSON.stringify(stateObj, null, 2));
    fs.renameSync(stateTmp, path.join(runtimesDir, 'runtime-state.json'));

    // 标记 state 已成功持久化
    statePersisted = true;

    return result;
  } catch (error) {
    // 组件发布后的任何失败（包括后续组件、state write/rename）都回滚整批。
    for (const op of [...atomicOps].reverse()) {
      try { fs.rmSync(op.targetDir, { recursive: true, force: true }); } catch {}
      if (op.backupCreated && op.backupDir && fs.existsSync(op.backupDir)) {
        try { fs.renameSync(op.backupDir, op.targetDir); } catch {}
      }
      try { fs.rmSync(op.tempDir, { recursive: true, force: true }); } catch {}
    }
    try {
      for (const entry of fs.readdirSync(runtimesDir)) {
        if (entry.startsWith('.tmp-state-')) fs.rmSync(path.join(runtimesDir, entry), { force: true });
      }
    } catch {}
    throw error;
  } finally {
    // 统一释放锁：复用分支与所有异常分支
    if (lockFd != null) { try { fs.closeSync(lockFd); } catch {} }
    try { fs.unlinkSync(lockFile); } catch {}

    // 只在 state 成功持久化后才清理 backup
    if (statePersisted) {
      for (const { backupDir } of backupsToClean) {
        try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
      }
    }
  }
}

// ─── doctorRuntime ─────────────────────────────────────────────────────

export function doctorRuntime({ pluginRoot, cacheDir, env = {}, processInfo = {} }) {
  const manifest = readManifest(pluginRoot);
  const runtimeVersion = manifest.runtime_version;
  const state = readCacheState(cacheDir, runtimeVersion);
  const components = [];

  for (const component of manifest.components) {
    // 1) 优先检查插件本地依赖
    const localNm = path.join(pluginRoot, 'node_modules');
    if (fs.existsSync(localNm) && componentReadyFromDir(localNm, component)) {
      components.push({ name: component.name, status: 'READY', source: 'plugin' });
      continue;
    }

    // 2) 检查缓存
    if (state && !state._corrupted && state.components?.[component.name]?.status === 'READY') {
      const cached = checkComponentCached(cacheDir, state, component, runtimeVersion);
      components.push({ name: component.name, status: cached.status, source: 'cache' });
      continue;
    }

    components.push({ name: component.name, status: 'MISSING' });
  }

  const coreOk = components.find(c => c.name === 'core')?.status === 'READY';
  const optionalMissing = components.some(c => c.name !== 'core' && c.status !== 'READY');
  const overall = coreOk ? (optionalMissing ? 'DEGRADED' : 'READY') : 'BLOCKED';

  return {
    node_version: processInfo.nodeVersion || process.version,
    platform: processInfo.platform || process.platform,
    arch: processInfo.arch || process.arch,
    overall,
    components
  };
}

// ─── 辅助：从已有状态构建 check 结果 ──────────────────────────────────

function buildCheckResultFromExisting(cacheDir, pluginRoot, state, runtimeVersion) {
  const manifest = readManifest(pluginRoot);
  const components = [];
  for (const component of manifest.components) {
    const cached = checkComponentCached(cacheDir, state, component, runtimeVersion);
    components.push({ name: component.name, ...cached });
  }
  const coreOk = components.find(c => c.name === 'core')?.status === 'READY';
  const optionalMissing = components.some(c => c.name !== 'core' && c.status !== 'READY');
  const overall = coreOk ? (optionalMissing ? 'DEGRADED' : 'READY') : 'BLOCKED';
  return { overall, exitCode: overall === 'BLOCKED' ? 1 : 0, components };
}
