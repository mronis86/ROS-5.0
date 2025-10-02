# Authentication Setup for ROS-5.0

## Problem Identified
Your React app was using **fake authentication** that only stored users in localStorage, never in the Neon database. Users were never actually stored in the database, which is why you couldn't see them in Neon.

## Solution Implemented

### 1. ✅ Added Authentication Endpoints to API Server
- **File**: `api-server.js`
- **Endpoints Added**:
  - `POST /api/auth/signup` - Creates new users in Neon database
  - `POST /api/auth/signin` - Authenticates existing users
- **Database**: Uses `user_profiles` table to store user data

### 2. ✅ Created Database Schema
- **File**: `sql/setup-user-tables.sql`
- **Tables Created**:
  - `user_profiles` - Stores user information (email, full_name, role)
  - `user_sessions` - Tracks user sessions per event
- **Features**: Proper indexes, triggers for updated_at, foreign key constraints

### 3. ✅ Updated React Auth Service
- **File**: `src/services/auth-service.ts`
- **Changes**:
  - `signIn()` now calls `/api/auth/signin` endpoint
  - `signUp()` now calls `/api/auth/signup` endpoint
  - Users are now stored in Neon database, not just localStorage
  - Still uses localStorage for session management (but with real user data)

## Next Steps Required

### 1. 🚨 **CRITICAL**: Run Database Migration
You need to run the SQL script to create the user tables in your Neon database:

```sql
-- Run this in your Neon database:
-- File: sql/setup-user-tables.sql
```

### 2. 🚨 **CRITICAL**: Deploy Updated API Server
Your API server needs to be updated with the new authentication endpoints:

```bash
# Deploy the updated api-server.js to Railway
```

### 3. Test the Authentication Flow
Run the test script to verify everything works:

```bash
node test-auth.js
```

## How It Works Now

### User Registration Flow:
1. User fills out signup form in React app
2. React app calls `POST /api/auth/signup` with email, password, full_name
3. API server creates user in `user_profiles` table in Neon database
4. API server returns user data (user_id, email, full_name, role)
5. React app stores user session in localStorage

### User Login Flow:
1. User fills out signin form in React app
2. React app calls `POST /api/auth/signin` with email, password
3. API server looks up user in `user_profiles` table
4. API server returns user data if found
5. React app stores user session in localStorage

### Database Storage:
- **Users are now stored in Neon database** in the `user_profiles` table
- **User sessions** are tracked in the `user_sessions` table
- **All API calls** now include real user_id from the database

## Files Modified:
- ✅ `api-server.js` - Added authentication endpoints
- ✅ `src/services/auth-service.ts` - Updated to use real API
- ✅ `sql/setup-user-tables.sql` - Database schema (NEW)
- ✅ `test-auth.js` - Test script (NEW)
- ✅ `AUTHENTICATION_SETUP.md` - This documentation (NEW)

## Files That Need Action:
- 🚨 **Run SQL migration** in Neon database
- 🚨 **Deploy updated API server** to Railway
- 🚨 **Test the complete flow** with the test script

## Security Notes:
- Currently accepts any password (for testing)
- In production, you should hash passwords with bcrypt
- Consider adding JWT tokens for session management
- Add rate limiting to prevent brute force attacks
