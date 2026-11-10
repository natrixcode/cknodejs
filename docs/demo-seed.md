# Demo seed

The demo setup prepares sample data for local testing and QA.

The SQL seed is located at:

`database/seeds/demo.sql`

Demo account creation is implemented in:

`scripts/seed-demo-users.js`

## Run

Start Docker Compose, apply migrations and bootstrap the
first administrator.

Then run:

```sh
docker compose exec -e DEMO_PASSWORD=YOUR_LOCAL_TEST_PASSWORD server npm run demo:setup
```

The password must contain at least 12 characters.

## Demo accounts

| Username | Role |
| --- | --- |
| demo_manager | manager |
| demo_educator | employee (educator) |
| demo_assistant | employee (assistant) |
| demo_teacher | teacher |
| demo_parent | parent |

All demo accounts use the password supplied through
DEMO_PASSWORD.

The administrator is created separately through
`npm run bootstrap:admin`.

## Safety

- Demo setup is disabled in production.
- The seed does not delete existing data.
- Demo account creation skips existing usernames.
- The seed does not create an administrator.
- Demo data is separate from numbered SQL migrations.
- Never commit real passwords or tokens.

## Bruno authentication

Open the Bruno collection and select the Local environment.

Set admin_username, admin_password and demo_password locally.

Use Auth/Login for administrator authentication or
Demo Manager Login for manager authentication.

Successful login saves the token in the Bruno runtime
variable `token`. Protected requests inherit the
collection Bearer token.

Employees - No Auth explicitly disables authorization
to test unauthorized access.
