# Query, index, and runtime verification evidence

Normal lists use descending `_id` cursor pagination.
ObjectId ordering is approximately chronological, not an exact creation-time guarantee.

## Declared indexes (`schema.index()` + built-in `_id_`)

Verified via `collection.indexes()` in `secure_notes_test`:

- `users`:
  - `_id_` (`{ _id: 1 }`)
  - `users_email_unique` (`{ email: 1 }`, unique) — supports login lookup and enforces normalized email uniqueness.
  - `users_interest_id_desc` (`{ interests: 1, _id: -1 }`, multikey) — supports selected-interest membership filtering and descending `_id` cursor pagination in `GET /api/admin/interests/users`.
- `notes`:
  - `_id_` (`{ _id: 1 }`)
  - `notes_owner_id_desc` (`{ ownerId: 1, _id: -1 }`) — supports owner-filtered lists with descending `_id` pagination in `GET /api/notes` and owner-scoped cascade deletion.
- `posts`:
  - `_id_` (`{ _id: 1 }`)
  - `posts_author_id_desc` (`{ authorId: 1, _id: -1 }`) — supports author filtering and descending post pagination inside `GET /api/posts/by-user/:userId` `$lookup` and author-scoped cascade deletion.

## Observed `explain("executionStats")` evidence

Measured via `npm run verify:indexes` (`scripts/verify-indexes.ts`) against `secure_notes_test` on MongoDB **`8.0.37`** without `hint()`.

Synthetic dataset size during measurement: `users: 24`, `notes: 60` (25 belonging to the primary owner), `posts: 60` (25 belonging to the primary author), across 8 overlapping interests (plus 3 users with `interests: []`). All synthetic fixtures were cleaned up afterward (`{ users: 0, notes: 0, posts: 0 }`).

| Query / Aggregation | Collection(s) | Winning Plan Stages | Index(es) Used | `nReturned` | `totalKeysExamined` | `totalDocsExamined` | Notes |
|---|---|---|---|---:|---:|---:|---|
| 1. Email lookup (`login`) | `users` | `EXPRESS_IXSCAN` | `users_email_unique` | 1 | 1 | 1 | Point lookup, no blocking sort |
| 2a. Owner-scoped note list (no cursor, `limit=10`) | `notes` | `LIMIT` -> `FETCH` -> `IXSCAN` | `notes_owner_id_desc` | 11 | 11 | 11 | Bounds scan to `limit + 1`, no `SORT` |
| 2b. Owner-scoped note list (with cursor, `limit=10`) | `notes` | `LIMIT` -> `FETCH` -> `IXSCAN` | `notes_owner_id_desc` | 11 | 11 | 11 | Index range on `_id < cursor`, no `SORT` |
| 3a. Admin user list (`limit=10`) | `users` | `LIMIT` -> `FETCH` -> `IXSCAN` | `_id_` | 11 | 11 | 11 | Uses primary key reverse scan |
| 3b. Admin all-notes list (`limit=10`) | `notes` | `LIMIT` -> `FETCH` -> `IXSCAN` | `_id_` | 11 | 11 | 11 | Uses primary key reverse scan |
| 4a. Individual note lookup (`_id` + `ownerId`) | `notes` | `LIMIT` -> `FETCH` -> `IXSCAN` | `_id_` | 1 | 1 | 1 | Locates `_id` first then checks `ownerId` |
| 4b. Individual user lookup (`_id`) | `users` | `EXPRESS_IXSCAN` | `_id_` | 1 | 1 | 1 | Point lookup |
| 5. Public posts list (`limit=10`) | `posts` | `LIMIT` -> `FETCH` -> `IXSCAN` | `_id_` | 11 | 11 | 11 | Uses primary key reverse scan |
| 6. Selected-interest members (`buildInterestUsersPipeline`, with cursor) | `users` | `LIMIT` -> `PROJECTION_SIMPLE` -> `FETCH` -> `IXSCAN` | `users_interest_id_desc` | 2 | 2 | 2 | Multikey prefix + `_id` range, no `SORT` |
| 7. User-post `$lookup` (`buildUserPostsPipeline`, `limit=10` + cursor) | `users`, `posts` | Outer: `EXPRESS_IXSCAN`; Pipeline: `$lookup` -> `$project` | Outer: `_id_`; `$lookup` foreign: `posts_author_id_desc` | 1 (outer) | Outer: 1; Foreign: 11 | Outer: 1; Foreign: 11 | Bounded foreign scan (`limit + 1`), `executionTimeMillisEstimate: 1` |
| 8. Full interest grouping (`buildInterestGroupsPipeline`, `limit=10`) | `users` | `$cursor` (`PROJECTION_DEFAULT` -> `COLLSCAN`) -> `$unwind` -> `$group` -> `$sort` | None (collection scan) | 24 (`$cursor`) | 0 | 24 | Expected full scan + in-pipeline `$sort` over grouped keys |

