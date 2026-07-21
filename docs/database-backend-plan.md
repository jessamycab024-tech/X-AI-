# Database-Backed Backend Plan

## Current status
The prototype uses file-based storage by default, but the architecture is ready to switch to a real database-backed backend.

## Recommended database options
- PostgreSQL for relational data such as users, subscriptions, and invoices.
- Redis for caching and session state.
- Object storage for generated assets and media.

## Suggested next implementation steps
1. Add a database client and connection management.
2. Migrate user, project, and billing data from file storage to the database.
3. Add migrations and seed scripts.
4. Introduce environment-based configuration for database credentials.
