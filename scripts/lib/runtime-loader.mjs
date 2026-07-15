/**
 * Runtime Loader — 从隔离 Marketplace 插件加载运行时依赖。
 *
 * 加载顺序：插件本地 → 外部缓存。
 * 缓存加载前必须通过 runtime manager 的状态校验。
 * 未知组件或未声明包一律结构化拒绝。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cacheRoot, checkRuntime, readManifest } from './runtime-manager.mjs';

// ─── 默认根推导 ─────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// scripts/lib → scripts → pluginRoot（向上两级）
const DEFAULT_PLUGIN_ROOT = path.resolve(__dirname, '..', '..');

// ─── RuntimeCapabilityError ─────────────────────────────────────────────

export class RuntimeCapabilityError extends Error {
  /**
   * @param {string} message
   * @param {string} component
   * @param {string} specifier
   * @param {string[]} setupCommands
   * @param {Error} [cause]
   */
  constructor(message, component, specifier, setupCommands = [], cause) {
    super(message, { cause });
    this.name = 'RuntimeCapabilityError';
    this.code = 'FLOW_ARCHITECT_RUNTIME_MISSING';
    this.component = component;
    this.specifier = specifier;
    this.setup_commands = setupCommands;
  }
}

// ─── Setup 命令 ─────────────────────────────────────────────────────────

function getSetupCommands() {
  return ['/flow-architect:setup', '$flow-architect-setup'];
}

// ─── 缓存根推导 ─────────────────────────────────────────────────────────

function getDefaultCacheDir() {
  return cacheRoot({ env: process.env });
}

// ─── Manifest 读取与组件校验 ────────────────────────────────────────────

/**
 * 从 specifier 提取 manifest 中声明的包名。
 * 作用域包保留前两段，普通包取第一段。
 */
function specifierToPackageName(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split('/')[0];
}

/**
 * 校验 component 存在于 manifest，且 specifier 对应的包被该组件声明。
 */
function validateSpecifier(pluginRoot, component, specifier) {
  if (typeof specifier !== 'string' || !specifier || path.isAbsolute(specifier) || specifier.includes('\\')) {
    throw new RuntimeCapabilityError(
      `Invalid package specifier: ${specifier}`,
      component,
      specifier,
      getSetupCommands()
    );
  }
  const segments = specifier.split('/');
  if (segments.some(segment => segment === '.' || segment === '..' || segment === '')) {
    throw new RuntimeCapabilityError(
      `Invalid package specifier: ${specifier}`,
      component,
      specifier,
      getSetupCommands()
    );
  }

  let manifest;
  try {
    manifest = readManifest(pluginRoot);
  } catch (cause) {
    throw new RuntimeCapabilityError(
      `Runtime manifest unavailable: ${cause.message}`,
      component,
      specifier,
      getSetupCommands(),
      cause
    );
  }
  const comp = manifest.components.find(c => c.name === component);
  if (!comp) {
    throw new RuntimeCapabilityError(
      `Unknown component: ${component}`,
      component,
      specifier,
      getSetupCommands()
    );
  }

  const pkgName = specifierToPackageName(specifier);
  if (!comp.packages[pkgName]) {
    throw new RuntimeCapabilityError(
      `Package ${pkgName} not declared in component ${component}`,
      component,
      specifier,
      getSetupCommands()
    );
  }

  return {
    manifest,
    componentEntry: comp,
    packageName: pkgName,
    expectedVersion: comp.packages[pkgName]
  };
}

// ─── 本地优先查找 ───────────────────────────────────────────────────────

/**
 * 在插件本地 node_modules 中查找包。
 * 仅接受 manifest 声明的精确版本。
 * 返回 { require } 或 null。
 */
