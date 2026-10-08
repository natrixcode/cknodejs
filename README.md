# Команда «СК-Node.js»

**Дата:** 06.10.2026

**Група:** ІПЗ-31

## Склад команди

* **Team Lead** — Наталія Гошовська
* **QA** — Олеся Андрієнко
* **BA** — Сергій Афтанас
* **Devs:**
  1. Богдан Бобрис
  2. Тадей Адамчук
  3. Юлія Голіней
  4. Михайло Венгринович
  5. Ігор Бобик
  6. Денис Бойченко

## Початкове середовище проєкту

Це технічна основа: JavaScript, Node.js, Express і PostgreSQL через бібліотеку
`pg`, без TypeScript та ORM. Кожен учасник запускає власну локальну базу.
Бізнес-логіка садочка надалі реалізовуватиметься в SQL; зараз немає таблиць
садочка, бізнес-правил, авторизації чи фронтенду.

Встановіть Git, VS Code, Docker Desktop, DBeaver і Bruno за отриманою раніше
інструкцією. Для запуску через Docker встановлювати Node.js або PostgreSQL на
комп'ютер окремо не потрібно. Запустіть Docker Desktop і дочекайтеся готовності
Docker Engine. На Windows використовуйте Linux containers (WSL 2), на macOS —
звичайний Docker Desktop. Команди виконуйте в терміналі з кореня репозиторію.

### Версії та основні файли

