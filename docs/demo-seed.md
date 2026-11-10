# Demo seed

The demo seed adds two rooms and two subjects.

## Run

Start Docker Compose and apply migrations first.

Then execute:

docker compose exec server npm run db:seed

## Safety

- Does not delete existing data.
- Uses ON CONFLICT to prevent duplicate names.
- Does not create an administrator.
- Does not modify migrations.
- Does not create financial transactions.
- Disabled when NODE_ENV=production.

## Bruno authentication

The Login request is located at:

bruno/Auth/Login.yml

Replace the placeholder credentials locally.
Do not commit real passwords.

Other protected requests use:

Authorization: Bearer {{token}}

Automatic token extraction still needs to be
configured for the actual Bruno collection format
and login response structure.
