
import express from 'express';

import authRouter from './route/auth_router.js';
import childrenRouter from './route/children_router.js';
import discountsRouter from './route/discounts.routes.js';
import employeesRouter from './route/employees_routes.js';
import expensesRouter from './route/expenses_routes.js';
import foodRouter from './route/food_routes.js';
import groupsRouter from './route/groups_routes.js';
import healthRouter from './route/health_routes.js';
import invoicesRouter from './route/invoices_routes.js';
import parentsRouter from './route/parents_routes.js';
import paymentsRouter from './route/payments_routes.js';
import reportsRouter from './route/reports_routes.js';
import roomsRouter from './route/rooms_routes.js';
import salariesRouter from './route/salaries_routes.js';
import scheduleRouter from './route/schedule_routes.js';
import settingsRouter from './route/settings_routes.js';
import subjectsRouter from './route/subjects_routes.js';
import tuitionRouter from './route/tuition_routes.js';
import usersRouter from './route/users_routes.js';

const app = express();

app.use(express.json());

const API_PREFIX = '/api/v1';

app.use(`${API_PREFIX}/auth`, authRouter);
app.use(`${API_PREFIX}/children`, childrenRouter);
app.use(`${API_PREFIX}/discounts`, discountsRouter);
app.use(`${API_PREFIX}/employees`, employeesRouter);
app.use(`${API_PREFIX}/expenses`, expensesRouter);
app.use(`${API_PREFIX}/food`, foodRouter);
app.use(`${API_PREFIX}/groups`, groupsRouter);
app.use(`${API_PREFIX}/health`, healthRouter);
app.use(`${API_PREFIX}/invoices`, invoicesRouter);
app.use(`${API_PREFIX}/parents`, parentsRouter);
app.use(`${API_PREFIX}/payments`, paymentsRouter);
app.use(`${API_PREFIX}/reports`, reportsRouter);
app.use(`${API_PREFIX}/rooms`, roomsRouter);
app.use(`${API_PREFIX}/salaries`, salariesRouter);
app.use(`${API_PREFIX}/schedule`, scheduleRouter);
app.use(`${API_PREFIX}/settings`, settingsRouter);
app.use(`${API_PREFIX}/subjects`, subjectsRouter);
app.use(`${API_PREFIX}/tuition`, tuitionRouter);
app.use(`${API_PREFIX}/users`, usersRouter);

app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Маршрут не знайдено',
  });
});

export default app;
