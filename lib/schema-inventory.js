/**
 * Read-only SQLite/libSQL schema inventory for safe multi-tenant migration planning.
 * No customer/order records, values, database writes, or connection side effects.
 *
 * Pass an existing read-only dbAll(sql) provider. Never invoke on startup or in
 * a public route; this is an explicit operator/offline diagnostic only.
 */
export async function inspectDatabaseSchema(dbAll) {
  if (typeof dbAll !== 'function') throw new TypeError('A read-only database query provider is required');
  const schema = await dbAll(
    "SELECT type, name, tbl_name AS table_name, sql FROM sqlite_master " +
    "WHERE type IN ('table','index','view','trigger') AND name NOT LIKE 'sqlite_%' " +
    "ORDER BY type, name"
  );
  if (!Array.isArray(schema)) throw new TypeError('Schema provider must return rows');
  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  const tables = [];
  for (const item of schema.filter(entry => entry.type === 'table')) {
    const name = String(item.name);
    const quoted = quote(name);
    const [columns, indexes, foreignKeys] = await Promise.all([
      dbAll(`PRAGMA table_info(${quoted})`),
      dbAll(`PRAGMA index_list(${quoted})`),
      dbAll(`PRAGMA foreign_key_list(${quoted})`),
    ]);
    const keys = [];
    for (const index of indexes || []) {
      const indexName = String(index.name);
      const parts = await dbAll(`PRAGMA index_xinfo(${quote(indexName)})`);
      keys.push({
        name: indexName,
        unique: Boolean(index.unique),
        origin: String(index.origin || ''),
        partial: Boolean(index.partial),
        columns: (parts || []).filter(part => part.key === 1).map(part => part.name == null ? null : String(part.name)),
      });
    }
    const columnNames = (columns || []).map(column => String(column.name));
    const hasTenantColumn = columnNames.some(column => column.toLowerCase() === 'tenant_id');
    tables.push({
      name,
      columns: (columns || []).map(column => ({
        name: String(column.name),
        type: String(column.type || ''),
        notNull: Boolean(column.notnull),
        primaryKeyPosition: Number(column.pk || 0),
      })),
      hasTenantColumn,
      indexes: keys,
      foreignKeys: (foreignKeys || []).map(fk => ({
        id: Number(fk.id),
        from: String(fk.from),
        toTable: String(fk.table),
        toColumn: fk.to == null ? null : String(fk.to),
        onDelete: String(fk.on_delete || ''),
      })),
      review: {
        // Advisory only: some tables are global by design; audit business scope manually.
        noTenantColumn: !hasTenantColumn,
        globalUniqueIndexCandidates: hasTenantColumn
          ? keys.filter(index => index.unique && !index.columns.includes('tenant_id') && index.origin !== 'pk')
              .map(index => index.name)
          : [],
      },
    });
  }
  return {
    format: 'gastroflow-schema-inventory',
    version: 1,
    tableCount: tables.length,
    indexCount: schema.filter(item => item.type === 'index').length,
    viewCount: schema.filter(item => item.type === 'view').length,
    triggerCount: schema.filter(item => item.type === 'trigger').length,
    tables,
  };
}
