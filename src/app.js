import express from 'express';

import { requireAuth } from './middleware/auth.js';
import { requireEmployeeAccess } from './middleware/employeeAccess.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';

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
import dailyBlocksRouter from './routes/daily_blocks_routes.js';
import settingsRouter from './routes/settings_routes.js';
import subjectsRouter from './routes/subjects_routes.js';
import tuitionRouter from './routes/tuition_routes.js';
import usersRouter from './routes/users_routes.js';
import historyRouter from './routes/history_router.js';
import attendanceRouter from './routes/attendance_routes.js';


const app = express();
const API_PREFIX = '/api/v1';

app.disable('x-powered-by');
app.use(express.json());

app.use(`${API_PREFIX}/auth`, authRouter);

app.use(
  `${API_PREFIX}/children`,
  requireAuth,
  requireEmployeeAccess,
  childrenRouter
);

// Protected API routes

app.use(`${API_PREFIX}/history`, requireAuth, historyRouter);
app.use(`${API_PREFIX}/attendance`, requireAuth, attendanceRouter);

app.use(
  `${API_PREFIX}/discounts`,
  requireAuth,
  requireEmployeeAccess,
  discountsRouter
);

app.use(
  `${API_PREFIX}/employees`,
  requireAuth,
  requireEmployeeAccess,
  employeesRouter
);

app.use(
  `${API_PREFIX}/expenses`,
  requireAuth,
  requireEmployeeAccess,
  expensesRouter
);

app.use(
  `${API_PREFIX}/food`,
  requireAuth,
  requireEmployeeAccess,
  foodRouter
);

app.use(
  `${API_PREFIX}/groups`,
  requireAuth,
  requireEmployeeAccess,
  groupsRouter
);

app.use(
  `${API_PREFIX}/health`,
  requireAuth,
  healthRouter
);

app.use(
  `${API_PREFIX}/invoices`,
  requireAuth,
  requireEmployeeAccess,
  invoicesRouter
);

app.use(
  `${API_PREFIX}/parents`,
  requireAuth,
  requireEmployeeAccess,
  parentsRouter
);

app.use(
  `${API_PREFIX}/payments`,
  requireAuth,
  requireEmployeeAccess,
  paymentsRouter
);

app.use(
  `${API_PREFIX}/reports`,
  requireAuth,
  requireEmployeeAccess,
  reportsRouter
);

app.use(
  `${API_PREFIX}/rooms`,
  requireAuth,
  requireEmployeeAccess,
  roomsRouter
);

app.use(
  `${API_PREFIX}/salaries`,
  requireAuth,
  requireEmployeeAccess,
  salariesRouter
);

app.use(
  `${API_PREFIX}/schedule`,
  requireAuth,
  requireEmployeeAccess,
  scheduleRouter
);

app.use(
  `${API_PREFIX}/daily-blocks`,
  requireAuth,
  requireEmployeeAccess,
  dailyBlocksRouter
);

app.use(
  `${API_PREFIX}/settings`,
  requireAuth,
  requireEmployeeAccess,
  settingsRouter
);

app.use(
  `${API_PREFIX}/subjects`,
  requireAuth,
  requireEmployeeAccess,
  subjectsRouter
);

app.use(
  `${API_PREFIX}/tuition`,
  requireAuth,
  requireEmployeeAccess,
  tuitionRouter
);

app.use(
  `${API_PREFIX}/users`,
  requireAuth,
  requireEmployeeAccess,
  usersRouter
);

app.use(notFound);
app.use(errorHandler);

export default app;
