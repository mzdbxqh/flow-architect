import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildMeetingEditor } from '../scripts/build-meeting-editor.mjs';

const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'meeting-package');

test('meeting editor build is deterministic and offline', async () => {
  const first = await buildMeetingEditor({ write: false });
  const second = await buildMeetingEditor({ write: false });
  assert.deepEqual(first, second);
  assert.doesNotMatch(first.js.toString(), /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b/);
  assert.doesNotMatch(first.css.toString(), /url\((?!data:)/);
  assert.ok(first.js.length + first.css.length + first.shell.length < 5 * 1024 * 1024);
});

test('committed runtime assets match source build', async () => {
  const result = await buildMeetingEditor({ check: true });
  assert.deepEqual(result.problems, []);
  assert.ok(fs.existsSync(new URL('../runtime/meeting-package/editor.bundle.js', import.meta.url)));
});

test('--check does not write to disk when assets match', async () => {
  const jsPath = path.join(RUNTIME, 'editor.bundle.js');
  const cssPath = path.join(RUNTIME, 'editor.bundle.css');
  const shellPath = path.join(RUNTIME, 'shell.html');
  const jsMtime = fs.statSync(jsPath).mtimeMs;
  const cssMtime = fs.statSync(cssPath).mtimeMs;
  const shellMtime = fs.statSync(shellPath).mtimeMs;
  await buildMeetingEditor({ check: true });
  assert.equal(fs.statSync(jsPath).mtimeMs, jsMtime);
  assert.equal(fs.statSync(cssPath).mtimeMs, cssMtime);
  assert.equal(fs.statSync(shellPath).mtimeMs, shellMtime);
});
