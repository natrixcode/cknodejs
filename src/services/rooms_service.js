import {
  ok, list, byId, create, patch, rows
} from './_common.js';

const fields = ['name', 'capacity', 'status'];

export const getRooms = () => list('rooms');

export const getRoomById = id => byId('rooms', id);

export const createRoom = data =>
  create('rooms', data, fields);

export const updateRoom = (id, data) =>
  patch('rooms', id, data, fields);

export const updateRoomStatus = (id, data) =>
  patch('rooms', id, data, ['status']);

export async function getRoomSchedule(id) {
  return ok(
    await rows(
      `SELECT *
       FROM schedule
       WHERE room_id = $1
       ORDER BY start_time`,
      [id]
    )
  );
}