import { Router } from 'express';

import {
  getFoodRates,
  createFoodRate,
  updateFoodRate,
  calculateFoodCost
} from '../controllers/food_controller.js';

import {
  mealPriceSchema,
  updateMealPriceSchema,
  calculateFoodSchema
} from '../validators/meal_price_validator.js';

import { validateBody } from '../middleware/validate.js';

const router = Router();

router.get('/rates', getFoodRates);

router.post(
  '/rates',
  validateBody(mealPriceSchema),
  createFoodRate
);

router.patch(
  '/rates/:id',
  validateBody(updateMealPriceSchema),
  updateFoodRate
);

router.get('/calculate', (req, res, next) => {
  const parsed = calculateFoodSchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid food calculation parameters',
      errors: parsed.error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message
      }))
    });
  }

  res.locals.foodCalculation = parsed.data;
  next();
}, (req, res, next) => {
  req.query = res.locals.foodCalculation;
  return calculateFoodCost(req, res, next);
});

export default router;
