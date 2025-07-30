const express = require('express');
const { PostgreSQLDatabase } = require('../database/postgres');

const router = express.Router();

// Store main page
router.get('/', async (req, res) => {
    const db = new PostgreSQLDatabase();
    
    try {
        const products = await db.query('SELECT * FROM products WHERE is_active = true ORDER BY category, name');
        
        // Ensure stock_quantity defaults to 0 if null/undefined
        const processedProducts = products.map(product => ({
            ...product,
            stock_quantity: product.stock_quantity || 0
        }));
        
        res.render('store/index', { products: processedProducts, user: req.session.user });
    } catch (err) {
        console.error('Store main page error:', err);
        return res.status(500).send('Database error');
    }
});

// Purchase item (Team leaders only)
router.post('/purchase', async (req, res) => {
    const { product_id, quantity = 1 } = req.body;
    
    // Check if user is team leader
    if (req.session.user.role !== 'team_leader' && req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only team leaders can make purchases' });
    }
    
    if (!product_id || quantity <= 0) {
        return res.status(400).json({ error: 'Valid product and quantity required' });
    }
    
    const db = new PostgreSQLDatabase();
    
    try {
        const transaction = await db.beginTransaction();
        
        // Get product details
        const product = await transaction.get('SELECT * FROM products WHERE id = $1 AND is_active = true', [product_id]);
        
        if (!product) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Product not found' });
        }
        
        // Check stock availability
        if ((product.stock_quantity || 0) < quantity) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Insufficient stock available' });
        }
        
        const totalPrice = product.price * quantity;
        
        // Check user balance
        const user = await transaction.get('SELECT balance FROM users WHERE id = $1', [req.session.user.id]);
        
        if (!user) {
            await transaction.rollback();
            return res.status(500).json({ error: 'User not found' });
        }
        
        if (user.balance < totalPrice) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Insufficient balance' });
        }
        
        // Deduct balance
        await transaction.run('UPDATE users SET balance = balance - $1 WHERE id = $2',
            [totalPrice, req.session.user.id]);
        
        // Create order
        const orderResult = await transaction.run(`INSERT INTO orders (user_id, team_id, product_id, quantity, total_price, status) 
                VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id`,
            [req.session.user.id, req.session.user.team_id, product_id, quantity, totalPrice]);
        
        const orderId = orderResult.lastID;
        
        // Record transaction
        await transaction.run('INSERT INTO transactions (user_id, type, amount, description, reference_id) VALUES ($1, $2, $3, $4, $5)',
            [req.session.user.id, 'purchase', -totalPrice, `Purchased ${product.name} x${quantity}`, orderId]);
        
        // Update product stock
        await transaction.run('UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
            [quantity, product_id]);
        
        // Check if product is now out of stock and auto-deactivate
        const newStock = (product.stock_quantity || 0) - quantity;
        if (newStock <= 0) {
            try {
                await transaction.run('UPDATE products SET is_active = false WHERE id = $1', [product_id]);
            } catch (err) {
                console.log('Error auto-deactivating sold out product:', err.message);
            }
        }
        
        // Add items to team inventory (UPSERT)
        await transaction.run(`INSERT INTO team_inventory (team_id, product_id, quantity, obtained_from, reference_id, created_at) 
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
            ON CONFLICT (team_id, product_id) 
            DO UPDATE SET quantity = team_inventory.quantity + EXCLUDED.quantity, 
                          reference_id = EXCLUDED.reference_id, 
                          created_at = CURRENT_TIMESTAMP`,
            [req.session.user.team_id, product_id, quantity, 'purchase', orderId]);
        
        await transaction.commit();
        
        // Update session balance
        req.session.user.balance -= totalPrice;
        
        res.json({ 
            success: true, 
            orderId: orderId,
            newBalance: req.session.user.balance,
            message: `Successfully purchased ${product.name} x${quantity}${newStock <= 0 ? ' (Product now sold out)' : ''}` 
        });
    } catch (err) {
        console.error('Purchase error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

// Get user's orders
router.get('/orders', async (req, res) => {
    const db = new PostgreSQLDatabase();
    
    try {
        const orders = await db.query(`SELECT o.*, p.name as product_name, p.description
                FROM orders o
                JOIN products p ON o.product_id = p.id
                WHERE o.user_id = $1
                ORDER BY o.created_at DESC`, [req.session.user.id]);
        
        res.json({ orders });
    } catch (err) {
        console.error('Orders error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

// NEW Donation System - Purchase from store and donate to team
router.post('/donate', async (req, res) => {
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
    
    const db = new PostgreSQLDatabase();
    
    try {
        const transaction = await db.beginTransaction();
        
        // Check if product exists and has stock
        const product = await transaction.get('SELECT * FROM products WHERE id = $1 AND is_active = true', [product_id]);
        
        if (!product) {
            await transaction.rollback();
            return res.status(404).json({ error: '상품을 찾을 수 없거나 비활성 상태입니다' });
        }
        
        if (product.stock_quantity < quantity) {
            await transaction.rollback();
            return res.status(400).json({ error: `재고가 부족합니다. 현재 재고: ${product.stock_quantity}개` });
        }
        
        const totalCost = product.price * quantity;
        
        // Check if donor has enough balance
        if (req.session.user.balance < totalCost) {
            await transaction.rollback();
            return res.status(400).json({ error: `잔액이 부족합니다. 필요: $${totalCost}, 보유: $${req.session.user.balance}` });
        }
        
        // Check if recipient team exists
        const recipientTeam = await transaction.get('SELECT id, name FROM teams WHERE id = $1', [recipient_team_id]);
        
        if (!recipientTeam) {
            await transaction.rollback();
            return res.status(404).json({ error: '받는 팀을 찾을 수 없습니다' });
        }
        
        // Get recipient team leader
        const recipientLeader = await transaction.get('SELECT id FROM users WHERE team_id = $1 AND role = $2', [recipient_team_id, 'team_leader']);
        
        // 1. Deduct money from donor's balance
        await transaction.run('UPDATE users SET balance = balance - $1 WHERE id = $2',
            [totalCost, req.session.user.id]);
        
        // 2. Decrease product stock
        await transaction.run('UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
            [quantity, product_id]);
        
        // 3. Add to recipient team inventory (UPSERT)
        await transaction.run(`INSERT INTO team_inventory (team_id, product_id, quantity, obtained_from, reference_id, created_at) 
            VALUES ($1, $2, $3, 'donation', $4, CURRENT_TIMESTAMP)
            ON CONFLICT (team_id, product_id) 
            DO UPDATE SET quantity = team_inventory.quantity + EXCLUDED.quantity, 
                          obtained_from = 'donation', 
                          reference_id = EXCLUDED.reference_id, 
                          created_at = CURRENT_TIMESTAMP`,
            [recipient_team_id, product_id, quantity, 0]);
        
        // 4. Create donation record
        const donationResult = await transaction.run('INSERT INTO donations (donor_id, recipient_id, product_id, amount, quantity, message, donor_team_id, recipient_team_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
            [req.session.user.id, recipientLeader?.id, product_id, totalCost, quantity, message || '', req.session.user.team_id, recipient_team_id]);
        
        const donationId = donationResult.lastID;
        
        // 5. Record transaction for donor (spending money)
        try {
            await transaction.run('INSERT INTO transactions (user_id, type, amount, description, reference_id) VALUES ($1, $2, $3, $4, $5)',
                [req.session.user.id, 'donation_sent', -totalCost, `${recipientTeam.name}에게 ${product.name} ${quantity}개 기부 (상점에서 구매)`, donationId]);
        } catch (err) {
            console.log('Error recording donor transaction:', err.message);
        }
        
        // 6. Record transaction for recipient (if leader found)
        if (recipientLeader) {
            try {
                await transaction.run('INSERT INTO transactions (user_id, type, amount, description, reference_id) VALUES ($1, $2, $3, $4, $5)',
                    [recipientLeader.id, 'donation_received', 0, `${req.session.user.team_name || 'Unknown'}팀으로부터 ${product.name} ${quantity}개 기부받음`, donationId]);
            } catch (err) {
                console.log('Error recording recipient transaction:', err.message);
            }
        }
        
        // 7. Update user session balance
        req.session.user.balance -= totalCost;
        
        // 8. Check if product is now out of stock and auto-deactivate
        try {
            const updatedProduct = await transaction.get('SELECT stock_quantity FROM products WHERE id = $1', [product_id]);
            if (updatedProduct && updatedProduct.stock_quantity <= 0) {
                await transaction.run('UPDATE products SET is_active = false WHERE id = $1', [product_id]);
            }
        } catch (err) {
            console.log('Error checking/updating product stock status:', err.message);
        }
        
        // 9. Commit transaction
        await transaction.commit();
        
        res.json({ 
            success: true, 
            message: `${recipientTeam.name}에게 ${product.name} ${quantity}개를 성공적으로 기부했습니다! (총 $${totalCost} 지출)`,
            newBalance: req.session.user.balance
        });
    } catch (err) {
        console.error('Donation error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

// Get available teams for donation (team leaders only)
router.get('/teams', async (req, res) => {
    // Only team leaders can access this
    if (req.session.user.role !== 'team_leader' && req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only team leaders can make donations' });
    }
    
    const db = new PostgreSQLDatabase();
    
    try {
        const teams = await db.query('SELECT id, name FROM teams WHERE id != $1', 
            [req.session.user.team_id]);
        res.json({ teams });
    } catch (err) {
        console.error('Teams error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

// Get store products for donation (team leaders only)
router.get('/donation-products', async (req, res) => {
    // Only team leaders can access this
    if (req.session.user.role !== 'team_leader' && req.session.user.role !== 'admin') {
        return res.status(403).json({ error: '팀 리더만 기부할 수 있습니다' });
    }
    
    const db = new PostgreSQLDatabase();
    
    try {
        const products = await db.query('SELECT id, name, price, stock_quantity, category FROM products WHERE is_active = true AND stock_quantity > 0 ORDER BY category, name');
        res.json({ products });
    } catch (err) {
        console.error('Donation products error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;