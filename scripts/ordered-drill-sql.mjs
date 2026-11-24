// Reconstruct from SQLite's parsed schema, never split a trigger or a quoted value on ';'.
export function orderedDrillSql(db) {
	const id = (s) => `"${s.replaceAll('"', '""')}"`;
	const objects = db
		.prepare(
			"SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' ORDER BY type,name"
		)
		.all();
	const tables = objects.filter((o) => o.type === 'table');
	const lines = ['PRAGMA defer_foreign_keys=TRUE;', ...tables.map((o) => `${o.sql};`)];
	// Composite foreign keys require their parent UNIQUE indexes before any row is inserted.
	for (const o of objects.filter((o) => o.type === 'index')) lines.push(`${o.sql};`);
	for (const table of tables) {
		const name = id(table.name);
		const cols = db
			.prepare(`PRAGMA table_xinfo(${name})`)
			.all()
			.filter((c) => !c.hidden)
			.map((c) => id(c.name));
		const expressions = cols.map(
			(c) =>
				`CASE WHEN typeof(${c})='text' AND instr(${c},char(0))>0 THEN 'CAST(X''' || hex(${c}) || ''' AS TEXT)' ELSE quote(${c}) END`
		);
		const query = db.prepare(`SELECT ${expressions.join(',')} FROM ${name}`);
		query.setReturnArrays(true);
		for (const row of query.iterate())
			lines.push(`INSERT INTO ${name} (${cols.join(',')}) VALUES (${row.join(',')});`);
	}
	if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'").get()) {
		lines.push('DELETE FROM sqlite_sequence;');
		for (const row of db
			.prepare('SELECT quote(name) AS n,quote(seq) AS s FROM sqlite_sequence')
			.all())
			lines.push(`INSERT INTO sqlite_sequence(name,seq) VALUES(${row.n},${row.s});`);
	}
	for (const type of ['view', 'trigger'])
		for (const o of objects.filter((o) => o.type === type)) lines.push(`${o.sql};`);
	return lines.join('\n');
}
