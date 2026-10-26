import express from 'express';

import authRouter from './routes/auth_router.js';
import childrenRouter from './routes/children_router.js';
import discountsRouter from './routes/discounts.routes.js';
import employeesRouter from './routes/employees_routes.js';
import expensesRouter from './routes/expenses_routes.js';
import foodRouter from './routes/food_routes.js';
import groupsRouter from './routes/groups_routes.js';
import healthRouter from './routes/health_routes.js';
import invoicesRouter from './routes/invoices_routes.js';
import parentsRouter from './routes/parents_routes.js';
import paymentsRouter from './routes/payments_routes.js';
import reportsRouter from './routes/reports_routes.js';
import roomsRouter from './routes/rooms_routes.js';
import salariesRouter from './routes/salaries_routes.js';
import scheduleRouter from './routes/schedule_routes.js';
import settingsRouter from './routes/settings_routes.js';
import subjectsRouter from './routes/subjects_routes.js';
import tuitionRouter from './routes/tuition_routes.js';
import usersRouter from './routes/users_routes.js';

const app = express();
const API_PREFIX = '/api/v1';

app.disable('x-powered-by');
app.use(express.json());

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

export default app;