const express = require('express');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const router = express.Router();
const dbPath = path.join(__dirname, '../database/retreat.db');

// Admin Dashboard
router.get('/dashboard', (req, res) => {
    res.render('admin/dashboard', { user: req.session.user });
});

// Team Rankings Dashboard
router.get('/rankings', (req, res) => {
    const db = new sqlite3.Database(dbPath);
    
    db.all(`SELECT 
                t.id,
                t.name as team_name,
                COUNT(DISTINCT u.id) as member_count,
                
                -- Total earned (money codes + donations received)
                COALESCE(SUM(CASE 
                    WHEN tr.type IN ('earn', 'donation_received') THEN tr.amount 
                    ELSE 0 
                END), 0) as total_earned,
                
                -- Total spent (purchases only, not donations)
                COALESCE(SUM(CASE 
                    WHEN tr.type = 'purchase' THEN ABS(tr.amount) 
                    ELSE 0 
                END), 0) as total_spent,
                
                -- Total donated (amount donated to other teams)
                COALESCE(SUM(CASE 
                    WHEN tr.type = 'donation_sent' THEN ABS(tr.amount) 
                    ELSE 0 
                END), 0) as total_donated,
                
                -- Current team balance
                COALESCE(SUM(u.balance), 0) as current_balance
                
            FROM teams t
            LEFT JOIN users u ON t.id = u.team_id
            LEFT JOIN transactions tr ON u.id = tr.user_id
            GROUP BY t.id, t.name
            ORDER BY t.name`, (err, teamStats) => {
        
        if (err) {
            db.close();
            return res.status(500).send('Database error');
        }
        
        // Calculate donation scores
        const rankings = teamStats.map(team => {
            const donationScore = team.total_earned > 0 
                ? Math.round((team.total_donated / team.total_earned) * 100)
                : 0;
                
            return {
                ...team,
                donation_score: donationScore
            };
        }).sort((a, b) => b.donation_score - a.donation_score);
        
        db.close();
        res.render('admin/rankings', { 
            user: req.session.user,
            rankings: rankings
        });
    });
});

// User Management
router.get('/users', (req, res) => {
    const db = new sqlite3.Database(dbPath);
    
    db.all(`SELECT u.*, t.name as team_name 
            FROM users u 
            LEFT JOIN teams t ON u.team_id = t.id 
            ORDER BY u.created_at DESC`, (err, users) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.render('admin/users', { users, user: req.session.user });
    });
});