function findLocalWithVersion(pluginRoot, specifier, packageName, expectedVersion) {
  const localNm = path.join(pluginRoot, 'node_modules');
  if (!fs.existsSync(localNm)) return null;
  const pkgJsonPath = path.join(localNm, packageName, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return null;
  try {
    const req = createRequire(path.join(pluginRoot, 'package.json'));
    req.resolve(specifier);
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    if (String(pkg.version).trim() === expectedVersion) {
      return { require: req };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── 缓存加载（带完整验证）─────────────────────────────────────────────

/**
 * 从 manager 验证过的缓存中查找包。
 * 要求：state 完好、组件 READY、lock SHA 匹配、精确版本匹配。
 * 返回 { require } 或抛出 RuntimeCapabilityError。
 */
function findInCache(pluginRoot, cacheDir, manifest, component, specifier) {
  let runtimeStatus;
  try {
    runtimeStatus = checkRuntime({ pluginRoot, cacheDir, env: process.env });
  } catch (cause) {
    throw new RuntimeCapabilityError(
      `Runtime cache validation failed for component ${component}: ${cause.message}`,
      component,
      specifier,
      getSetupCommands(),
      cause
    );
  }

  const componentStatus = runtimeStatus.components.find(item => item.name === component);
  if (componentStatus?.status !== 'READY' || componentStatus.source !== 'cache') {
    throw new RuntimeCapabilityError(
      `Component ${component} is not READY in the verified runtime cache`,
      component,
      specifier,
      getSetupCommands()
    );
  }

  const componentDir = path.join(
    cacheDir,
    'runtimes',
    manifest.runtime_version,
    component
  );
  return { require: createRequire(path.join(componentDir, 'package.json')) };
}

// ─── 同步 requireRuntimePackage ─────────────────────────────────────────

/**
 * 同步加载运行时包。
 *
 * @param {string} component - 组件名称 (core|pdf|docx|xlsx)
 * @param {string} specifier - 包名或子路径
 * @param {object} [options]
 * @param {string} [options.pluginRoot] - 插件根目录（默认从 import.meta.url 推导）
 * @param {string} [options.cacheDir] - 缓存目录（默认从环境变量推导）
 * @returns {any} 加载的模块
 */
export function requireRuntimePackage(component, specifier, options = {}) {
  const pluginRoot = options.pluginRoot || DEFAULT_PLUGIN_ROOT;
  const cacheDir = options.cacheDir || getDefaultCacheDir();

  // 校验 component 和 specifier
  const { manifest, packageName, expectedVersion } = validateSpecifier(pluginRoot, component, specifier);

  // 1. 本地优先（精确版本验证）
  const local = findLocalWithVersion(pluginRoot, specifier, packageName, expectedVersion);
  if (local) {
    try {
      return local.require(specifier);
    } catch (e) {
      // 已定位但执行失败 → 包装为能力错误，保留 cause
      throw new RuntimeCapabilityError(
        `Package ${specifier} execution failed in component ${component}: ${e.message}`,
        component, specifier, getSetupCommands(), e
      );
    }
  }

  // 2. 缓存加载（完整验证）
  try {
    const cache = findInCache(pluginRoot, cacheDir, manifest, component, specifier);
    return cache.require(specifier);
  } catch (e) {
    if (e instanceof RuntimeCapabilityError) {
      // 如果是已知的能力错误（状态/版本/lock 问题），检查是否因缓存入口损坏需要保留 cause
      // findInCache 不加载模块，只验证；真正加载在 cache.require(specifier) 中
      // 如果上面 cache.require 成功就不会到这里
      // 如果 findInCache 抛出能力错误，直接传播
      throw e;
    }
    // cache.require 执行失败 → 包装，保留 cause
    throw new RuntimeCapabilityError(
      `Package ${specifier} execution failed from cache for component ${component}: ${e.message}`,
      component, specifier, getSetupCommands(), e
    );
  }
}

// ─── 异步 importRuntimePackage ──────────────────────────────────────────

/**
 * 异步加载运行时包。
 * 使用 import() 支持 CJS/ESM 兼容。
 * 返回模块 namespace 对象（CJS 模块通过 namespace.default 访问默认导出）。
 *
 * @param {string} component
 * @param {string} specifier
 * @param {object} [options]
 * @returns {Promise<Module>}
 */
export async function importRuntimePackage(component, specifier, options = {}) {
  const pluginRoot = options.pluginRoot || DEFAULT_PLUGIN_ROOT;
  const cacheDir = options.cacheDir || getDefaultCacheDir();

  // 校验 component 和 specifier
  const { manifest, packageName, expectedVersion } = validateSpecifier(pluginRoot, component, specifier);

  // 1. 本地优先
  const local = findLocalWithVersion(pluginRoot, specifier, packageName, expectedVersion);
  if (local) {
    try {
      const resolvedPath = local.require.resolve(specifier);
      const loaded = await import(pathToFileURL(resolvedPath).href);
      return loaded.default ?? loaded;
    } catch (e) {
      if (e instanceof RuntimeCapabilityError) throw e;
      throw new RuntimeCapabilityError(
        `Package ${specifier} execution failed in component ${component}: ${e.message}`,
        component, specifier, getSetupCommands(), e
      );
    }
  }

  // 2. 缓存加载
  try {
    const cache = findInCache(pluginRoot, cacheDir, manifest, component, specifier);
    const resolvedPath = cache.require.resolve(specifier);
    const loaded = await import(pathToFileURL(resolvedPath).href);
    return loaded.default ?? loaded;
  } catch (e) {
    if (e instanceof RuntimeCapabilityError) throw e;
    throw new RuntimeCapabilityError(
      `Package ${specifier} execution failed from cache for component ${component}: ${e.message}`,
      component, specifier, getSetupCommands(), e
    );
  }
}
