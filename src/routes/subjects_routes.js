import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import {
  getSubjects,
  getSubjectById,
  createSubject,
  updateSubject,
  getSubjectTeachers,
  updateSubjectTeachers
} from '../controllers/subjects_controller.js';

import { subjectSchema } from '../validators/subject_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();
router.use(requireRole('admin'));
const subjectTeachersSchema = z.strictObject({
  employee_ids: z.array(z.coerce.number().int().positive())
});

router.get('/', getSubjects);
router.get('/:id', getSubjectById);
router.post('/', validateBody(subjectSchema), createSubject);
router.patch('/:id', validateBody(subjectSchema.partial()), updateSubject);
router.get('/:id/teachers', getSubjectTeachers);
router.put(
  '/:id/teachers',
  validateBody(subjectTeachersSchema),
  updateSubjectTeachers
);

export default router;