// Create User
router.post('/users', async (req, res) => {
    const { username, password, role, team_id } = req.body;
    
    if (!username || !password || !role) {
        return res.status(400).json({ error: 'Username, password, and role required' });
    }
    
    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const db = new sqlite3.Database(dbPath);
        
        db.run('INSERT INTO users (username, password_hash, role, team_id) VALUES (?, ?, ?, ?)',
            [username, passwordHash, role, team_id || null], function(err) {
            db.close();
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Username already exists' });
                }
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true, userId: this.lastID });
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Edit User
router.post('/users/:id/edit', async (req, res) => {
    const userId = req.params.id;
    const { username, password, role, team_id, balance } = req.body;
    
    if (!username || !role) {
        return res.status(400).json({ error: 'Username and role required' });
    }
    
    try {
        const db = new sqlite3.Database(dbPath);
        
        db.serialize(async () => {
            // Get current user data to check for balance changes
            db.get('SELECT balance FROM users WHERE id = ?', [userId], async (err, currentUser) => {
                if (err) {
                    db.close();
                    return res.status(500).json({ error: 'Database error' });
                }
                
                const currentBalance = currentUser.balance;
                const newBalance = balance !== undefined ? parseInt(balance) : currentBalance;
                const balanceChanged = newBalance !== currentBalance;
                
                // Update user information
                let updateQuery, updateParams;
                
                if (password && password.trim() !== '') {
                    // Update with new password
                    const passwordHash = await bcrypt.hash(password, 10);
                    updateQuery = 'UPDATE users SET username = ?, password_hash = ?, role = ?, team_id = ?, balance = ? WHERE id = ?';
                    updateParams = [username, passwordHash, role, team_id || null, newBalance, userId];
                } else {
                    // Update without changing password
                    updateQuery = 'UPDATE users SET username = ?, role = ?, team_id = ?, balance = ? WHERE id = ?';
                    updateParams = [username, role, team_id || null, newBalance, userId];
                }
                
                db.run(updateQuery, updateParams, function(err) {
                    if (err) {
                        db.close();
                        if (err.message.includes('UNIQUE constraint failed')) {
                            return res.status(400).json({ error: 'Username already exists' });
                        }
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    // Log balance change if it occurred
                    if (balanceChanged) {
                        const balanceDifference = newBalance - currentBalance;
                        const description = balanceDifference > 0 
                            ? `Admin added $${balanceDifference} to balance` 
                            : `Admin removed $${Math.abs(balanceDifference)} from balance`;
                            
                        db.run('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
                            [userId, 'admin_adjustment', balanceDifference, description], (err) => {
                            if (err) {
                                console.log('Error logging balance change:', err.message);
                            }
                            db.close();
                            res.json({ success: true });
                        });
                    } else {
                        db.close();
                        res.json({ success: true });
                    }
                });
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete User
router.post('/users/:id/delete', (req, res) => {
    const userId = req.params.id;
    
    // Prevent deleting admin users
    const db = new sqlite3.Database(dbPath);
    
    db.get('SELECT role FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) {
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user) {
            db.close();
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (user.role === 'admin') {
            db.close();
            return res.status(400).json({ error: 'Cannot delete admin users' });
        }
        
        // Check if user has transactions
        db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ?', [userId], (err, result) => {
            if (err) {
                db.close();
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (result.count > 0) {
                db.close();
                return res.status(400).json({ error: 'Cannot delete user with transaction history' });
            }
            
            // Safe to delete
            db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
                db.close();
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                res.json({ success: true });
            });
        });
    });
});

// Team Management
router.get('/teams', (req, res) => {
    const db = new sqlite3.Database(dbPath);
    
    db.all(`SELECT t.*, u.username as leader_name,
                   COUNT(m.id) as member_count
            FROM teams t 
            LEFT JOIN users u ON t.leader_id = u.id
            LEFT JOIN users m ON t.id = m.team_id
            GROUP BY t.id
            ORDER BY t.name`, (err, teams) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.render('admin/teams', { teams, user: req.session.user });
    });
});

// Update Team Leader
router.post('/teams/:id/leader', (req, res) => {
    const { leader_id } = req.body;
    const teamId = req.params.id;
    
    const db = new sqlite3.Database(dbPath);
    
    db.serialize(() => {
        // Remove previous leader role
        db.run('UPDATE users SET role = "participant" WHERE team_id = ? AND role = "team_leader"', [teamId]);
        
        // Set new leader
        db.run('UPDATE teams SET leader_id = ? WHERE id = ?', [leader_id, teamId]);
        db.run('UPDATE users SET role = "team_leader" WHERE id = ?', [leader_id], function(err) {
            db.close();
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true });
        });
    });
});

// Get team members for leader assignment
router.get('/teams/:id/members', (req, res) => {
    const teamId = req.params.id;
    
    const db = new sqlite3.Database(dbPath);
    
    db.all('SELECT id, username, role FROM users WHERE team_id = ? ORDER BY username', [teamId], (err, members) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ members });
    });
});

// Money Code Management
router.get('/money-codes', (req, res) => {
    const db = new sqlite3.Database(dbPath);
    
    db.all(`SELECT mc.*, u.username as used_by_username 
            FROM money_codes mc 
            LEFT JOIN users u ON mc.used_by = u.id 
            ORDER BY mc.created_at DESC`, (err, codes) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.render('admin/money-codes', { codes, user: req.session.user });
    });
});

// Create Money Code
router.post('/money-codes', (req, res) => {
    const { amount, quantity = 1 } = req.body;
    
    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Valid amount required' });
    }
    
    const db = new sqlite3.Database(dbPath);
    const codes = [];
    
    // Generate unique codes
    for (let i = 0; i < quantity; i++) {
        const code = 'RC' + Date.now() + Math.random().toString(36).substr(2, 6);
        codes.push([code, amount]);
    }
    
    const placeholders = codes.map(() => '(?, ?)').join(', ');
    const flatCodes = codes.flat();
    
    db.run(`INSERT INTO money_codes (code, amount) VALUES ${placeholders}`, flatCodes, function(err) {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true, generated: quantity });
    });
});

// Product Management
router.get('/products', (req, res) => {
    const db = new sqlite3.Database(dbPath);
    
    db.all('SELECT * FROM products ORDER BY created_at DESC', (err, products) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.render('admin/products', { products, user: req.session.user });
    });
});

