const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const router = express.Router();
const dbPath = path.join(__dirname, '../database/retreat.db');

// Store main page
router.get('/', (req, res) => {
    const db = new sqlite3.Database(dbPath);
    
    db.all('SELECT * FROM products WHERE is_active = 1 ORDER BY category, name', (err, products) => {
        db.close();
        if (err) {
            return res.status(500).send('Database error');
        }
        // Ensure stock_quantity defaults to 0 if null/undefined
        products = products.map(product => ({
            ...product,
            stock_quantity: product.stock_quantity || 0
        }));
        res.render('store/index', { products, user: req.session.user });
    });
});

// Purchase item (Team leaders only)
router.post('/purchase', (req, res) => {
    const { product_id, quantity = 1 } = req.body;
    
    // Check if user is team leader
    if (req.session.user.role !== 'team_leader' && req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only team leaders can make purchases' });
    }
    
    if (!product_id || quantity <= 0) {
        return res.status(400).json({ error: 'Valid product and quantity required' });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    db.serialize(() => {
        // Get product details
        db.get('SELECT * FROM products WHERE id = ? AND is_active = 1', [product_id], (err, product) => {
            if (err) {
                db.close();
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!product) {
                db.close();
                return res.status(404).json({ error: 'Product not found' });
            }
            
            // Check stock availability
            if ((product.stock_quantity || 0) < quantity) {
                db.close();
                return res.status(400).json({ error: 'Insufficient stock available' });
            }
            
            const totalPrice = product.price * quantity;
            
            // Check user balance
            db.get('SELECT balance FROM users WHERE id = ?', [req.session.user.id], (err, user) => {
                if (err) {
                    db.close();
                    return res.status(500).json({ error: 'Database error' });
                }
                
                if (user.balance < totalPrice) {
                    db.close();
                    return res.status(400).json({ error: 'Insufficient balance' });
                }
                
                // Deduct balance
                db.run('UPDATE users SET balance = balance - ? WHERE id = ?',
                    [totalPrice, req.session.user.id], (err) => {
                    if (err) {
                        db.close();
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    // Create order
                    db.run(`INSERT INTO orders (user_id, team_id, product_id, quantity, total_price, status) 
                            VALUES (?, ?, ?, ?, ?, 'pending')`,
                        [req.session.user.id, req.session.user.team_id, product_id, quantity, totalPrice], 
                        function(err) {
                        if (err) {
                            db.close();
                            return res.status(500).json({ error: 'Database error' });
                        }
                        
                        const orderId = this.lastID;
                        
                        // Record transaction
                        db.run('INSERT INTO transactions (user_id, type, amount, description, reference_id) VALUES (?, ?, ?, ?, ?)',
                            [req.session.user.id, 'purchase', -totalPrice, `Purchased ${product.name} x${quantity}`, orderId], 
                            (err) => {
                            if (err) {
                                db.close();
                                return res.status(500).json({ error: 'Database error' });
                            }
                            
                            // Update product stock
                            db.run('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
                                [quantity, product_id], (err) => {
                                if (err) {
                                    db.close();
                                    return res.status(500).json({ error: 'Database error updating stock' });
                                }
                                
                                // Check if product is now out of stock and auto-deactivate
                                const newStock = (product.stock_quantity || 0) - quantity;
                                if (newStock <= 0) {
                                    db.run('UPDATE products SET is_active = 0 WHERE id = ?', [product_id], (err) => {
                                        if (err) {
                                            console.log('Error auto-deactivating sold out product:', err.message);
                                        }
                                    });
                                }
                                
                                // Add items to team inventory
                                db.run('INSERT INTO team_inventory (team_id, product_id, quantity, obtained_from, reference_id) VALUES (?, ?, ?, ?, ?)',
                                    [req.session.user.team_id, product_id, quantity, 'purchase', orderId], (err) => {
                                    if (err) {
                                        db.close();
                                        return res.status(500).json({ error: 'Database error adding to inventory' });
                                    }
                                    
                                    // Update session balance
                                    req.session.user.balance -= totalPrice;
                                    
                                    db.close();
                                    res.json({ 
                                        success: true, 
                                        orderId: orderId,
                                        newBalance: req.session.user.balance,
                                        message: `Successfully purchased ${product.name} x${quantity}${newStock <= 0 ? ' (Product now sold out)' : ''}` 
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

// Get user's orders
router.get('/orders', (req, res) => {
    const db = new sqlite3.Database(dbPath);
    
    db.all(`SELECT o.*, p.name as product_name, p.description
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.user_id = ?
            ORDER BY o.created_at DESC`, [req.session.user.id], (err, orders) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ orders });
    });
});

// Donation feature - Team leaders only, team-to-team product donations
router.post('/donate', (req, res) => {
    const { recipient_team_id, product_id, quantity = 1, message } = req.body;
    
    // Check if user is team leader
    if (req.session.user.role !== 'team_leader' && req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only team leaders can make donations' });
    }
    
    if (!recipient_team_id || !product_id || !quantity || quantity <= 0) {
        return res.status(400).json({ error: 'Recipient team, product, and valid quantity required' });
    }
    
    if (recipient_team_id === req.session.user.team_id) {
        return res.status(400).json({ error: 'Cannot donate to your own team' });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    db.serialize(() => {
        // Check if product exists
        db.get('SELECT * FROM products WHERE id = ? AND is_active = 1', [product_id], (err, product) => {
            if (err) {
                db.close();
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!product) {
                db.close();
                return res.status(404).json({ error: 'Product not found or inactive' });
            }
            
            // Check if donor team has enough of this item in inventory
            db.get('SELECT SUM(quantity) as total_quantity FROM team_inventory WHERE team_id = ? AND product_id = ?', 
                [req.session.user.team_id, product_id], (err, inventoryResult) => {
                if (err) {
                    db.close();
                    return res.status(500).json({ error: 'Database error' });
                }
                
                const availableQuantity = inventoryResult.total_quantity || 0;
                if (availableQuantity < quantity) {
                    db.close();
                    return res.status(400).json({ 
                        error: `Insufficient inventory. You have ${availableQuantity} ${product.name}(s), but trying to donate ${quantity}` 
                    });
                }
                
                // Check if recipient team exists
                db.get('SELECT id, name FROM teams WHERE id = ?', [recipient_team_id], (err, recipientTeam) => {
                    if (err) {
                        db.close();
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    if (!recipientTeam) {
                        db.close();
                        return res.status(404).json({ error: 'Recipient team not found' });
                    }
                    
                    // Get recipient team leader
                    db.get('SELECT id FROM users WHERE team_id = ? AND role = "team_leader"', [recipient_team_id], (err, recipientLeader) => {
                        if (err) {
                            db.close();
                            return res.status(500).json({ error: 'Database error' });
                        }
                        
                        if (!recipientLeader) {
                            db.close();
                            return res.status(404).json({ error: 'Recipient team has no leader' });
                        }
                        
                        // Create donation record
                        db.run('INSERT INTO donations (donor_id, recipient_id, product_id, amount, quantity, message, donor_team_id, recipient_team_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                            [req.session.user.id, recipientLeader.id, product_id, product.price * quantity, quantity, message || '', req.session.user.team_id, recipient_team_id], function(err) {
                            if (err) {
                                db.close();
                                return res.status(500).json({ error: 'Database error' });
                            }
                            
                            const donationId = this.lastID;
                            
                            // Remove items from donor team inventory
                            db.run('UPDATE team_inventory SET quantity = quantity - ? WHERE team_id = ? AND product_id = ? AND quantity > 0',
                                [quantity, req.session.user.team_id, product_id], (err) => {
                                if (err) {
                                    db.close();
                                    return res.status(500).json({ error: 'Database error removing from inventory' });
                                }
                                
                                // Add items to recipient team inventory
                                db.run('INSERT INTO team_inventory (team_id, product_id, quantity, obtained_from, reference_id) VALUES (?, ?, ?, ?, ?)',
                                    [recipient_team_id, product_id, quantity, 'donation', donationId], (err) => {
                                    if (err) {
                                        db.close();
                                        return res.status(500).json({ error: 'Database error adding to recipient inventory' });
                                    }
                                    
                                    // Decrease product stock (as items are being transferred/consumed)
                                    db.run('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
                                        [quantity, product_id], (err) => {
                                        if (err) {
                                            console.log('Error decreasing stock for donation:', err.message);
                                        }
                                        
                                        // Check if product is now out of stock and auto-deactivate
                                        db.get('SELECT stock_quantity FROM products WHERE id = ?', [product_id], (err, updatedProduct) => {
                                            if (!err && updatedProduct && updatedProduct.stock_quantity <= 0) {
                                                db.run('UPDATE products SET is_active = 0 WHERE id = ?', [product_id]);
                                            }
                                        });
                                    });
                                    
                                    // Record transaction for donor
                                    db.run('INSERT INTO transactions (user_id, type, amount, description, reference_id) VALUES (?, ?, ?, ?, ?)',
                                        [req.session.user.id, 'donation_sent', 0, `Donated ${quantity} ${product.name}(s) to ${recipientTeam.name}`, donationId], (err) => {
                                        if (err) {
                                            console.log('Error recording donor transaction:', err.message);
                                        }
                                    });
                                    
                                    // Record transaction for recipient
                                    db.run('INSERT INTO transactions (user_id, type, amount, description, reference_id) VALUES (?, ?, ?, ?, ?)',
                                        [recipientLeader.id, 'donation_received', 0, `Received ${quantity} ${product.name}(s) from team ${req.session.user.team_id}`, donationId], (err) => {
                                        if (err) {
                                            console.log('Error recording recipient transaction:', err.message);
                                        }
                                    });
                                    
                                    db.close();
                                    res.json({ 
                                        success: true, 
                                        message: `Successfully donated ${quantity} ${product.name}(s) to ${recipientTeam.name}` 
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

// Get available teams for donation (team leaders only)
router.get('/teams', (req, res) => {
    // Only team leaders can access this
    if (req.session.user.role !== 'team_leader' && req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only team leaders can make donations' });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    db.all('SELECT id, name FROM teams WHERE id != ?', 
        [req.session.user.team_id], (err, teams) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ teams });
    });
});

// Get team inventory for donations (team leaders only)
router.get('/team-inventory', (req, res) => {
    // Only team leaders can access this
    if (req.session.user.role !== 'team_leader' && req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only team leaders can make donations' });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    db.all(`SELECT 
                ti.product_id,
                p.name as product_name,
                SUM(ti.quantity) as available_quantity
            FROM team_inventory ti
            JOIN products p ON ti.product_id = p.id
            WHERE ti.team_id = ? AND ti.quantity > 0
            GROUP BY ti.product_id, p.name`, 
        [req.session.user.team_id], (err, inventory) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ inventory });
    });
});

module.exports = router;