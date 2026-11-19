# Деактивація користувачів — Issue #76

Міграція `0032_deactivate_users.sql` додає `kms_deactivate_user(bigint)` та
заборону фізичного DELETE для всіх користувачів. Колонка `is_active` вже
існує. На 15.11.2026 main закінчується міграцією 0031, відкритих PR пошук
не виявив. Номер **0032 потрібно погодити з TL перед merge**.

Тільки admin може керувати користувачами:

- `DELETE /api/v1/users/:id`: встановлює `status='inactive'`, `is_active=false`,
  повертає 204 без тіла. Повторний запит — 204, відсутній ID — 404.
- `GET /api/v1/users`: лише `is_active=true`; `include_inactive=false` — так само,
  `include_inactive=true` — всі. Інші значення (включно з порожнім чи повтореним
  параметром) — 400. Паролі не повертаються.
- Неавторизований запит — 401; інші ролі — 403.

Чинні правила міграції 0027 збережено: admin лише один; зміна його ролі,
статусу, активності й фізичне видалення заборонені. Деактивація себе через
API повертає 409, як чинний PATCH статусу. Нових винятків не запроваджено.

SQL-функція повертає false для відсутнього ID і true для наявного.
Вона блокує рядок до завершення транзакції. Повторна деактивація вже
неактивного акаунта не створює зайвого UPDATE. HTTP виконує функцію через
`withActor`: журнал отримує ID адміністратора, після commit відкликаються
сесії наявним механізмом. Login та requireAuth зберігають перевірки статусу
й активності; навіть після прямої SQL-деактивації старий токен не працює.

Прямий DELETE повертає `KMS_USER_DELETE_FORBIDDEN`; для admin збережено
попередній `KMS_ADMIN_IMMUTABLE`. Історія аудиту та actor_user_id залишаються
незмінними. Захист журналу і чинна заборона TRUNCATE не вимикаються.

## Демонстрація Bruno

У локальному середовищі задайте `token` адміністратора та `user_id` іншого
тестового користувача. Секрети не зберігайте в колекції. Запити в `Users`:
список активних → деактивація (204) → активний список без цього ID → повний
список із неактивним ID → повторна деактивація (204). Новий login і запит зі
старим токеном деактивованого користувача мають повернути 401.

## Перевірки

За налаштованих PGHOST/PGPORT/PGUSER/PGPASSWORD та
`MIGRATION_TEST_ADMIN_DB=postgres`:

```powershell
node --test tests/api/deactivate-users.integration.test.js
node --test --test-concurrency=1
npm.cmd run check
git diff --check
```

Інтеграційний тест створює окрему випадкову БД, застосовує міграції лише там,
використовує справжній login, перевіряє SQL/HTTP та видаляє лише свою тестову БД.
Без MIGRATION_TEST_ADMIN_DB він пропускається. Основну БД для тестів не використовуємо.

Для локальних параметрів Compose із `.env`, без виведення пароля:

```powershell
node --env-file=.env --input-type=module -e "import {spawnSync} from 'node:child_process'; const r=spawnSync(process.execPath,['--test','--test-concurrency=1'],{env:{...process.env,PGHOST:'127.0.0.1',PGPORT:process.env.POSTGRES_PORT??'5432',PGUSER:process.env.POSTGRES_USER,PGPASSWORD:process.env.POSTGRES_PASSWORD,MIGRATION_TEST_ADMIN_DB:'postgres'},stdio:'inherit'});process.exitCode=r.status??1;"
```

Фактично 15.11.2026: повний прогін із PostgreSQL — 474 тести, 473 успішні,
0 помилок, 1 пропущений (`Demo seed contains required data`, потребує окремої
підготовленої demo-БД). Новий набір #76 пройшов повністю. `npm run check` —
158 JavaScript-файлів; `git diff --check` — успішно. Початкові помилки
обов'язкових полів phone/salary у нових тестових даних виправлено;
наявні тести не змінювалися. GUI Bruno не запускався.