// Create Product
router.post('/products', (req, res) => {
    const { name, description, price, category, stock_quantity } = req.body;
    
    if (!name || !price || price <= 0) {
        return res.status(400).json({ error: 'Name and valid price required' });
    }
    
    if (!stock_quantity || stock_quantity < 0) {
        return res.status(400).json({ error: 'Valid stock quantity required' });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    db.run('INSERT INTO products (name, description, price, category, stock_quantity, initial_stock) VALUES (?, ?, ?, ?, ?, ?)',
        [name, description || '', price, category || 'item', stock_quantity, stock_quantity], function(err) {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true, productId: this.lastID });
    });
});

// Toggle Product Active Status
router.post('/products/:id/toggle', (req, res) => {
    const productId = req.params.id;
    const { is_active } = req.body;
    
    const db = new sqlite3.Database(dbPath);
    
    db.run('UPDATE products SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, productId], function(err) {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true });
    });
});

// Edit Product
router.post('/products/:id/edit', (req, res) => {
    const productId = req.params.id;
    const { name, description, price, category, stock_quantity } = req.body;
    
    if (!name || !price || price <= 0) {
        return res.status(400).json({ error: 'Name and valid price required' });
    }
    
    if (stock_quantity !== undefined && stock_quantity < 0) {
        return res.status(400).json({ error: 'Stock quantity cannot be negative' });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    // If stock_quantity is provided, update it
    if (stock_quantity !== undefined) {
        db.run('UPDATE products SET name = ?, description = ?, price = ?, category = ?, stock_quantity = ? WHERE id = ?',
            [name, description || '', price, category || 'item', stock_quantity, productId], function(err) {
            db.close();
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true });
        });
    } else {
        // Update without changing stock
        db.run('UPDATE products SET name = ?, description = ?, price = ?, category = ? WHERE id = ?',
            [name, description || '', price, category || 'item', productId], function(err) {
            db.close();
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true });
        });
    }
});

// Delete Product
router.post('/products/:id/delete', (req, res) => {
    const productId = req.params.id;
    
    const db = new sqlite3.Database(dbPath);
    
    // Check if product has been ordered
    db.get('SELECT COUNT(*) as count FROM orders WHERE product_id = ?', [productId], (err, result) => {
        if (err) {
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (result.count > 0) {
            db.close();
            return res.status(400).json({ error: 'Cannot delete product that has been ordered' });
        }
        
        // Safe to delete
        db.run('DELETE FROM products WHERE id = ?', [productId], function(err) {
            db.close();
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true });
        });
    });
});

// Adjust Product Stock
router.post('/products/:id/stock', (req, res) => {
    const productId = req.params.id;
    const { adjustment, type } = req.body; // type: 'set' or 'adjust'
    
    if (!adjustment && adjustment !== 0) {
        return res.status(400).json({ error: 'Stock adjustment value required' });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    if (type === 'set') {
        // Set absolute stock value
        if (adjustment < 0) {
            db.close();
            return res.status(400).json({ error: 'Stock cannot be negative' });
        }
        
        db.run('UPDATE products SET stock_quantity = ? WHERE id = ?', [adjustment, productId], function(err) {
            if (err) {
                db.close();
                return res.status(500).json({ error: 'Database error' });
            }
            
            // Auto-reactivate product if stock is now available
            if (adjustment > 0) {
                db.run('UPDATE products SET is_active = 1 WHERE id = ?', [productId], (err) => {
                    if (err) {
                        console.log('Error auto-reactivating restocked product:', err.message);
                    }
                    db.close();
                    res.json({ success: true });
                });
            } else {
                db.close();
                res.json({ success: true });
            }
        });
    } else {
        // Adjust stock by amount (can be positive or negative)
        db.get('SELECT stock_quantity FROM products WHERE id = ?', [productId], (err, product) => {
            if (err) {
                db.close();
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!product) {
                db.close();
                return res.status(404).json({ error: 'Product not found' });
            }
            
            const newStock = product.stock_quantity + adjustment;
            if (newStock < 0) {
                db.close();
                return res.status(400).json({ error: 'Stock cannot go below zero' });
            }
            
            db.run('UPDATE products SET stock_quantity = ? WHERE id = ?', [newStock, productId], function(err) {
                if (err) {
                    db.close();
                    return res.status(500).json({ error: 'Database error' });
                }
                
                // Auto-reactivate if stock is now available and was previously 0
                if (newStock > 0 && product.stock_quantity <= 0) {
                    db.run('UPDATE products SET is_active = 1 WHERE id = ?', [productId], (err) => {
                        if (err) {
                            console.log('Error auto-reactivating restocked product:', err.message);
                        }
                        db.close();
                        res.json({ success: true, newStock });
                    });
                } else if (newStock <= 0) {
                    // Auto-deactivate if stock is now 0
                    db.run('UPDATE products SET is_active = 0 WHERE id = ?', [productId], (err) => {
                        if (err) {
                            console.log('Error auto-deactivating out of stock product:', err.message);
                        }
                        db.close();
                        res.json({ success: true, newStock });
                    });
                } else {
                    db.close();
                    res.json({ success: true, newStock });
                }
            });
        });
    }
});

// Orders Management
router.get('/orders', (req, res) => {
    const db = new sqlite3.Database(dbPath);
    
    db.all(`SELECT o.*, u.username, t.name as team_name, p.name as product_name
            FROM orders o
            JOIN users u ON o.user_id = u.id
            JOIN teams t ON o.team_id = t.id
            JOIN products p ON o.product_id = p.id
            ORDER BY o.created_at DESC`, (err, orders) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.render('admin/orders', { orders, user: req.session.user });
    });
});

