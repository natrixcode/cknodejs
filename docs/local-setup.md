# Local setup

## Requirements

- Docker Desktop
- Git
- Bruno
- Node.js 24 (for local npm commands)

## Initial setup

1. Copy environment configuration:

   cp .env.example .env

2. Start PostgreSQL and API:

   docker compose up -d --build --wait

3. Apply database migrations:

   docker compose exec server npm run db:migrate

4. Create the first administrator:

   docker compose exec -it server npm run bootstrap:admin

The bootstrap script asks for username, name,
email and password (minimum 12 characters).

Only one administrator is allowed.

## Authentication

POST http://localhost:3000/api/v1/auth/login

Use the login credentials created during bootstrap.

Send the returned token in protected requests:

Authorization: Bearer YOUR_TOKEN

## Role access

See docs/access-matrix.md.

## Bruno

Open the bruno directory as a collection.

Configure the login request and collection-level
Bearer authentication according to the existing
YAML collection format.

## Notes

Use only local test credentials for demo accounts.
Never commit .env, real passwords or tokens.
