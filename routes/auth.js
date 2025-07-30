const express = require('express');
const bcrypt = require('bcrypt');
const { Database } = require('../database/config');

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    try {
        const db = new Database();
        
        const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Get team information
        const team = user.team_id ? await db.get('SELECT name FROM teams WHERE id = ?', [user.team_id]) : null;
        
        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            team_id: user.team_id,
            team_name: team ? team.name : null,
            balance: user.balance
        };
        
        res.json({ success: true, user: req.session.user });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Authentication error' });
    }
});

// Logout
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Could not log out' });
        }
        res.json({ success: true });
    });
});

// Check session
router.get('/check', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

module.exports = router;