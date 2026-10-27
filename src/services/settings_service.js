import { pool } from '../config/database.js';
import { settingsSchema } from '../validators/settings_validator.js';

const columns = `
  id, institution_name, email, phone,
  educational_year, currency, timezone,
  settings, updated_at
`;

const allowedFields = [
  'institution_name',
  'email',
  'phone',
  'educational_year',
  'currency',
  'timezone',
  'settings'
];

async function findSettings() {
  const result = await pool.query(
    `SELECT ${columns}
     FROM settings
     ORDER BY id ASC
     LIMIT 1`
  );

  return result.rows[0] ?? null;
}

export async function getSettings() {
  try {
    const result = await findSettings();

    if (!result) {
      return { status: 404, body: {
        message: 'Settings not found'
      } };
    }

    return { status: 200, body: result };
  } catch (error) {
    throw error;
  }
}

export async function getSettingByKey(key) {
  try {

    const record = await findSettings();

    if (!record) {
      return { status: 404, body: {
        message: 'Settings not found'
      } };
    }

    if (allowedFields.includes(key)) {
      return { status: 200, body: {
        key,
        value: record[key]
      } };
    }

    if (Object.hasOwn(record.settings, key)) {
      return { status: 200, body: {
        key,
        value: record.settings[key]
      } };
    }

    return { status: 404, body: {
      message: 'Setting key not found'
    } };
  } catch (error) {
    throw error;
  }
}

export async function updateSettingByKey(key, data) {
  const { value } = data ?? {};

  if (!Object.hasOwn(data ?? {}, 'value')) {
    return { status: 400, body: {
      message: 'Setting value is required'
    } };
  }

  if (key === 'id' || key === 'updated_at') {
    return { status: 400, body: {
      message: 'Setting cannot be modified'
    } };
  }

  const isColumn = allowedFields.includes(key);

  if (isColumn) {
    const fieldSchema = settingsSchema.shape[key];
    const parsed = fieldSchema.safeParse(value);

    if (!parsed.success) {
      return { status: 400, body: {
        message: 'Invalid setting value',
        errors: parsed.error.issues.map(issue => ({
          field: key,
          message: issue.message
        }))
      } };
    }
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT ${columns}
       FROM settings
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE`
    );

    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');

      return { status: 404, body: {
        message: 'Settings not found'
      } };
    }

    const record = existing.rows[0];

    if (isColumn) {
      const merged = {
        institution_name: record.institution_name,
        email: record.email,
        phone: record.phone,
        educational_year: record.educational_year,
        currency: record.currency,
        timezone: record.timezone,
        settings: record.settings,
        [key]: value
      };

      const parsed = settingsSchema.safeParse(merged);

      if (!parsed.success) {
        await client.query('ROLLBACK');

        return { status: 400, body: {
          message: 'Invalid settings',
          errors: parsed.error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message
          }))
        } };
      }

      const result = await client.query(
        `UPDATE settings
         SET ${key} = $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING ${columns}`,
        [
          key === 'settings'
            ? JSON.stringify(parsed.data.settings)
            : parsed.data[key],
          record.id
        ]
      );

      await client.query('COMMIT');

      return { status: 200, body: result.rows[0] };
    }

    const updatedSettings = {
      ...record.settings,
      [key]: value
    };

    const parsed = settingsSchema.shape.settings.safeParse(
      updatedSettings
    );

    if (!parsed.success) {
      await client.query('ROLLBACK');

      return { status: 400, body: {
        message: 'Invalid settings value'
      } };
    }

    const result = await client.query(
      `UPDATE settings
       SET settings = $1::jsonb,
           updated_at = NOW()
       WHERE id = $2
       RETURNING ${columns}`,
      [JSON.stringify(parsed.data), record.id]
    );

    await client.query('COMMIT');

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
      }
    }

    throw error;
  } finally {
    client?.release();
  }
}

export async function getAcademicYear() {
  try {
    const record = await findSettings();

    if (!record) {
      return { status: 404, body: {
        message: 'Settings not found'
      } };
    }

    return { status: 200, body: {
      educational_year: record.educational_year
    } };
  } catch (error) {
    throw error;
  }
}

export async function updateAcademicYear(data) {
  try {
    const { educational_year } = data;

    const result = await pool.query(
      `UPDATE settings
       SET educational_year = $1,
           updated_at = NOW()
       WHERE id = (
         SELECT id
         FROM settings
         ORDER BY id ASC
         LIMIT 1
       )
       RETURNING educational_year, updated_at`,
      [educational_year]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Settings not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}
