import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { Client } from "pg";

const execFileAsync = promisify(execFile);
const migrate = fileURLToPath(
  new URL("../src/database/migrate.js", import.meta.url),
);

function dateYearsAgo(years) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - 1);

  return date.toISOString().slice(0, 10);
}

test(
  "Complete kindergarten API scenario",
  {
    skip: !process.env.MIGRATION_TEST_ADMIN_DB,
    timeout: 120000,
  },
  async (t) => {
    const dbName = `cknodejs_scenario_${randomUUID().replaceAll("-", "")}`;
    const originalDatabase = process.env.PGDATABASE;
    const admin = new Client({
      database: process.env.MIGRATION_TEST_ADMIN_DB,
      connectionTimeoutMillis: 3000,
    });

    let server;
    let pool;
    let adminConnected = false;
    let created = false;

    try {
      await admin.connect();
      adminConnected = true;

      await admin.query(`CREATE DATABASE "${dbName}"`);
      created = true;

      await execFileAsync(process.execPath, [migrate], {
        env: { ...process.env, PGDATABASE: dbName },
        timeout: 60000,
      });

      process.env.PGDATABASE = dbName;

      const { default: app } = await import("../src/app.js");
      ({ pool } = await import("../src/config/database.js"));

      server = app.listen(0, "127.0.0.1");
      await once(server, "listening");

      const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

      async function request(method, path, body) {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: { "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

        const text = await response.text();

        return {
          status: response.status,
          body: text ? JSON.parse(text) : null,
        };
      }

      async function createRecord(path, data) {
        const response = await request("POST", path, data);

        assert.equal(
          response.status,
          201,
          `POST ${path}: ${JSON.stringify(response.body)}`,
        );

        return response.body.data;
      }

      async function createEmployee(position, number) {
        return createRecord("/employees", {
          first_name: "Test",
          last_name: `Employee${number}`,
          email: `scenario${number}@example.com`,
          phone: `099${String(number).padStart(7, "0")}`,
          position,
          salary: 20000,
          status: "active",
        });
      }

      async function createChild(firstName, age) {
        return createRecord("/children", {
          first_name: firstName,
          last_name: "Child",
          date_of_birth: dateYearsAgo(age),
        });
      }

      const room = await createRecord("/rooms", {
        name: "Scenario Room",
        capacity: 20,
        status: "available",
      });

      await t.test("Update room and verify persistence", async () => {
        const response = await request("PATCH", `/rooms/${room.id}`, {
          name: "Updated Scenario Room",
          capacity: 25,
        });

        assert.equal(response.status, 200);

        const updatedRoom = await request("GET", `/rooms/${room.id}`);

        assert.equal(updatedRoom.status, 200);
        assert.equal(updatedRoom.body.data.name, "Updated Scenario Room");
        assert.equal(Number(updatedRoom.body.data.capacity), 25);
        assert.equal(updatedRoom.body.data.status, "available");
      });

      const group = await createRecord("/groups", {
        name: "Scenario Group",
        room_id: Number(room.id),
        age_years: 3,
        max_capacity: 20,
      });

      await t.test("Update group and verify persistence", async () => {
        const response = await request("PATCH", `/groups/${group.id}`, {
          name: "Updated Scenario Group",
          max_capacity: 18,
        });

        assert.equal(response.status, 200);

        const updatedGroup = await request("GET", `/groups/${group.id}`);

        assert.equal(updatedGroup.status, 200);
        assert.equal(updatedGroup.body.data.name, "Updated Scenario Group");
        assert.equal(Number(updatedGroup.body.data.max_capacity), 18);
        assert.equal(Number(updatedGroup.body.data.room_id), Number(room.id));
        assert.equal(Number(updatedGroup.body.data.age_years), 3);
      });

      await t.test("Group cannot activate without staff", async () => {
        const response = await request("PATCH", `/groups/${group.id}/status`, {
          status: "active",
        });

        assert.equal(response.status, 409);
      });

      const educator = await createEmployee("educator", 1);
      const assistant = await createEmployee("assistant", 2);

      await t.test("Assign staff and activate group", async () => {
        for (const [employee, role] of [
          [educator, "educator"],
          [assistant, "assistant"],
        ]) {
          const response = await request(
            "POST",
            `/groups/${group.id}/employees`,
            {
              employee_id: Number(employee.id),
              role,
            },
          );

          assert.equal(response.status, 201);
        }

        const response = await request("PATCH", `/groups/${group.id}/status`, {
          status: "active",
        });

        assert.equal(response.status, 200);
      });

      const child = await createChild("Test", 3);

      await t.test("Enroll child into group", async () => {
        const response = await request("POST", `/groups/${group.id}/children`, {
          child_id: Number(child.id),
        });

        assert.equal(response.status, 200);

        const children = await request("GET", `/groups/${group.id}/children`);

        assert.equal(children.status, 200);
        assert.ok(
          children.body.data.some(
            (item) => Number(item.id) === Number(child.id),
          ),
        );
      });

      const parent = await createRecord("/parents", {
        first_name: "Test",
        last_name: "Parent",
        email: `parent${randomUUID().slice(0, 8)}@example.com`,
        phone: "0980000001",
      });

      await t.test("Link parent to child", async () => {
        const response = await request(
          "POST",
          `/parents/${parent.id}/children`,
          {
            child_id: Number(child.id),
            relationship_type: "parent",
          },
        );

        assert.equal(response.status, 201);

        const children = await request("GET", `/parents/${parent.id}/children`);

        assert.equal(children.status, 200);
        assert.ok(
          children.body.data.some(
            (item) => Number(item.id) === Number(child.id),
          ),
        );

        const parents = await request("GET", `/children/${child.id}/parents`);

        assert.equal(parents.status, 200);
        assert.ok(
          parents.body.data.some(
            (item) => Number(item.parent_id) === Number(parent.id),
          ),
        );
      });

      const secondRoom = await createRecord("/rooms", {
        name: "Scenario Room 2",
        capacity: 20,
        status: "available",
      });

      const secondGroup = await createRecord("/groups", {
        name: "Scenario Group 2",
        room_id: Number(secondRoom.id),
        age_years: 3,
        max_capacity: 20,
      });

      await t.test("Reject assigning child to another group", async () => {
        const response = await request(
          "POST",
          `/groups/${secondGroup.id}/children`,
          { child_id: Number(child.id) },
        );

        assert.equal(response.status, 409);

        const currentGroup = await request(
          "GET",
          `/groups/${group.id}/children`,
        );

        assert.equal(currentGroup.status, 200);
        assert.ok(
          currentGroup.body.data.some(
            (item) => Number(item.id) === Number(child.id),
          ),
        );
      });

      await t.test("Transfer child between groups", async () => {
        const remove = await request(
          "DELETE",
          `/groups/${group.id}/children/${child.id}`,
        );

        assert.equal(remove.status, 200);

        const assign = await request(
          "POST",
          `/groups/${secondGroup.id}/children`,
          { child_id: Number(child.id) },
        );

        assert.equal(assign.status, 200);

        const oldGroup = await request("GET", `/groups/${group.id}/children`);

        const newGroup = await request(
          "GET",
          `/groups/${secondGroup.id}/children`,
        );

        assert.equal(oldGroup.status, 200);
        assert.equal(newGroup.status, 200);

        assert.ok(
          !oldGroup.body.data.some(
            (item) => Number(item.id) === Number(child.id),
          ),
        );

        assert.ok(
          newGroup.body.data.some(
            (item) => Number(item.id) === Number(child.id),
          ),
        );
      });

      await t.test("Reject duplicate child enrollment", async () => {
        const response = await request(
          "POST",
          `/groups/${secondGroup.id}/children`,
          { child_id: Number(child.id) },
        );

        assert.equal(response.status, 409);
      });

      await t.test("Reject child with incorrect group age", async () => {
        const olderChild = await createChild("Older", 5);

        const response = await request(
          "POST",
          `/groups/${secondGroup.id}/children`,
          { child_id: Number(olderChild.id) },
        );

        assert.equal(response.status, 400);

        const details = await request("GET", `/children/${olderChild.id}`);

        assert.equal(details.status, 200);
        assert.equal(details.body.data.group_id, null);
      });

      await t.test("Reject enrollment of missing child", async () => {
        const response = await request(
          "POST",
          `/groups/${secondGroup.id}/children`,
          { child_id: 999999999 },
        );

        assert.equal(response.status, 404);
      });

      const smallRoom = await createRecord("/rooms", {
        name: "Scenario Small Room",
        capacity: 1,
        status: "available",
      });

      await t.test("Reject group exceeding room capacity", async () => {
        const response = await request("POST", "/groups", {
          name: "Oversized Group",
          room_id: Number(smallRoom.id),
          age_years: 3,
          max_capacity: 2,
        });

        assert.equal(response.status, 400, JSON.stringify(response.body));
      });

      const smallGroup = await createRecord("/groups", {
        name: "Scenario Small Group",
        room_id: Number(smallRoom.id),
        age_years: 3,
        max_capacity: 1,
      });

      await t.test("Reject enrollment when group is full", async () => {
        const firstChild = await createChild("First", 3);
        const secondChild = await createChild("Second", 3);

        const firstEnrollment = await request(
          "POST",
          `/groups/${smallGroup.id}/children`,
          { child_id: Number(firstChild.id) },
        );

        assert.equal(firstEnrollment.status, 200);

        const secondEnrollment = await request(
          "POST",
          `/groups/${smallGroup.id}/children`,
          { child_id: Number(secondChild.id) },
        );

        assert.equal(secondEnrollment.status, 409);

        const children = await request(
          "GET",
          `/groups/${smallGroup.id}/children`,
        );

        assert.equal(children.status, 200);
        assert.equal(children.body.data.length, 1);
        assert.equal(Number(children.body.data[0].id), Number(firstChild.id));

        const details = await request("GET", `/children/${secondChild.id}`);

        assert.equal(details.status, 200);
        assert.equal(details.body.data.group_id, null);
      });

      await t.test(
        "Repeated parent-child link does not create duplicates",
        async () => {
          const response = await request(
            "POST",
            `/parents/${parent.id}/children`,
            {
              child_id: Number(child.id),
              relationship_type: "parent",
            },
          );

          assert.equal(response.status, 201);

          const children = await request(
            "GET",
            `/parents/${parent.id}/children`,
          );

          assert.equal(children.status, 200);

          const linkedChildren = children.body.data.filter(
            (item) => Number(item.id) === Number(child.id),
          );

          assert.equal(linkedChildren.length, 1);
        },
      );
    } finally {
      try {
        if (server) {
          await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          });
        }

        if (pool) {
          await pool.end();
        }
      } finally {
        try {
          if (created) {
            await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
          }
        } finally {
          if (adminConnected) {
            await admin.end();
          }

          if (originalDatabase === undefined) {
            delete process.env.PGDATABASE;
          } else {
            process.env.PGDATABASE = originalDatabase;
          }
        }
      }
    }
  },
);
