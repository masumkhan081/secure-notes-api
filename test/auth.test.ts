import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import {
  FixtureTracker,
  User,
  app,
  connectTestDatabase,
  createExpiredAccessToken,
  disconnectTestDatabase,
} from "./setup.js";

const fixtures = new FixtureTracker();

describe("Authentication, RBAC, and global error handling", () => {
  before(async () => {
    await connectTestDatabase();
  });

  after(async () => {
    try {
      await fixtures.cleanup();
    } finally {
      await disconnectTestDatabase();
    }
  });

  it("registers a USER with normalized email/interests, hashes password, and excludes passwordHash", async () => {
    const email = fixtures.email("register");

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        name: "  Alice Reader  ",
        email: `  ${email.toUpperCase()}  `,
        password: "StrongPassword123!",
        interests: [" Chess ", "chess", "Sci-Fi & Books"],
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.user?.id);
    fixtures.trackUser(res.body.user.id);

    assert.equal(res.body.user.role, "USER");
    assert.equal(res.body.user.name, "Alice Reader");
    assert.equal(res.body.user.email, email);
    assert.deepEqual(res.body.user.interests, ["chess", "sci-fi & books"]);
    assert.equal("passwordHash" in res.body.user, false);

    const dbUser = await User.findById(res.body.user.id)
      .select("+passwordHash")
      .lean()
      .exec();
    assert.ok(dbUser);
    assert.match(dbUser.passwordHash, /^\$argon2id\$/);
    assert.notEqual(dbUser.passwordHash, "StrongPassword123!");
  });

  it("rejects extra role or owner fields on registration and returns 409 on normalized duplicate email", async () => {
    const email = fixtures.email("strict-dup");

    const roleAttempt = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Bob",
        email,
        password: "StrongPassword123!",
        role: "ADMIN",
      });
    assert.equal(roleAttempt.status, 400);
    assert.equal(roleAttempt.body.error.code, "VALIDATION_ERROR");

    const ownerAttempt = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Bob",
        email,
        password: "StrongPassword123!",
        ownerId: "507f1f77bcf86cd799439011",
      });
    assert.equal(ownerAttempt.status, 400);

    const first = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Bob",
        email,
        password: "StrongPassword123!",
      });
    assert.equal(first.status, 201);
    fixtures.trackUser(first.body.user.id);

    const duplicate = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Bob Clone",
        email: `  ${email.toUpperCase()} `,
        password: "AnotherPassword123!",
      });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, "DUPLICATE_VALUE");
  });

  it("authenticates valid credentials, rejects wrong passwords, and validates /api/auth/me", async () => {
    const email = fixtures.email("login");
    const password = "LoginSecret1234!";

    const reg = await request(app)
      .post("/api/auth/register")
      .send({ name: "Charlie", email, password });
    assert.equal(reg.status, 201);
    fixtures.trackUser(reg.body.user.id);

    const badPass = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "WrongPassword123!" });
    assert.equal(badPass.status, 401);
    assert.equal(badPass.body.error.code, "INVALID_CREDENTIALS");

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: `  ${email.toUpperCase()} `, password });
    assert.equal(login.status, 200);
    assert.equal(login.body.tokenType, "Bearer");
    assert.equal(typeof login.body.accessToken, "string");
    assert.equal("passwordHash" in login.body.user, false);

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${login.body.accessToken}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, reg.body.user.id);
    assert.equal(me.body.user.email, email);
    assert.equal("passwordHash" in me.body.user, false);
  });

  it("rejects missing, tampered, expired, and deleted-user tokens with 401", async () => {
    const user = await fixtures.createUser({ tag: "tokens" });

    const missing = await request(app).get("/api/auth/me");
    assert.equal(missing.status, 401);

    const tampered = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${user.token}tampered`);
    assert.equal(tampered.status, 401);

    const expiredToken = createExpiredAccessToken(user.id);
    const expired = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${expiredToken}`);
    assert.equal(expired.status, 401);

    await User.deleteOne({ _id: user.id });

    const afterDelete = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${user.token}`);
    assert.equal(afterDelete.status, 401);
  });

  it("returns 403 for normal users calling admin endpoints", async () => {
    const user = await fixtures.createUser({ tag: "non-admin", role: "USER" });

    const endpoints = [
      "/api/admin/users",
      "/api/admin/notes",
      "/api/admin/interests",
      "/api/admin/interests/users?interest=chess",
    ];

    for (const path of endpoints) {
      const res = await request(app)
        .get(path)
        .set("Authorization", `Bearer ${user.token}`);
      assert.equal(res.status, 403, `Expected 403 on ${path}`);
      assert.equal(res.body.error.code, "FORBIDDEN");
    }
  });

  it("handles invalid JSON, unknown routes, and client errors without leaking stack or database details", async () => {
    const invalidJson = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{broken-json");
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJson.body.error.code, "INVALID_JSON");
    assert.equal("stack" in invalidJson.body.error, false);

    const unknown = await request(app).get("/api/does-not-exist");
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, "NOT_FOUND");
    assert.equal("stack" in unknown.body.error, false);
  });
});
