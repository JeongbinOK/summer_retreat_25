-- PostgreSQL schema for Church Summer Retreat 2025
-- This file contains the database schema converted from SQLite to PostgreSQL

-- Users table (create first, no foreign keys initially)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'participant' CHECK (role IN ('admin', 'team_leader', 'participant')),
    team_id INTEGER,
    balance INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Teams table (create second, can reference users now)
CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    leader_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price INTEGER NOT NULL,
    category VARCHAR(50) DEFAULT 'item',
    stock_quantity INTEGER DEFAULT 0,
    initial_stock INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    team_id INTEGER NOT NULL REFERENCES teams(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    total_price INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'cancelled')),
    verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type VARCHAR(30) NOT NULL CHECK (type IN ('earn', 'purchase', 'donation_sent', 'donation_received', 'admin_adjustment')),
    amount INTEGER NOT NULL,
    description TEXT,
    reference_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Money codes table
CREATE TABLE IF NOT EXISTS money_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    amount INTEGER NOT NULL,
    used_by INTEGER REFERENCES users(id),
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Team inventory table
CREATE TABLE IF NOT EXISTS team_inventory (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL DEFAULT 0,
    obtained_from VARCHAR(20) DEFAULT 'purchase' CHECK (obtained_from IN ('purchase', 'donation')),
    reference_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, product_id)
);

-- Donations table
CREATE TABLE IF NOT EXISTS donations (
    id SERIAL PRIMARY KEY,
    donor_id INTEGER NOT NULL REFERENCES users(id),
    recipient_id INTEGER REFERENCES users(id),
    donor_team_id INTEGER NOT NULL REFERENCES teams(id),
    recipient_team_id INTEGER NOT NULL REFERENCES teams(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    amount INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key constraints after all tables are created
ALTER TABLE teams ADD CONSTRAINT fk_teams_leader 
    FOREIGN KEY (leader_id) REFERENCES users(id);

ALTER TABLE users ADD CONSTRAINT fk_users_team 
    FOREIGN KEY (team_id) REFERENCES teams(id);

ALTER TABLE orders ADD CONSTRAINT fk_orders_user 
    FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE orders ADD CONSTRAINT fk_orders_team 
    FOREIGN KEY (team_id) REFERENCES teams(id);

ALTER TABLE orders ADD CONSTRAINT fk_orders_product 
    FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE transactions ADD CONSTRAINT fk_transactions_user 
    FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE money_codes ADD CONSTRAINT fk_money_codes_user 
    FOREIGN KEY (used_by) REFERENCES users(id);

ALTER TABLE team_inventory ADD CONSTRAINT fk_team_inventory_team 
    FOREIGN KEY (team_id) REFERENCES teams(id);

ALTER TABLE team_inventory ADD CONSTRAINT fk_team_inventory_product 
    FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE donations ADD CONSTRAINT fk_donations_donor 
    FOREIGN KEY (donor_id) REFERENCES users(id);

ALTER TABLE donations ADD CONSTRAINT fk_donations_recipient 
    FOREIGN KEY (recipient_id) REFERENCES users(id);

ALTER TABLE donations ADD CONSTRAINT fk_donations_donor_team 
    FOREIGN KEY (donor_team_id) REFERENCES teams(id);

ALTER TABLE donations ADD CONSTRAINT fk_donations_recipient_team 
    FOREIGN KEY (recipient_team_id) REFERENCES teams(id);

ALTER TABLE donations ADD CONSTRAINT fk_donations_product 
    FOREIGN KEY (product_id) REFERENCES products(id);

-- Insert initial teams (Korean names) - Only if they don't exist
INSERT INTO teams (name) VALUES 
    ('A그룹'),
    ('B그룹'),
    ('C그룹'),
    ('D그룹'),
    ('E그룹'),
    ('F그룹')
ON CONFLICT (name) DO NOTHING;

-- Insert admin user (password: akftmaryghl)
INSERT INTO users (username, password_hash, role, balance) VALUES 
    ('admin', '$2b$10$8vF0qGqyGJWWqO5HXaQ8KO7pB5fM5fB5xM5aQ5eM5tO5wQ5zO5yM5u', 'admin', 0)
ON CONFLICT (username) DO NOTHING;