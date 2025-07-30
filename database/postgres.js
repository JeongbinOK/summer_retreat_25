// PostgreSQL-only database configuration for Church Summer Retreat 2025
const { Pool } = require('pg');

let pool;

// Initialize PostgreSQL connection pool
if (process.env.DATABASE_URL) {
    console.log('🗄️ Initializing PostgreSQL connection pool');
    console.log('📡 Database URL exists:', !!process.env.DATABASE_URL);
    console.log('📡 NODE_ENV:', process.env.NODE_ENV);
    
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : {
            rejectUnauthorized: false
        },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        // Force IPv4 for Supabase compatibility
        family: 4
    });
    
    // Handle connection errors
    pool.on('error', (err) => {
        console.error('❌ PostgreSQL pool error:', err);
    });
    
    // Test initial connection
    pool.connect()
        .then(client => {
            console.log('✅ PostgreSQL connected successfully');
            client.release();
        })
        .catch(err => {
            console.error('❌ PostgreSQL initial connection failed:', err);
        });
} else {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
}

/**
 * Simple PostgreSQL-only Database class
 * No SQLite compatibility, direct PostgreSQL queries only
 */
class PostgreSQLDatabase {
    constructor() {
        if (!pool) {
            throw new Error('Database pool not initialized');
        }
        this.pool = pool;
    }

    /**
     * Execute a query that returns multiple rows
     */
    async query(sql, params = []) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(sql, params);
            return result.rows;
        } finally {
            client.release();
        }
    }

    /**
     * Execute a query that returns a single row
     */
    async get(sql, params = []) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(sql, params);
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    /**
     * Execute an INSERT/UPDATE/DELETE query
     * For INSERT queries that need the ID, use RETURNING id explicitly in the SQL
     */
    async run(sql, params = []) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(sql, params);
            
            return {
                lastID: result.rows[0]?.id || null,
                changes: result.rowCount || 0,
                rows: result.rows
            };
        } finally {
            client.release();
        }
    }

    /**
     * Begin transaction
     */
    async beginTransaction() {
        const client = await this.pool.connect();
        await client.query('BEGIN');
        
        // Return a transaction object with the client
        return {
            client,
            async query(sql, params = []) {
                const result = await client.query(sql, params);
                return result.rows;
            },
            async get(sql, params = []) {
                const result = await client.query(sql, params);
                return result.rows[0] || null;
            },
            async run(sql, params = []) {
                const result = await client.query(sql, params);
                return {
                    lastID: result.rows[0]?.id || null,
                    changes: result.rowCount || 0,
                    rows: result.rows
                };
            },
            async commit() {
                await client.query('COMMIT');
                client.release();
            },
            async rollback() {
                await client.query('ROLLBACK');
                client.release();
            }
        };
    }

    /**
     * Commit transaction (for non-transaction object usage)
     */
    async commit() {
        const client = await this.pool.connect();
        try {
            await client.query('COMMIT');
        } finally {
            client.release();
        }
    }

    /**
     * Rollback transaction (for non-transaction object usage)
     */
    async rollback() {
        const client = await this.pool.connect();
        try {
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    }

    /**
     * Close all database connections
     */
    async close() {
        if (this.pool) {
            await this.pool.end();
        }
    }
}

module.exports = {
    PostgreSQLDatabase,
    pool
};