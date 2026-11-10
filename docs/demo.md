# Kindergarten Management System — Demo

## Demo scenario

1. Start Docker Compose and check container health.
2. Apply PostgreSQL migrations.
3. Bootstrap the administrator if one does not exist.
4. Log in as administrator through Bruno.
5. Retrieve rooms using GET /api/v1/rooms.
6. Retrieve groups using GET /api/v1/groups.
7. Retrieve employees using GET /api/v1/employees.
8. Retrieve children using GET /api/v1/children.
9. Retrieve invoices and payments using the Finance
   requests in Bruno.
10. Run the financial report and break-even request
    using Finance and Reports in Bruno.

## Additional scenarios after dependent PRs merge

- Attendance (#53)
- Archiving children and parents (#52)
- Full audit history (#55)

## Verification

- Confirm authentication succeeds.
- Confirm protected requests do not return 401
  when the correct token is supplied.
- Confirm expected response bodies.
- Record actual HTTP statuses and test results.
- Run automated tests before opening the PR.

## Important

This document is a demo plan, not evidence
that the scenarios have passed.
