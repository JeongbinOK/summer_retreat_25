// PostgreSQL-only database initialization for Church Summer Retreat 2025
const bcrypt = require('bcrypt');
const { PostgreSQLDatabase } = require('./postgres');
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

class PostgreSQLInitializer {
    constructor() {
        this.db = new PostgreSQLDatabase();
    }

    async initializeDatabase() {
        try {
            console.log('🔧 Initializing PostgreSQL database for Church Summer Retreat 2025...');
            
            await this.createSchema();
            await this.createInitialData();
            
            console.log('✅ PostgreSQL database initialized successfully');
            return this.db;
        } catch (error) {
            console.error('❌ PostgreSQL database initialization failed:', error);
            throw error;
        }
    }

    async createSchema() {
        console.log('🔧 Creating PostgreSQL schema...');
        
        // Read and execute PostgreSQL schema
        const schemaPath = path.join(__dirname, 'postgres_init.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        // Split by semicolon and execute each statement
        const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);
        
        for (const statement of statements) {
            const cleanStatement = statement.trim();
            if (cleanStatement.length === 0) continue;
            
            // Skip INSERT statements - they will be handled by createInitialData()
            if (cleanStatement.toLowerCase().startsWith('insert')) {
                console.log('⚠️ Skipping INSERT statement (handled by createInitialData):', cleanStatement.substring(0, 50) + '...');
                continue;
            }
            
            try {
                await this.db.query(cleanStatement);
                console.log('✅ Executed:', cleanStatement.substring(0, 50) + '...');
            } catch (error) {
                // Ignore specific expected errors
                if (error.message.includes('already exists') || 
                    error.message.includes('duplicate key') ||
                    error.message.includes('ON CONFLICT') ||
                    error.message.includes('constraint') ||
                    error.code === '42P07' || // relation already exists
                    error.code === '23505' || // unique violation
                    error.code === '42710') { // object already exists
                    console.log('⚠️ Skipped (already exists):', cleanStatement.substring(0, 50) + '...');
                } else {
                    console.error('❌ SQL Error:', error.message);
                    console.error('📝 Statement:', cleanStatement.substring(0, 100));
                    throw error; // Re-throw unexpected errors
                }
            }
        }
    }

    async createInitialData() {
        console.log('📝 Creating initial data...');
        
        // 🔍 TEST: Check if existing data exists before initialization
        try {
            const existingUsers = await this.db.query('SELECT COUNT(*) as count FROM users');
            const existingTeams = await this.db.query('SELECT COUNT(*) as count FROM teams'); 
            
            console.log('🔍 EXISTING DATA CHECK:');
            console.log(`   Users: ${existingUsers[0]?.count || 0}`);
            console.log(`   Teams: ${existingTeams[0]?.count || 0}`);
            
            if ((existingUsers[0]?.count || 0) > 1) { // More than just admin
                console.log('✅ EXISTING USER DATA FOUND - Preserving data');
            }
        } catch (error) {
            console.log('⚠️ Could not check existing data (tables may not exist yet)');
        }
        
        try {
            // Create or update admin user (password: akftmaryghl)
            const adminPassword = await bcrypt.hash('akftmaryghl', 10);
            
            // PostgreSQL: Use ON CONFLICT for upsert - DON'T UPDATE PASSWORD IF EXISTS
            try {
                await this.db.query(`
                    INSERT INTO users (username, password_hash, role, balance) 
                    VALUES ($1, $2, 'admin', 0)
                    ON CONFLICT (username) 
                    DO NOTHING
                `, ['admin', adminPassword]);
                console.log('✅ Admin user ensured (password preserved if existed)');
            } catch (error) {
                console.error('❌ Error creating admin user:', error.message);
                throw error;
            }

            // Create sample teams (Korean names) - Only if less than 6 teams exist
            const existingTeamCount = (await this.db.query('SELECT COUNT(*) as count FROM teams'))[0]?.count || 0;
            
            if (existingTeamCount < 6) {
                console.log(`📋 Creating teams (current: ${existingTeamCount}, needed: 6)`);
                const teams = ['A그룹', 'B그룹', 'C그룹', 'D그룹', 'E그룹', 'Z그룹'];
                
                for (const teamName of teams) {
                    try {
                        await this.db.query(`
                            INSERT INTO teams (name) VALUES ($1)
                            ON CONFLICT (name) DO NOTHING
                        `, [teamName]);
                        console.log(`✅ Team '${teamName}' ensured`);
                    } catch (error) {
                        console.warn(`Warning creating team ${teamName}:`, error.message);
                    }
                }
            } else {
                console.log(`✅ Teams already exist (${existingTeamCount}), skipping creation`);
            }

            // 🚫 NO INITIAL PRODUCTS - Empty products table as requested
            console.log('🚫 No initial products created - products table will be empty');
            
            console.log('👤 Admin user ready with password: akftmaryghl');
            
        } catch (error) {
            console.error('Error creating initial data:', error);
            throw error;
        }
    }

    // Helper method to close database connection
    close() {
        this.db.close();
    }
}

// Export singleton instance and helper functions
const postgresInitializer = new PostgreSQLInitializer();

module.exports = {
    PostgreSQLInitializer,
    postgresInitializer,
    formatDate,
    initDatabase: () => postgresInitializer.initializeDatabase()
};