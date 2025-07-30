const express = require('express');
const bcrypt = require('bcrypt');
const { Database } = require('../database/config');

const router = express.Router();

// Admin Dashboard
router.get('/dashboard', (req, res) => {
    res.render('admin/dashboard', { user: req.session.user });
});

// Team Rankings Dashboard
router.get('/rankings', async (req, res) => {
    try {
        const db = new Database();
        
        const teamStats = await db.query(`SELECT 
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
                ORDER BY t.name`);
            
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
        
        res.render('admin/rankings', { 
            user: req.session.user,
            rankings: rankings
        });
    } catch (error) {
        console.error('Rankings error:', error);
        res.status(500).send('Database error');
    }
});

// User Management
router.get('/users', async (req, res) => {
    try {
        const db = new Database();
        
        const users = await db.query(`SELECT u.*, t.name as team_name 
                FROM users u 
                LEFT JOIN teams t ON u.team_id = t.id 
                ORDER BY u.created_at DESC`);
                
        res.render('admin/users', { users, user: req.session.user });
    } catch (error) {
        console.error('Users error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Create User
router.post('/users', async (req, res) => {
    const { username, password, role, team_id } = req.body;
    
    if (!username || !password || !role) {
        return res.status(400).json({ error: 'Username, password, and role required' });
    }
    
    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const db = new Database();
        
        const result = await db.run('INSERT INTO users (username, password_hash, role, team_id) VALUES (?, ?, ?, ?)',
            [username, passwordHash, role, team_id || null]);
            
        res.json({ success: true, userId: result.lastID });
    } catch (error) {
        console.error('Create user error:', error);
        if (error.message && error.message.includes('duplicate key') || error.code === '23505') {
            return res.status(400).json({ error: 'Username already exists' });
        }
        res.status(500).json({ error: 'Database error' });
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
        const db = new Database();
        
        // Get current user data to check for balance changes
        const currentUser = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
        if (!currentUser) {
            return res.status(404).json({ error: 'User not found' });
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
        
        await db.run(updateQuery, updateParams);
        
        // Log balance change if it occurred
        if (balanceChanged) {
            const balanceDifference = newBalance - currentBalance;
            const description = balanceDifference > 0 
                ? `Admin added $${balanceDifference} to balance` 
                : `Admin removed $${Math.abs(balanceDifference)} from balance`;
                
            try {
                await db.run('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
                    [userId, 'admin_adjustment', balanceDifference, description]);
            } catch (err) {
                console.log('Error logging balance change:', err.message);
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Edit user error:', error);
        if (error.message && (error.message.includes('UNIQUE constraint failed') || error.message.includes('duplicate key'))) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete User
router.post('/users/:id/delete', async (req, res) => {
    const userId = req.params.id;
    
    try {
        const db = new Database();
        
        // Prevent deleting admin users
        const user = await db.get('SELECT role FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (user.role === 'admin') {
            return res.status(400).json({ error: 'Cannot delete admin users' });
        }
        
        // Check if user has transactions
        const result = await db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ?', [userId]);
        if (result.count > 0) {
            return res.status(400).json({ error: 'Cannot delete user with transaction history' });
        }
        
        // Safe to delete
        await db.run('DELETE FROM users WHERE id = ?', [userId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Team Management
router.get('/teams', async (req, res) => {
    try {
        const db = new Database();
        
        const teams = await db.query(`SELECT t.*, u.username as leader_name,
                       COUNT(m.id) as member_count
                FROM teams t 
                LEFT JOIN users u ON t.leader_id = u.id
                LEFT JOIN users m ON t.id = m.team_id
                GROUP BY t.id
                ORDER BY t.name`);
                
        res.render('admin/teams', { teams, user: req.session.user });
    } catch (error) {
        console.error('Teams error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update Team Leader
router.post('/teams/:id/leader', async (req, res) => {
    const { leader_id } = req.body;
    const teamId = req.params.id;
    
    try {
        const db = new Database();
        
        // Remove previous leader role
        await db.run('UPDATE users SET role = "participant" WHERE team_id = ? AND role = "team_leader"', [teamId]);
        
        // Set new leader
        await db.run('UPDATE teams SET leader_id = ? WHERE id = ?', [leader_id, teamId]);
        await db.run('UPDATE users SET role = "team_leader" WHERE id = ?', [leader_id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Update team leader error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get team members for leader assignment
router.get('/teams/:id/members', async (req, res) => {
    const teamId = req.params.id;
    
    try {
        const db = new Database();
        
        const members = await db.query('SELECT id, username, role FROM users WHERE team_id = ? ORDER BY username', [teamId]);
        res.json({ members });
    } catch (error) {
        console.error('Get team members error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Money Code Management
router.get('/money-codes', async (req, res) => {
    try {
        const db = new Database();
        
        const codes = await db.query(`SELECT mc.*, u.username as used_by_username 
                FROM money_codes mc 
                LEFT JOIN users u ON mc.used_by = u.id 
                ORDER BY mc.created_at DESC`);
                
        res.render('admin/money-codes', { codes, user: req.session.user });
    } catch (error) {
        console.error('Money codes error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Create Money Code
router.post('/money-codes', async (req, res) => {
    const { amount, quantity = 1 } = req.body;
    
    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Valid amount required' });
    }
    
    try {
        const db = new Database();
        const codes = [];
        
        // Generate unique codes
        for (let i = 0; i < quantity; i++) {
            const code = 'RC' + Date.now() + Math.random().toString(36).substr(2, 6);
            codes.push([code, amount]);
        }
        
        const placeholders = codes.map(() => '(?, ?)').join(', ');
        const flatCodes = codes.flat();
        
        await db.run(`INSERT INTO money_codes (code, amount) VALUES ${placeholders}`, flatCodes);
        res.json({ success: true, generated: quantity });
    } catch (error) {
        console.error('Create money code error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Product Management
router.get('/products', async (req, res) => {
    try {
        const db = new Database();
        
        const products = await db.query('SELECT * FROM products ORDER BY created_at DESC');
        res.render('admin/products', { products, user: req.session.user });
    } catch (error) {
        console.error('Products error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Create Product
router.post('/products', async (req, res) => {
    const { name, description, price, category, stock_quantity } = req.body;
    
    if (!name || !price || price <= 0) {
        return res.status(400).json({ error: 'Name and valid price required' });
    }
    
    if (!stock_quantity || stock_quantity < 0) {
        return res.status(400).json({ error: 'Valid stock quantity required' });
    }
    
    try {
        const db = new Database();
        
        const result = await db.run('INSERT INTO products (name, description, price, category, stock_quantity, initial_stock) VALUES (?, ?, ?, ?, ?, ?)',
            [name, description || '', price, category || 'item', stock_quantity, stock_quantity]);
            
        res.json({ success: true, productId: result.lastID });
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Toggle Product Active Status
router.post('/products/:id/toggle', async (req, res) => {
    const productId = req.params.id;
    const { is_active } = req.body;
    
    try {
        const db = new Database();
        
        await db.run('UPDATE products SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, productId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Toggle product error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Edit Product
router.post('/products/:id/edit', async (req, res) => {
    const productId = req.params.id;
    const { name, description, price, category, stock_quantity } = req.body;
    
    if (!name || !price || price <= 0) {
        return res.status(400).json({ error: 'Name and valid price required' });
    }
    
    if (stock_quantity !== undefined && stock_quantity < 0) {
        return res.status(400).json({ error: 'Stock quantity cannot be negative' });
    }
    
    try {
        const db = new Database();
        
        // If stock_quantity is provided, update it
        if (stock_quantity !== undefined) {
            await db.run('UPDATE products SET name = ?, description = ?, price = ?, category = ?, stock_quantity = ? WHERE id = ?',
                [name, description || '', price, category || 'item', stock_quantity, productId]);
        } else {
            // Update without changing stock
            await db.run('UPDATE products SET name = ?, description = ?, price = ?, category = ? WHERE id = ?',
                [name, description || '', price, category || 'item', productId]);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Edit product error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete Product
router.post('/products/:id/delete', async (req, res) => {
    const productId = req.params.id;
    
    try {
        const db = new Database();
        
        // Check if product has been ordered
        const result = await db.get('SELECT COUNT(*) as count FROM orders WHERE product_id = ?', [productId]);
        if (result.count > 0) {
            return res.status(400).json({ error: 'Cannot delete product that has been ordered' });
        }
        
        // Safe to delete
        await db.run('DELETE FROM products WHERE id = ?', [productId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Adjust Product Stock
router.post('/products/:id/stock', async (req, res) => {
    const productId = req.params.id;
    const { adjustment, type } = req.body; // type: 'set' or 'adjust'
    
    if (!adjustment && adjustment !== 0) {
        return res.status(400).json({ error: 'Stock adjustment value required' });
    }
    
    try {
        const db = new Database();
        
        if (type === 'set') {
            // Set absolute stock value
            if (adjustment < 0) {
                return res.status(400).json({ error: 'Stock cannot be negative' });
            }
            
            await db.run('UPDATE products SET stock_quantity = ? WHERE id = ?', [adjustment, productId]);
            
            // Auto-reactivate product if stock is now available
            if (adjustment > 0) {
                try {
                    await db.run('UPDATE products SET is_active = 1 WHERE id = ?', [productId]);
                } catch (err) {
                    console.log('Error auto-reactivating restocked product:', err.message);
                }
            }
            
            res.json({ success: true });
        } else {
            // Adjust stock by amount (can be positive or negative)
            const product = await db.get('SELECT stock_quantity FROM products WHERE id = ?', [productId]);
            if (!product) {
                return res.status(404).json({ error: 'Product not found' });
            }
            
            const newStock = product.stock_quantity + adjustment;
            if (newStock < 0) {
                return res.status(400).json({ error: 'Stock cannot go below zero' });
            }
            
            await db.run('UPDATE products SET stock_quantity = ? WHERE id = ?', [newStock, productId]);
            
            // Auto-reactivate if stock is now available and was previously 0
            if (newStock > 0 && product.stock_quantity <= 0) {
                try {
                    await db.run('UPDATE products SET is_active = 1 WHERE id = ?', [productId]);
                } catch (err) {
                    console.log('Error auto-reactivating restocked product:', err.message);
                }
            } else if (newStock <= 0) {
                // Auto-deactivate if stock is now 0
                try {
                    await db.run('UPDATE products SET is_active = 0 WHERE id = ?', [productId]);
                } catch (err) {
                    console.log('Error auto-deactivating out of stock product:', err.message);
                }
            }
            
            res.json({ success: true, newStock });
        }
    } catch (error) {
        console.error('Adjust product stock error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Orders Management
router.get('/orders', async (req, res) => {
    try {
        const db = new Database();
        
        const orders = await db.query(`SELECT o.*, u.username, t.name as team_name, p.name as product_name
                FROM orders o
                JOIN users u ON o.user_id = u.id
                JOIN teams t ON o.team_id = t.id
                JOIN products p ON o.product_id = p.id
                ORDER BY o.created_at DESC`);
                
        res.render('admin/orders', { orders, user: req.session.user });
    } catch (error) {
        console.error('Orders error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Verify Order
router.post('/orders/:id/verify', async (req, res) => {
    const orderId = req.params.id;
    
    try {
        const db = new Database();
        
        await db.run('UPDATE orders SET verified = 1, status = "verified" WHERE id = ?', [orderId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Verify order error:', error);
        res.status(500).json({ error: 'Database error' });
    }
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
    
    try {
        const db = new Database();
        
        // Get current admin password hash
        const user = await db.get('SELECT password_hash FROM users WHERE role = "admin" LIMIT 1');
        if (!user) {
            return res.status(404).json({ error: 'Admin user not found' });
        }
        
        // Verify current password
        const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        // Hash new password
        const saltRounds = 10;
        const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
        
        // Update password
        await db.run('UPDATE users SET password_hash = ? WHERE role = "admin"', [newPasswordHash]);
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Password processing error' });
    }
});

// Database Reset/Initialization
router.post('/reset-database', async (req, res) => {
    try {
        const db = new Database();
        
        // Clear all data tables (but keep schema)
        try {
            await db.run('DELETE FROM team_inventory');
        } catch (err) {
            console.log('Error clearing team_inventory:', err.message);
        }
        
        try {
            await db.run('DELETE FROM donations');
        } catch (err) {
            console.log('Error clearing donations:', err.message);
        }
        
        try {
            await db.run('DELETE FROM transactions');
        } catch (err) {
            console.log('Error clearing transactions:', err.message);
        }
        
        try {
            await db.run('DELETE FROM orders');
        } catch (err) {
            console.log('Error clearing orders:', err.message);
        }
        
        try {
            await db.run('DELETE FROM money_codes');
        } catch (err) {
            console.log('Error clearing money_codes:', err.message);
        }
        
        // Reset all users except admin to initial state
        try {
            await db.run('DELETE FROM users WHERE role != "admin"');
        } catch (err) {
            console.log('Error clearing non-admin users:', err.message);
        }
        
        // Reset admin balance to 0
        try {
            await db.run('UPDATE users SET balance = 0 WHERE role = "admin"');
        } catch (err) {
            console.log('Error resetting admin balance:', err.message);
        }
        
        // Delete all products
        try {
            await db.run('DELETE FROM products');
        } catch (err) {
            console.log('Error deleting products:', err.message);
        }
        
        // Reset teams (remove leaders and update names)
        try {
            await db.run('UPDATE teams SET leader_id = NULL');
        } catch (err) {
            console.log('Error resetting team leaders:', err.message);
        }
        
        // Update team names to A,B,C,D,E,Z
        const teamUpdates = [
            { id: 1, name: 'A그룹' },
            { id: 2, name: 'B그룹' },
            { id: 3, name: 'C그룹' },
            { id: 4, name: 'D그룹' },
            { id: 5, name: 'E그룹' },
            { id: 6, name: 'Z그룹' }
        ];
        
        for (const team of teamUpdates) {
            try {
                await db.run('UPDATE teams SET name = ? WHERE id = ?', [team.name, team.id]);
            } catch (err) {
                console.log(`Error updating team ${team.id}:`, err.message);
            }
        }
        
        res.json({ success: true, message: 'Database reset to initial values successfully' });
    } catch (error) {
        console.error('Database reset error:', error);
        res.status(500).json({ error: 'Database reset failed' });
    }
});

// API endpoint to get all teams (for dynamic dropdowns)
router.get('/api/teams', async (req, res) => {
    try {
        const db = new Database();
        const teams = await db.query('SELECT id, name FROM teams ORDER BY id');
        res.json({ teams });
    } catch (error) {
        console.error('Teams API error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;