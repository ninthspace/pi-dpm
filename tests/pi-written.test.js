/**
 * What a write hands back to the model — `written` in the pi adapter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { written } from '../extensions/dpm/adapter.ts';

test('a write returns what the call did not send, and names the columns stored as sent', () => {
  const row = { id: 'C1', story_id: 'S1', text: 'a stack trace reaches the user', polarity: 'must_not', position: 2, superseded_at: null };

  assert.deepEqual(
    written(row, { story_id: 'S1', text: row.text, polarity: 'must_not', position: 2 }),
    { id: 'C1', superseded_at: null, as_sent: ['story_id', 'text', 'polarity', 'position'] },
  );
});

test('a column stored differently from what was sent stays in the result', () => {
  assert.deepEqual(written({ id: 'A', title: 'Stored' }, { title: 'Sent' }), { id: 'A', title: 'Stored' });
});

test('a boolean is as sent when SQLite stored it as 0 or 1', () => {
  assert.deepEqual(written({ id: 'A', chosen: 1 }, { chosen: true }), { id: 'A', as_sent: ['chosen'] });
  assert.deepEqual(written({ id: 'A', chosen: 0 }, { chosen: true }), { id: 'A', chosen: 0 });
});

test('the id stays even when it was sent, and anything but a row passes through', () => {
  assert.deepEqual(written({ id: 'A', phase: 'read' }, { id: 'A', phase: 'read' }), { id: 'A', as_sent: ['phase'] });
  assert.deepEqual(written([{ id: 'A' }], { id: 'A' }), [{ id: 'A' }]);
  assert.equal(written(null, {}), null);
});
