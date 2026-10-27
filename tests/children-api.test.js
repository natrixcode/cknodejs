import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import childrenRouter from '../src/routes/children_router.js';

test('Children API rejects invalid child data', async () => {
  const app = express();

  app.use(express.json());
  app.use('/api/v1/children', childrenRouter);

  const server = app.listen(0);

  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${url}/api/v1/children`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        first_name: '',
        last_name: '',
        date_of_birth: '2030-01-01'
      })
    });

    assert.equal(response.status, 400);

    const result = await response.json();

    assert.ok(Array.isArray(result.errors));
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});


test('Children API rejects invalid child ID', async () => {
  const app = express();

  app.use(express.json());
  app.use('/api/v1/children', childrenRouter);

  const server = app.listen(0);

  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;

    const response = await fetch(
      `${url}/api/v1/children/abc`
    );

    assert.equal(response.status, 400);

    const result = await response.json();

    assert.equal(result.message, 'Invalid child ID');
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});


test('Children API returns children from PostgreSQL', async () => {
  const app = express();

  app.use(express.json());
  app.use('/api/v1/children', childrenRouter);

  const server = app.listen(0);

  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;

    const response = await fetch(
      `${url}/api/v1/children`
    );

    assert.equal(response.status, 200);

    const result = await response.json();

    assert.ok(Array.isArray(result));
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});


test('Children API creates a child in PostgreSQL', async () => {
  const app = express();

  app.use(express.json());
  app.use('/api/v1/children', childrenRouter);

  const server = app.listen(0);

  let createdChildId = null;

  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;

    const childData = {
      first_name: 'Test',
      last_name: 'Child',
      date_of_birth: '2021-05-14',
      group_id: null,
      dietary_preferences: null,
      notes: 'Integration test'
    };

    const response = await fetch(`${url}/api/v1/children`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(childData)
    });

    assert.equal(response.status, 201);

    const createdChild = await response.json();

    createdChildId = createdChild.id;

    assert.equal(createdChild.first_name, 'Test');
    assert.equal(createdChild.last_name, 'Child');
    assert.ok(createdChild.id);

    const getResponse = await fetch(
      `${url}/api/v1/children/${createdChildId}`
    );

    assert.equal(getResponse.status, 200);

    const savedChild = await getResponse.json();

    assert.equal(savedChild.id, createdChildId);
    assert.equal(savedChild.notes, 'Integration test');
  } finally {
    try {
      if (createdChildId !== null) {
        const { pool } = await import('../src/config/database.js');

        await pool.query(
          'DELETE FROM children WHERE id = $1',
          [createdChildId]
        );
      }
    } finally {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  }
});


test('Children API updates a child in PostgreSQL', async () => {
  const app = express();

  app.use(express.json());
  app.use('/api/v1/children', childrenRouter);

  const server = app.listen(0);

  let createdChildId = null;

  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;

    const createResponse = await fetch(`${url}/api/v1/children`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        first_name: 'Test',
        last_name: 'Child',
        date_of_birth: '2021-05-14',
        group_id: null,
        notes: 'Original notes'
      })
    });

    assert.equal(createResponse.status, 201);

    const createdChild = await createResponse.json();
    createdChildId = createdChild.id;

    const updateResponse = await fetch(
      `${url}/api/v1/children/${createdChildId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          first_name: 'Updated',
          notes: 'Updated notes'
        })
      }
    );

    assert.equal(updateResponse.status, 200);

    const updatedChild = await updateResponse.json();

    assert.equal(updatedChild.first_name, 'Updated');
    assert.equal(updatedChild.notes, 'Updated notes');
    assert.equal(updatedChild.last_name, 'Child');

    const getResponse = await fetch(
      `${url}/api/v1/children/${createdChildId}`
    );

    assert.equal(getResponse.status, 200);

    const savedChild = await getResponse.json();

    assert.equal(savedChild.first_name, 'Updated');
    assert.equal(savedChild.notes, 'Updated notes');
    assert.equal(savedChild.last_name, 'Child');
  } finally {
    try {
      if (createdChildId !== null) {
        const { pool } = await import('../src/config/database.js');

        await pool.query(
          'DELETE FROM children WHERE id = $1',
          [createdChildId]
        );
      }
    } finally {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  }
});

