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