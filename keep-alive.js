// Keep-alive service to prevent Render from sleeping
// This prevents the app from going to sleep and losing data

const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes (before 15min timeout)
const APP_URL = 'https://summer-retreat-25.onrender.com';

async function keepAlive() {
    try {
        console.log('🏓 Sending keep-alive ping...');
        
        // Use built-in https module for Node.js compatibility
        const https = require('https');
        const url = require('url');
        const parsedUrl = url.parse(APP_URL);
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.path || '/',
            method: 'GET',
            timeout: 30000 // 30 second timeout
        };
        
        const req = https.request(options, (res) => {
            console.log(`✅ Keep-alive successful: ${res.statusCode} at ${new Date().toISOString()}`);
        });
        
        req.on('error', (error) => {
            console.error('❌ Keep-alive failed:', error.message);
        });
        
        req.on('timeout', () => {
            console.error('❌ Keep-alive timeout');
            req.destroy();
        });
        
        req.end();
        
    } catch (error) {
        console.error('❌ Keep-alive failed:', error.message);
    }
}

// Only run in production (Render)
if (process.env.NODE_ENV === 'production') {
    console.log('🚀 Starting keep-alive service...');
    console.log(`📡 Will ping ${APP_URL} every ${PING_INTERVAL / 1000 / 60} minutes`);
    
    // Start immediately
    keepAlive();
    
    // Then repeat every 14 minutes
    setInterval(keepAlive, PING_INTERVAL);
} else {
    console.log('⚠️ Keep-alive disabled in development mode');
}

module.exports = { keepAlive };