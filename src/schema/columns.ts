/**
 * Whether a column exists, for a write-side check that also runs against a database older than it.
 *
 * A corpus is written through this release's tools into a database built at an earlier version by
 * more than one migration test. A check naming a column that version lacks fails at prepare, for a
 * reason with nothing to do with what the test was checking — and a missing supersession column
 * means nothing has been superseded, so leaving the clause out is the honest reading.
 */

import type { DatabaseSync } from 'node:sqlite';

export function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((row) => row.name === column);
}