test('Children API returns empty related resources', async () => {
  const { pool } = await import('../src/config/database.js');

  const app = express();
  app.use(express.json());
  app.use('/api/v1/children', childrenRouter);

  const server = app.listen(0);
  let childId = null;

  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;

    const createResponse = await fetch(`${url}/api/v1/children`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        first_name: 'Test',
        last_name: 'Relations',
        date_of_birth: '2021-05-14',
        group_id: null
      })
    });

    assert.equal(createResponse.status, 201);

    const child = await createResponse.json();
    childId = child.id;

    const resources = [
      'parents',
      'groups',
      'invoices',
      'payments',
      'schedule'
    ];

    for (const resource of resources) {
      const response = await fetch(
        `${url}/api/v1/children/${childId}/${resource}`
      );

      assert.equal(
        response.status,
        200,
        `Unexpected status for ${resource}`
      );

      const data = await response.json();

      assert.deepEqual(
        data,
        [],
        `Expected empty array for ${resource}`
      );
    }
  } finally {
    try {
      if (childId !== null) {
        await pool.query(
          'DELETE FROM children WHERE id = $1',
          [childId]
        );
      }
    } finally {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  }
});

test('Children API returns related parents', async () => {
  const { pool } = await import('../src/config/database.js');

  const app = express();
  app.use(express.json());
  app.use('/api/v1/children', childrenRouter);

  const server = app.listen(0);

  let childId = null;
  let parentId = null;

  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;

    const childResult = await pool.query(
      `INSERT INTO children (
        first_name, last_name, date_of_birth
      )
      VALUES ($1, $2, $3)
      RETURNING id`,
      ['Test', 'Child', '2021-05-14']
    );

    childId = childResult.rows[0].id;

    
    const parentResult = await pool.query(
      `INSERT INTO parents (
        first_name,
        last_name,
        phone,
        email
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id`,
      [
        'Test',
        'Parent',
        crypto.randomUUID().replaceAll('-', '').slice(0, 20),
        `test-${crypto.randomUUID()}@example.com`
      ]
    );

    parentId = parentResult.rows[0].id;


    await pool.query(
      `INSERT INTO children_parents (
        child_id, parent_id, relationship_type
      )
      VALUES ($1, $2, $3)`,
      [childId, parentId, 'parent']
    );

    const response = await fetch(
      `${url}/api/v1/children/${childId}/parents`
    );

    assert.equal(response.status, 200);

    const parents = await response.json();

    assert.equal(parents.length, 1);
    assert.equal(parents[0].id, parentId);
    assert.equal(parents[0].first_name, 'Test');
    assert.equal(parents[0].relationship_type, 'parent');
  } finally {
    try {
      if (childId !== null) {
        await pool.query(
          'DELETE FROM children WHERE id = $1',
          [childId]
        );
      }

      if (parentId !== null) {
        await pool.query(
          'DELETE FROM parents WHERE id = $1',
          [parentId]
        );
      }
    } finally {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  }
});

test('Children API returns related group', async () => {
  const { pool } = await import('../src/config/database.js');

  const app = express();
  app.use(express.json());
  app.use('/api/v1/children', childrenRouter);

  const server = app.listen(0);

  let roomId = null;
  let groupId = null;
  let childId = null;

  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;

    const roomResult = await pool.query(
      `INSERT INTO rooms (name, capacity)
       VALUES ($1, $2)
       RETURNING id`,
      [`Test Room ${crypto.randomUUID().slice(0, 8)}`, 20]
    );

    roomId = roomResult.rows[0].id;

    const groupResult = await pool.query(
      `INSERT INTO groups (name, room_id, age_years, max_capacity)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        `Test Group ${crypto.randomUUID().slice(0, 8)}`,
        roomId,
        4,
        20
      ]
    );

    groupId = groupResult.rows[0].id;

    const childResult = await pool.query(
      `INSERT INTO children (
        first_name, last_name, date_of_birth, group_id
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id`,
      ['Test', 'Child', '2021-05-14', groupId]
    );

    childId = childResult.rows[0].id;

    const response = await fetch(
      `${url}/api/v1/children/${childId}/groups`
    );

    assert.equal(response.status, 200);

    const groups = await response.json();

    assert.equal(groups.length, 1);
    assert.equal(groups[0].id, groupId);
    assert.equal(groups[0].age_years, 4);
    assert.equal(groups[0].max_capacity, 20);
  } finally {
    try {
      if (childId !== null) {
        await pool.query('DELETE FROM children WHERE id = $1', [childId]);
      }

      if (groupId !== null) {
        await pool.query('DELETE FROM groups WHERE id = $1', [groupId]);
      }

      if (roomId !== null) {
        await pool.query('DELETE FROM rooms WHERE id = $1', [roomId]);
      }
    } finally {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  }
});

test('Children API returns related invoices and payments', async () => {
  const { pool } = await import('../src/config/database.js');

  const app = express();
  app.use(express.json());
  app.use('/api/v1/children', childrenRouter);

  const server = app.listen(0);

  let childId = null;
  let invoiceId = null;
  let paymentId = null;

  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;

    const childResult = await pool.query(
      `INSERT INTO children (
        first_name, last_name, date_of_birth
      )
      VALUES ($1, $2, $3)
      RETURNING id`,
      ['Test', 'Finance', '2021-05-14']
    );

    childId = childResult.rows[0].id;

    const invoiceResult = await pool.query(
      `INSERT INTO invoices (
        child_id,
        period_start,
        period_end,
        tuition_amount,
        meal_amount,
        discount_amount
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [
        childId,
        '2026-10-01',
        '2026-10-31',
        5000,
        1500,
        500
      ]
    );

    invoiceId = invoiceResult.rows[0].id;

    const paymentResult = await pool.query(
      `INSERT INTO payments (
        invoice_id,
        amount,
        payment_date,
        method
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id`,
      [
        invoiceId,
        2500,
        new Date(),
        'card'
      ]
    );

    paymentId = paymentResult.rows[0].id;

    const invoicesResponse = await fetch(
      `${url}/api/v1/children/${childId}/invoices`
    );

    assert.equal(invoicesResponse.status, 200);

    const invoices = await invoicesResponse.json();

    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].id, invoiceId);
    assert.equal(invoices[0].total_amount, '6000.00');

    const paymentsResponse = await fetch(
      `${url}/api/v1/children/${childId}/payments`
    );

    assert.equal(paymentsResponse.status, 200);

    const payments = await paymentsResponse.json();

    assert.equal(payments.length, 1);
    assert.equal(payments[0].id, paymentId);
    assert.equal(payments[0].invoice_id, invoiceId);
    assert.equal(payments[0].amount, '2500.00');

  } finally {
    try {
      if (paymentId !== null) {
        await pool.query(
          'DELETE FROM payments WHERE id = $1',
          [paymentId]
        );
      }

      if (invoiceId !== null) {
        await pool.query(
          'DELETE FROM invoices WHERE id = $1',
          [invoiceId]
        );
      }

      if (childId !== null) {
        await pool.query(
          'DELETE FROM children WHERE id = $1',
          [childId]
        );
      }
    } finally {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  }
});

