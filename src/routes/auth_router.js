import { Router } from 'express';

import {
  login,
  logout
} from '../controllers/auth_controller.js';

import { authSchema } from '../validators/auth_validator.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/login', validateBody(authSchema), login);
router.post('/logout', requireAuth, logout);

export default router;
