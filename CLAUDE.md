# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Church Summer Retreat Web Service

A temporary 3-day web service for managing virtual currency, team-based purchasing, and donations for a church summer retreat with ~30 participants.

## Common Commands

- `npm start` or `npm run dev` - Start the web server (http://localhost:3000)
- `node app.js` - Alternative way to start the server
- Default admin login: admin / admin123

## Architecture

**Technology Stack:**
- Backend: Node.js + Express.js
- Database: SQLite (single file: `database/retreat.db`)
- Frontend: EJS templates + Bootstrap + vanilla JavaScript
- Session management: express-session

**Key Components:**
- `app.js` - Main server application with middleware and route setup
- `database/init.js` - Database schema initialization and sample data
- `routes/` - Route handlers for auth, admin, user, and store functionality
- `views/` - EJS templates organized by user type (admin, user, store)

**User Roles:**
- **Admin**: Full system management (users, teams, products, money codes, order verification)
- **Team Leader**: Can make purchases for their team in the store
- **Participant**: Can redeem money codes, view team, donate to others

**Core Features:**
1. Virtual currency system with admin-generated money codes
2. Team-based organization (6 teams, 3-4 members each)
3. Store with products/services (only team leaders can purchase)
4. Donation system (donate money to help others buy specific items)
5. Order verification system for physical fulfillment
6. Transaction logging and balance tracking

**Database Schema:**
- `users` - User accounts with roles and team assignments
- `teams` - Team organization with leaders
- `products` - Store items with prices and categories
- `transactions` - All money movements (earn, spend, donate)
- `orders` - Purchase records requiring verification
- `donations` - Targeted donations between users
- `money_codes` - Admin-generated codes for money distribution

## Security Notes

- Passwords are hashed with bcrypt
- Session-based authentication
- Role-based access control
- SQLite database is file-based (easy backup/restore)

# Git commit ment
- Don't write anything about Claude.