import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from 'pg';
import { defaultDirectory, readMigrations } from '../../src/database/migrations.js';

const cli = fileURLToPath(new URL('../../src/database/migrate.js', import.meta.url));
function migrate(database, directory = defaultDirectory) {
  return new Promise((resolveResult, reject) => {
    execFile(process.execPath, [cli, '--directory', directory], {
      env: { ...process.env, PGDATABASE: database }, timeout: 30000,
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${stdout}\n${stderr}`));
      else resolveResult(stdout);
    });
  });
}

async function fixture(c) {
  const id = async (sql, args = []) => (await c.query(sql, args)).rows[0].id;
  const employee = (position, phone) => id(`INSERT INTO employees
    (first_name,last_name,phone,position,salary) VALUES ('Test','Employee',$1,$2,0) RETURNING id`, [phone, position]);
  const teacher = await employee('teacher', '1000001');
  const other = await employee('teacher', '1000002');
  const groups = [];
  for (let n = 0; n < 2; n++) {
    const room = await id(`INSERT INTO rooms (name,capacity) VALUES ($1,20) RETURNING id`, [`Room ${n}`]);
    const group = await id(`INSERT INTO groups (name,room_id,age_years) VALUES ($1,$2,3) RETURNING id`, [`Group ${n}`, room]);
    for (const [i, role] of ['educator', 'assistant'].entries()) {
      const staff = await employee(role, `20000${n}${i}`);
      await c.query('SELECT kms_assign_employee_to_group($1,$2,$3)', [group, staff, role]);
    }
    await c.query('SELECT kms_activate_group($1)', [group]);
    groups.push({ group, room });
  }
  const subject = await id(`INSERT INTO subjects (name) VALUES ('Test subject') RETURNING id`);
  await c.query('INSERT INTO employee_subjects VALUES ($1,$3),($2,$3)', [teacher, other, subject]);
  const lesson = await id(`INSERT INTO schedule (group_id,room_id,subject_id,teacher_id,start_time,end_time)
    VALUES ($1,$2,$3,$4,'2026-11-02 10:00+02','2026-11-02 11:00+02') RETURNING id`,
  [groups[0].group, groups[0].room, subject, teacher]);
  const otherLesson = await id(`INSERT INTO schedule (group_id,room_id,subject_id,teacher_id,start_time,end_time)
    VALUES ($1,$2,$3,$4,'2026-11-03 10:00+02','2026-11-03 11:00+02') RETURNING id`,
  [groups[0].group, groups[0].room, subject, other]);
  const user = await id(`INSERT INTO users (username,password_hash,role,employee_id)
    VALUES ('teacher','test-hash','employee',$1) RETURNING id`, [teacher]);
  const admins = [];
  for (const role of ['admin', 'manager']) {
    admins.push(await id(`INSERT INTO users (username,password_hash,role)
      VALUES ($1,'test-hash',$1) RETURNING id`, [role]));
  }
  const blocks = [];
  for (const [kind, start, end] of [
    ['meal', '08:00', '08:30'], ['meal', '12:00', '12:30'],
    ['nap', '13:00', '14:00'], ['meal', '15:00', '15:30'],
  ]) {
    blocks.push(await id(`INSERT INTO kms_daily_blocks (group_id,block_date,kind,start_time,end_time)
      VALUES ($1,'2026-11-02',$2,$3,$4) RETURNING id`,
    [groups[0].group, kind, `2026-11-02 ${start}+02`, `2026-11-02 ${end}+02`]));
  }
  await c.query("SELECT kms_publish_group_day($1,'2026-11-02')", [groups[0].group]);
  return { teacher, user, admins, groups, lesson, otherLesson, blocks };
}

async function rollback(c, action) {
  await c.query('BEGIN');
  try { await action(); } finally { await c.query('ROLLBACK'); }
}

test('SQL business rules on isolated PostgreSQL databases', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB && 'Set MIGRATION_TEST_ADMIN_DB to enable PostgreSQL tests',
  timeout: 120000,
}, async (t) => {
  const admin = new Client({ database: process.env.MIGRATION_TEST_ADMIN_DB, connectionTimeoutMillis: 3000 });
  await admin.connect();
  t.after(() => admin.end());
  async function database(subtest) {
    const name = `cknodejs_rules_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(name, /^cknodejs_rules_test_[a-f0-9]{32}$/);
    await admin.query(`CREATE DATABASE "${name}"`);
    let c;
    subtest.after(async () => {
      await c?.end();
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    });
    c = new Client({ database: name, connectionTimeoutMillis: 3000 });
    await c.connect();
    return { name, c };
  }
  const directory = await mkdtemp(join(tmpdir(), 'cknodejs-rules-'));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('cknodejs-rules-'));
    await rm(directory, { recursive: true, force: true });
  });
  const files = await readMigrations(defaultDirectory);
  for (const file of files.filter((f) => f.number <= 11)) {
    await copyFile(join(defaultDirectory, file.filename), join(directory, file.filename));
  }

  await t.test('reproduce both defects on 0001–0011, then upgrade and repeat', async (st) => {
    const { name, c } = await database(st);
    assert.match(await migrate(name, directory), /11 applied, 0 already applied/);
    const f = await fixture(c);
    assert.equal((await c.query('SELECT kms_can_manage_lesson($1,$2) AS allowed', [f.user, f.lesson])).rows[0].allowed, false);
    for (const sql of [
      `DELETE FROM kms_daily_blocks WHERE id = ${f.blocks[0]}`,
      `DELETE FROM kms_daily_blocks WHERE id = ${f.blocks[2]}`,
      `UPDATE kms_daily_blocks SET start_time='2026-11-02 17:00+02',end_time='2026-11-02 17:30+02' WHERE id=${f.blocks[3]}`,
    ]) {
      await rollback(c, async () => {
        assert.equal((await c.query(sql)).rowCount, 1);
        await assert.rejects(c.query("SELECT kms_publish_group_day($1,'2026-11-02')", [f.groups[0].group]),
          /KMS_DAILY_ROUTINE_INCOMPLETE|KMS_BLOCK_OUTSIDE_WORKDAY/);
      });
    }
    if (process.env.SQL_RULES_REPRO_ONLY === '1') return;
    const before = (await c.query('SELECT * FROM schema_migrations ORDER BY number')).rows;
    assert.match(await migrate(name), /1 applied, 11 already applied/);
    assert.deepEqual((await c.query('SELECT * FROM schema_migrations WHERE number<=11 ORDER BY number')).rows, before);
    assert.match(await migrate(name), /0 applied, 12 already applied/);
    await st.test('legacy published day requires explicit window before editing', async () => {
      await assert.rejects(c.query('UPDATE kms_daily_blocks SET start_time=start_time WHERE id=$1', [f.blocks[0]]), /KMS_REPUBLISH_DAY_REQUIRED/);
      await c.query("SELECT kms_publish_group_day($1,'2026-11-02')", [f.groups[0].group]);
    });
    await regression(st, c, f);
  });
  if (process.env.SQL_RULES_REPRO_ONLY === '1') return;
  await t.test('all migrations on clean database and repeat', async (st) => {
    const { name, c } = await database(st);
    assert.match(await migrate(name), /12 applied, 0 already applied/);
    const before = (await c.query('SELECT * FROM schema_migrations ORDER BY number')).rows;
    assert.match(await migrate(name), /0 applied, 12 already applied/);
    assert.deepEqual((await c.query('SELECT * FROM schema_migrations ORDER BY number')).rows, before);
    await regression(st, c, await fixture(c));
  });
});

