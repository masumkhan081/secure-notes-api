# Query and index strategy

Normal lists use descending _id cursor pagination.
ObjectId ordering is approximately chronological, not an exact creation-time guarantee.

## Explicit indexes

- users: { email: 1 }, unique.
  Supports login lookup and enforces email uniqueness.

- notes: { ownerId: 1, _id: -1 }.
  Supports owner-filtered lists with descending _id pagination.

- posts: { authorId: 1, _id: -1 }.
  Supports the author match and ordered posts inside the user-post $lookup.

## Existing indexes

MongoDB creates a unique _id index on each collection.
We reuse it for individual document lookups and unfiltered lists ordered by _id.

A note ownership check can first locate the unique _id and then check ownerId.
It does not need another compound index.

## Interests aggregation

The interests view has two paginated operations:

1. List interest groups and their user counts.
2. List users belonging to a selected interest.

Each operation uses exactly one collection.aggregate() call.
There are no additional find, distinct or count queries for these results.

Grouping uses $unwind and $group. It processes the collection;
the interests index does not eliminate this aggregation work.
Users with no interests do not appear in any group.

The compound index { interests: 1, _id: -1 } supports the selected-interest
user list's initial match and descending ID ordering.
It is a multikey index because interests is an array.

The grouped output uses an alphabetical interest cursor.
The selected-interest user list uses a descending ObjectId cursor.

Execution plans still need verification against representative data.

## Verification

Index definitions are the initial query-driven plan.
Execution statistics will be checked against the implemented queries.

## User posts lookup

GET /api/posts/by-user/:userId uses one aggregation pipeline.

- The initial user match uses the existing users _id index.
- $lookup joins users._id to posts.authorId.
- The posts index { authorId: 1, _id: -1 } supports author filtering
  and descending post pagination.
- Pagination happens inside $lookup, so it does not load all author posts.
- A missing user returns 404.
- An existing user without posts returns an empty list.
- Public author information contains only ID and name.

Public posts are readable without authentication.
Creating a post requires authentication.