#!/usr/bin/env node

/**
 * Functional Test Suite for Church Summer Retreat 2025 Web Service
 * 
 * This script tests specific functionality scenarios:
 * 1. User creation and team assignment
 * 2. Money code generation and redemption
 * 3. Product purchase (including consecutive purchases)
 * 4. Donation system with messages
 * 5. Team inventory management
 */

const { Database } = require('./database/config');
const bcrypt = require('bcrypt');

console.log('🧪 Starting Functional Test Suite for Church Summer Retreat 2025...\n');

async function runFunctionalTests() {
    let testsPassed = 0;
    let testsFailed = 0;
    
    const db = new Database();
    
    // Test 1: Create Test Users and Assign to Teams
    console.log('1️⃣ Testing User Creation and Team Assignment...');
    try {
        // Create team leader for A그룹 (Team ID 1)
        const leaderPassword = await bcrypt.hash('testpass', 10);
        const leaderResult = await db.run(
            'INSERT INTO users (username, password_hash, role, team_id, balance) VALUES (?, ?, ?, ?, ?)',
            ['test_leader_a', leaderPassword, 'team_leader', 1, 2000]
        );
        const leaderId = leaderResult.lastID;
        
        // Update team leadership
        await db.run('UPDATE teams SET leader_id = ? WHERE id = ?', [leaderId, 1]);
        
        // Create regular participant for B그룹 (Team ID 2)
        const participantPassword = await bcrypt.hash('testpass', 10);
        await db.run(
            'INSERT INTO users (username, password_hash, role, team_id, balance) VALUES (?, ?, ?, ?, ?)',
            ['test_participant_b', participantPassword, 'participant', 2, 1000]
        );
        
        console.log('   ✅ Test users created successfully');
        testsPassed++;
    } catch (error) {
        console.log('   ❌ User creation failed:', error.message);
        testsFailed++;
    }
    
    // Test 2: Money Code Generation and Redemption
    console.log('\n2️⃣ Testing Money Code System...');
    try {
        // Generate money code
        const code = 'TEST' + Date.now();
        await db.run('INSERT INTO money_codes (code, amount) VALUES (?, ?)', [code, 500]);
        
        // Redeem money code
        const leader = await db.get('SELECT * FROM users WHERE username = ?', ['test_leader_a']);
        await db.run('UPDATE money_codes SET used_by = ?, used_at = ? WHERE code = ?', 
            [leader.id, new Date().toISOString(), code]);
        await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [500, leader.id]);
        await db.run('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
            [leader.id, 'earn', 500, `Redeemed code: ${code}`]);
        
        // Verify redemption
        const redeemedCode = await db.get('SELECT * FROM money_codes WHERE code = ?', [code]);
        if (redeemedCode.used_by === leader.id) {
            console.log('   ✅ Money code generation and redemption successful');
            testsPassed++;
        } else {
            console.log('   ❌ Money code redemption failed');
            testsFailed++;
        }
    } catch (error) {
        console.log('   ❌ Money code system test failed:', error.message);
        testsFailed++;
    }
    
    // Test 3: Product Purchase (Including Consecutive Purchases)
    console.log('\n3️⃣ Testing Product Purchase System...');
    try {
        const leader = await db.get('SELECT * FROM users WHERE username = ?', ['test_leader_a']);
        const coffee = await db.get('SELECT * FROM products WHERE name = ?', ['Coffee']);
        
        // First purchase
        await db.beginTransaction();
        const order1 = await db.run(
            'INSERT INTO orders (user_id, team_id, product_id, quantity, total_price, status) VALUES (?, ?, ?, ?, ?, ?)',
            [leader.id, leader.team_id, coffee.id, 1, coffee.price, 'pending']
        );
        await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [coffee.price, leader.id]);
        await db.run('INSERT INTO transactions (user_id, type, amount, description, reference_id) VALUES (?, ?, ?, ?, ?)',
            [leader.id, 'purchase', -coffee.price, `Purchased ${coffee.name} x1`, order1.lastID]);
        
        // Add to team inventory (UPSERT test)
        if (db.isPostgres) {
            await db.run(`INSERT INTO team_inventory (team_id, product_id, quantity, obtained_from, reference_id, created_at) 
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (team_id, product_id) 
                DO UPDATE SET quantity = team_inventory.quantity + EXCLUDED.quantity`,
                [leader.team_id, coffee.id, 1, 'purchase', order1.lastID]);
        } else {
            await db.run(`INSERT OR REPLACE INTO team_inventory (team_id, product_id, quantity, obtained_from, reference_id) 
                VALUES (?, ?, 
                    COALESCE((SELECT quantity FROM team_inventory WHERE team_id = ? AND product_id = ?), 0) + ?, 
                    ?, ?)`,
                [leader.team_id, coffee.id, leader.team_id, coffee.id, 1, 'purchase', order1.lastID]);
        }
        await db.commit();
        
        // Second purchase (test consecutive purchases)
        await db.beginTransaction();
        const order2 = await db.run(
            'INSERT INTO orders (user_id, team_id, product_id, quantity, total_price, status) VALUES (?, ?, ?, ?, ?, ?)',
            [leader.id, leader.team_id, coffee.id, 2, coffee.price * 2, 'pending']
        );
        await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [coffee.price * 2, leader.id]);
        await db.run('INSERT INTO transactions (user_id, type, amount, description, reference_id) VALUES (?, ?, ?, ?, ?)',
            [leader.id, 'purchase', -coffee.price * 2, `Purchased ${coffee.name} x2`, order2.lastID]);
        
        // Add to team inventory (UPSERT test for existing product)
        if (db.isPostgres) {
            await db.run(`INSERT INTO team_inventory (team_id, product_id, quantity, obtained_from, reference_id, created_at) 
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (team_id, product_id) 
                DO UPDATE SET quantity = team_inventory.quantity + EXCLUDED.quantity`,
                [leader.team_id, coffee.id, 2, 'purchase', order2.lastID]);
        } else {
            await db.run(`INSERT OR REPLACE INTO team_inventory (team_id, product_id, quantity, obtained_from, reference_id) 
                VALUES (?, ?, 
                    COALESCE((SELECT quantity FROM team_inventory WHERE team_id = ? AND product_id = ?), 0) + ?, 
                    ?, ?)`,
                [leader.team_id, coffee.id, leader.team_id, coffee.id, 2, 'purchase', order2.lastID]);
        }
        await db.commit();
        
        // Verify inventory
        const inventory = await db.get('SELECT quantity FROM team_inventory WHERE team_id = ? AND product_id = ?', 
            [leader.team_id, coffee.id]);
        
        if (inventory && inventory.quantity === 3) {
            console.log('   ✅ Product purchase system (including consecutive purchases) successful');
            testsPassed++;
        } else {
            console.log(`   ❌ Product purchase failed - expected 3 coffee, got ${inventory ? inventory.quantity : 0}`);
            testsFailed++;
        }
    } catch (error) {
        await db.rollback();
        console.log('   ❌ Product purchase system test failed:', error.message);
        testsFailed++;
    }
    
    // Test 4: Donation System with Messages
    console.log('\n4️⃣ Testing Donation System...');
    try {
        const leader = await db.get('SELECT * FROM users WHERE username = ?', ['test_leader_a']);
        const snacks = await db.get('SELECT * FROM products WHERE name = ?', ['Snacks']);
        const recipientTeam = 2; // B그룹
        const message = "Hope you enjoy these snacks! 😊";
        
        await db.beginTransaction();
        
        // Deduct money from donor
        await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [snacks.price, leader.id]);
        
        // Add to recipient team inventory (UPSERT)
        if (db.isPostgres) {
            await db.run(`INSERT INTO team_inventory (team_id, product_id, quantity, obtained_from, reference_id, created_at) 
                VALUES (?, ?, ?, 'donation', ?, CURRENT_TIMESTAMP)
                ON CONFLICT (team_id, product_id) 
                DO UPDATE SET quantity = team_inventory.quantity + EXCLUDED.quantity`,
                [recipientTeam, snacks.id, 1, 0]);
        } else {
            await db.run(`INSERT OR REPLACE INTO team_inventory (team_id, product_id, quantity, obtained_from, reference_id) 
                VALUES (?, ?, COALESCE((SELECT quantity FROM team_inventory WHERE team_id = ? AND product_id = ?), 0) + ?, 'donation', ?)`,
                [recipientTeam, snacks.id, recipientTeam, snacks.id, 1, 0]);
        }
        
        // Create donation record
        const donation = await db.run(
            'INSERT INTO donations (donor_id, product_id, amount, quantity, message, donor_team_id, recipient_team_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [leader.id, snacks.id, snacks.price, 1, message, leader.team_id, recipientTeam]
        );
        
        // Record transactions
        await db.run('INSERT INTO transactions (user_id, type, amount, description, reference_id) VALUES (?, ?, ?, ?, ?)',
            [leader.id, 'donation_sent', -snacks.price, `Donated ${snacks.name} to B그룹`, donation.lastID]);
        
        await db.commit();
        
        // Verify donation
        const donationRecord = await db.get('SELECT * FROM donations WHERE id = ?', [donation.lastID]);
        const recipientInventory = await db.get('SELECT quantity FROM team_inventory WHERE team_id = ? AND product_id = ?', 
            [recipientTeam, snacks.id]);
        
        if (donationRecord.message === message && recipientInventory.quantity >= 1) {
            console.log('   ✅ Donation system with messages successful');
            testsPassed++;
        } else {
            console.log('   ❌ Donation system test failed');
            testsFailed++;
        }
    } catch (error) {
        await db.rollback();
        console.log('   ❌ Donation system test failed:', error.message);
        testsFailed++;
    }
    
    // Test 5: Team Inventory Query (PostgreSQL compatibility)
    console.log('\n5️⃣ Testing Team Inventory Query...');
    try {
        // Test the complex query that was causing issues
        const inventory = await db.query(`SELECT 
                ti.product_id,
                p.name as product_name,
                p.description,
                p.price,
                p.category,
                SUM(ti.quantity) as total_quantity,
                COUNT(DISTINCT ti.id) as entries_count,
                MAX(ti.created_at) as last_obtained
            FROM team_inventory ti
            JOIN products p ON ti.product_id = p.id
            WHERE ti.team_id = ? AND ti.quantity > 0
            GROUP BY ti.product_id, p.name, p.description, p.price, p.category
            ORDER BY p.category, p.name`, [1]);
        
        if (inventory.length >= 1) {
            console.log(`   ✅ Team inventory query successful - found ${inventory.length} product types`);
            inventory.forEach(item => {
                console.log(`      - ${item.product_name}: ${item.total_quantity} items`);
            });
            testsPassed++;
        } else {
            console.log('   ❌ Team inventory query returned no results');
            testsFailed++;
        }
    } catch (error) {
        console.log('   ❌ Team inventory query test failed:', error.message);
        testsFailed++;
    }
    
    // Clean up test data
    console.log('\n🧹 Cleaning up test data...');
    try {
        await db.run('DELETE FROM team_inventory WHERE team_id IN (1, 2)');
        await db.run('DELETE FROM donations WHERE donor_team_id = 1 OR recipient_team_id = 2');
        await db.run('DELETE FROM transactions WHERE user_id IN (SELECT id FROM users WHERE username LIKE "test_%")');
        await db.run('DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE username LIKE "test_%")');
        await db.run('DELETE FROM money_codes WHERE code LIKE "TEST%"');
        await db.run('UPDATE teams SET leader_id = NULL WHERE id = 1');
        await db.run('DELETE FROM users WHERE username LIKE "test_%"');
        console.log('   ✅ Test data cleaned up');
    } catch (error) {
        console.log('   ⚠️  Cleanup warning:', error.message);
    }
    
    // Summary
    console.log('\n📊 Functional Test Results Summary:');
    console.log(`   ✅ Tests Passed: ${testsPassed}`);
    console.log(`   ❌ Tests Failed: ${testsFailed}`);
    console.log(`   📈 Success Rate: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);
    
    if (testsFailed === 0) {
        console.log('\n🎉 All functional tests passed! Core features are working correctly.');
        process.exit(0);
    } else {
        console.log('\n⚠️  Some functional tests failed. Please review the errors above.');
        process.exit(1);
    }
}

// Run the functional tests
runFunctionalTests().catch(error => {
    console.error('💥 Functional test suite crashed:', error);
    process.exit(1);
});