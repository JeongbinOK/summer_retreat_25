// Universal database initialization for both SQLite (development) and PostgreSQL (production)
const bcrypt = require('bcrypt');
const { Database, isProduction, rawDb } = require('./config');
const fs = require('fs');
const path = require('path');

// Format date helper function (same format as used in EJS templates)
function formatDate(dateString) {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

class UniversalDatabase {
    constructor() {
        this.db = new Database();
    }

    async initializeDatabase() {
        try {
            if (isProduction && process.env.DATABASE_URL) {
                await this.initializePostgreSQL();
            } else {
                await this.initializeSQLite();
            }
            
            await this.createInitialData();
            console.log('✅ Database initialized successfully');
            return this.db;
        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            throw error;
        }
    }

    async initializePostgreSQL() {
        console.log('🔧 Initializing PostgreSQL database...');
        
        // Read and execute PostgreSQL schema
        const schemaPath = path.join(__dirname, 'postgres_init.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        // Split by semicolon and execute each statement
        const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);
        
        for (const statement of statements) {
            try {
                await this.db.query(statement.trim());
            } catch (error) {
                // Ignore "already exists" errors
                if (!error.message.includes('already exists') && 
                    !error.message.includes('duplicate key') &&
                    !error.message.includes('ON CONFLICT')) {
                    console.warn('PostgreSQL statement warning:', error.message);
                }
            }
        }
    }

    async initializeSQLite() {
        console.log('🔧 Initializing SQLite database...');
        
        // Create all tables
        const tables = [
            // Users table
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'participant',
                team_id INTEGER,
                balance INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Teams table
            `CREATE TABLE IF NOT EXISTS teams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                leader_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (leader_id) REFERENCES users (id)
            )`,
            
            // Products table
            `CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                price INTEGER NOT NULL,
                category TEXT DEFAULT 'item',
                is_active BOOLEAN DEFAULT 1,
                stock_quantity INTEGER DEFAULT 0,
                initial_stock INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Transactions table
            `CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                amount INTEGER NOT NULL,
                description TEXT,
                reference_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,
            
            // Orders table
            `CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                team_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                quantity INTEGER DEFAULT 1,
                total_price INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                verified BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (team_id) REFERENCES teams (id),
                FOREIGN KEY (product_id) REFERENCES products (id)
            )`,
            
            // Money codes table
            `CREATE TABLE IF NOT EXISTS money_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                amount INTEGER NOT NULL,
                used BOOLEAN DEFAULT 0,
                used_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                used_at DATETIME,
                FOREIGN KEY (used_by) REFERENCES users (id)
            )`,
            
            // Team inventory table
            `CREATE TABLE IF NOT EXISTS team_inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                team_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                obtained_from TEXT DEFAULT 'purchase',
                obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                reference_id INTEGER,
                FOREIGN KEY (team_id) REFERENCES teams (id),
                FOREIGN KEY (product_id) REFERENCES products (id)
            )`,
            
            // Donations table (updated schema)
            `CREATE TABLE IF NOT EXISTS donations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                donor_id INTEGER NOT NULL,
                recipient_id INTEGER,
                donor_team_id INTEGER NOT NULL,
                recipient_team_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (donor_id) REFERENCES users (id),
                FOREIGN KEY (recipient_id) REFERENCES users (id),
                FOREIGN KEY (donor_team_id) REFERENCES teams (id),
                FOREIGN KEY (recipient_team_id) REFERENCES teams (id),
                FOREIGN KEY (product_id) REFERENCES products (id)
            )`
        ];

        for (const table of tables) {
            await this.db.run(table);
        }

        // Add new columns if they don't exist (SQLite migration)
        const migrations = [
            "ALTER TABLE products ADD COLUMN stock_quantity INTEGER DEFAULT 0",
            "ALTER TABLE products ADD COLUMN initial_stock INTEGER DEFAULT 0",
            "ALTER TABLE donations ADD COLUMN donor_team_id INTEGER",
            "ALTER TABLE donations ADD COLUMN recipient_team_id INTEGER", 
            "ALTER TABLE donations ADD COLUMN quantity INTEGER DEFAULT 1"
        ];

        for (const migration of migrations) {
            try {
                await this.db.run(migration);
            } catch (error) {
                // Ignore "duplicate column" errors
                if (!error.message.includes('duplicate column name')) {
                    console.warn('Migration warning:', error.message);
                }
            }
        }
    }

    async createInitialData() {
        console.log('📝 Creating initial data...');
        
        try {
            // Create or update admin user
            const adminPassword = await bcrypt.hash('akftmaryghl', 10);
            
            if (isProduction) {
                // PostgreSQL: Use ON CONFLICT for upsert
                await this.db.query(`
                    INSERT INTO users (username, password_hash, role, balance) 
                    VALUES ($1, $2, 'admin', 0)
                    ON CONFLICT (username) 
                    DO UPDATE SET password_hash = $2
                `, ['admin', adminPassword]);
            } else {
                // SQLite: Use INSERT OR REPLACE
                await this.db.run(`
                    INSERT OR REPLACE INTO users (id, username, password_hash, role, balance, created_at) 
                    VALUES (
                        (SELECT id FROM users WHERE username = 'admin'), 
                        'admin', 
                        ?, 
                        'admin', 
                        COALESCE((SELECT balance FROM users WHERE username = 'admin'), 0),
                        COALESCE((SELECT created_at FROM users WHERE username = 'admin'), CURRENT_TIMESTAMP)
                    )
                `, [adminPassword]);
            }

            // Create sample teams (Korean names)
            const teams = ['A그룹', 'B그룹', 'C그룹', 'D그룹', 'E그룹', 'F그룹'];
            
            for (let i = 0; i < teams.length; i++) {
                const teamName = teams[i];
                const teamId = i + 1;
                
                if (isProduction) {
                    // PostgreSQL
                    await this.db.query(`
                        INSERT INTO teams (name) VALUES ($1)
                        ON CONFLICT DO NOTHING
                    `, [teamName]);
                } else {
                    // SQLite
                    await this.db.run(`
                        INSERT OR IGNORE INTO teams (id, name) VALUES (?, ?)
                    `, [teamId, teamName]);
                }
            }

            // Create sample products
            await this.createSampleProducts();
            
            console.log('👤 Admin password updated in init.js');
            
        } catch (error) {
            console.error('Error creating initial data:', error);
            throw error;
        }
    }

    async createSampleProducts() {
        const sampleProducts = [
            { name: 'Coffee', description: 'Hot coffee from cafe', price: 500, category: 'beverage', stock: 20 },
            { name: 'Snacks', description: 'Assorted snacks', price: 300, category: 'food', stock: 15 },
            { name: 'Prayer Request', description: 'Personal prayer service', price: 200, category: 'service', stock: 999 },
            { name: 'Souvenir', description: 'Retreat souvenir item', price: 1000, category: 'item', stock: 10 }
        ];

        for (const product of sampleProducts) {
            try {
                // Check if product already exists
                const existing = await this.db.get(
                    'SELECT id FROM products WHERE name = ?', 
                    [product.name]
                );

                if (!existing) {
                    await this.db.run(`
                        INSERT INTO products (name, description, price, category, stock_quantity, initial_stock) 
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [product.name, product.description, product.price, product.category, product.stock, product.stock]);
                }
            } catch (error) {
                console.warn(`Warning creating sample product ${product.name}:`, error.message);
            }
        }
    }

    // Helper method to close database connection
    close() {
        this.db.close();
    }
}

// Export singleton instance and helper functions
const universalDb = new UniversalDatabase();

module.exports = {
    UniversalDatabase,
    universalDb,
    formatDate,
    initDatabase: () => universalDb.initializeDatabase(),
    createInitialData: () => universalDb.createInitialData()
};