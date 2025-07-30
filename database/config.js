// Database configuration for both SQLite (development) and PostgreSQL (production)
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');

// Check if we're in production (Render) or development
const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL;

let db;

if (isProduction && process.env.DATABASE_URL) {
    // PostgreSQL for production (Render)
    console.log('🗄️ Using PostgreSQL database for production');
    console.log('📡 DATABASE_URL exists:', !!process.env.DATABASE_URL);
    console.log('📡 NODE_ENV:', process.env.NODE_ENV);
    console.log('📡 isProduction:', isProduction);
    console.log('📡 Connecting to:', process.env.DATABASE_URL.split('@')[1]); // Log only host part for security
    
    db = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : {
            rejectUnauthorized: false
        },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000, // Increased timeout
        // Force IPv4 for Supabase compatibility
        family: 4
    });
    
    // Test connection
    db.on('error', (err) => {
        console.error('❌ PostgreSQL connection error:', err);
    });
    
} else {
    // SQLite for development
    console.log('🗄️ Using SQLite database for development');
    const dbPath = path.join(__dirname, 'retreat.db');
    db = new sqlite3.Database(dbPath);
}

// Database abstraction layer
class Database {
    constructor() {
        this.isPostgres = isProduction && process.env.DATABASE_URL;
    }

    // Convert SQLite placeholders (?) to PostgreSQL placeholders ($1, $2, ...)
    convertSqlForPostgres(sql, params) {
        if (!this.isPostgres) return { sql, params };
        
        let paramIndex = 1;
        const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
        return { sql: convertedSql, params };
    }

    // Execute a query
    async query(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isPostgres) {
                // PostgreSQL - convert ? to $1, $2, etc.
                const { sql: convertedSql, params: convertedParams } = this.convertSqlForPostgres(sql, params);
                db.query(convertedSql, convertedParams, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result.rows);
                    }
                });
            } else {
                // SQLite
                db.all(sql, params, (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                });
            }
        });
    }

    // Execute a single query that returns one row
    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isPostgres) {
                // PostgreSQL - convert ? to $1, $2, etc.
                const { sql: convertedSql, params: convertedParams } = this.convertSqlForPostgres(sql, params);
                db.query(convertedSql, convertedParams, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result.rows[0] || null);
                    }
                });
            } else {
                // SQLite
                db.get(sql, params, (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row || null);
                    }
                });
            }
        });
    }

    // Execute an insert/update/delete query
    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isPostgres) {
                // PostgreSQL - convert ? to $1, $2, etc.
                const { sql: convertedSql, params: convertedParams } = this.convertSqlForPostgres(sql, params);
                
                // For INSERT queries, add RETURNING id to get the inserted ID
                let finalSql = convertedSql;
                if (convertedSql.toLowerCase().trim().startsWith('insert') && !convertedSql.toLowerCase().includes('returning')) {
                    finalSql = convertedSql + ' RETURNING id';
                }
                
                db.query(finalSql, convertedParams, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        let lastID = null;
                        
                        // If it's an INSERT with RETURNING, get the returned ID
                        if (result.rows && result.rows.length > 0 && result.rows[0].id) {
                            lastID = result.rows[0].id;
                        }
                        
                        resolve({
                            lastID: lastID,
                            changes: result.rowCount || 0
                        });
                    }
                });
            } else {
                // SQLite
                db.run(sql, params, function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({
                            lastID: this.lastID,
                            changes: this.changes
                        });
                    }
                });
            }
        });
    }

    // Begin transaction
    async beginTransaction() {
        if (this.isPostgres) {
            return await this.query('BEGIN');
        } else {
            return await this.run('BEGIN TRANSACTION');
        }
    }

    // Commit transaction
    async commit() {
        return await this.query('COMMIT');
    }

    // Rollback transaction
    async rollback() {
        return await this.query('ROLLBACK');
    }

    // Close database connection
    close() {
        if (this.isPostgres) {
            db.end();
        } else {
            db.close();
        }
    }
}

module.exports = {
    Database,
    isProduction,
    rawDb: db
};