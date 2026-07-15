import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildMeetingEditor } from '../scripts/build-meeting-editor.mjs';

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
