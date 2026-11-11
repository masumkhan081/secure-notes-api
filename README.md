# Secure Notes API

Backend assessment for Care Guide BD.

## Stack

Node.js 22, Express 5, TypeScript, MongoDB and Mongoose 8.

## Scope

- JWT authentication and Argon2id password hashing.
- Users manage their own private notes.
- Admins manage users and can read everyone's notes.
- Users grouped by interests through one aggregation call.
- Public user posts retrieved through an aggregation with `$lookup`.
- Cursor pagination for every list endpoint.
- Explicit, query-driven indexes using `schema.index()`.

## Implementation decisions

- Notes and public posts are separate collections.
- Admin access to another user's notes is read-only.
- The first admin is created through an explicit seed command.
- Public registration cannot assign the admin role.

## Environment variables

See `.env.example` for all supported variables (`PORT`, `NODE_ENV`, `MONGODB_URI`, `JWT_SECRET`, `CORS_ORIGINS`, `TRUST_PROXY_HOPS`, `SEED_ADMIN_*`, and `TEST_MONGODB_URI`).

## First administrator

Set `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in the local environment, then run:

```bash
npm run seed:admin
```

The command creates the initial administrator. Rerunning it preserves an existing administrator's details and password, refuses to promote an existing normal user, and never runs automatically during application startup.

## Administrative rules

- Admins create normal users and edit profile fields.
- Public and administrative user forms cannot assign roles.
- Administrator accounts are protected from deletion.
- Removing a normal user also removes their notes and posts in a database transaction.
- Admin access to other users' notes is read-only.

## Testing and index verification

Integration tests and the `explain("executionStats")` script require a dedicated MongoDB database named `secure_notes_test` on a replica-set cluster (such as MongoDB Atlas) because note/post creation and user deletion use multi-document transactions.

1. Configure `TEST_MONGODB_URI` locally (for example in `.env` or your shell environment) pointing strictly to `secure_notes_test`:

   ```bash
   TEST_MONGODB_URI="mongodb+srv://USERNAME:PASSWORD@CLUSTER/secure_notes_test?retryWrites=true&w=majority"
   ```

   Tests refuse to run if `TEST_MONGODB_URI` is missing or targets any database other than `secure_notes_test`, and never fall back to `MONGODB_URI`.

2. Run checks:

   ```bash
   npm run typecheck
   npm run typecheck:tests
   npm run build
   npm test
   npm run verify:indexes
   ```

- **Verified against `secure_notes_test` (MongoDB `8.0.37`)**:
  - `npm test`: 6 test suites, 18 tests passed, 0 failed, 0 skipped — covering authentication/JWT/RBAC, private notes CRUD/isolation/validation/pagination, admin user CRUD/role protection/cascade delete/coordination invariants, public posts and `$lookup` author pagination/privacy, admin interest groups and URL-encoded member queries, malformed JSON/404 error responses, and the `authLimiter` 30-request `429` threshold.
  - `npm run verify:indexes`: verified `explain("executionStats")` plans across all list, lookup, and aggregation queries (see `docs/indexes.md`).
- **Remaining limitations / pending deployment checks**:
  - `authLimiter` uses single-process in-memory storage (resets on restart).
  - Concurrent creation/deletion tests assert post-condition invariants (`Promise.all` leaves zero orphans) rather than forcing deterministic transaction lock interleavings.
  - Deployed Render `TRUST_PROXY_HOPS` proxy-hop count cannot be verified locally and remains pending deployment verification.
