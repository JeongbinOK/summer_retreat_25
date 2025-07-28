const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const router = express.Router();
const dbPath = path.join(__dirname, '../database/retreat.db');

// User Dashboard
router.get('/dashboard', (req, res) => {
    const db = new sqlite3.Database(dbPath);
    
    // Get updated user balance
    db.get('SELECT balance FROM users WHERE id = ?', [req.session.user.id], (err, user) => {
        if (err) {
            db.close();
            return res.status(500).send('Database error');
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
                               WHERE t.user_id = ? 
                               ORDER BY t.created_at DESC 
                               LIMIT 10`;
            transactionParams = [req.session.user.id];
        } else if (req.session.user.team_id) {
            // Team members see team transactions
            transactionQuery = `SELECT t.*, u.username 
                               FROM transactions t
                               JOIN users u ON t.user_id = u.id
                               WHERE u.team_id = ? 
                               ORDER BY t.created_at DESC 
                               LIMIT 20`;
            transactionParams = [req.session.user.team_id];
        } else {
            // Users without teams see their personal transactions
            transactionQuery = `SELECT t.*, u.username 
                               FROM transactions t
                               JOIN users u ON t.user_id = u.id
                               WHERE t.user_id = ? 
                               ORDER BY t.created_at DESC 
                               LIMIT 10`;
            transactionParams = [req.session.user.id];
        }
        
        db.all(transactionQuery, transactionParams, (err, transactions) => {
            db.close();
            if (err) {
                return res.status(500).send('Database error');
            }
            
            res.render('user/dashboard', { 
                user: req.session.user, 
                transactions 
            });
        });
    });
});

// Redeem Money Code - Team leaders only
router.post('/redeem-code', (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: 'Code required' });
    }
    
    // Check if user is team leader or admin
    if (req.session.user.role !== 'team_leader' && req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only team leaders can redeem money codes' });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    db.serialize(() => {
        db.get('SELECT * FROM money_codes WHERE code = ? AND used = 0', [code], (err, moneyCode) => {
            if (err) {
                db.close();
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!moneyCode) {
                db.close();
                return res.status(400).json({ error: 'Invalid or already used code' });
            }
            
            // Mark code as used
            db.run('UPDATE money_codes SET used = 1, used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ?',
                [req.session.user.id, moneyCode.id], (err) => {
                if (err) {
                    db.close();
                    return res.status(500).json({ error: 'Database error' });
                }
                
                // Add money to user balance
                db.run('UPDATE users SET balance = balance + ? WHERE id = ?',
                    [moneyCode.amount, req.session.user.id], (err) => {
                    if (err) {
                        db.close();
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    // Record transaction
                    db.run('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
                        [req.session.user.id, 'earn', moneyCode.amount, `Redeemed code: ${code}`], (err) => {
                        if (err) {
                            db.close();
                            return res.status(500).json({ error: 'Database error' });
                        }
                        
                        // Update session balance
                        req.session.user.balance += moneyCode.amount;
                        
                        db.close();
                        res.json({ 
                            success: true, 
                            amount: moneyCode.amount,
                            newBalance: req.session.user.balance
                        });
                    });
                });
            });
        });
    });
});

// Get Transaction History
router.get('/transactions', (req, res) => {
    const db = new sqlite3.Database(dbPath);
    
    db.all('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC',
        [req.session.user.id], (err, transactions) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ transactions });
    });
});

// Team Information
router.get('/team', (req, res) => {
    if (!req.session.user.team_id) {
        return res.render('user/team', { 
            user: req.session.user, 
            teamMembers: [], 
            teamInfo: null 
        });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    db.serialize(() => {
        // Get team info
        db.get('SELECT * FROM teams WHERE id = ?', [req.session.user.team_id], (err, team) => {
            if (err) {
                db.close();
                return res.status(500).send('Database error');
            }
            
            // Get team members
            db.all('SELECT * FROM users WHERE team_id = ?', [req.session.user.team_id], (err, members) => {
                if (err) {
                    db.close();
                    return res.status(500).send('Database error');
                }
                
                // Get team financial data
                db.serialize(() => {
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
                    const memberIds = members.map(m => m.id).join(',');
                    
                    db.all(`SELECT type, amount FROM transactions WHERE user_id IN (${memberIds})`, (err, transactions) => {
                        if (err) {
                            db.close();
                            return res.status(500).send('Database error');
                        }
                        
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
                        
                        db.close();
                        res.render('user/team', { 
                            user: req.session.user, 
                            teamMembers: members, 
                            teamInfo: team,
                            financialData: financialData
                        });
                    });
                });
            });
        });
    });
});

// Team Purchase History
router.get('/team-purchases', (req, res) => {
    if (!req.session.user.team_id) {
        return res.render('user/team-purchases', { 
            user: req.session.user, 
            orders: [],
            teamInfo: null 
        });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    db.serialize(() => {
        // Get team info
        db.get('SELECT * FROM teams WHERE id = ?', [req.session.user.team_id], (err, team) => {
            if (err) {
                db.close();
                return res.status(500).send('Database error');
            }
            
            // Get team orders
            db.all(`SELECT o.*, p.name as product_name, p.description, u.username
                    FROM orders o
                    JOIN products p ON o.product_id = p.id
                    JOIN users u ON o.user_id = u.id
                    WHERE o.team_id = ?
                    ORDER BY o.created_at DESC`, [req.session.user.team_id], (err, orders) => {
                db.close();
                if (err) {
                    return res.status(500).send('Database error');
                }
                
                res.render('user/team-purchases', { 
                    user: req.session.user, 
                    orders: orders,
                    teamInfo: team 
                });
            });
        });
    });
});

// Team Inventory
router.get('/team-inventory', (req, res) => {
    if (!req.session.user.team_id) {
        return res.render('user/team-inventory', { 
            user: req.session.user, 
            inventory: [],
            teamInfo: null 
        });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    db.serialize(() => {
        // Get team info
        db.get('SELECT * FROM teams WHERE id = ?', [req.session.user.team_id], (err, team) => {
            if (err) {
                db.close();
                return res.status(500).send('Database error');
            }
            
            // Get team inventory with product details
            db.all(`SELECT 
                        ti.product_id,
                        p.name as product_name,
                        p.description,
                        p.price,
                        p.category,
                        SUM(ti.quantity) as total_quantity,
                        COUNT(DISTINCT ti.id) as entries_count,
                        MAX(ti.obtained_at) as last_obtained
                    FROM team_inventory ti
                    JOIN products p ON ti.product_id = p.id
                    WHERE ti.team_id = ? AND ti.quantity > 0
                    GROUP BY ti.product_id, p.name, p.description, p.price, p.category
                    ORDER BY p.category, p.name`, [req.session.user.team_id], (err, inventory) => {
                
                // Also get detailed history
                db.all(`SELECT 
                            ti.*,
                            p.name as product_name,
                            p.price
                        FROM team_inventory ti
                        JOIN products p ON ti.product_id = p.id
                        WHERE ti.team_id = ? AND ti.quantity > 0
                        ORDER BY ti.obtained_at DESC`, [req.session.user.team_id], (err2, inventoryHistory) => {
                    db.close();
                    if (err || err2) {
                        return res.status(500).send('Database error');
                    }
                    
                    res.render('user/team-inventory', { 
                        user: req.session.user, 
                        inventory: inventory || [],
                        inventoryHistory: inventoryHistory || [],
                        teamInfo: team 
                    });
                });
            });
        });
    });
});

module.exports = router;