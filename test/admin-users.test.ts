import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import {
  FixtureTracker,
  Note,
  Post,
  User,
  app,
  connectTestDatabase,
  disconnectTestDatabase,
  withActiveUser,
} from "./setup.js";

const fixtures = new FixtureTracker();

describe("Admin user management and deletion/creation coordination", () => {
  let admin: Awaited<ReturnType<FixtureTracker["createUser"]>>;

  before(async () => {
    await connectTestDatabase();
    admin = await fixtures.createUser({ tag: "admin-mgr", role: "ADMIN" });
  });

  after(async () => {
    try {
      await fixtures.cleanup();
    } finally {
      await disconnectTestDatabase();
    }
  });

  it("creates, reads, lists, and edits normal users while excluding hashes and rejecting role/password updates", async () => {
    const email = fixtures.email("managed");

    const roleRejected = await request(app)
      .post("/api/admin/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        name: "Bad Role",
        email,
        password: "StrongPassword123!",
        role: "ADMIN",
      });
    assert.equal(roleRejected.status, 400);

    const created = await request(app)
      .post("/api/admin/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        name: "Managed User",
        email,
        password: "StrongPassword123!",
        interests: ["Chess", "Reading"],
      });
    assert.equal(created.status, 201);
    const userId = created.body.user.id as string;
    fixtures.trackUser(userId);
    assert.equal(created.body.user.role, "USER");
    assert.equal("passwordHash" in created.body.user, false);

    const getOne = await request(app)
      .get(`/api/admin/users/${userId}`)
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(getOne.status, 200);
    assert.equal(getOne.body.user.id, userId);
    assert.equal("passwordHash" in getOne.body.user, false);

    const list = await request(app)
      .get("/api/admin/users?limit=10")
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(list.status, 200);
    for (const item of list.body.items as Array<Record<string, unknown>>) {
      assert.equal("passwordHash" in item, false);
    }

    const badPatchPassword = await request(app)
      .patch(`/api/admin/users/${userId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ password: "NewPassword1234!" });
    assert.equal(badPatchPassword.status, 400);

    const badPatchRole = await request(app)
      .patch(`/api/admin/users/${userId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ role: "ADMIN" });
    assert.equal(badPatchRole.status, 400);

    const updated = await request(app)
      .patch(`/api/admin/users/${userId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        name: "Managed User Updated",
        interests: ["Music", "music"],
      });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.user.name, "Managed User Updated");
    assert.deepEqual(updated.body.user.interests, ["music"]);
    assert.equal(updated.body.user.role, "USER");
    assert.equal("passwordHash" in updated.body.user, false);
  });

  it("blocks deleting ADMIN accounts and cascades normal user deletion to notes and posts", async () => {
    const anotherAdmin = await fixtures.createUser({
      tag: "protected-admin",
      role: "ADMIN",
    });

    const deleteAdminRes = await request(app)
      .delete(`/api/admin/users/${anotherAdmin.id}`)
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(deleteAdminRes.status, 403);
    assert.equal(deleteAdminRes.body.error.code, "ADMIN_PROTECTED");

    const victim = await fixtures.createUser({ tag: "victim" });

    const noteRes = await request(app)
      .post("/api/notes")
      .set("Authorization", `Bearer ${victim.token}`)
      .send({ title: "Victim Note", content: "To be deleted" });
    assert.equal(noteRes.status, 201);
    fixtures.trackNote(noteRes.body.note.id);

    const postRes = await request(app)
      .post("/api/posts")
      .set("Authorization", `Bearer ${victim.token}`)
      .send({ title: "Victim Post", content: "To be deleted" });
    assert.equal(postRes.status, 201);
    fixtures.trackPost(postRes.body.post.id);

    const del = await request(app)
      .delete(`/api/admin/users/${victim.id}`)
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(del.status, 204);
    assert.equal(del.text, "");

    assert.equal(await User.countDocuments({ _id: victim.id }), 0);
    assert.equal(await Note.countDocuments({ ownerId: victim.id }), 0);
    assert.equal(await Post.countDocuments({ authorId: victim.id }), 0);
  });

  it("rejects withActiveUser on deleted parent and preserves no-orphan invariant under overlapping requests", async () => {
    const target = await fixtures.createUser({ tag: "coord" });

    // Direct coordination check after deletion: withActiveUser finds no parent user and aborts.
    const sequentialTarget = await fixtures.createUser({ tag: "coord-seq" });
    await User.deleteOne({ _id: sequentialTarget.id });
    await assert.rejects(
      () =>
        withActiveUser(sequentialTarget.id, async (session) => {
          const doc = new Note({
            ownerId: sequentialTarget.id,
            title: "Should Never Commit",
            content: "Should Never Commit",
          });
          await doc.save({ session });
          return doc;
        }),
      (err: unknown) =>
        err instanceof Error &&
        err.message === "This account is no longer available.",
    );
    assert.equal(await Note.countDocuments({ ownerId: sequentialTarget.id }), 0);

    // Concurrent Promise.all invariant check (does not guarantee a specific race interleaving,
    // but verifies every request settles cleanly and leaves zero orphan notes/posts after deletion).
    const noteCreations = Array.from({ length: 4 }, (_, idx) =>
      request(app)
        .post("/api/notes")
        .set("Authorization", `Bearer ${target.token}`)
        .send({ title: `Concurrent Note ${idx}`, content: "Body" }),
    );
    const postCreations = Array.from({ length: 4 }, (_, idx) =>
      request(app)
        .post("/api/posts")
        .set("Authorization", `Bearer ${target.token}`)
        .send({ title: `Concurrent Post ${idx}`, content: "Body" }),
    );
    const deleteOp = request(app)
      .delete(`/api/admin/users/${target.id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    const results = await Promise.all([
      ...noteCreations,
      ...postCreations,
      deleteOp,
    ]);
    const deleteResult = results.at(-1);
    assert.equal(deleteResult?.status, 204);

    for (const creationResult of results.slice(0, -1)) {
      assert.ok(
        creationResult.status === 201 || creationResult.status === 401,
        `Unexpected concurrent creation status: ${creationResult.status}`,
      );
    }

    assert.equal(await User.countDocuments({ _id: target.id }), 0);
    assert.equal(await Note.countDocuments({ ownerId: target.id }), 0);
    assert.equal(await Post.countDocuments({ authorId: target.id }), 0);
  });
});
