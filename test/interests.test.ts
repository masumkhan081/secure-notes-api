import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import {
  FixtureTracker,
  app,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./setup.js";

const fixtures = new FixtureTracker();

describe("Admin interest groups and member aggregation", () => {
  let admin: Awaited<ReturnType<FixtureTracker["createUser"]>>;
  let tag: string;

  before(async () => {
    await connectTestDatabase();
    admin = await fixtures.createUser({
      tag: "interest-admin",
      role: "ADMIN",
      interests: [],
    });
    tag = fixtures.runId;
  });

  after(async () => {
    try {
      await fixtures.cleanup();
    } finally {
      await disconnectTestDatabase();
    }
  });

  it("normalizes duplicate interests, skips empty-interest users, paginates groups alphabetically, and encodes '&' / spaces", async () => {
    const specialInterest = `${tag} art & design`;
    const alphaInterest = `${tag} astronomy`;
    const middleInterest = `${tag} chess`;

    const createUsers = [
      {
        name: "U1",
        email: fixtures.email("int-1"),
        password: "StrongPassword123!",
        // Duplicate casing + spacing should normalize and count U1 once.
        interests: [` ${specialInterest.toUpperCase()} `, specialInterest, alphaInterest],
      },
      {
        name: "U2",
        email: fixtures.email("int-2"),
        password: "StrongPassword123!",
        interests: [specialInterest, middleInterest],
      },
      {
        name: "U3",
        email: fixtures.email("int-3"),
        password: "StrongPassword123!",
        interests: [specialInterest],
      },
      {
        name: "No Interests",
        email: fixtures.email("int-none"),
        password: "StrongPassword123!",
        interests: [],
      },
    ];

    const createdMemberIds: string[] = [];
    for (const payload of createUsers) {
      const res = await request(app)
        .post("/api/admin/users")
        .set("Authorization", `Bearer ${admin.token}`)
        .send(payload);
      assert.equal(res.status, 201);
      fixtures.trackUser(res.body.user.id);
      if (payload.interests.length > 0) {
        createdMemberIds.push(res.body.user.id);
      }
    }

    // Read groups scoped via cursor just before our unique run prefix.
    const page1 = await request(app)
      .get(
        `/api/admin/interests?limit=2&cursor=${encodeURIComponent(`${tag} a`)}`,
      )
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(page1.status, 200);
    assert.deepEqual(page1.body.items, [
      { interest: specialInterest, userCount: 3 },
      { interest: alphaInterest, userCount: 1 },
    ]);
    assert.equal(page1.body.pageInfo.hasMore, true);
    assert.equal(page1.body.pageInfo.nextCursor, alphaInterest);

    const page2 = await request(app)
      .get(
        `/api/admin/interests?limit=2&cursor=${encodeURIComponent(page1.body.pageInfo.nextCursor)}`,
      )
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(page2.status, 200);
    assert.ok(
      page2.body.items.some(
        (group: { interest: string; userCount: number }) =>
          group.interest === middleInterest && group.userCount === 1,
      ),
    );

    // Members for URL-encoded interest containing spaces and '&' with ObjectId cursor pagination.
    const members1 = await request(app)
      .get(
        `/api/admin/interests/users?interest=${encodeURIComponent(specialInterest)}&limit=2`,
      )
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(members1.status, 200);
    assert.equal(members1.body.interest, specialInterest);
    assert.equal(members1.body.items.length, 2);
    assert.equal(members1.body.pageInfo.hasMore, true);
    assert.ok(members1.body.pageInfo.nextCursor);

    const members2 = await request(app)
      .get(
        `/api/admin/interests/users?interest=${encodeURIComponent(specialInterest)}&limit=2&cursor=${members1.body.pageInfo.nextCursor}`,
      )
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(members2.status, 200);
    assert.equal(members2.body.items.length, 1);
    assert.equal(members2.body.pageInfo.hasMore, false);
    assert.equal(members2.body.pageInfo.nextCursor, null);

    const allMembers = [...members1.body.items, ...members2.body.items];
    for (const member of allMembers as Array<Record<string, unknown>>) {
      assert.equal("passwordHash" in member, false);
    }
    const memberIds = allMembers.map((m: { id: string }) => m.id);
    assert.deepEqual(memberIds, createdMemberIds.slice(0, 3).reverse());
  });
});
