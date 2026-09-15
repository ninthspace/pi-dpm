/**
 * The statements every entity tool is built from.
 *
 * Table and column names are interpolated rather than bound, because SQLite binds values and not
 * identifiers. That is safe here and only here: every name reaching these functions comes from a
 * tool descriptor in this repository, never from a caller's arguments — `validate` has already
 * refused any argument the schema does not name, so an unknown key cannot arrive as a column. A
 * future caller-supplied column name would have to be checked against `PRAGMA table_info` first,
 * and there is no such caller today.
 *
 * **A constraint violation becomes a refusal, not a crash.** FR3 puts rejection at the tool
 * boundary, and `validate` does most of it — but the constraints only the database can check,
 * foreign keys and `CHECK` sets among them, still surface here. Reported as an internal error
 * they would read to a caller as a broken server rather than a bad call, so they are translated.
 */

import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Args, Row } from './convention.ts';

import { ToolError } from './convention.ts';
import { refuseBareUlids } from './prose-refusal.ts';

/**
 * The abort a retirement guard raises, and the qualified columns it blames.
 *
 * `RAISE(ABORT, …)` takes a **string literal** — SQLite gives a trigger no way to interpolate
 * `NEW.<column>` into its own message — so the guard can say which reference was refused and can
 * never say which value. It comes out as `retired: finding.category_id, finding.category_domain
 * references a retired taxonomy row`: enough to identify the argument, and silent on the item.
 *
 * The values are in scope here, so the naming is completed here. A caller told only the column
 * has to cross-reference the message against their own call to find out what was retired, and a
 * refusal that makes the caller do that work is a refusal that will be read as a bug in dpm.
 */
const RETIRED = /^retired: (\S.*) references a retired \w+ row$/;

/**
 * `— category_id 'finding:testability-concerns'` for a retirement abort, `''` for anything else.
 *
 * Columns with no value are dropped rather than reported as `undefined`: a composite reference
 * whose second column is defaulted by the schema is named by the column the caller supplied.
 */
function itemNamed(message: string, table: string, values: Args) {
  const blamed = RETIRED.exec(message)?.[1];

  if (!blamed) return '';

  const named = blamed
    .split(', ')
    .filter((qualified) => qualified.startsWith(`${table}.`))
    .map((qualified) => qualified.slice(table.length + 1))
    .filter((column) => values[column] !== undefined && values[column] !== null)
    .map((column) => `${column} '${values[column]}'`);

  return named.length > 0 ? ` — ${named.join(', ')}` : '';
}

/**
 * `— story_criterion_id '…' names no story_criterion row` for a foreign key failure, `''` otherwise.
 *
 * SQLite's own message names neither the column nor the value. An MTPLX epics run tagged criteria in
 * the same message that created them, sending ids nobody had returned yet, and was told only
 * "FOREIGN KEY constraint failed" — twice, with nothing to say which of two ids was wrong. Asked
 * after the statement failed, so nothing was written and each reference reads as it stands.
 *
 * A composite reference is checked as the whole tuple, and skipped when the write did not supply
 * every column of it: an update names only what changed, and a partial tuple cannot be looked up.
 */
function danglingNamed(db: DatabaseSync, table: string, values: Args): string {
  const references = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
    id: number; table: string; from: string; to: string | null;
  }>;
  const grouped = new Map<number, typeof references>();

  for (const reference of references) {
    grouped.set(reference.id, [...(grouped.get(reference.id) ?? []), reference]);
  }
  const named: string[] = [];

  for (const columns of grouped.values()) {
    const parent = columns[0]!.table;

    if (columns.some(({ from }) => values[from] === undefined || values[from] === null)) continue;

    const keys = columns.some(({ to }) => to === null)
      ? (db.prepare(`PRAGMA table_info(${parent})`).all() as Array<{ name: string; pk: number }>)
        .filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name)
      : columns.map(({ to }) => to!);
    const found = db.prepare(`SELECT 1 FROM ${parent} WHERE ${keys.map((key) => `${key} = ?`).join(' AND ')}`)
      .get(...columns.map(({ from }) => values[from] as SQLInputValue));

    if (!found) {
      named.push(`${columns.map(({ from }) => `${from} '${values[from]}'`).join(', ')} names no ${parent} row`);
    }
  }

  return named.length > 0 ? ` — ${named.join('; ')}` : '';
}

/**
 * Run a statement, turning SQLite's constraint failures into caller-facing refusals.
 *
 * @param {string} where The tool name, for the message.
 * @param {() => object} run
 * @param {{table: string, values: Record<string, unknown>}} [wrote] What was being written, so a
 *   retirement abort can name the item as well as the column, and a foreign key failure the
 *   reference that names no row. Omitted where nothing was.
 */
