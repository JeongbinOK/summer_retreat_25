-- Create Test Ranking Data Script
-- Use this script to generate sample transactions for testing ranking calculations
-- Run this in Supabase SQL Editor ONLY if you need test data

-- =============================================================================
-- 1. CHECK CURRENT TRANSACTION DATA
-- =============================================================================

-- Check if transactions already exist
SELECT 
    COUNT(*) as total_transactions,
    COUNT(CASE WHEN type = 'earn' THEN 1 END) as earn_count,
    COUNT(CASE WHEN type = 'donation_sent' THEN 1 END) as donation_sent_count,
    COUNT(CASE WHEN type = 'purchase' THEN 1 END) as purchase_count
FROM transactions;

-- Check current team leader status
SELECT 
    t.id as team_id,
    t.name as team_name,
    u.username as leader_name,
    u.role as leader_role,
    u.balance as leader_balance
FROM teams t
LEFT JOIN users u ON t.leader_id = u.id
ORDER BY t.id;

-- =============================================================================
-- 2. CREATE SAMPLE TRANSACTIONS FOR RANKING TESTING
-- =============================================================================

DO $$
DECLARE
    team_record RECORD;
    base_amount INTEGER := 100000; -- Base amount for testing
BEGIN
    -- Loop through each team and create test data
    FOR team_record IN 
        SELECT 
            t.id as team_id,
            t.name as team_name,
            u.id as leader_id,
            u.username as leader_name
        FROM teams t
        JOIN users u ON t.leader_id = u.id
        WHERE u.role = 'team_leader'
        ORDER BY t.id
    LOOP
        RAISE NOTICE 'Creating test data for team % (%) - Leader: %', 
            team_record.team_id, team_record.team_name, team_record.leader_name;
        
        -- 1. Create earn transaction (money code redemption)
        INSERT INTO transactions (user_id, type, amount, description) 
        VALUES (
            team_record.leader_id, 
            'earn', 
            base_amount * team_record.team_id, -- Different amounts: 100k, 200k, 300k, etc.
            FORMAT('Test money code for %s', team_record.team_name)
        );
        
        -- 2. Create donation_sent transaction for some teams (to create ranking differences)
        IF team_record.team_id <= 4 THEN
            INSERT INTO transactions (user_id, type, amount, description) 
            VALUES (
                team_record.leader_id, 
                'donation_sent', 
                -(base_amount * team_record.team_id * 0.1), -- 10% of earned amount as donation
                FORMAT('Test donation from %s to other teams', team_record.team_name)
            );
        END IF;
        
        -- 3. Create purchase transaction for some teams
        IF team_record.team_id % 2 = 1 THEN -- Odd teams make purchases
            INSERT INTO transactions (user_id, type, amount, description) 
            VALUES (
                team_record.leader_id, 
                'purchase', 
                -(base_amount * team_record.team_id * 0.05), -- 5% of earned amount as purchase
                FORMAT('Test purchase by %s', team_record.team_name)
            );
        END IF;
        
        -- 4. Update user balance to reflect transactions
        UPDATE users 
        SET balance = (
            SELECT COALESCE(SUM(amount), 0) 
            FROM transactions 
            WHERE user_id = team_record.leader_id
        )
        WHERE id = team_record.leader_id;
        
    END LOOP;
    
    RAISE NOTICE 'Test data creation completed!';
END $$;

-- =============================================================================
-- 3. VERIFY CREATED DATA
-- =============================================================================

-- Check transactions created
SELECT 
    t.name as team_name,
    u.username as leader_name,
    tr.type,
    tr.amount,
    tr.description,
    tr.created_at
FROM transactions tr
JOIN users u ON tr.user_id = u.id
JOIN teams t ON u.team_id = t.id
WHERE tr.description LIKE 'Test%'
ORDER BY t.id, tr.type, tr.created_at;

-- Check calculated ranking data
SELECT 
    t.id,
    t.name as team_name,
    COUNT(DISTINCT u.id) as member_count,
    
    -- Total earned
    COALESCE(SUM(CASE 
        WHEN tr.type = 'earn' THEN tr.amount 
        ELSE 0 
    END), 0) as total_earned,
    
    -- Total donated
    COALESCE(SUM(CASE 
        WHEN tr.type = 'donation_sent' THEN ABS(tr.amount) 
        ELSE 0 
    END), 0) as total_donated,
    
    -- Total spent
    COALESCE(SUM(CASE 
        WHEN tr.type IN ('purchase', 'donation_sent') THEN ABS(tr.amount) 
        ELSE 0 
    END), 0) as total_spent,
    
    -- Balance
    (COALESCE(SUM(CASE 
        WHEN tr.type = 'earn' THEN tr.amount 
        ELSE 0 
    END), 0) - 
    COALESCE(SUM(CASE 
        WHEN tr.type IN ('purchase', 'donation_sent') THEN ABS(tr.amount) 
        ELSE 0 
    END), 0)) as calculated_balance,
    
    -- Donation Score
    CASE 
        WHEN COALESCE(SUM(CASE WHEN tr.type = 'earn' THEN tr.amount ELSE 0 END), 0) > 0 THEN
            ROUND((COALESCE(SUM(CASE WHEN tr.type = 'donation_sent' THEN ABS(tr.amount) ELSE 0 END), 0)::NUMERIC / 
                   COALESCE(SUM(CASE WHEN tr.type = 'earn' THEN tr.amount ELSE 0 END), 0)::NUMERIC) * 100, 2)
        ELSE 0
    END as donation_score_percent
    
FROM teams t
LEFT JOIN users u ON t.id = u.team_id
LEFT JOIN transactions tr ON u.id = tr.user_id
GROUP BY t.id, t.name
ORDER BY donation_score_percent DESC;

-- =============================================================================
-- 4. INSTRUCTIONS
-- =============================================================================

SELECT '✅ Test data created successfully!' as status;
SELECT 'Now check the /admin/rankings page to see if scores display correctly' as next_step;
SELECT 'Also visit /admin/debug-rankings for detailed debugging info' as debug_tip;

-- =============================================================================
-- 5. CLEANUP SCRIPT (OPTIONAL - UNCOMMENT TO REMOVE TEST DATA)
-- =============================================================================

/*
-- DANGER: This will delete all test transactions!
-- Only run this if you want to remove the test data

DELETE FROM transactions WHERE description LIKE 'Test%';

-- Reset user balances to 0
UPDATE users SET balance = 0 WHERE role = 'team_leader';

SELECT 'Test data removed!' as cleanup_status;
*/