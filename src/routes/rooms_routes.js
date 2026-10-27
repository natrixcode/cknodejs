import { Router } from 'express';
import { z } from 'zod';

import {
  getRooms,
  getRoomById,
  createRoom,
  updateRoom,
  getRoomSchedule,
  updateRoomStatus
} from '../controllers/rooms_controller.js';

import { roomSchema } from '../validators/room_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const roomStatusSchema = z.strictObject({
  status: z.enum([
    'available',
    'occupied',
    'maintenance',
    'inactive'
  ])
});

router.get('/', getRooms);
router.get('/:id', getRoomById);
router.post('/', validateBody(roomSchema), createRoom);
router.patch('/:id', validateBody(roomSchema.partial()), updateRoom);
router.get('/:id/schedule', getRoomSchedule);
router.patch('/:id/status', validateBody(roomStatusSchema), updateRoomStatus);

export default router;
