-- Fix team leader assignments after CSV import
-- This script should be run in Supabase after importing users_data.csv

-- Update teams table to assign leader_id for each team
-- This connects the team_leader role users to their respective teams

UPDATE teams SET leader_id = (
    SELECT id FROM users 
    WHERE team_id = teams.id AND role = 'team_leader' 
    LIMIT 1
) WHERE EXISTS (
    SELECT 1 FROM users 
    WHERE team_id = teams.id AND role = 'team_leader'
);

-- Verify the results
SELECT 
    t.id as team_id,
    t.name as team_name,
    t.leader_id,
    u.username as leader_name,
    u.role as leader_role
FROM teams t
LEFT JOIN users u ON t.leader_id = u.id
ORDER BY t.id;