async function regression(t, c, f) {
  await t.test('employee teacher: own/other lesson, user and employee status, admin/manager', async () => {
    const allowed = async (user, lesson = f.lesson) => (await c.query(
      'SELECT kms_can_manage_lesson($1,$2) AS allowed', [user, lesson])).rows[0].allowed;
    assert.equal(await allowed(f.user), true);
    assert.equal(await allowed(f.user, f.otherLesson), false);
    assert.equal(await allowed(f.user, -1), false);
    assert.equal(await allowed(-1), false);
    await rollback(c, async () => {
      await c.query("UPDATE users SET role='teacher' WHERE id=$1", [f.user]);
      assert.equal(await allowed(f.user), true);
      assert.equal(await allowed(f.user, f.otherLesson), false);
    });
    for (const user of [f.user, ...f.admins]) {
      assert.equal(await allowed(user), true);
      for (const change of ["status='blocked'", "status='inactive'", "status='pending'", 'is_active=false']) {
        await rollback(c, async () => {
          await c.query(`UPDATE users SET ${change} WHERE id=$1`, [user]);
          assert.equal(await allowed(user), false);
        });
      }
    }
    for (const change of ["status='inactive'", "status='on_leave'", "position='cook'"]) {
      await rollback(c, async () => {
        await c.query(`UPDATE employees SET ${change} WHERE id=$1`, [f.teacher]);
        assert.equal(await allowed(f.user), false);
        for (const user of f.admins) assert.equal(await allowed(user), true);
      });
    }
  });
  for (const [label, sql, error] of [
    ['delete meal', `DELETE FROM kms_daily_blocks WHERE id=${f.blocks[0]}`, 'KMS_DAILY_ROUTINE_INCOMPLETE'],
    ['delete nap', `DELETE FROM kms_daily_blocks WHERE id=${f.blocks[2]}`, 'KMS_DAILY_ROUTINE_INCOMPLETE'],
    ['change kind', `UPDATE kms_daily_blocks SET kind='nap',end_time=start_time+interval '1 hour' WHERE id=${f.blocks[0]}`, 'KMS_DAILY_ROUTINE_INCOMPLETE'],
    ['outside eight hours', `UPDATE kms_daily_blocks SET start_time='2026-11-02 17:00+02',end_time='2026-11-02 17:30+02' WHERE id=${f.blocks[3]}`, 'KMS_BLOCK_OUTSIDE_WORKDAY'],
    ['move group: old day', `UPDATE kms_daily_blocks SET group_id=${f.groups[1].group} WHERE id=${f.blocks[0]}`, 'KMS_DAILY_ROUTINE_INCOMPLETE'],
    ['move date: old day', `UPDATE kms_daily_blocks SET block_date=block_date+1,start_time=start_time+interval '1 day',end_time=end_time+interval '1 day' WHERE id=${f.blocks[0]}`, 'KMS_DAILY_ROUTINE_INCOMPLETE'],
    ['extra meal', `INSERT INTO kms_daily_blocks(group_id,block_date,kind,start_time,end_time) VALUES (${f.groups[0].group},'2026-11-02','meal','2026-11-02 09:00+02','2026-11-02 09:30+02')`, 'KMS_DAILY_ROUTINE_INCOMPLETE'],
  ]) {
    await t.test(label, async () => {
      await rollback(c, async () => {
        await assert.rejects(c.query(sql), new RegExp(error));
      });
      assert.equal((await c.query('SELECT count(*)::int AS n FROM kms_daily_blocks')).rows[0].n, 4);
    });
  }
  await t.test('valid time edit and draft incremental filling', async () => {
    await rollback(c, async () => {
      await c.query(`UPDATE kms_daily_blocks SET start_time='2026-11-02 14:45+02',end_time='2026-11-02 15:15+02' WHERE id=$1`, [f.blocks[3]]);
      await c.query(`INSERT INTO kms_daily_blocks(group_id,block_date,kind,start_time,end_time)
        VALUES ($1,'2026-11-04','meal','2026-11-04 09:00+02','2026-11-04 09:30+02')`, [f.groups[1].group]);
      await c.query("DELETE FROM kms_daily_blocks WHERE block_date='2026-11-04'");
    });
  });
  await t.test('valid multi-row change checks final statement state', async () => {
    await rollback(c, async () => {
      await c.query(`UPDATE kms_daily_blocks SET
        kind = CASE WHEN kind='meal' THEN 'nap' ELSE 'meal' END,
        end_time = start_time + CASE WHEN kind='meal' THEN interval '1 hour' ELSE interval '30 minutes' END
        WHERE id IN ($1,$2)`, [f.blocks[0], f.blocks[2]]);
    });
  });
  await t.test('valid delete/insert replacement can defer routine check until commit', async () => {
    await c.query('BEGIN');
    try {
      await c.query('SET CONSTRAINTS trg_kms_published_routine_guard DEFERRED');
      const { rows: [b] } = await c.query('DELETE FROM kms_daily_blocks WHERE id=$1 RETURNING *', [f.blocks[3]]);
      await c.query(`INSERT INTO kms_daily_blocks(group_id,block_date,kind,start_time,end_time)
        VALUES ($1,$2,$3,$4,$5)`, [b.group_id, b.block_date, b.kind, b.start_time, b.end_time]);
      await c.query('SET CONSTRAINTS trg_kms_published_routine_guard IMMEDIATE');
    } finally { await c.query('ROLLBACK'); }
    await c.query('BEGIN');
    try {
      await c.query('SET CONSTRAINTS trg_kms_published_routine_guard DEFERRED');
      await c.query('DELETE FROM kms_daily_blocks WHERE id=$1', [f.blocks[2]]);
      await assert.rejects(c.query('COMMIT'), /KMS_DAILY_ROUTINE_INCOMPLETE/);
    } finally { await c.query('ROLLBACK'); }
  });
  await t.test('non-default publication window is preserved', async () => {
    await rollback(c, async () => {
      // Shift the entire fixture to a 09:00–17:00 workday while it is a draft.
      await c.query("UPDATE schedule SET status='draft' WHERE id=$1", [f.lesson]);
      for (const block of [...f.blocks].reverse()) {
        await c.query("UPDATE kms_daily_blocks SET start_time=start_time+interval '1 hour',end_time=end_time+interval '1 hour' WHERE id=$1", [block]);
      }
      await c.query("UPDATE schedule SET start_time=start_time+interval '1 hour',end_time=end_time+interval '1 hour' WHERE id=$1", [f.lesson]);
      await c.query("SELECT kms_publish_group_day($1,'2026-11-02','09:00')", [f.groups[0].group]);
      await c.query("UPDATE kms_daily_blocks SET start_time='2026-11-02 16:30+02',end_time='2026-11-02 17:00+02' WHERE id=$1", [f.blocks[3]]);
      await assert.rejects(c.query("UPDATE kms_daily_blocks SET start_time='2026-11-02 08:00+02',end_time='2026-11-02 08:30+02' WHERE id=$1", [f.blocks[0]]), /KMS_BLOCK_OUTSIDE_WORKDAY/);
    });
  });
  for (const dimension of ['group', 'date']) {
    await t.test(`move draft block into published day: new ${dimension}`, async () => {
      await rollback(c, async () => {
        const sourceGroup = dimension === 'group' ? f.groups[1].group : f.groups[0].group;
        const day = dimension === 'group' ? '2026-11-02' : '2026-11-04';
        const { rows: [b] } = await c.query(`INSERT INTO kms_daily_blocks(group_id,block_date,kind,start_time,end_time)
          VALUES ($1,$2,'meal',$3,$4) RETURNING id`, [sourceGroup, day, `${day} 09:00+02`, `${day} 09:30+02`]);
        await assert.rejects(c.query(`UPDATE kms_daily_blocks SET group_id=$1,block_date='2026-11-02',
          start_time='2026-11-02 09:00+02',end_time='2026-11-02 09:30+02' WHERE id=$2`, [f.groups[0].group, b.id]), /KMS_DAILY_ROUTINE_INCOMPLETE/);
      });
    });
  }
}