// Verify Order
router.post('/orders/:id/verify', (req, res) => {
    const orderId = req.params.id;
    
    const db = new sqlite3.Database(dbPath);
    
    db.run('UPDATE orders SET verified = 1, status = "verified" WHERE id = ?', [orderId], function(err) {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true });
    });
});

// Change Admin Password
router.post('/change-password', async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new passwords are required' });
    }
    
    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    // Get current admin password hash
    db.get('SELECT password_hash FROM users WHERE role = "admin" LIMIT 1', async (err, user) => {
        if (err) {
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user) {
            db.close();
            return res.status(404).json({ error: 'Admin user not found' });
        }
        
        try {
            // Verify current password
            const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
            if (!passwordMatch) {
                db.close();
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
            
            // Hash new password
            const saltRounds = 10;
            const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
            
            // Update password
            db.run('UPDATE users SET password_hash = ? WHERE role = "admin"', [newPasswordHash], function(err) {
                db.close();
                if (err) {
                    return res.status(500).json({ error: 'Failed to update password' });
                }
                res.json({ success: true, message: 'Password changed successfully' });
            });
            
        } catch (error) {
            db.close();
            res.status(500).json({ error: 'Password processing error' });
        }
    });
});

// Database Reset/Initialization
router.post('/reset-database', (req, res) => {
    const db = new sqlite3.Database(dbPath);
    
    db.serialize(() => {
        // Clear all data tables (but keep schema)
        db.run('DELETE FROM team_inventory', (err) => {
            if (err) console.log('Error clearing team_inventory:', err.message);
        });
        
        db.run('DELETE FROM donations', (err) => {
            if (err) console.log('Error clearing donations:', err.message);
        });
        
        db.run('DELETE FROM transactions', (err) => {
            if (err) console.log('Error clearing transactions:', err.message);
        });
        
        db.run('DELETE FROM orders', (err) => {
            if (err) console.log('Error clearing orders:', err.message);
        });
        
        db.run('DELETE FROM money_codes', (err) => {
            if (err) console.log('Error clearing money_codes:', err.message);
        });
        
        // Reset all users except admin to initial state
        db.run('DELETE FROM users WHERE role != "admin"', (err) => {
            if (err) console.log('Error clearing non-admin users:', err.message);
        });
        
        // Reset admin balance to 0
        db.run('UPDATE users SET balance = 0 WHERE role = "admin"', (err) => {
            if (err) console.log('Error resetting admin balance:', err.message);
        });
        
        // Delete all products
        db.run('DELETE FROM products', (err) => {
            if (err) console.log('Error deleting products:', err.message);
        });
        
        // Reset teams (remove leaders)
        db.run('UPDATE teams SET leader_id = NULL', (err) => {
            if (err) console.log('Error resetting team leaders:', err.message);
            
            db.close();
            res.json({ success: true, message: 'Database reset to initial values successfully' });
        });
    });
});

module.exports = router;