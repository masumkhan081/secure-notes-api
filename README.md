# Secure Notes API

Backend assessment for Care Guide BD.

## Stack

Node.js, Express, TypeScript, MongoDB and Mongoose.

## Scope

- JWT authentication and secure password hashing.
- Users manage their own notes.
- Admins manage users and can read everyone's notes.
- Users grouped by interests through one aggregation call.
- Public user posts retrieved through an aggregation with $lookup.
- Pagination for every list endpoint.
- Explicit, query-driven indexes using schema.index().

## Implementation decisions

- Notes and public posts are separate collections.
- Admin access to another user's notes is read-only.
- The first admin is created through an explicit seed command.
- Public registration cannot assign the admin role.
- Setup instructions will be added alongside implementation.

## First administrator

Set SEED_ADMIN_NAME, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD
in the local environment, then run:

npm run seed:admin

The command creates the initial administrator.
Rerunning it preserves an existing administrator's details and password.
It refuses to promote an existing normal user.
It never runs automatically during application startup.

## Administrative rules

- Admins create normal users and edit profile fields.
- Public and administrative user forms cannot assign roles.
- Administrator accounts are protected from deletion.
- Removing a normal user also removes their notes and posts
  in a database transaction.
- Admin access to other users' notes is read-only.