test('Children API returns related schedule', async () => {
  const { pool } = await import('../src/config/database.js');

  const app = express();
  app.use(express.json());
  app.use('/api/v1/children', childrenRouter);

  const server = app.listen(0);

  const ids = {};

  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;
    const unique = crypto.randomUUID().slice(0, 8);

    const room = await pool.query(
      `INSERT INTO rooms (name, capacity)
       VALUES ($1, $2)
       RETURNING id`,
      [`Schedule Room ${unique}`, 20]
    );
    ids.room = room.rows[0].id;

    const group = await pool.query(
      `INSERT INTO groups (name, room_id, age_years, max_capacity)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [`Schedule Group ${unique}`, ids.room, 4, 20]
    );
    ids.group = group.rows[0].id;

    const child = await pool.query(
      `INSERT INTO children
        (first_name, last_name, date_of_birth, group_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      ['Test', 'Schedule', '2021-05-14', ids.group]
    );
    ids.child = child.rows[0].id;

    const subject = await pool.query(
      `INSERT INTO subjects (name, description)
       VALUES ($1, $2)
       RETURNING id`,
      [`Test Subject ${unique}`, 'Integration test']
    );
    ids.subject = subject.rows[0].id;

    const teacher = await pool.query(
      `INSERT INTO employees
        (first_name, last_name, phone, position, salary)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        'Test',
        'Teacher',
        crypto.randomUUID().replaceAll('-', '').slice(0, 20),
        'teacher',
        15000
      ]
    );
    ids.teacher = teacher.rows[0].id;

    const lesson = await pool.query(
      `INSERT INTO schedule (
        group_id,
        subject_id,
        teacher_id,
        room_id,
        start_time,
        end_time,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id`,
      [
        ids.group,
        ids.subject,
        ids.teacher,
        ids.room,
        '2026-11-02T09:00:00Z',
        '2026-11-02T10:00:00Z',
        'published'
      ]
    );
    ids.lesson = lesson.rows[0].id;

    const response = await fetch(
      `${url}/api/v1/children/${ids.child}/schedule`
    );

    assert.equal(response.status, 200);

    const schedule = await response.json();

    assert.equal(schedule.length, 1);
    assert.equal(schedule[0].id, ids.lesson);
    assert.equal(schedule[0].group_id, ids.group);
    assert.equal(schedule[0].subject_id, ids.subject);
    assert.equal(schedule[0].teacher_id, ids.teacher);
    assert.equal(schedule[0].status, 'published');

  } finally {
    try {
      const cleanup = [
        ['schedule', ids.lesson],
        ['children', ids.child],
        ['groups', ids.group],
        ['subjects', ids.subject],
        ['employees', ids.teacher],
        ['rooms', ids.room]
      ];

      for (const [table, id] of cleanup) {
        if (id != null) {
          await pool.query(
            `DELETE FROM ${table} WHERE id = $1`,
            [id]
          );
        }
      }
    } finally {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  }
});

