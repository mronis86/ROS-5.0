# SQL Database Files

This folder contains all SQL schema and migration files for the Run of Show application.

## File Categories

### Core Schema Files
- `complete-schema.sql` - Main database schema
- `run-of-show-schema.sql` - Core run of show tables
- `supabase-schema.sql` - Supabase-specific schema

### Authentication & Users
- `auth-schema.sql` - Authentication tables and functions
- `auth-schema-minimal.sql` - Simplified auth schema
- `auth-schema-simplified.sql` - Basic auth setup
- `user-sessions-schema.sql` - User session management
- `active-users-schema.sql` - Active user tracking

### Timer System
- `complete-timer-schema.sql` - Complete timer functionality
- `active-timers-schema.sql` - Active timer management
- `timer-actions-schema.sql` - Timer action definitions
- `sub-cue-timers-schema.sql` - Sub-cue timer system

### Change Logging
- `change-log-schema.sql` - Change tracking system
- `complete-change-log-system.sql` - Full change log implementation
- `simple-change-tracking.sql` - Basic change tracking

### Migration & Fixes
- `migrate-timer-states.sql` - Timer state migrations
- `fix-*.sql` - Various database fixes and corrections
- `setup-*.sql` - Setup and initialization scripts

### Testing & Utilities
- `check-*.sql` - Database validation scripts
- `test-*.sql` - Test data and validation
- `cleanup-*.sql` - Cleanup and maintenance scripts

## Usage

1. **Initial Setup**: Start with `complete-schema.sql` or `setup-complete-system.sql`
2. **Migrations**: Apply relevant migration files in chronological order
3. **Fixes**: Apply any `fix-*.sql` files as needed
4. **Testing**: Use `test-*.sql` files for validation

## Notes

- Files are organized by functionality and purpose
- Some files may be duplicates or variations of the same functionality
- Always backup your database before applying schema changes
- Test in a development environment first





