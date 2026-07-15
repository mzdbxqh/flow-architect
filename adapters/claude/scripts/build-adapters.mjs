import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Build adapter outputs for both Codex and Claude platforms.
 *
 * @param {string|URL} pluginRoot - Root of the plugin (packages/flow-architect/)
 * @returns {Map<string,{content:Buffer,mode:number}>} relative path -> file descriptor
 */
export function buildAdapterOutputs(pluginRoot) {
  const root = typeof pluginRoot === 'string'
    ? path.resolve(pluginRoot)
    : fileURLToPath(pluginRoot);

  // Verify root exists and is not a symlink
  rejectSymlinks(root);

  const outputs = new Map();

  // Shared directories copied to both adapters
  const sharedDirs = ['skills', 'references', 'scripts'];

  // Build adapters
  for (const adapter of ['codex', 'claude']) {
    const adapterPrefix = `adapters/${adapter}`;

    // Copy shared directories
    for (const dir of sharedDirs) {
      const srcDir = path.join(root, dir);
      if (!fs.existsSync(srcDir)) continue;
      collectFiles(srcDir, root, `${adapterPrefix}/${dir}`, outputs);
    }

    // Copy agents/ only to Claude adapter
    if (adapter === 'claude') {
      const agentsDir = path.join(root, 'agents');
      if (fs.existsSync(agentsDir)) {
        collectFiles(agentsDir, root, `${adapterPrefix}/agents`, outputs);
      }
    }

    // Generate platform-specific plugin.json
    if (adapter === 'claude') {
      const claudePluginJson = JSON.stringify({
        name: 'flow-architect',
        version: '0.1.0',
        description: 'Read-only process architecture and diagram review skill family',
        author: { name: 'flow-architect contributors' },
        license: 'Apache-2.0',
        keywords: ['architecture', 'review', 'bpmn', 'process', 'diagram'],
        skills: './skills/'
      }, null, 2) + '\n';
      outputs.set(`${adapterPrefix}/.claude-plugin/plugin.json`, {
        content: Buffer.from(claudePluginJson),
        mode: 0o644
      });

      const marketplaceJson = JSON.stringify({
        name: 'flow-architect',
        version: '0.1.0',
        description: 'Read-only process architecture and diagram review skill family',
        category: 'Productivity',
        capabilities: ['Read'],
        entrypoint: './skills/'
      }, null, 2) + '\n';
      outputs.set(`${adapterPrefix}/marketplace.json`, {
        content: Buffer.from(marketplaceJson),
        mode: 0o644
      });
    }

    if (adapter === 'codex') {
      const codexPluginJson = JSON.stringify({
        name: 'flow-architect',
        version: '0.1.0',
        description: 'Read-only process architecture and diagram review skill family',
        author: { name: 'flow-architect contributors' },
        license: 'Apache-2.0',
        keywords: ['architecture', 'review', 'bpmn', 'process', 'diagram'],
        skills: './skills/',
        interface: {
          displayName: 'Flow Architect',
          shortDescription: 'Process architecture review',
          longDescription: 'Read-only skill family for reviewing process architectures, BPMN diagrams, and consistency across artifacts',
          developerName: 'flow-architect contributors',
          category: 'Productivity',
          capabilities: ['Read'],
          defaultPrompt: 'Review my process architecture for defects'
        }
      }, null, 2) + '\n';
      outputs.set(`${adapterPrefix}/.codex-plugin/plugin.json`, {
        content: Buffer.from(codexPluginJson),
        mode: 0o644
      });
    }
  }

  // Generate root .codex-plugin/plugin.json
  const rootCodexPluginJson = JSON.stringify({
    name: 'flow-architect',
    version: '0.1.0',
    description: 'Read-only process architecture and diagram review skill family',
    author: { name: 'flow-architect contributors' },
    license: 'Apache-2.0',
    keywords: ['architecture', 'review', 'bpmn', 'process', 'diagram'],
    skills: './skills/',
    interface: {
      displayName: 'Flow Architect',
      shortDescription: 'Process architecture review',
      longDescription: 'Read-only skill family for reviewing process architectures, BPMN diagrams, and consistency across artifacts',
      developerName: 'flow-architect contributors',
      category: 'Productivity',
      capabilities: ['Read'],
      defaultPrompt: 'Review my process architecture for defects'
    }
  }, null, 2) + '\n';
  outputs.set('.codex-plugin/plugin.json', {
    content: Buffer.from(rootCodexPluginJson),
    mode: 0o644
  });

  return outputs;
}