function attempt<T>(
  where: string, run: () => T, wrote?: { table: string; values: Args; db: DatabaseSync },
): T {
  try {
    return run();
  } catch (error) {
    const { message } = error as Error;

    // **`RAISE(ABORT, …)` carries the message the trigger wrote and nothing else** — no "constraint",
    // no "CHECK", none of the words below. So the retirement guards, whose whole message is
    // `retired: …`, fell straight through this test and reached the caller as a bare `Error` with
    // `ERR_SQLITE_ERROR` and no `rpc` code: *Internal error* at the MCP boundary, for a call that
    // was simply naming a retired term. The guard was working and the report said the server was
    // broken. Found by Epic 47-05 Story 6 — Story 2 built the guards, Epic 47-03 built this
    // translation, and until here nothing had run the two together.
    if (RETIRED.test(message) || /constraint|FOREIGN KEY|UNIQUE|CHECK/i.test(message)) {
      const item = wrote ? itemNamed(message, wrote.table, wrote.values) : '';
      const dangling = wrote && /FOREIGN KEY/i.test(message)
        ? danglingNamed(wrote.db, wrote.table, wrote.values)
        : '';

      throw new ToolError(`${where}: ${message}${item}${dangling}`);
    }
    throw error;
  }
}

/**
 * Insert a row and return it as read back from the database.
 *
 * Read back rather than returned from the arguments, so what the caller sees is what was stored —
 * a column with a default the tool did not set, or a value the database normalised, is visible
 * instead of being reported as whatever was sent.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} table
 * @param {Record<string, unknown>} values
 * @param {string} where The tool name, for the message.
 * @param {string|string[]} [key] The primary key columns, where they are not a single `id`. AD7's
 *   detail tables key on `document_id` and the join tables key on both their columns, so the
 *   read-back has to be told what identifies the row it just wrote.
 * @returns {object}
 */
export function insert(
  db: DatabaseSync, table: string, values: Args, where: string, key: string | string[] = 'id',
): Row {
  const columns = Object.keys(values);

  // **`undefined` is not a value SQLite can bind, and the failure it produces is the wrong one.**
  // Found by mutation: dropping a column from a create tool's `required` list left the handler
  // reading `args.<column>` as `undefined`, and `node:sqlite` answered with a bare `TypeError` —
  // "Provided value cannot be bound to SQLite parameter 3", carrying no `rpc` code and so
  // reaching the caller as *Internal error*. That tells them the server is broken when what
  // happened is that their call was. A column with no value is NULL, said explicitly, or it is a
  // refusal that names the column; it is never a crash.
  for (const column of columns) {
    if (values[column] === undefined) {
      throw new ToolError(`${where}: no value supplied for ${table}.${column}`);
    }
  }
  // Before the statement is built, so a refused body is a call that did nothing rather than one
  // that has to be rolled back. FR16's whole claim is that the bad prose never enters.
  refuseBareUlids(db, table, values, where);

  const sql = `INSERT INTO ${table} (${columns.join(', ')}) `
    + `VALUES (${columns.map(() => '?').join(', ')})`;

  attempt(
    where,
    () => db.prepare(sql).run(...columns.map((column) => values[column]) as SQLInputValue[]),
    { table, values, db },
  );

  const keys = Array.isArray(key) ? key : [key];

  return readByKey(db, table, Object.fromEntries(keys.map((column) => [column, values[column]])), where);
}

/**
 * Read one row by whatever identifies it — a single column or a composite key.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} table
 * @param {Record<string, unknown>} key Column-to-value, ANDed.
 * @param {string} where
 * @returns {object}
 * @throws {ToolError} If there is no such row, for the reason `readById` gives.
 */
export function readByKey(db: DatabaseSync, table: string, key: Args, where: string): Row {
  const columns = Object.keys(key);
  const sql = `SELECT * FROM ${table} WHERE ${columns.map((column) => `${column} = ?`).join(' AND ')}`;
  const row = db.prepare(sql)
    .get(...columns.map((column) => key[column]) as SQLInputValue[]) as Row | undefined;

  if (!row) {
    throw new ToolError(
      `${where}: no ${table} with ${columns.map((column) => `${column} '${key[column]}'`).join(', ')}`,
    );
  }

  return row;
}

/**
 * Read one row by primary key.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} table
 * @param {string} id
 * @param {string} where
 * @param {string} [key] The primary key column, where it is not `id`.
 * @returns {object}
 * @throws {ToolError} If there is no such row — an absent artefact is a caller mistake, and
 *   returning null for it would let a read failure pass as an empty artefact.
 */
