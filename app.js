const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDatabase } = require('./database/init_universal');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'retreat-2025-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set to false for now to fix login issues
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Helper function for consistent date formatting
app.locals.formatDate = function(dateString) {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
};

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
}

function requireAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).send('Access denied');
    }
}

function requireTeamLeader(req, res, next) {
    if (req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'team_leader')) {
        next();
    } else {
        res.status(403).send('Access denied - Team leaders only');
    }
}

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');
const storeRoutes = require('./routes/store');

app.use('/auth', authRoutes);
app.use('/admin', requireAdmin, adminRoutes);
app.use('/user', requireAuth, userRoutes);
app.use('/store', requireAuth, storeRoutes);

// Main routes
app.get('/', (req, res) => {
    if (req.session.user) {
        if (req.session.user.role === 'admin') {
            res.redirect('/admin/dashboard');
        } else {
            res.redirect('/user/dashboard');
        }
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.get('/dashboard', requireAuth, (req, res) => {
    if (req.session.user.role === 'admin') {
        res.redirect('/admin/dashboard');
    } else {
        res.redirect('/user/dashboard');
    }
});

// 🔍 DEBUG: Environment and database status endpoint
app.get('/debug-status', requireAdmin, (req, res) => {
    const { Database, isProduction } = require('./database/config');
    
    const status = {
        environment: {
            NODE_ENV: process.env.NODE_ENV,
            DATABASE_URL_exists: !!process.env.DATABASE_URL,
            DATABASE_URL_type: process.env.DATABASE_URL ? 
                (process.env.DATABASE_URL.startsWith('postgresql://') ? 'PostgreSQL' : 'Other') : 'None',
            isProduction: isProduction,
            PORT: process.env.PORT
        },
        database: {
            type: isProduction && process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite',
            connected: true // We'll update this with actual connection test
        },
        server: {
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        }
    };
    
    res.json(status);
});

// Initialize database and start server
async function startServer() {
    try {
        await initDatabase();
        
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`Database: ${process.env.DATABASE_URL ? 'PostgreSQL (Production)' : 'SQLite (Development)'}`);
            
            // Start keep-alive service in production
            if (process.env.NODE_ENV === 'production' && false) { // 🔴 임시 비활성화 for testing
                console.log('🚀 Starting keep-alive service to prevent sleep...');
                require('./keep-alive');
            } else if (process.env.NODE_ENV === 'production') {
                console.log('⚠️ Keep-alive service DISABLED for testing data persistence');
            }
        });
    } catch (error) {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    }
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('Page not found');
});

startServer();

module.exports = app;