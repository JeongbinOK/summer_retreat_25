// Script to update team names directly in database
// Usage: node update_team_names.js

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'retreat.db');

function updateTeamNames() {
    console.log('🔄 Updating team names to A-F 그룹...');
    
    const db = new sqlite3.Database(dbPath);
    
    const teamUpdates = [
        { id: 1, name: 'A그룹' },
        { id: 2, name: 'B그룹' },
        { id: 3, name: 'C그룹' },
        { id: 4, name: 'D그룹' },
        { id: 5, name: 'E그룹' },
        { id: 6, name: 'F그룹' }
    ];
    
    let completed = 0;
    const total = teamUpdates.length;
    
    teamUpdates.forEach(team => {
        db.run(
            'UPDATE teams SET name = ? WHERE id = ?',
            [team.name, team.id],
            function(err) {
                if (err) {
                    console.log(`❌ Error updating team ${team.id}:`, err.message);
                } else {
                    console.log(`✅ Updated team ${team.id} to "${team.name}"`);
                }
                
                completed++;
                if (completed === total) {
                    console.log(`🎉 Successfully updated ${total} teams!`);
                    console.log('📋 Team names are now: A그룹, B그룹, C그룹, D그룹, E그룹, F그룹');
                    
                    db.close((err) => {
                        if (err) {
                            console.log('⚠️ Warning: Error closing database:', err.message);
                        }
                        process.exit(0);
                    });
                }
            }
        );
    });
}

updateTeamNames();