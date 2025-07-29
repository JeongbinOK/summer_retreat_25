const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

// Ensure database directory exists
const dbDir = __dirname;
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(__dirname, 'retreat.db');

function initDatabase() {
    const db = new sqlite3.Database(dbPath);
    
    db.serialize(() => {
        // Users table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'participant',
            team_id INTEGER,
            balance INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        // Teams table
        db.run(`CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            leader_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (leader_id) REFERENCES users (id)
        )`);
        
        // Products/Services table
        db.run(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            price INTEGER NOT NULL,
            category TEXT DEFAULT 'item',
            is_active BOOLEAN DEFAULT 1,
            stock_quantity INTEGER DEFAULT 0,
            initial_stock INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        // Transactions table
        db.run(`CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            amount INTEGER NOT NULL,
            description TEXT,
            reference_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);
        
        // Orders table
        db.run(`CREATE TABLE IF NOT EXISTS orders (
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
        )`);
        
        // Donations table
        db.run(`CREATE TABLE IF NOT EXISTS donations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            donor_id INTEGER NOT NULL,
            recipient_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            message TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (donor_id) REFERENCES users (id),
            FOREIGN KEY (recipient_id) REFERENCES users (id),
            FOREIGN KEY (product_id) REFERENCES products (id)
        )`);
        
        // Money codes table (for admin to distribute money)
        db.run(`CREATE TABLE IF NOT EXISTS money_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            amount INTEGER NOT NULL,
            used BOOLEAN DEFAULT 0,
            used_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            used_at DATETIME,
            FOREIGN KEY (used_by) REFERENCES users (id)
        )`);
        
        // Team inventory table (tracks items owned by teams)
        db.run(`CREATE TABLE IF NOT EXISTS team_inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            obtained_from TEXT DEFAULT 'purchase',
            obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            reference_id INTEGER,
            FOREIGN KEY (team_id) REFERENCES teams (id),
            FOREIGN KEY (product_id) REFERENCES products (id)
        )`);
    });
    
    return db;
}

// Create initial admin user and sample data
async function createInitialData() {
    const db = initDatabase();
    
    return new Promise((resolve, reject) => {
        db.serialize(async () => {
            try {
                // Create admin user
                const adminPassword = await bcrypt.hash('admin123', 10);
                db.run(`INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
                    ['admin', adminPassword, 'admin']);
                
                // Create sample teams
                const teams = [
                    'A그룹', 'B그룹', 'C그룹', 
                    'D그룹', 'E그룹', 'F그룹'
                ];
                
                teams.forEach((teamName, index) => {
                    db.run(`INSERT OR IGNORE INTO teams (id, name) VALUES (?, ?)`,
                        [index + 1, teamName]);
                });
                
                // Add stock columns to existing products if they don't exist
                db.serialize(() => {
                    db.run(`ALTER TABLE products ADD COLUMN stock_quantity INTEGER DEFAULT 0`, (err) => {
                        if (err && !err.message.includes('duplicate column name')) {
                            console.log('Error adding stock_quantity column:', err.message);
                        }
                    });
                    
                    db.run(`ALTER TABLE products ADD COLUMN initial_stock INTEGER DEFAULT 0`, (err) => {
                        if (err && !err.message.includes('duplicate column name')) {
                            console.log('Error adding initial_stock column:', err.message);
                        }
                    });
                    
                    // Add team columns to donations table for team-based donations
                    db.run(`ALTER TABLE donations ADD COLUMN donor_team_id INTEGER`, (err) => {
                        if (err && !err.message.includes('duplicate column name')) {
                            console.log('Error adding donor_team_id column:', err.message);
                        }
                    });
                    
                    db.run(`ALTER TABLE donations ADD COLUMN recipient_team_id INTEGER`, (err) => {
                        if (err && !err.message.includes('duplicate column name')) {
                            console.log('Error adding recipient_team_id column:', err.message);
                        }
                    });
                    
                    db.run(`ALTER TABLE donations ADD COLUMN quantity INTEGER DEFAULT 1`, (err) => {
                        if (err && !err.message.includes('duplicate column name')) {
                            console.log('Error adding quantity column to donations:', err.message);
                        }
                        
                        // Create sample products with stock after columns are added
                        createSampleProducts(db);
                        
                        console.log('Database initialized successfully');
                        resolve(db);
                    });
                });
            } catch (error) {
                reject(error);
            }
        });
    });
}

function createSampleProducts(db) {
    const sampleProducts = [
        { name: 'Coffee', description: 'Hot coffee from cafe', price: 500, category: 'beverage', stock: 20 },
        { name: 'Snacks', description: 'Assorted snacks', price: 300, category: 'food', stock: 15 },
        { name: 'Prayer Request', description: 'Personal prayer service', price: 200, category: 'service', stock: 999 }, // Unlimited service
        { name: 'Souvenir', description: 'Retreat souvenir item', price: 1000, category: 'item', stock: 10 }
    ];
    
    // Check if products already exist to prevent duplicates
    sampleProducts.forEach(product => {
        db.get('SELECT id FROM products WHERE name = ?', [product.name], (err, existingProduct) => {
            if (err) {
                console.log('Error checking for existing product:', err.message);
                return;
            }
            
            // Only insert if product doesn't exist
            if (!existingProduct) {
                db.run(`INSERT INTO products (name, description, price, category, stock_quantity, initial_stock) VALUES (?, ?, ?, ?, ?, ?)`,
                    [product.name, product.description, product.price, product.category, product.stock, product.stock],
                    (err) => {
                        if (err) {
                            console.log(`Error creating sample product ${product.name}:`, err.message);
                        }
                    });
            }
        });
    });
}

module.exports = { initDatabase, createInitialData };