Зафіксовано Node.js **24.21.0 LTS**, Express **5.2.1**, `pg` **8.23.0** та
PostgreSQL **18.6**. Docker-образи: `node:24.21.0-bookworm-slim` і
`postgres:18.6-bookworm`. Обидва підтримують amd64 та arm64 (зокрема Apple
Silicon); локальний образ сервера має тег `cknodejs-server:0.1.0`.
Тег `latest` не використовується. Версії перевірено за
[Node.js](https://nodejs.org/en/download),
[Express](https://www.npmjs.com/package/express?activeTab=versions),
[pg](https://www.npmjs.com/package/pg?activeTab=versions),
[PostgreSQL](https://www.postgresql.org/support/versioning/) та переліками
офіційних Docker-образів
[Node.js](https://github.com/docker-library/official-images/blob/master/library/node)
і [PostgreSQL](https://github.com/docker-library/official-images/blob/master/library/postgres).

| Файл | Призначення |
| --- | --- |
| `src/server.js` | Express-сервер, два тестові маршрути та завершення за SIGINT/SIGTERM. |
| `src/db.js` | Один `Pool` бібліотеки `pg`, тайм-аути та обробка втрати з'єднання. |
| `package.json` | Залежності та команди `start`, `dev`, `check`. |
| `package-lock.json` | Точні версії всіх залежностей для відтворюваного `npm ci`. |
| `Dockerfile` | Збирання сервера; Node.js запускається від користувача `node`. |
| `.dockerignore` | Виключає локальні залежності, Git та `.env` із контексту збирання. |
| `compose.yaml` | Сервер, база, перевірка готовності PostgreSQL, порти та volume. |
| `.env.example` | Приклад явно тестових локальних налаштувань. |
| `.env` | Ваші локальні налаштування; не потрапляє в Git. |
| `.gitignore` | Виключає `.env`, інші локальні env-файли та `node_modules`. |
| `bruno/` | Готова колекція Bruno з двома збереженими GET-запитами для перевірки сервера й бази. |

### Створення .env

Зробіть це один раз, якщо `.env` ще немає. Наявний файл не перезаписуйте.

Windows PowerShell:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

macOS (Terminal):

```sh
if [ ! -f .env ]; then cp .env.example .env; fi
```

Типові значення: база `kindergarten_local`, користувач `student`, пароль
`local_test_only_change_me`, порт сервера `3000`, порт бази на комп'ютері `5432`.
Це лише тестові локальні облікові дані. Compose читає `.env` і передає параметри
контейнерам; `.env` не копіюється в образ. Не додавайте власний `.env` у Git.

### Запуск, стан, логи та зупинка

Перший запуск і запуск після оновлення залежностей:

```sh
docker compose up -d --build --wait
```

Перший запуск завантажить образи й встановить залежності всередині образу
сервера через `npm ci`. Compose почекає, доки `pg_isready` підтвердить готовність
PostgreSQL, і лише тоді запустить сервер. Детальніше про цей порядок — у
[документації Docker Compose](https://docs.docker.com/compose/how-tos/startup-order/).

Стан контейнерів та логи:

```sh
docker compose ps
docker compose logs --tail=100
docker compose logs -f server db
```

Для бази очікуйте `healthy`, для сервера — `Up`. `Ctrl+C` під час перегляду логів
лише завершує їх перегляд.

Звичайна зупинка та повторний запуск тих самих контейнерів:

```sh
docker compose stop
docker compose up -d --wait
```

Зупинка з видаленням контейнерів і мережі, зі збереженням даних:

```sh
docker compose down
```

Node.js отримує SIGTERM, припиняє приймати HTTP-запити, чекає завершення поточних
запитів та викликає `pool.end()` для закриття підключень до бази. Сервер має до
10 секунд на завершення; Compose дає йому 15 секунд.

### Тестові маршрути

За типових налаштувань:

| Метод і адреса | HTTP | JSON |
| --- | --- | --- |
| `GET http://localhost:3000/health` | `200` | `{"status":"ok"}` |
| `GET http://localhost:3000/health/db` | `200` | `{"status":"ok","database":"ok"}` |
| `GET http://localhost:3000/health/db`, коли база недоступна | `503` | `{"status":"error","database":"unavailable"}` |

`/health` перевіряє лише відповідь сервера. `/health/db` виконує `SELECT 1` через
`Pool`. За недоступної бази відповідь не містить пароля, SQL-подробиць або stack
trace; очікування підключення та запиту обмежене тайм-аутами.

Швидка перевірка в PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/health/db
```

У macOS:

```sh
curl -i http://localhost:3000/health
curl -i http://localhost:3000/health/db
```

Для перевірки сценарію недоступності виконайте `docker compose stop db`:
`/health` має й далі відповідати `200`, а `/health/db` — `503`. Після цього
відновіть базу командою `docker compose up -d --wait db` і повторіть запит до
`/health/db`: очікуйте `200` без перезапуску сервера.

### Перевірка через Bruno

1. Після клонування репозиторію створіть `.env` і запустіть Docker Compose за
   інструкцією вище.
2. У Bruno виберіть **Open Collection** і відкрийте папку **`bruno`** в корені
   клонованого репозиторію. Вона містить `opencollection.yml`; відкриється готова
   колекція `cknodejs`.
3. Відкрийте збережений запит **Server health**: метод `GET`, URL
   `http://localhost:3000/health`. Натисніть Send і перевірте HTTP `200` та
   `{"status":"ok"}`.
4. Відкрийте збережений запит **Database health**: метод `GET`, URL
   `http://localhost:3000/health/db`. Перевірте HTTP `200` та
   `{"status":"ok","database":"ok"}`.
5. Після `docker compose stop db` повторіть обидва запити: `Server health` —
   `200`, `Database health` — `503` із відповіддю з таблиці вище. Поверніть базу командою
   `docker compose up -d --wait db`.

### Підключення через DBeaver

Створіть New Database Connection → PostgreSQL. За незміненого `.env` заповніть:

| Поле | Значення |
| --- | --- |
| Connect by | Host |
| Host | `localhost` |
| Port | `5432` |
| Database | `kindergarten_local` |
| Authentication | Username/password (назва може відрізнятися залежно від версії DBeaver) |
| Username | `student` |
| Password | `local_test_only_change_me` |
| SSL | Вимкнено для цієї локальної навчальної бази |
| SSH tunnel | Вимкнено |

Якщо змінювали `.env`, використайте відповідні `POSTGRES_PORT`, `POSTGRES_DB`,
`POSTGRES_USER`, `POSTGRES_PASSWORD`. Натисніть Test Connection; за першого
підключення дозвольте DBeaver завантажити JDBC-драйвер PostgreSQL. У SQL Editor
виконайте `SELECT 1;` — очікуйте один рядок зі значенням `1`.

У мережі Docker сервер підключається до **`db:5432`**: `db` — назва сервісу в
Compose, яка працює як ім'я хоста. `localhost` усередині контейнера сервера
означає сам контейнер сервера. DBeaver працює на вашому комп'ютері, тому
підключається до **`localhost:5432`** через опублікований порт. Обидва порти
опубліковано лише на `127.0.0.1`, тож доступ призначений для вашого комп'ютера.

### Збереження даних

Дані PostgreSQL зберігаються в іменованому volume `postgres_data`, змонтованому
в `/var/lib/postgresql` (шлях для офіційного образу PostgreSQL 18). Реальна назва
volume має префікс Compose-проєкту, зазвичай `cknodejs_postgres_data`.
Кожен учасник має окремий volume у власному Docker Desktop.

`docker compose stop`, `docker compose down` та перебудова сервера зберігають
volume. Наступний запуск із того самого каталогу використовує ті самі дані.
Інша назва каталогу або `docker compose -p ...` можуть обрати інший volume.

**`docker compose down -v` видаляє volume й усі дані в ньому.** Не використовуйте
цю команду, якщо потрібно зберегти дані. Зміна `POSTGRES_DB`, `POSTGRES_USER` або
`POSTGRES_PASSWORD` у `.env` не перестворює базу й не змінює облікові дані в уже
ініціалізованому volume. Початкові значення застосовуються лише до порожнього
volume; для наявної бази зміни потрібно виконувати окремо в PostgreSQL.

### Як застосовувати зміни коду

Змініть `src/server.js` або `src/db.js`, збережіть файл і виконайте:

```sh
docker compose up -d --build --no-deps server
```

Команда перебудує та перестворить лише сервер. База й дані збережуться. Простий
режим запуску не монтує вихідний код у контейнер, тому саме збереження файлу чи
`docker compose restart server` не застосує зміни коду з комп'ютера.

Перевірка синтаксису в контейнері:

```sh
docker compose exec server npm run check
```

`npm start` запускає сервер, `npm run dev` запускає Node.js у режимі `--watch`,
`npm run check` перевіряє синтаксис обох JavaScript-файлів. Вони доступні в образі;
для звичайної розробки достатньо перебудови вище. Якщо змінюєте залежності та
маєте локальний Node.js 24, оновіть `package.json` і `package-lock.json` через
`npm install` (у PowerShell за блокування `npm.ps1` використайте
`npm.cmd install`), після чого перебудуйте образ.

### Якщо порт зайнятий або запуск не вдався

Якщо Docker повідомляє `port is already allocated` чи `address already in use`,
змініть у `.env` лише порти вашого комп'ютера, наприклад:

```dotenv
SERVER_PORT=3001
POSTGRES_PORT=5433
```

Після цього виконайте `docker compose up -d --wait`. Для маршрутів і Bruno
використовуйте `http://localhost:3001`, у DBeaver — порт `5433`. Усередині Docker
сервер і база й далі використовують `3000` та `db:5432` відповідно.

Якщо не вдається підключитися до Docker Engine, запустіть Docker Desktop і
дочекайтеся його готовності. Перевірте `docker compose ps` та
`docker compose logs --tail=100`. Якщо база готова, але `/health/db` повертає
`503`, перевірте відповідність `.env` обліковим даним наявного volume; не
видаляйте volume для виправлення налаштувань.

### Стан перевірки середовища

08.10.2026 перевірено на Windows із Docker Desktop, Linux containers (amd64):

- `npm ci`, перевірка синтаксису та `docker compose config --quiet`.
- Збирання образу й запуск обох контейнерів; PostgreSQL готовий перед сервером,
  порти прив'язані до `127.0.0.1`.
- Обидва маршрути: HTTP `200` і точний JSON; після зупинки бази `/health` — `200`,
  `/health/db` — `503`; після відновлення бази знову `200` без заміни сервера.
- Тайм-аут і `503`, коли контейнер бази призупинений та не відповідає.
- Підключення до PostgreSQL через `localhost` та `SELECT 1` (та сама адреса,
  яку використовуватиме DBeaver).
- Збереження нового тестового запису після `stop/up` та `down/up` без `-v`.
  Перевірка використовувала окрему нову схему, яку потім прибрано; наявні дані
  не видалялися, volume збережено.
- Завершення за SIGTERM і SIGINT, закриття Pool та код виходу `0`.
- Початковий текст README збережено; `.env` і `node_modules` ігноруються Git.

09.10.2026 учасник команди підтвердив ручну перевірку обох маршрутів у Bruno:
отримано HTTP `200` та очікувані JSON-відповіді. Підключення через DBeaver також
успішне. Колекцію з обома збереженими GET-запитами додано в папку `bruno`.

Залишається перевірити запуск на реальному macOS/Apple Silicon.
