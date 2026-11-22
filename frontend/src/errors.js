// Пояснення бізнес-помилок бази (KMS_*) зрозумілою мовою.
// Бекенд повертає код у полі message, а тут він перекладається
// для користувача сайту.

const messages = {
  // Діти й групи
  KMS_CHILD_AGE_OUT_OF_RANGE:
    'У садочок приймають дітей віком від 2 до 5 років.',
  KMS_CHILD_AGE_MISMATCH:
    'Вік дитини не відповідає віку цієї групи.',
  KMS_PREFLIGHT_CHILD_AGE_INVALID:
    'Вік дитини не відповідає віку цієї групи.',
  KMS_GROUP_FULL:
    'У групі немає вільних місць.',
  KMS_PREFLIGHT_GROUP_OVERFULL:
    'У групі немає вільних місць.',
  KMS_GROUP_NOT_FOUND:
    'Такої групи не знайдено.',
  KMS_GROUP_REQUIRED:
    'Оберіть групу.',
  KMS_GROUP_ID_REQUIRED:
    'Оберіть групу.',
  KMS_GROUP_NOT_ACTIVE:
    'Ця дія можлива лише для активної групи.',
  KMS_CHILD_NOT_FOUND:
    'Таку дитину не знайдено.',
  KMS_CHILD_ALREADY_ASSIGNED:
    'Дитина вже зарахована до цієї групи.',
  KMS_CHILD_NOT_ASSIGNED:
    'Дитина не зарахована до цієї групи.',
  KMS_CHILD_ALREADY_ARCHIVED:
    'Картка дитини вже в архіві.',
  KMS_CHILD_NOT_ARCHIVED:
    'Картка дитини не в архіві.',
  KMS_CANNOT_ASSIGN_ARCHIVED_CHILD:
    'Архівну дитину не можна зарахувати до групи. Спершу поверніть картку з архіву.',
  KMS_CHILD_ARCHIVED:
    'Для архівної дитини ця дія недоступна.',
  KMS_TRANSFER_NOT_APPLICABLE:
    'Переведення до тієї самої групи не потрібне.',

  // Групи, кімнати, персонал
  KMS_GROUP_EXCEEDS_ROOM_CAPACITY:
    'Місткість групи більша, ніж вміщує кімната.',
  KMS_GROUP_CAPACITY_BELOW_OCCUPANCY:
    'Місткість не може бути меншою за кількість дітей у групі.',
  KMS_GROUP_AGE_CHANGE_INVALID:
    'Вік групи не можна змінити, поки в ній є діти іншого віку.',
  KMS_ASSIGNED_ROOM_CANNOT_CHANGE:
    'Кімнату групи не можна змінити в поточному стані.',
  KMS_ROOM_NOT_FOUND:
    'Таку кімнату не знайдено.',
  KMS_ROOM_UNAVAILABLE:
    'Кімната недоступна.',
  KMS_ROOM_LIMIT_REACHED:
    'Досягнуто ліміту кімнат.',
  KMS_GROUP_REQUIRES_EDUCATOR_AND_ASSISTANT:
    'Активна група повинна мати вихователя й помічника.',
  KMS_EMPLOYEE_ALREADY_ASSIGNED:
    'Працівник уже призначений до іншої групи.',
  KMS_EMPLOYEE_ROLE_MISMATCH:
    'Посада працівника не відповідає ролі в групі.',
  KMS_EMPLOYEE_INACTIVE:
    'Працівник неактивний.',

  // Батьки
  KMS_INVALID_PARENT_LINK:
    'Оберіть батька або матір і тип зв’язку.',
  KMS_PARENT_LINK_NOT_FOUND:
    'Такого зв’язку з дитиною немає.',

  // Розклад і відвідуваність (тексти з DayActions.jsx)
  KMS_DAILY_ROUTINE_INCOMPLETE:
    'Для цього дня потрібні три прийоми їжі й один денний сон.',
  KMS_GENERATION_INSUFFICIENT_SUBJECTS:
    'Для генерації потрібно щонайменше три предмети.',
  KMS_GENERATION_NO_AVAILABLE_TEACHER:
    'Для одного з предметів немає вільного викладача з відповідним призначенням.',
  KMS_GENERATION_DAY_EXISTS:
    'На цю дату вже є заняття. Онови розклад.',
  KMS_BLOCK_OUTSIDE_WORKDAY:
    'Режимні блоки мають поміститися у вісім годин робочого дня.',
  KMS_CONSECUTIVE_MEALS:
    'Між прийомами їжі потрібна перерва.',
  KMS_ATTENDANCE_PAST_FORBIDDEN:
    'Вихователь може ставити відмітки за сьогодні.',
  KMS_SCHEDULE_ROOM_CONFLICT:
    'Кімната в цей час уже зайнята іншим заняттям.',
  KMS_SCHEDULE_TEACHER_CONFLICT:
    'Викладач у цей час уже веде інше заняття.',
  KMS_SCHEDULE_GROUP_CONFLICT:
    'У групи в цей час уже є заняття.',
  KMS_SCHEDULE_ROOM_UNAVAILABLE:
    'Кімната недоступна для занять (ремонт або неактивна).',
  KMS_TEACHER_SUBJECT_MISMATCH:
    'Цей викладач не веде обраний предмет. Призначте предмет у розділі «Персонал».',
  KMS_INVALID_TEACHER:
    'Обраний працівник не є активним викладачем.',
  KMS_SUBJECT_REQUIRED:
    'Оберіть предмет заняття.',
  KMS_LESSON_DAILY_BLOCK_CONFLICT:
    'Заняття накладається на харчування або сон.',
  KMS_LESSON_OUTSIDE_WORKDAY:
    'Заняття має бути в межах робочого дня групи.',
  KMS_SCHEDULE_INVALID_INTERVAL:
    'Час завершення має бути пізніше за початок.',
  KMS_BLOCK_LESSON_CONFLICT:
    'Блок накладається на заняття.',
  KMS_GENERATION_NO_FREE_WINDOW:
    'Для генерації немає вільного часу в дні групи.',
  KMS_GENERATION_ROOM_CONFLICT:
    'Кімната групи зайнята в потрібний час.',
  KMS_REPUBLISH_DAY_REQUIRED:
    'Публікуйте всі чернетки дня разом.',

  // Користувачі
  KMS_ADMIN_IMMUTABLE:
    'Обліковий запис адміністратора не можна змінити чи вимкнути.',
  KMS_INVALID_USER_ROLE:
    'Роль не відповідає прив’язці: батькам потрібен профіль батьків, працівнику — картка працівника.',
  KMS_USER_DELETE_FORBIDDEN:
    'Обліковий запис не видаляють — його можна лише деактивувати.',

  // Персонал
  KMS_EMPLOYEE_NOT_FOUND:
    'Такого працівника не знайдено.',
  KMS_EMPLOYEE_NOT_ACTIVE:
    'Працівник неактивний.',
  KMS_EMPLOYEE_ASSIGNED_TO_MULTIPLE_GROUPS:
    'Працівник уже працює в іншій групі.',
  KMS_EMPLOYEE_HAS_INCOMPATIBLE_ASSIGNMENT:
    'Працівник має несумісне призначення.',
  KMS_GROUP_STAFF_NOT_FOUND:
    'Цей працівник не призначений до групи.',
  KMS_DEACTIVATE_GROUP_BEFORE_STAFF_CHANGE:
    'Щоб змінити персонал, спершу деактивуйте групу.',
  KMS_INVALID_STAFF_ROLE:
    'Роль у групі може бути лише «вихователь» або «помічник».',
  KMS_PREFLIGHT_GROUP_ROOM_INVALID:
    'Кімната групи недоступна або замала.',
  KMS_PREFLIGHT_TOO_MANY_ROOMS:
    'Перевищено кількість кімнат садочка.',
  KMS_PREFLIGHT_GROUP_AGE_INVALID:
    'У групі є діти іншого віку.',

  KMS_PUBLISHED_SCHEDULE_IMMUTABLE:
    'Опублікований розклад змінювати не можна.'
};

export function describeError(code) {
  return messages[code] || null;
}