export function readById(
  db: DatabaseSync, table: string, id: SQLInputValue, where: string, key = 'id',
): Row {
  const row = db.prepare(`SELECT * FROM ${table} WHERE ${key} = ?`).get(id) as Row | undefined;

  if (!row) throw new ToolError(`${where}: no ${table} with ${key} '${id}'`);

  return row;
}

/**
 * Update the named columns of one row and return it as read back.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} table
 * @param {string} id
 * @param {Record<string, unknown>} values Only the columns present are written.
 * @param {string} where
 * @param {string} [key]
 * @returns {object}
 * @throws {ToolError} If no row was changed. `UPDATE` matching nothing reports success, which is
 *   the same silent-nothing shape `allocateNumber` guards against for the same reason.
 */
export function update(
  db: DatabaseSync, table: string, id: SQLInputValue, values: Args, where: string, key = 'id',
): Row {
  return updateByKey(db, table, { [key]: id }, values, where);
}

/**
 * The same, for a row identified by more than one column.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} table
 * @param {Record<string, unknown>} key Column-to-value, ANDed.
 * @param {Record<string, unknown>} values Only the columns present are written.
 * @param {string} where
 * @returns {object}
 * @throws {ToolError} If no row was changed, for the reason `update` gives.
 */
export function updateByKey(
  db: DatabaseSync, table: string, key: Args, values: Args, where: string,
): Row {
  const columns = Object.keys(values);
  const keyColumns = Object.keys(key);

  if (columns.length === 0) throw new ToolError(`${where}: nothing to update`);

  // An update reaches prose the same way a create does — an amended body is the commonest way a
  // bare id would arrive, since it is written after the document it names already exists.
  refuseBareUlids(db, table, values, where);

  const sql = `UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')} `
    + `WHERE ${keyColumns.map((column) => `${column} = ?`).join(' AND ')}`;

  const changed = attempt(where, () => db.prepare(sql).run(
    ...columns.map((column) => values[column]) as SQLInputValue[],
    ...keyColumns.map((column) => key[column]) as SQLInputValue[],
  ), { table, values, db });

  if (changed.changes === 0) {
    throw new ToolError(
      `${where}: no ${table} with ${keyColumns.map((column) => `${column} '${key[column]}'`).join(', ')}`,
    );
  }

  return readByKey(db, table, key, where);
}

/**
 * Delete one row, having read it first, and hand back what was removed.
 *
 * **Read before, not after.** Every other statement here reads back what it wrote, and this one
 * cannot — so the row is fetched while it still exists and returned from that. It is also what
 * makes the absent case a refusal rather than a silent success: `DELETE` matching nothing reports
 * zero changes and no error, the same shape `update` guards against, and a caller told "deleted"
 * about a row that was never there has been told something false about their own database.
 *
 * **The row is returned because a delete is the one operation with nothing left to look at.** A
 * caller that wants to report what it removed, or to undo it, has no second chance to ask.
 *
 * A reference from elsewhere surfaces through `attempt` as a refusal, which is the intended
 * behaviour rather than an obstacle to route around: a foreign key that would be left pointing at
 * nothing is exactly the row that must not go.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} table
 * @param {string} id
 * @param {string} where
 * @param {string} [key]
 * @returns {object} The row as it was immediately before deletion.
 * @throws {ToolError} If there is no such row, or if something still references it.
 */
export function deleteById(
  db: DatabaseSync, table: string, id: SQLInputValue, where: string, key = 'id',
): Row {
  const row = readById(db, table, id, where, key);

  attempt(where, () => db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`).run(id));

  return row;
}

/**
 * Delete one row named by a composite key — `deleteById`, for a join table whose key is its columns.
 *
 * The same read-before and refusal on absence, for the same reasons. A second function rather than
 * an array accepted by the first, so the sweep in `coverage-retirement-tool.test.js` reads each
 * call site's table the same way whichever of the two it goes through.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} table
 * @param {object} key Column → value, every column of the table's primary key.
 * @param {string} where
 * @returns {object} The row as it was immediately before deletion.
 * @throws {ToolError} If there is no such row, or if something still references it.
 */
export function deleteByKey(db: DatabaseSync, table: string, key: Args, where: string): Row {
  const row = readByKey(db, table, key, where);
  const columns = Object.keys(key);

  attempt(where, () => db
    .prepare(`DELETE FROM ${table} WHERE ${columns.map((column) => `${column} = ?`).join(' AND ')}`)
    .run(...columns.map((column) => key[column]) as SQLInputValue[]));

  return row;
}
