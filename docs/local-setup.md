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

Select the Local environment. Use Auth/Login or Demo Manager Login to obtain a token. Protected requests inherit the collection Bearer token.

## Notes

Use only local test credentials for demo accounts.
Never commit .env, real passwords or tokens.


## Demo setup for QA (#54)

Apply migrations and create the administrator first.

Run the demo setup with a local test password of at least
12 characters:

```sh
docker compose exec -e DEMO_PASSWORD=YOUR_LOCAL_TEST_PASSWORD server npm run demo:setup
```

Replace YOUR_LOCAL_TEST_PASSWORD with your own test password.
Do not commit the password or use a production password.

Demo accounts:

| Username | Role |
| --- | --- |
| demo_manager | manager |
| demo_educator | employee (educator) |
| demo_assistant | employee (assistant) |
| demo_teacher | teacher |
| demo_parent | parent |

All five demo accounts use the same DEMO_PASSWORD.

In Bruno, select the Local environment and set:

- admin_username: your bootstrap administrator username
- admin_password: your bootstrap administrator password
- demo_password: the same value as DEMO_PASSWORD

Run Demo Manager Login to obtain a manager token.
Run Auth/Login to obtain an administrator token.
The token is stored in the Bruno runtime variable token.

Do not commit passwords, tokens, or local secret values.
