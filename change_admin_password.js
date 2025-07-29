// Script to change admin password directly in database
// Usage: node change_admin_password.js "new_password"

const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'retreat.db');

async function changeAdminPassword(newPassword) {
    if (!newPassword) {
        console.log('❌ Error: Please provide a new password');
        console.log('Usage: node change_admin_password.js "your_new_password"');
        process.exit(1);
    }

    if (newPassword.length < 6) {
        console.log('❌ Error: Password must be at least 6 characters long');
        process.exit(1);
    }

    try {
        console.log('🔐 Changing admin password...');
        
        // Hash the new password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        
        // Open database connection
        const db = new sqlite3.Database(dbPath);
        
        // Update admin password
        db.run(
            'UPDATE users SET password_hash = ? WHERE role = "admin"',
            [hashedPassword],
            function(err) {
                if (err) {
                    console.log('❌ Database Error:', err.message);
                    process.exit(1);
                }
                
                if (this.changes === 0) {
                    console.log('❌ Error: No admin user found in database');
                } else {
                    console.log('✅ Admin password successfully changed!');
                    console.log(`📧 Updated ${this.changes} admin user(s)`);
                    console.log('🔒 New password has been encrypted and stored safely');
                }
                
                db.close((err) => {
                    if (err) {
                        console.log('⚠️ Warning: Error closing database:', err.message);
                    }
                    process.exit(0);
                });
            }
        );
        
    } catch (error) {
        console.log('❌ Error:', error.message);
        process.exit(1);
    }
}

// Get password from command line argument
const newPassword = process.argv[2];
changeAdminPassword(newPassword);