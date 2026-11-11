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

describe("Private notes CRUD, ownership, validation, and pagination", () => {
  let userA: Awaited<ReturnType<FixtureTracker["createUser"]>>;
  let userB: Awaited<ReturnType<FixtureTracker["createUser"]>>;
  let admin: Awaited<ReturnType<FixtureTracker["createUser"]>>;

  before(async () => {
    await connectTestDatabase();
    userA = await fixtures.createUser({ tag: "notes-a" });
    userB = await fixtures.createUser({ tag: "notes-b" });
    admin = await fixtures.createUser({ tag: "notes-admin", role: "ADMIN" });
  });

  after(async () => {
    try {
      await fixtures.cleanup();
    } finally {
      await disconnectTestDatabase();
    }
  });

  it("supports create, read, update, and 204 empty delete for the owner", async () => {
    const created = await request(app)
      .post("/api/notes")
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ title: "  First Note  ", content: "  Secret body  " });
    assert.equal(created.status, 201);
    const noteId = created.body.note.id as string;
    fixtures.trackNote(noteId);
    assert.equal(created.body.note.title, "First Note");
    assert.equal(created.body.note.content, "Secret body");
    assert.equal("ownerId" in created.body.note, false);

    const read = await request(app)
      .get(`/api/notes/${noteId}`)
      .set("Authorization", `Bearer ${userA.token}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.note.id, noteId);

    const updated = await request(app)
      .patch(`/api/notes/${noteId}`)
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ title: "Updated Title" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.note.title, "Updated Title");
    assert.equal(updated.body.note.content, "Secret body");

    const deleted = await request(app)
      .delete(`/api/notes/${noteId}`)
      .set("Authorization", `Bearer ${userA.token}`);
    assert.equal(deleted.status, 204);
    assert.equal(deleted.text, "");

    const afterDelete = await request(app)
      .get(`/api/notes/${noteId}`)
      .set("Authorization", `Bearer ${userA.token}`);
    assert.equal(afterDelete.status, 404);
  });

  it("isolates private notes across users and blocks admin mutation via personal routes while allowing admin read", async () => {
    const created = await request(app)
      .post("/api/notes")
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ title: "Private to A", content: "Confidential" });
    assert.equal(created.status, 201);
    const noteId = created.body.note.id as string;
    fixtures.trackNote(noteId);

    // User B cannot read, update, or delete User A's note.
    const bRead = await request(app)
      .get(`/api/notes/${noteId}`)
      .set("Authorization", `Bearer ${userB.token}`);
    assert.equal(bRead.status, 404);

    const bPatch = await request(app)
      .patch(`/api/notes/${noteId}`)
      .set("Authorization", `Bearer ${userB.token}`)
      .send({ title: "Hijacked" });
    assert.equal(bPatch.status, 404);

    const bDelete = await request(app)
      .delete(`/api/notes/${noteId}`)
      .set("Authorization", `Bearer ${userB.token}`);
    assert.equal(bDelete.status, 404);

    // Admin cannot read, update, or delete User A's note through personal routes.
    const adminPersonalRead = await request(app)
      .get(`/api/notes/${noteId}`)
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(adminPersonalRead.status, 404);

    const adminPersonalPatch = await request(app)
      .patch(`/api/notes/${noteId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ title: "Admin Mutated" });
    assert.equal(adminPersonalPatch.status, 404);

    const adminPersonalDelete = await request(app)
      .delete(`/api/notes/${noteId}`)
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(adminPersonalDelete.status, 404);

    // Admin can view User A's note via admin read endpoints.
    const adminReadOne = await request(app)
      .get(`/api/admin/notes/${noteId}`)
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(adminReadOne.status, 200);
    assert.equal(adminReadOne.body.note.id, noteId);
    assert.equal(adminReadOne.body.note.ownerId, userA.id);

    const adminReadList = await request(app)
      .get("/api/admin/notes?limit=100")
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(adminReadList.status, 200);
    assert.ok(
      adminReadList.body.items.some((item: { id: string }) => item.id === noteId),
    );
  });

  it("rejects invalid IDs, unavailable IDs, extra ownerId, empty updates, and blank or oversized fields", async () => {
    const created = await request(app)
      .post("/api/notes")
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ title: "Validation Target", content: "Original" });
    assert.equal(created.status, 201);
    const noteId = created.body.note.id as string;
    fixtures.trackNote(noteId);

    const badId = await request(app)
      .get("/api/notes/not-an-object-id")
      .set("Authorization", `Bearer ${userA.token}`);
    assert.equal(badId.status, 400);

    const missingId = await request(app)
      .get("/api/notes/507f1f77bcf86cd799439011")
      .set("Authorization", `Bearer ${userA.token}`);
    assert.equal(missingId.status, 404);

    const extraOwner = await request(app)
      .post("/api/notes")
      .set("Authorization", `Bearer ${userA.token}`)
      .send({
        title: "Spoof",
        content: "Body",
        ownerId: userB.id,
      });
    assert.equal(extraOwner.status, 400);

    const emptyPatch = await request(app)
      .patch(`/api/notes/${noteId}`)
      .set("Authorization", `Bearer ${userA.token}`)
      .send({});
    assert.equal(emptyPatch.status, 400);

    const blankTitle = await request(app)
      .post("/api/notes")
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ title: "   ", content: "Body" });
    assert.equal(blankTitle.status, 400);

    const oversizedTitle = await request(app)
      .post("/api/notes")
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ title: "a".repeat(201), content: "Body" });
    assert.equal(oversizedTitle.status, 400);

    const oversizedContent = await request(app)
      .post("/api/notes")
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ title: "Valid", content: "b".repeat(20_001) });
    assert.equal(oversizedContent.status, 400);
  });

  it("paginates notes with bounded pages, no duplicates, and rejects invalid limits or cursors", async () => {
    const pager = await fixtures.createUser({ tag: "notes-pager" });
    const createdIds: string[] = [];

    for (let i = 1; i <= 12; i += 1) {
      const res = await request(app)
        .post("/api/notes")
        .set("Authorization", `Bearer ${pager.token}`)
        .send({ title: `Paged ${i}`, content: `Body ${i}` });
      assert.equal(res.status, 201);
      createdIds.push(res.body.note.id);
      fixtures.trackNote(res.body.note.id);
    }

    const p1 = await request(app)
      .get("/api/notes?limit=5")
      .set("Authorization", `Bearer ${pager.token}`);
    assert.equal(p1.status, 200);
    assert.equal(p1.body.items.length, 5);
    assert.equal(p1.body.pageInfo.hasMore, true);
    assert.ok(p1.body.pageInfo.nextCursor);

    const p2 = await request(app)
      .get(`/api/notes?limit=5&cursor=${p1.body.pageInfo.nextCursor}`)
      .set("Authorization", `Bearer ${pager.token}`);
    assert.equal(p2.status, 200);
    assert.equal(p2.body.items.length, 5);
    assert.equal(p2.body.pageInfo.hasMore, true);

    const p3 = await request(app)
      .get(`/api/notes?limit=5&cursor=${p2.body.pageInfo.nextCursor}`)
      .set("Authorization", `Bearer ${pager.token}`);
    assert.equal(p3.status, 200);
    assert.equal(p3.body.items.length, 2);
    assert.equal(p3.body.pageInfo.hasMore, false);
    assert.equal(p3.body.pageInfo.nextCursor, null);

    const collected = [
      ...p1.body.items.map((n: { id: string }) => n.id),
      ...p2.body.items.map((n: { id: string }) => n.id),
      ...p3.body.items.map((n: { id: string }) => n.id),
    ];
    assert.equal(collected.length, 12);
    assert.equal(new Set(collected).size, 12);
    assert.deepEqual(collected, [...createdIds].reverse());

    for (const badQuery of [
      "/api/notes?limit=0",
      "/api/notes?limit=101",
      "/api/notes?limit=abc",
      "/api/notes?cursor=invalid-cursor",
    ]) {
      const bad = await request(app)
        .get(badQuery)
        .set("Authorization", `Bearer ${pager.token}`);
      assert.equal(bad.status, 400, `Expected 400 for ${badQuery}`);
    }
  });
});
