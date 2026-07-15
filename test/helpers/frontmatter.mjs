import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

/** Parse YAML-ish frontmatter from markdown, returning {frontmatter, body}. */
export function parseFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return { frontmatter: {}, body: markdown };
  const raw = match[1];
  const body = markdown.slice(match[0].length).trimStart();
  const frontmatter = {};
  let listKey = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    // list item under a key
    if (/^-\s+/.test(trimmed) && listKey) {
      if (!frontmatter[listKey]) frontmatter[listKey] = [];
      frontmatter[listKey].push(trimmed.replace(/^-\s+/, '').trim());
      continue;
    }
    // key: value
    const kv = trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)/);
    if (kv) {
      const key = kv[1];
      const val = kv[2].trim();
      if (val === '' || val === '[]') {
        listKey = key;
        frontmatter[key] = [];
      } else if (val.startsWith('[') && val.endsWith(']')) {
        frontmatter[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
        listKey = null;
      } else {
        frontmatter[key] = val.replace(/^["']|["']$/g, '');
        listKey = null;
      }
    }
  }
  return { frontmatter, body };
}

/**
 * Read an agent (worker) markdown file by name.
 * Looks in the agents/ directory of the plugin root.
 * @param {string} name - The agent filename without .md extension, or the agent's frontmatter name.
 * @returns {{frontmatter: object, body: string}}
 */
export function readAgent(name) {
  const agentsDir = path.join(ROOT, 'agents');

  // First try direct filename match
  let filePath = path.join(agentsDir, `${name}.md`);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    return parseFrontmatter(content);
  }

  // Then try matching by frontmatter name
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir)) {
      if (!entry.endsWith('.md')) continue;
      const candidate = path.join(agentsDir, entry);
      const content = fs.readFileSync(candidate, 'utf8');
      const parsed = parseFrontmatter(content);
      if (parsed.frontmatter.name === name) {
        return parsed;
      }
    }
  }

  throw new Error(`Agent not found: ${name}`);
}
