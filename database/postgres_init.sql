-- PostgreSQL schema for Church Summer Retreat 2025
-- This file contains the database schema converted from SQLite to PostgreSQL

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    leader_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'participant' CHECK (role IN ('admin', 'team_leader', 'participant')),
    team_id INTEGER REFERENCES teams(id),
    balance INTEGER DEFAULT 0,
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

-- Insert initial teams (Korean names)
INSERT INTO teams (name) VALUES 
    ('A그룹'),
    ('B그룹'),
    ('C그룹'),
    ('D그룹'),
    ('E그룹'),
    ('F그룹')
ON CONFLICT DO NOTHING;

-- Insert admin user (password: admin123)
INSERT INTO users (username, password_hash, role, balance) VALUES 
    ('admin', '$2b$10$8vF0qGqyGJWWqO5HXaQ8KO7pB5fM5fB5xM5aQ5eM5tO5wQ5zO5yM5u', 'admin', 0)
ON CONFLICT (username) DO NOTHING;