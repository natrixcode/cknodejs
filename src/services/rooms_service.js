import { pool } from '../config/database.js';

const isValidId = (id) =>
  typeof id === 'string' &&
  /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;

const allowedFields = ['name', 'capacity', 'status'];

const allowedStatuses = [
  'available',
  'occupied',
  'maintenance',
  'inactive'
];

export async function getRooms() {
  try {
    const result = await pool.query(
      `SELECT id, room_number, name, capacity, status, created_at
       FROM rooms
       ORDER BY id ASC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getRoomById(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid room ID' } };
    }

    const result = await pool.query(
      `SELECT id, room_number, name, capacity, status, created_at
       FROM rooms
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: { message: 'Room not found' } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function createRoom(data) {
  try {
    const { name, capacity, status = 'available' } = data;

    const result = await pool.query(
      `INSERT INTO rooms (name, capacity, status)
       VALUES ($1, $2, $3)
       RETURNING id, room_number, name, capacity, status, created_at`,
      [name, capacity, status]
    );

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function updateRoom(id, data) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid room ID' } };
    }

    const fields = Object.keys(data);

    if (
      fields.length === 0 ||
      fields.some(field => !allowedFields.includes(field))
    ) {
      return { status: 400, body: {
        message: 'Invalid update fields'
      } };
    }

    const setClause = fields.map(
      (field, index) => `${field} = $${index + 1}`
    ).join(', ');

    const values = fields.map(field => data[field]);

    const result = await pool.query(
      `UPDATE rooms
       SET ${setClause}
       WHERE id = $${values.length + 1}
       RETURNING id, room_number, name, capacity, status, created_at`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: { message: 'Room not found' } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function getRoomSchedule(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid room ID' } };
    }

    const room = await pool.query(
      'SELECT id FROM rooms WHERE id = $1',
      [id]
    );

    if (room.rows.length === 0) {
      return { status: 404, body: { message: 'Room not found' } };
    }

    const result = await pool.query(
      `SELECT
        id,
        group_id,
        subject_id,
        teacher_id,
        room_id,
        start_time,
        end_time,
        status,
        created_at
       FROM schedule
       WHERE room_id = $1
       ORDER BY start_time ASC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function updateRoomStatus(id, data) {
  try {
    const { status } = data ?? {};

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid room ID' } };
    }

    if (!allowedStatuses.includes(status)) {
      return { status: 400, body: { message: 'Invalid room status' } };
    }

    const result = await pool.query(
      `UPDATE rooms
       SET status = $1
       WHERE id = $2
       RETURNING id, room_number, name, capacity, status, created_at`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: { message: 'Room not found' } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}
