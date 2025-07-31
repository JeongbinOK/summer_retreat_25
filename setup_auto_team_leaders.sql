-- Complete Database Setup Script for Automatic Team Leader Assignment
-- Run this script in Supabase SQL Editor after CSV imports

-- =============================================================================
-- 1. CREATE TRIGGER FUNCTION FOR AUTOMATIC TEAM LEADER ASSIGNMENT
-- =============================================================================

CREATE OR REPLACE FUNCTION update_team_leader()
RETURNS TRIGGER AS $$
BEGIN
    -- When a user is inserted or updated with team_leader role
    IF NEW.role = 'team_leader' AND NEW.team_id IS NOT NULL THEN
        
        -- Update the team's leader_id to point to this user
        UPDATE teams 
        SET leader_id = NEW.id 
        WHERE id = NEW.team_id;
        
        -- Demote any other team_leader in the same team to participant
        UPDATE users 
        SET role = 'participant' 
        WHERE team_id = NEW.team_id 
          AND role = 'team_leader' 
          AND id != NEW.id;
          
        RAISE NOTICE 'Team leader updated: User % is now leader of team %', NEW.username, NEW.team_id;
    END IF;
    
    -- Handle role changes from team_leader to something else
    IF OLD.role = 'team_leader' AND NEW.role != 'team_leader' THEN
        UPDATE teams 
        SET leader_id = NULL 
        WHERE leader_id = NEW.id;
        
        RAISE NOTICE 'Team leader removed: User % is no longer a team leader', NEW.username;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 2. CREATE TRIGGER
-- =============================================================================

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_update_team_leader ON users;

-- Create new trigger
CREATE TRIGGER trigger_update_team_leader
    AFTER INSERT OR UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_team_leader();

-- =============================================================================
-- 3. CREATE SYNC FUNCTION FOR EXISTING DATA
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_all_team_leaders()
RETURNS TABLE(team_id INTEGER, team_name VARCHAR, leader_id INTEGER, leader_name VARCHAR) AS $$
BEGIN
    -- Update all teams with their current team_leader users
    UPDATE teams SET leader_id = (
        SELECT u.id FROM users u 
        WHERE u.team_id = teams.id AND u.role = 'team_leader' 
        LIMIT 1
    ) WHERE EXISTS (
        SELECT 1 FROM users u2 
        WHERE u2.team_id = teams.id AND u2.role = 'team_leader'
    );
    
    -- Return verification results
    RETURN QUERY
    SELECT 
        t.id as team_id,
        t.name as team_name,
        t.leader_id,
        u.username as leader_name
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    ORDER BY t.id;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 4. EXECUTE SYNC FOR EXISTING DATA
-- =============================================================================

-- Run the sync function to fix current data
SELECT * FROM sync_all_team_leaders();

-- =============================================================================
-- 5. VERIFICATION QUERIES
-- =============================================================================

-- Check team leader assignments
SELECT 
    t.id as team_id,
    t.name as team_name,
    t.leader_id,
    u.username as leader_name,
    u.role as leader_role,
    CASE 
        WHEN t.leader_id IS NULL THEN '❌ No Leader'
        WHEN u.role != 'team_leader' THEN '⚠️ Leader role mismatch'
        ELSE '✅ OK'
    END as status
FROM teams t
LEFT JOIN users u ON t.leader_id = u.id
ORDER BY t.id;

-- Check for multiple team leaders in same team (should be empty)
SELECT 
    team_id,
    COUNT(*) as leader_count,
    STRING_AGG(username, ', ') as leaders
FROM users 
WHERE role = 'team_leader' 
GROUP BY team_id 
HAVING COUNT(*) > 1;

-- =============================================================================
-- 6. SAMPLE TEST DATA CREATION (OPTIONAL - UNCOMMENT IF NEEDED)
-- =============================================================================

/*
-- Create sample transactions for testing ranking calculations
-- Run this only if you need test data for ranking scores

DO $$
DECLARE
    leader_user RECORD;
BEGIN
    -- Add money (earn transactions) to each team leader
    FOR leader_user IN 
        SELECT id, username, team_id 
        FROM users 
        WHERE role = 'team_leader' 
        ORDER BY team_id
    LOOP
        -- Add earn transaction (money code)
        INSERT INTO transactions (user_id, type, amount, description) 
        VALUES (
            leader_user.id, 
            'earn', 
            10000 + (leader_user.team_id * 1000), -- Different amounts per team
            'Test money code for ranking'
        );
        
        -- Add donation_sent transaction for some teams
        IF leader_user.team_id <= 3 THEN
            INSERT INTO transactions (user_id, type, amount, description) 
            VALUES (
                leader_user.id, 
                'donation_sent', 
                -(500 + (leader_user.team_id * 200)), -- Negative for donation sent
                'Test donation to other team'
            );
        END IF;
        
        RAISE NOTICE 'Created test transactions for user % (team %)', leader_user.username, leader_user.team_id;
    END LOOP;
END $$;

-- Verify test transactions
SELECT 
    u.username,
    t.name as team_name,
    tr.type,
    tr.amount,
    tr.description
FROM transactions tr
JOIN users u ON tr.user_id = u.id
JOIN teams t ON u.team_id = t.id
WHERE tr.description LIKE 'Test%'
ORDER BY t.id, tr.type;
*/

-- =============================================================================
-- 7. FINAL STATUS REPORT
-- =============================================================================

SELECT 'Setup completed! Team leader auto-assignment is now active.' as status;
SELECT 'Trigger: trigger_update_team_leader' as trigger_name;
SELECT 'Function: update_team_leader()' as function_name;
SELECT 'Sync Function: sync_all_team_leaders()' as sync_function;