## Interests aggregation (`src/features/admin/interest.routes.ts` & `interest.pipelines.ts`)

Both operations execute a single `User.collection.aggregate()` call with no supplementary `find`, `distinct`, or `count` queries (confirmed by source inspection):

1. `GET /api/admin/interests`: uses `buildInterestGroupsPipeline()` (`$project` with `$setUnion` + `$ifNull`, `$unwind`, `$group`, optional alphabetical `$match` cursor, `$sort: { _id: 1 }`, `$limit: limit + 1`).
   - Limitation: full-interest grouping necessarily processes all user documents (`COLLSCAN`, `totalDocsExamined: 24` for 24 users) and runs `$unwind` -> `$group` -> `$sort` on grouped `_id` strings. Adding another index on `interests` cannot avoid unwinding/grouping across users, so no extra index is added.
   - Users with `interests: []` (or missing/null interests) are dropped by `$unwind` and do not appear in any group.
2. `GET /api/admin/interests/users`: uses `buildInterestUsersPipeline()` (`$match` on `interests` + optional `_id: { $lt }`, `$sort: { _id: -1 }`, `$limit: limit + 1`, `$project` excluding `passwordHash`). Verified above to use `users_interest_id_desc` without blocking sort.

## User posts `$lookup` (`src/features/posts/post.routes.ts` & `post.pipelines.ts`)

`GET /api/posts/by-user/:userId` executes one `User.collection.aggregate()` call via `buildUserPostsPipeline()`:

- Outer `$match` uses `users` `_id_` (`EXPRESS_IXSCAN`, 1 key/doc examined).
- Foreign `$lookup` on `posts` (`localField: "_id"`, `foreignField: "authorId"`) uses `posts_author_id_desc` (`totalKeysExamined: 11`, `totalDocsExamined: 11` for `limit=10` + 1), paginating inside `$lookup`.
- Projects only `_id`, `name`, and `posts` on the author document (never `email` or `passwordHash`).

## Creation/deletion coordination, rate limiting, and proxy trust

- **User deletion vs note/post creation (`src/lib/with-active-user.ts`, `src/features/admin/admin.routes.ts`)**:
  `POST /api/notes` and `POST /api/posts` run inside `withActiveUser()`, which increments `__v` on the parent `users` document inside a MongoDB transaction (`User.updateOne({ _id: userId }, { $inc: { __v: 1 } }, { session })`) before saving the child document. `DELETE /api/admin/users/:id` deletes the parent user and its notes/posts in a transaction, so concurrent transactions contend on the same `users` document write lock and require a replica set (e.g., MongoDB Atlas). Integration tests verified sequential rejection after deletion and a `Promise.all` no-orphan invariant under overlapping HTTP requests, though `Promise.all` does not deterministically schedule lock interleavings.
- **Rate limiting (`src/features/auth/auth.routes.ts`)**:
  `authLimiter` limits `POST /api/auth/register` and `POST /api/auth/login` to 30 requests per 15-minute window using `express-rate-limit`'s default single-process `MemoryStore`. Counts reset on server restart and are not shared across multiple instances. Verified via `test/rate-limit.test.ts` (requests 1–30 allowed, request 31 returns `429 RATE_LIMITED`).
- **`TRUST_PROXY_HOPS` (`src/config/env.ts`, `src/app.ts`)**:
  Configured from `TRUST_PROXY_HOPS` (default `0`). On deployed platforms behind a reverse proxy (such as Render), `TRUST_PROXY_HOPS` must match the real proxy hop count so `req.ip` reflects the client IP rather than the proxy IP (too low causes all clients to share one rate-limit bucket; too high allows `X-Forwarded-For` spoofing). Render's deployed proxy hop chain cannot be verified from local source or local Supertest tests and remains **pending deployment verification**.
