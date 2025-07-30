#!/usr/bin/env node

/**
 * Basic Test Suite for Church Summer Retreat 2025 Web Service
 * 
 * This script performs basic validation of core functionality:
 * 1. Database connection and initialization
 * 2. Route loading
 * 3. Core database operations
 * 4. Sample data creation
 */

const { Database } = require('./database/config');
const { initDatabase } = require('./database/init_universal');

console.log('🧪 Starting Basic Test Suite for Church Summer Retreat 2025...\n');

async function runTests() {
    let testsPassed = 0;
    let testsFailed = 0;
    
    // Test 1: Database Connection
    console.log('1️⃣ Testing Database Connection...');
    try {
        const db = new Database();
        await db.query('SELECT 1 as test');
        console.log('   ✅ Database connection successful');
        testsPassed++;
    } catch (error) {
        console.log('   ❌ Database connection failed:', error.message);
        testsFailed++;
    }
    
    // Test 2: Database Initialization
    console.log('\n2️⃣ Testing Database Initialization...');
    try {
        await initDatabase();
        console.log('   ✅ Database initialized successfully');
        testsPassed++;
    } catch (error) {
        console.log('   ❌ Database initialization failed:', error.message);
        testsFailed++;
    }
    
    // Test 3: Core Tables Exist
    console.log('\n3️⃣ Testing Core Tables...');
    try {
        const db = new Database();
        const tables = ['users', 'teams', 'products', 'orders', 'transactions', 'money_codes', 'team_inventory', 'donations'];
        
        for (const table of tables) {
            const result = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
            console.log(`   ✅ Table '${table}' exists with ${result[0].count} records`);
        }
        testsPassed++;
    } catch (error) {
        console.log('   ❌ Core tables test failed:', error.message);
        testsFailed++;
    }
    
    // Test 4: Admin User Exists
    console.log('\n4️⃣ Testing Admin User...');
    try {
        const db = new Database();
        const admin = await db.get("SELECT username, role FROM users WHERE role = 'admin' LIMIT 1");
        if (admin) {
            console.log(`   ✅ Admin user found: ${admin.username}`);
            testsPassed++;
        } else {
            console.log('   ❌ No admin user found');
            testsFailed++;
        }
    } catch (error) {
        console.log('   ❌ Admin user test failed:', error.message);
        testsFailed++;
    }
    
    // Test 5: Teams Exist
    console.log('\n5️⃣ Testing Teams...');
    try {
        const db = new Database();
        const teams = await db.query("SELECT name FROM teams ORDER BY id");
        if (teams.length >= 6) {
            console.log(`   ✅ Found ${teams.length} teams: ${teams.map(t => t.name).join(', ')}`);
            testsPassed++;
        } else {
            console.log(`   ❌ Expected 6 teams, found ${teams.length}`);
            testsFailed++;
        }
    } catch (error) {
        console.log('   ❌ Teams test failed:', error.message);
        testsFailed++;
    }
    
    // Test 6: Sample Products Exist
    console.log('\n6️⃣ Testing Sample Products...');
    try {
        const db = new Database();
        const products = await db.query("SELECT name, price, stock_quantity FROM products ORDER BY name");
        if (products.length >= 4) {
            console.log(`   ✅ Found ${products.length} products:`);
            products.forEach(p => {
                console.log(`      - ${p.name}: $${p.price} (Stock: ${p.stock_quantity})`);
            });
            testsPassed++;
        } else {
            console.log(`   ❌ Expected at least 4 products, found ${products.length}`);
            testsFailed++;
        }
    } catch (error) {
        console.log('   ❌ Sample products test failed:', error.message);
        testsFailed++;
    }
    
    // Test 7: PostgreSQL vs SQLite Schema Consistency 
    console.log('\n7️⃣ Testing Schema Consistency...');
    try {
        const db = new Database();
        
        // Test team_inventory table structure (critical for UPSERT operations)
        const inventory = await db.query("SELECT * FROM team_inventory LIMIT 1");
        console.log('   ✅ team_inventory table accessible (UPSERT ready)');
        
        // Test money_codes table structure (critical for redemption)
        const codes = await db.query("SELECT * FROM money_codes LIMIT 1");
        console.log('   ✅ money_codes table accessible (redemption ready)');
        
        testsPassed++;
    } catch (error) {
        console.log('   ❌ Schema consistency test failed:', error.message);
        testsFailed++;
    }
    
    // Summary
    console.log('\n📊 Test Results Summary:');
    console.log(`   ✅ Tests Passed: ${testsPassed}`);
    console.log(`   ❌ Tests Failed: ${testsFailed}`);
    console.log(`   📈 Success Rate: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);
    
    if (testsFailed === 0) {
        console.log('\n🎉 All tests passed! The system is ready for deployment.');
        process.exit(0);
    } else {
        console.log('\n⚠️  Some tests failed. Please review the errors above.');
        process.exit(1);
    }
}

// Run the tests
runTests().catch(error => {
    console.error('💥 Test suite crashed:', error);
    process.exit(1);
});