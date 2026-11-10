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

Grouping all users by interests requires processing the relevant users.
An interests index does not eliminate the full $unwind/$group work.

We will not add an interests index without a query that benefits from it.
We will inspect execution plans when implementing the actual pipelines.

## Verification

Index definitions are the initial query-driven plan.
Execution statistics will be checked against the implemented queries.