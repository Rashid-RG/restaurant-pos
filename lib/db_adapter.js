import pg from 'pg';
import sqlite3 from 'sqlite3';

const { Pool } = pg;

const usePostgres = Boolean(process.env.DATABASE_URL);

let dbPool;
let sqliteDb;

if (usePostgres) {
  console.log('Connecting to PostgreSQL database...');
  dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
} else {
  console.log('Using SQLite fallback database...');
  sqliteDb = new sqlite3.Database('./database.sqlite');
}

export const query = async (sql, params = []) => {
  if (usePostgres) {
    let paramIdx = 1;
    const pgSql = sql.replace(/\?/g, () => `$${paramIdx++}`);
    const res = await dbPool.query(pgSql, params);
    return res;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve({ rows });
      });
    });
  }
};

export const execute = async (sql, params = []) => {
  if (usePostgres) {
    let paramIdx = 1;
    const pgSql = sql.replace(/\?/g, () => `$${paramIdx++}`);
    const res = await dbPool.query(pgSql, params);
    return { rowCount: res.rowCount };
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
  }
};
