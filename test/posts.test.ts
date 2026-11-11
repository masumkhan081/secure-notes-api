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

describe("Public posts and $lookup author aggregation", () => {
  let authorOne: Awaited<ReturnType<FixtureTracker["createUser"]>>;
  let authorTwo: Awaited<ReturnType<FixtureTracker["createUser"]>>;
  let emptyAuthor: Awaited<ReturnType<FixtureTracker["createUser"]>>;

  before(async () => {
    await connectTestDatabase();
    authorOne = await fixtures.createUser({
      tag: "post-author-1",
      name: "Author One",
      interests: ["writing"],
    });
    authorTwo = await fixtures.createUser({
      tag: "post-author-2",
      name: "Author Two",
    });
    emptyAuthor = await fixtures.createUser({
      tag: "post-author-empty",
      name: "Quiet Author",
    });
  });

  after(async () => {
    try {
      await fixtures.cleanup();
    } finally {
      await disconnectTestDatabase();
    }
  });

  it("allows public listing without authentication, requires auth for creation, and uses caller identity", async () => {
    const unauthCreate = await request(app)
      .post("/api/posts")
      .send({ title: "Blocked", content: "No token" });
    assert.equal(unauthCreate.status, 401);

    const spoofAuthor = await request(app)
      .post("/api/posts")
      .set("Authorization", `Bearer ${authorOne.token}`)
      .send({
        title: "Spoof",
        content: "Body",
        authorId: authorTwo.id,
      });
    assert.equal(spoofAuthor.status, 400);

    const created = await request(app)
      .post("/api/posts")
      .set("Authorization", `Bearer ${authorOne.token}`)
      .send({ title: "Public Intro", content: "Line 1\nLine 2" });
    assert.equal(created.status, 201);
    fixtures.trackPost(created.body.post.id);
    assert.equal(created.body.post.authorId, authorOne.id);

    const publicList = await request(app).get("/api/posts?limit=20");
    assert.equal(publicList.status, 200);
    assert.ok(
      publicList.body.items.some(
        (item: { id: string }) => item.id === created.body.post.id,
      ),
    );
  });

  it("returns author-scoped paginated posts without leaking private user fields", async () => {
    const authorOnePostIds: string[] = [];

    for (let i = 1; i <= 4; i += 1) {
      const res = await request(app)
        .post("/api/posts")
        .set("Authorization", `Bearer ${authorOne.token}`)
        .send({ title: `A1 Post ${i}`, content: `Body ${i}` });
      assert.equal(res.status, 201);
      authorOnePostIds.push(res.body.post.id);
      fixtures.trackPost(res.body.post.id);
    }

    const otherPost = await request(app)
      .post("/api/posts")
      .set("Authorization", `Bearer ${authorTwo.token}`)
      .send({ title: "A2 Post", content: "Other author" });
    assert.equal(otherPost.status, 201);
    fixtures.trackPost(otherPost.body.post.id);

    const page1 = await request(app).get(
      `/api/posts/by-user/${authorOne.id}?limit=3`,
    );
    assert.equal(page1.status, 200);
    assert.deepEqual(Object.keys(page1.body.author).sort(), ["id", "name"]);
    assert.equal(page1.body.author.id, authorOne.id);
    assert.equal(page1.body.author.name, "Author One");
    assert.equal("email" in page1.body.author, false);
    assert.equal("passwordHash" in page1.body.author, false);
    assert.equal("role" in page1.body.author, false);
    assert.equal("interests" in page1.body.author, false);

    assert.equal(page1.body.items.length, 3);
    assert.equal(page1.body.pageInfo.hasMore, true);
    assert.ok(page1.body.pageInfo.nextCursor);

    const page2 = await request(app).get(
      `/api/posts/by-user/${authorOne.id}?limit=3&cursor=${page1.body.pageInfo.nextCursor}`,
    );
    assert.equal(page2.status, 200);
    assert.equal(page2.body.items.length, 2);
    assert.equal(page2.body.pageInfo.hasMore, false);
    assert.equal(page2.body.pageInfo.nextCursor, null);

    const allReturned = [...page1.body.items, ...page2.body.items];
    for (const post of allReturned as Array<{
      id: string;
      authorId: string;
    }>) {
      assert.equal(post.authorId, authorOne.id);
      assert.notEqual(post.id, otherPost.body.post.id);
    }
    const returnedIds = allReturned.map((p: { id: string }) => p.id);
    assert.equal(new Set(returnedIds).size, 5);
  });

  it("handles existing author with zero posts and missing author distinctly", async () => {
    const emptyRes = await request(app).get(
      `/api/posts/by-user/${emptyAuthor.id}`,
    );
    assert.equal(emptyRes.status, 200);
    assert.deepEqual(emptyRes.body.author, {
      id: emptyAuthor.id,
      name: "Quiet Author",
    });
    assert.deepEqual(emptyRes.body.items, []);
    assert.deepEqual(emptyRes.body.pageInfo, {
      hasMore: false,
      nextCursor: null,
    });

    const missingRes = await request(app).get(
      "/api/posts/by-user/507f1f77bcf86cd799439011",
    );
    assert.equal(missingRes.status, 404);
    assert.equal(missingRes.body.error.code, "NOT_FOUND");
  });
});
