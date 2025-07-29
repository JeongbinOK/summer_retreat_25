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

// NEW Donation System - Purchase from store and donate to team
router.post('/donate', (req, res) => {
    const { recipient_team_id, product_id, quantity = 1, message } = req.body;
    
    // Check if user is team leader
    if (req.session.user.role !== 'team_leader' && req.session.user.role !== 'admin') {
        return res.status(403).json({ error: '팀 리더만 기부할 수 있습니다' });
    }
    
    if (!recipient_team_id || !product_id || !quantity || quantity <= 0) {
        return res.status(400).json({ error: '받는 팀, 상품, 수량을 모두 입력해주세요' });
    }
    
    if (recipient_team_id == req.session.user.team_id) {
        return res.status(400).json({ error: '자신의 팀에게는 기부할 수 없습니다' });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    db.serialize(() => {
        // Check if product exists and has stock
        db.get('SELECT * FROM products WHERE id = ? AND is_active = 1', [product_id], (err, product) => {
            if (err) {
                db.close();
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!product) {
                db.close();
                return res.status(404).json({ error: '상품을 찾을 수 없거나 비활성 상태입니다' });
            }
            
            if (product.stock_quantity < quantity) {
                db.close();
                return res.status(400).json({ error: `재고가 부족합니다. 현재 재고: ${product.stock_quantity}개` });
            }
            
            const totalCost = product.price * quantity;
            
            // Check if donor has enough balance
            if (req.session.user.balance < totalCost) {
                db.close();
                return res.status(400).json({ error: `잔액이 부족합니다. 필요: $${totalCost}, 보유: $${req.session.user.balance}` });
            }
            
            // Check if recipient team exists
            db.get('SELECT id, name FROM teams WHERE id = ?', [recipient_team_id], (err, recipientTeam) => {
                if (err) {
                    db.close();
                    return res.status(500).json({ error: 'Database error' });
                }
                
                if (!recipientTeam) {
                    db.close();
                    return res.status(404).json({ error: '받는 팀을 찾을 수 없습니다' });
                }
                
                // Get recipient team leader
                db.get('SELECT id FROM users WHERE team_id = ? AND role = "team_leader"', [recipient_team_id], (err, recipientLeader) => {
                    if (err) {
                        db.close();
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    // Begin transaction
                    db.run('BEGIN TRANSACTION', (err) => {
                        if (err) {
                            db.close();
                            return res.status(500).json({ error: 'Transaction error' });
                        }
                        
                        // 1. Deduct money from donor's balance
                        db.run('UPDATE users SET balance = balance - ? WHERE id = ?',
                            [totalCost, req.session.user.id], (err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                db.close();
                                return res.status(500).json({ error: '잔액 차감 실패' });
                            }
                            
                            // 2. Decrease product stock
                            db.run('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
                                [quantity, product_id], (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    db.close();
                                    return res.status(500).json({ error: '재고 업데이트 실패' });
                                }
                                
                                // 3. Add to recipient team inventory
                                db.run(`INSERT OR REPLACE INTO team_inventory (team_id, product_id, quantity, obtained_from, reference_id) 
                                        VALUES (?, ?, COALESCE((SELECT quantity FROM team_inventory WHERE team_id = ? AND product_id = ?), 0) + ?, 'donation', ?)`,
                                    [recipient_team_id, product_id, recipient_team_id, product_id, quantity, 0], (err) => {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        db.close();
                                        return res.status(500).json({ error: '인벤토리 업데이트 실패' });
                                    }
                                    
                                    // 4. Create donation record
                                    db.run('INSERT INTO donations (donor_id, recipient_id, product_id, amount, quantity, message, donor_team_id, recipient_team_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                                        [req.session.user.id, recipientLeader?.id, product_id, totalCost, quantity, message || '', req.session.user.team_id, recipient_team_id], 
                                        function(err) {
                                        if (err) {
                                            db.run('ROLLBACK');
                                            db.close();
                                            return res.status(500).json({ error: '기부 기록 생성 실패' });
                                        }
                                        
                                        const donationId = this.lastID;
                                        
                                        // 5. Record transaction for donor (spending money)
                                        db.run('INSERT INTO transactions (user_id, type, amount, description, reference_id) VALUES (?, ?, ?, ?, ?)',
                                            [req.session.user.id, 'donation_sent', -totalCost, `${recipientTeam.name}에게 ${product.name} ${quantity}개 기부 (상점에서 구매)`, donationId], (err) => {
                                            if (err) {
                                                console.log('Error recording donor transaction:', err.message);
                                            }
                                            
                                            // 6. Record transaction for recipient (if leader found)
                                            if (recipientLeader) {
                                                db.run('INSERT INTO transactions (user_id, type, amount, description, reference_id) VALUES (?, ?, ?, ?, ?)',
                                                    [recipientLeader.id, 'donation_received', 0, `${req.session.user.team_name || 'Unknown'}팀으로부터 ${product.name} ${quantity}개 기부받음`, donationId], (err) => {
                                                    if (err) {
                                                        console.log('Error recording recipient transaction:', err.message);
                                                    }
                                                });
                                            }
                                            
                                            // 7. Update user session balance
                                            req.session.user.balance -= totalCost;
                                            
                                            // 8. Check if product is now out of stock and auto-deactivate
                                            db.get('SELECT stock_quantity FROM products WHERE id = ?', [product_id], (err, updatedProduct) => {
                                                if (!err && updatedProduct && updatedProduct.stock_quantity <= 0) {
                                                    db.run('UPDATE products SET is_active = 0 WHERE id = ?', [product_id]);
                                                }
                                            });
                                            
                                            // 9. Commit transaction
                                            db.run('COMMIT', (err) => {
                                                db.close();
                                                if (err) {
                                                    return res.status(500).json({ error: '기부 완료 실패' });
                                                }
                                                res.json({ 
                                                    success: true, 
                                                    message: `${recipientTeam.name}에게 ${product.name} ${quantity}개를 성공적으로 기부했습니다! (총 $${totalCost} 지출)`,
                                                    newBalance: req.session.user.balance
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

// Get store products for donation (team leaders only)
router.get('/donation-products', (req, res) => {
    // Only team leaders can access this
    if (req.session.user.role !== 'team_leader' && req.session.user.role !== 'admin') {
        return res.status(403).json({ error: '팀 리더만 기부할 수 있습니다' });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    db.all('SELECT id, name, price, stock_quantity, category FROM products WHERE is_active = 1 AND stock_quantity > 0 ORDER BY category, name', 
        (err, products) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ products });
    });
});

module.exports = router;