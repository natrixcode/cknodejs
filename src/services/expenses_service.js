import {
  list, byId, create, patch
} from './_common.js';

const fields = [
  'name',
  'amount',
  'date',
  'category',
  'description',
  'currency'
];

export const getExpenses = () =>
  list('expenses');

export const getExpenseById = id =>
  byId('expenses', id);

export const createExpense = data =>
  create('expenses', data, fields);

export const updateExpense = (id, data) =>
  patch('expenses', id, data, fields);
