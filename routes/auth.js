const express = require('express');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const router = express.Router();
const dbPath = path.join(__dirname, '../database/retreat.db');

// Login
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    const db = new sqlite3.Database(dbPath);
    
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user) {
            db.close();
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        try {
            const validPassword = await bcrypt.compare(password, user.password_hash);
            
            if (!validPassword) {
                db.close();
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            
            // Get team information
            db.get('SELECT name FROM teams WHERE id = ?', [user.team_id], (err, team) => {
                db.close();
                
                req.session.user = {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    team_id: user.team_id,
                    team_name: team ? team.name : null,
                    balance: user.balance
                };
                
                res.json({ success: true, user: req.session.user });
            });
            
        } catch (error) {
            db.close();
            res.status(500).json({ error: 'Authentication error' });
        }
    });
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