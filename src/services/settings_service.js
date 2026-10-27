import {
  ok, fail, missing, one
} from './_common.js';

const columns = [
  'institution_name',
  'email',
  'phone',
  'educational_year',
  'currency',
  'timezone'
];

export async function getSettings() {
  const settings = await one(
    'SELECT * FROM settings ORDER BY id LIMIT 1'
  );

  return settings ? ok(settings) : missing();
}

export async function getSettingByKey(key) {
  const settings = await one(
    'SELECT * FROM settings ORDER BY id LIMIT 1'
  );

  if (!settings) return missing();

  const value = columns.includes(key)
    ? settings[key]
    : settings.settings?.[key];

  return value === undefined
    ? missing()
    : ok({ key, value });
}

export async function updateSettingByKey(key, data) {
  if (
    key === 'id' ||
    key === 'updated_at'
  ) {
    return fail(
      400,
      'Службове поле не можна змінювати'
    );
  }

  const value = data.value;
  let updated;

  if (columns.includes(key)) {
    updated = await one(
      `UPDATE settings
       SET ${key} = $1,
           updated_at = NOW()
       WHERE id = (
         SELECT id
         FROM settings
         ORDER BY id
         LIMIT 1
       )
       RETURNING *`,
      [value]
    );
  } else {
    updated = await one(
      `UPDATE settings
       SET settings = jsonb_set(
             settings,
             ARRAY[$1]::text[],
             $2::jsonb,
             true
           ),
           updated_at = NOW()
       WHERE id = (
         SELECT id
         FROM settings
         ORDER BY id
         LIMIT 1
       )
       RETURNING *`,
      [
        key,
        JSON.stringify(value)
      ]
    );
  }

  return updated
    ? ok({
        key,
        value: columns.includes(key)
          ? updated[key]
          : updated.settings[key]
      })
    : missing();
}

export async function getAcademicYear() {
  const setting = await one(
    `SELECT educational_year
     FROM settings
     ORDER BY id
     LIMIT 1`
  );

  return setting ? ok(setting) : missing();
}

export async function updateAcademicYear(data) {
  const item = await one(
    `UPDATE settings
     SET educational_year = $1,
         updated_at = NOW()
     WHERE id = (
       SELECT id
       FROM settings
       ORDER BY id
       LIMIT 1
     )
     RETURNING educational_year`,
    [data.educational_year]
  );

  return item ? ok(item) : missing();
}