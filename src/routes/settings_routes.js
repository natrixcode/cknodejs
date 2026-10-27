import { Router } from 'express';
import { z } from 'zod';

import {
  getSettings,
  getSettingByKey,
  updateSettingByKey,
  getAcademicYear,
  updateAcademicYear
} from '../controllers/settings_controller.js';

import { settingsSchema } from '../validators/settings_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const updateSettingSchema = z.strictObject({
  value: z.unknown()
}).refine(
  data => Object.hasOwn(data, 'value'),
  {
    path: ['value'],
    message: 'Setting value is required'
  }
);

const academicYearSchema = z.strictObject({
  educational_year: settingsSchema.shape.educational_year
});

router.get('/', getSettings);

router.get('/academic-year', getAcademicYear);

router.put(
  '/academic-year',
  validateBody(academicYearSchema),
  updateAcademicYear
);

router.get('/:key', getSettingByKey);

router.patch(
  '/:key',
  validateBody(updateSettingSchema),
  updateSettingByKey
);

export default router;