/**
 * Recursively collect files from srcDir into outputs Map.
 */
function collectFiles(srcDir, root, targetPrefix, outputs) {
  rejectSymlinks(srcDir);
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const relFromRoot = path.relative(root, srcPath);
    const targetRel = `${targetPrefix}/${entry.name}`;

    if (entry.isDirectory()) {
      collectFiles(srcPath, root, targetRel, outputs);
    } else if (entry.isFile()) {
      rejectSymlinks(srcPath);
      const stat = fs.lstatSync(srcPath);
      outputs.set(targetRel, {
        content: fs.readFileSync(srcPath),
        mode: stat.mode
      });
    }
  }
}

/**
 * Reject symlinks at the given path.
 */
function rejectSymlinks(filePath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Symlink detected and rejected: ${filePath}`);
  }
}

/**
 * Write adapter outputs to disk.
 * Deletes adapter roots first, then writes atomically.
 */
function writeAdapterOutputs(root, outputs) {
  // Delete existing adapter directories
  for (const adapter of ['codex', 'claude']) {
    const adapterDir = path.join(root, 'adapters', adapter);
    if (fs.existsSync(adapterDir)) {
      fs.rmSync(adapterDir, { recursive: true, force: true });
    }
  }

  // Write all files atomically
  for (const [relPath, { content, mode }] of outputs) {
    const absPath = path.join(root, relPath);
    const dir = path.dirname(absPath);
    fs.mkdirSync(dir, { recursive: true });

    // Write to temp file first, then rename for atomicity
    const tmpPath = absPath + `.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, content, { mode });
    fs.renameSync(tmpPath, absPath);
  }
}

/**
 * Check adapter outputs against disk.
 * Returns an array of problem descriptions. Empty means all good.
 */
function checkAdapterOutputs(root, outputs) {
  const problems = [];

  // Check that no extra files exist in adapter directories
  for (const adapter of ['codex', 'claude']) {
    const adapterDir = path.join(root, 'adapters', adapter);
    if (!fs.existsSync(adapterDir)) {
      problems.push(`Adapter directory missing: adapters/${adapter}`);
      continue;
    }
    const diskFiles = new Set();
    collectDiskFiles(adapterDir, root, diskFiles);

    // Check for extra files on disk not in outputs
    for (const diskFile of diskFiles) {
      if (!outputs.has(diskFile)) {
        problems.push(`Unexpected file on disk: ${diskFile}`);
      }
    }
  }

  // Check each expected file
  for (const [relPath, { content, mode }] of outputs) {
    const absPath = path.join(root, relPath);

    if (!fs.existsSync(absPath)) {
      problems.push(`Missing file: ${relPath}`);
      continue;
    }

    rejectSymlinks(absPath);

    const diskStat = fs.lstatSync(absPath);

    // Check mode (only compare permission bits)
    const diskPerm = diskStat.mode & 0o7777;
    const expectedPerm = mode & 0o7777;
    if (diskPerm !== expectedPerm) {
      problems.push(`Mode mismatch: ${relPath} (disk=${diskPerm.toString(8)}, expected=${expectedPerm.toString(8)})`);
    }

    // Check content bytes
    const diskContent = fs.readFileSync(absPath);
    if (!diskContent.equals(content)) {
      problems.push(`Content mismatch: ${relPath} (disk=${diskContent.length} bytes, expected=${content.length} bytes)`);
    }
  }

  return problems.sort();
}

/**
 * Collect all file paths on disk relative to root.
 */
function collectDiskFiles(dir, root, fileSet) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = path.relative(root, absPath);
    if (entry.isDirectory()) {
      collectDiskFiles(absPath, root, fileSet);
    } else {
      fileSet.add(relPath);
    }
  }
}

// CLI entry point
if (process.argv[1] === __filename) {
  const root = path.resolve(__dirname, '..');
  const isCheck = process.argv.includes('--check');

  try {
    const outputs = buildAdapterOutputs(root);

    if (isCheck) {
      const problems = checkAdapterOutputs(root, outputs);
      if (problems.length > 0) {
        for (const problem of problems) {
          process.stderr.write(`${problem}\n`);
        }
        process.exitCode = 1;
      } else {
        process.stdout.write(`build:check passed (${outputs.size} files verified)\n`);
      }
    } else {
      writeAdapterOutputs(root, outputs);
      process.stdout.write(`Build complete (${outputs.size} files written)\n`);
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}
