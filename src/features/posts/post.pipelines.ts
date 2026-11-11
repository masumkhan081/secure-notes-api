import { Types } from "mongoose";

export function buildUserPostsPipeline(
  userId: string,
  limit: number,
  cursor?: string,
): Record<string, unknown>[] {
  return [
    { $match: { _id: new Types.ObjectId(userId) } },
    {
      $lookup: {
        from: "posts",
        localField: "_id",
        foreignField: "authorId",
        pipeline: [
          ...(cursor
            ? [{ $match: { _id: { $lt: new Types.ObjectId(cursor) } } }]
            : []),
          { $sort: { _id: -1 } },
          { $limit: limit + 1 },
          {
            $project: {
              _id: 1,
              authorId: 1,
              title: 1,
              content: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],
        as: "posts",
      },
    },
    {
      $project: {
        _id: 1,
        name: 1,
        posts: 1,
      },
    },
  ];
}
