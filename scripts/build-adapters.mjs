import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_VERSION = '0.5.0';

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
  const sharedDirs = ['skills', 'references', 'scripts', 'runtime'];

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

      // Copy commands/ to Claude adapter
      const commandsDir = path.join(root, 'commands');
      if (fs.existsSync(commandsDir)) {
        collectFiles(commandsDir, root, `${adapterPrefix}/commands`, outputs);
      }
    }

    // Generate platform-specific plugin.json
    if (adapter === 'claude') {
      const claudePluginJson = JSON.stringify({
        name: 'flow-architect',
        version: PLUGIN_VERSION,
        description: 'Process architecture review, draft, and meeting package skill family',
        author: { name: 'flow-architect contributors' },
        license: 'Apache-2.0',
        keywords: ['architecture', 'review', 'draft', 'meeting', 'bpmn', 'process', 'diagram'],
        skills: './skills/',
        commands: [
          './commands/help.md',
          './commands/setup.md',
          './commands/quickstart.md'
        ]
      }, null, 2) + '\n';
      outputs.set(`${adapterPrefix}/.claude-plugin/plugin.json`, {
        content: Buffer.from(claudePluginJson),
        mode: 0o644
      });

    }

    if (adapter === 'codex') {
      const codexPluginJson = JSON.stringify({
        name: 'flow-architect',
        version: PLUGIN_VERSION,
        description: 'Process architecture review, draft, and meeting package skill family',
        author: { name: 'flow-architect contributors' },
        license: 'Apache-2.0',
        keywords: ['architecture', 'review', 'draft', 'meeting', 'bpmn', 'process', 'diagram'],
        skills: './skills/',
        interface: {
          displayName: 'Flow Architect',
          shortDescription: 'Process architecture review',
          longDescription: 'Skill family for reviewing process architectures, drafting process models, and building meeting packages from BPMN diagrams',
          developerName: 'flow-architect contributors',
          category: 'Productivity',
          capabilities: ['Read', 'Write'],
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
    version: PLUGIN_VERSION,
    description: 'Process architecture review, draft, and meeting package skill family',
    author: { name: 'flow-architect contributors' },
    license: 'Apache-2.0',
    keywords: ['architecture', 'review', 'draft', 'meeting', 'bpmn', 'process', 'diagram'],
    skills: './skills/',
    interface: {
      displayName: 'Flow Architect',
      shortDescription: 'Process architecture review',
      longDescription: 'Skill family for reviewing process architectures, drafting process models, and building meeting packages from BPMN diagrams',
      developerName: 'flow-architect contributors',
      category: 'Productivity',
      capabilities: ['Read', 'Write'],
      defaultPrompt: 'Review my process architecture for defects'
    }
  }, null, 2) + '\n';
  outputs.set('.codex-plugin/plugin.json', {
    content: Buffer.from(rootCodexPluginJson),
    mode: 0o644
  });

  // Generate root .claude-plugin/plugin.json for direct local plugin loading.
  // When the public subproject is used as a Claude Code plugin directory,
  // skills/ and commands/ resolve relative to the plugin root.
  const rootClaudePluginJson = JSON.stringify({
    name: 'flow-architect',
    version: PLUGIN_VERSION,
    description: 'Process architecture review, draft, and meeting package skill family',
    author: { name: 'flow-architect contributors' },
    license: 'Apache-2.0',
    keywords: ['architecture', 'review', 'draft', 'meeting', 'bpmn', 'process', 'diagram'],
    skills: './skills/',
    commands: [
      './commands/help.md',
      './commands/setup.md',
      './commands/quickstart.md'
    ]
  }, null, 2) + '\n';
  outputs.set('.claude-plugin/plugin.json', {
    content: Buffer.from(rootClaudePluginJson),
    mode: 0o644
  });

  // Generate repository-level marketplace manifests. Codex installs the root
  // plugin directly; Claude Code installs the generated Claude adapter.
  const codexMarketplaceJson = JSON.stringify({
    name: 'flow-architect',
    interface: {
      displayName: 'Flow Architect'
    },
    plugins: [{
      name: 'flow-architect',
      source: {
        source: 'local',
        path: './'
      },
      policy: {
        installation: 'AVAILABLE',
        authentication: 'ON_INSTALL'
      },
      category: 'Productivity'
    }]
  }, null, 2) + '\n';
  outputs.set('.agents/plugins/marketplace.json', {
    content: Buffer.from(codexMarketplaceJson),
    mode: 0o644
  });

  const claudeMarketplaceJson = JSON.stringify({
    name: 'flow-architect',
    description: 'Process architecture review, draft, and meeting package skills for Claude Code',
    owner: {
      name: 'flow-architect contributors'
    },
    plugins: [{
      name: 'flow-architect',
      source: './adapters/claude',
      description: 'Process architecture review, draft, and meeting package skill family',
      version: PLUGIN_VERSION,
      author: {
        name: 'flow-architect contributors'
      },
      repository: 'https://github.com/ifoohoo/flow-architect',
      license: 'Apache-2.0',
      keywords: ['architecture', 'review', 'draft', 'meeting', 'bpmn', 'process', 'diagram'],
      category: 'productivity'
    }]
  }, null, 2) + '\n';
  outputs.set('.claude-plugin/marketplace.json', {
    content: Buffer.from(claudeMarketplaceJson),
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
