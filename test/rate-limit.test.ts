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

describe("Auth route rate limiter", () => {
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

  it("enforces the 30-request window threshold and returns 429 on request 31", async () => {
    const unknownEmail = fixtures.email("ratelimit-miss");

    for (let i = 1; i <= 30; i += 1) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: unknownEmail, password: "AnyPassword123!" });
      assert.equal(
        res.status,
        401,
        `Request ${i} should reach login handler without hitting 429`,
      );
    }

    const blocked = await request(app)
      .post("/api/auth/login")
      .send({ email: unknownEmail, password: "AnyPassword123!" });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, "RATE_LIMITED");
  });
});
