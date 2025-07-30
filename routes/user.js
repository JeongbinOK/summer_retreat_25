const express = require('express');
const { PostgreSQLDatabase } = require('../database/postgres');

const router = express.Router();

// User Dashboard
router.get('/dashboard', async (req, res) => {
    const db = new PostgreSQLDatabase();
    
    try {
        // Get updated user balance
        const user = await db.get('SELECT balance FROM users WHERE id = $1', [req.session.user.id]);
        
        if (!user) {
            return res.status(500).send('User not found');
        }
        
        // Update session balance
        req.session.user.balance = user.balance;
        
        // Get team transactions for team members, personal for admins
        let transactionQuery, transactionParams;
        
        if (req.session.user.role === 'admin') {
            // Admins see their personal transactions
            transactionQuery = `SELECT t.*, u.username 
                               FROM transactions t
                               JOIN users u ON t.user_id = u.id
                               WHERE t.user_id = $1 
                               ORDER BY t.created_at DESC 
                               LIMIT 10`;
            transactionParams = [req.session.user.id];
        } else if (req.session.user.team_id) {
            // Team members see team transactions
            transactionQuery = `SELECT t.*, u.username 
                               FROM transactions t
                               JOIN users u ON t.user_id = u.id
                               WHERE u.team_id = $1 
                               ORDER BY t.created_at DESC 
                               LIMIT 20`;
            transactionParams = [req.session.user.team_id];
        } else {
            // Users without teams see their personal transactions
            transactionQuery = `SELECT t.*, u.username 
                               FROM transactions t
                               JOIN users u ON t.user_id = u.id
                               WHERE t.user_id = $1 
                               ORDER BY t.created_at DESC 
                               LIMIT 10`;
            transactionParams = [req.session.user.id];
        }
        
        const transactions = await db.query(transactionQuery, transactionParams);
        
        res.render('user/dashboard', { 
            user: req.session.user, 
            transactions 
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        return res.status(500).send('Database error');
    }
});

// Redeem Money Code - Team leaders only
router.post('/redeem-code', async (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: 'Code required' });
    }
    
    // Check if user is team leader or admin
    if (req.session.user.role !== 'team_leader' && req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only team leaders can redeem money codes' });
    }
    
    const db = new PostgreSQLDatabase();
    
    try {
        const transaction = await db.beginTransaction();
        
        const moneyCode = await transaction.get('SELECT * FROM money_codes WHERE code = $1 AND used_by IS NULL', [code]);
        
        if (!moneyCode) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Invalid or already used code' });
        }
        
        // Mark code as used
        const now = new Date().toISOString();
        await transaction.run('UPDATE money_codes SET used_by = $1, used_at = $2 WHERE id = $3',
            [req.session.user.id, now, moneyCode.id]);
        
        // Add money to user balance
        await transaction.run('UPDATE users SET balance = balance + $1 WHERE id = $2',
            [moneyCode.amount, req.session.user.id]);
        
        // Record transaction
        await transaction.run('INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)',
            [req.session.user.id, 'earn', moneyCode.amount, `Redeemed code: ${code}`]);
        
        await transaction.commit();
        
        // Update session balance
        req.session.user.balance += moneyCode.amount;
        
        res.json({ 
            success: true, 
            amount: moneyCode.amount,
            newBalance: req.session.user.balance
        });
    } catch (err) {
        console.error('Redeem code error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

// Get Transaction History
router.get('/transactions', async (req, res) => {
    const db = new PostgreSQLDatabase();
    
    try {
        const transactions = await db.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC',
            [req.session.user.id]);
        res.json({ transactions });
    } catch (err) {
        console.error('Transaction history error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

// Team Information
router.get('/team', async (req, res) => {
    if (!req.session.user.team_id) {
        return res.render('user/team', { 
            user: req.session.user, 
            teamMembers: [], 
            teamInfo: null 
        });
    }
    
    const db = new PostgreSQLDatabase();
    
    try {
        // Get team info
        const team = await db.get('SELECT * FROM teams WHERE id = $1', [req.session.user.team_id]);
        
        if (!team) {
            return res.status(500).send('Team not found');
        }
        
        // Get team members
        const members = await db.query('SELECT * FROM users WHERE team_id = $1', [req.session.user.team_id]);
        
        // Get team financial data
        let financialData = {
            earned: 0,
            spent: 0,
            donated: 0,
            received: 0,
            currentBalance: 0
        };
        
        // Calculate team's total current balance
        financialData.currentBalance = members.reduce((sum, member) => sum + member.balance, 0);
        
        // Get all transactions for team members
        if (members.length > 0) {
            const memberIds = members.map(m => m.id);
            const placeholders = memberIds.map((_, i) => `$${i + 1}`).join(',');
            const transactions = await db.query(`SELECT type, amount FROM transactions WHERE user_id IN (${placeholders})`, memberIds);
            
            // Calculate financial summary
            transactions.forEach(transaction => {
                switch(transaction.type) {
                    case 'earn':
                        financialData.earned += transaction.amount;
                        break;
                    case 'purchase':
                        financialData.spent += Math.abs(transaction.amount);
                        break;
                    case 'donation_sent':
                        financialData.donated += Math.abs(transaction.amount);
                        break;
                    case 'donation_received':
                        financialData.received += transaction.amount;
                        break;
                }
            });
        }
        
        // Get donations received by this team
        const receivedDonations = await db.query(`SELECT 
                d.*,
                p.name as product_name,
                dt.name as donor_team_name,
                du.username as donor_username
            FROM donations d
            JOIN products p ON d.product_id = p.id
            JOIN teams dt ON d.donor_team_id = dt.id
            JOIN users du ON d.donor_id = du.id
            WHERE d.recipient_team_id = $1
            ORDER BY d.created_at DESC
            LIMIT 10`, [req.session.user.team_id]);
        
        res.render('user/team', { 
            user: req.session.user, 
            teamMembers: members, 
            teamInfo: team,
            financialData: financialData,
            receivedDonations: receivedDonations,
            formatDate: require('../database/init_postgres').formatDate
        });
    } catch (err) {
        console.error('Team info error:', err);
        return res.status(500).send('Database error');
    }
});

// Team Purchase History
router.get('/team-purchases', async (req, res) => {
    if (!req.session.user.team_id) {
        return res.render('user/team-purchases', { 
            user: req.session.user, 
            orders: [],
            teamInfo: null 
        });
    }
    
    const db = new PostgreSQLDatabase();
    
    try {
        // Get team info
        const team = await db.get('SELECT * FROM teams WHERE id = $1', [req.session.user.team_id]);
        
        if (!team) {
            return res.status(500).send('Team not found');
        }
        
        // Get team orders
        const orders = await db.query(`SELECT o.*, p.name as product_name, p.description, u.username
                FROM orders o
                JOIN products p ON o.product_id = p.id
                JOIN users u ON o.user_id = u.id
                WHERE o.team_id = $1
                ORDER BY o.created_at DESC`, [req.session.user.team_id]);
        
        res.render('user/team-purchases', { 
            user: req.session.user, 
            orders: orders,
            teamInfo: team 
        });
    } catch (err) {
        console.error('Team purchases error:', err);
        return res.status(500).send('Database error');
    }
});

// Team Inventory
router.get('/team-inventory', async (req, res) => {
    if (!req.session.user.team_id) {
        return res.render('user/team-inventory', { 
            user: req.session.user, 
            inventory: [],
            teamInfo: null 
        });
    }
    
    const db = new PostgreSQLDatabase();
    
    try {
        // Get team info
        const team = await db.get('SELECT * FROM teams WHERE id = $1', [req.session.user.team_id]);
        
        if (!team) {
            return res.status(500).send('Team not found');
        }
        
        // Get team inventory with product details
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
                WHERE ti.team_id = $1 AND ti.quantity > 0
                GROUP BY ti.product_id, p.name, p.description, p.price, p.category
                ORDER BY p.category, p.name`, [req.session.user.team_id]);
        
        // Also get detailed history
        const inventoryHistory = await db.query(`SELECT 
                    ti.*,
                    p.name as product_name,
                    p.price
                FROM team_inventory ti
                JOIN products p ON ti.product_id = p.id
                WHERE ti.team_id = $1 AND ti.quantity > 0
                ORDER BY ti.created_at DESC`, [req.session.user.team_id]);
        
        res.render('user/team-inventory', { 
            user: req.session.user, 
            inventory: inventory || [],
            inventoryHistory: inventoryHistory || [],
            teamInfo: team,
            formatDate: require('../database/init_postgres').formatDate
        });
    } catch (err) {
        console.error('Team inventory error:', err);
        return res.status(500).send('Database error');
    }
});

module.exports = router;