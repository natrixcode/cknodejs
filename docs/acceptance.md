# Приймання першої версії СК Садок

**Дата:** 22.11.2026  
**Гілка або коміт:** Не вказано  
**Хто перевірив:** Богдан Бобрис
**Результат npm test:** PASS — 482 тести пройдено, 0 помилок, 0 пропущено  
**Результат frontend build:** Не перевірено (результат не надано)  
**Додатково:** `npm run check` — PASS, перевірено 162 JavaScript-файли.

| AC | Що перевіряємо | Результат / доказ |
|---|---|---|
| 01 | Адміністратор створює дитину, запис зберігається після оновлення | **PASS (API)** — `Valid child returns 201 and persists`. Збереження в БД підтверджено, оновлення сторінки не перевірено. |
| 02 | До однієї дитини прив’язуються двоє батьків | **PASS** — `Many-to-many relationships`, `Link parent to child`. |
| 03 | Зарахування до групи іншого віку відхиляється | **PASS** — `Reject age mismatch`, `Reject child with incorrect group age`. |
| 04 | 21-ша дитина не зараховується до групи місткістю 20 | **PASS** — `Reject full group`, `Full group returns 409 without over-enrollment`. |
| 05 | Групі призначаються вихователь і помічник | **PASS** — `Assign educator and assistant`, `Activate fully staffed group`. |
| 06 | Одну основну кімнату не можна закріпити за двома групами | **НЕ ПІДТВЕРДЖЕНО** — перевірено місткість і доступність кімнат, але прямого тесту подвійного закріплення немає. |
| 07 | Система враховує обмеження у 20 кімнат | **НЕ ПІДТВЕРДЖЕНО** — у логах немає окремого тесту глобального обмеження 20 кімнат. |
| 08 | Адміністратор змінює тариф харчування | **PASS (SQL)** — `Add new tariff and preserve history`. Зміну тарифу підтверджено, права адміністратора окремо не перевірено. |
| 09 | Пільга зменшує навчання, харчування зберігає повну вартість | **PASS** — `Personal discount reduces tuition only`. |
| 10 | Батьки мають доступ лише до своїх дітей | **PASS** — `Parents can view only their children`, `Parent cannot read unrelated child attendance`. |
| 11 | Викладач відкриває власний розклад | **PASS (API/SQL)** — `Employee teacher can view only assigned lessons`, `Schedule API access control`. |
| 12 | Одному викладачу не призначаються одночасні заняття | **PASS** — `Reject teacher schedule overlap`. |
| 13 | Зарплата помічника враховує дітей понад 12 | **PASS** — `Assistant salary with 13 children`. |
| 14 | Адміністратор отримує загальний прибуток | **PASS (розрахунок)** — `Finance report matches control example`, `Accrual revenue counts issued invoices`. Доступ адміністратора окремо не підтверджено. |
| 15 | Прогноз дотримується обмежень кількості дітей і кімнат | **ЧАСТКОВО PASS** — `Reject forecast capacity overflow`, `Forecast distributes children into groups`. Ліміт кімнат потребує перевірки. |
| 16 | Сума виставленого рахунку зберігається після зміни тарифу | **ЧАСТКОВО PASS** — `Issued invoice is immutable`, `New tuition rate preserves history`. Прямий сценарій зміни тарифу після виставлення рахунку не перевірено. |
| 17 | Новий рахунок має нуль отриманих оплат | **НЕ ПІДТВЕРДЖЕНО** — `Issue monthly invoice` проходить, але початковий нуль оплат прямо не перевірено. |
| 18 | Батьки бачать лише опубліковані заняття своєї дитини | **НЕ ПІДТВЕРДЖЕНО** — `Schedule API access control` проходить, але фільтрацію опублікованих занять для батьків окремо не підтверджено. |
| 19 | Конфлікт викладача або кімнати блокує публікацію | **PASS** — `Reject teacher schedule overlap`, `Reject room schedule overlap`, `HTTP: room overlap is rejected`. |
| 20 | Фактичні витрати та умовна вартість кімнат розрізняються у звіті | **PASS** — `Report separates payroll and expenses`, `Active group adds room model cost`. |
| 21 | Для недосяжної беззбитковості є пояснення | **ЧАСТКОВО PASS** — `Reports when break-even is not reachable`. Наявність зрозумілого пояснення окремо не перевірено. |
| 22 | Повтор платежу з тим самим ідентифікатором не подвоює оплату | **PASS** — `Repeated payment is not counted twice`, `Identical payment retry is idempotent`. |

