import { Types } from "mongoose";

export function buildInterestGroupsPipeline(
  limit: number,
  cursor?: string,
): Record<string, unknown>[] {
  return [
    {
      $project: {
        interests: { $setUnion: [{ $ifNull: ["$interests", []] }, []] },
      },
    },
    { $unwind: "$interests" },
    {
      $group: {
        _id: "$interests",
        userCount: { $sum: 1 },
      },
    },
    ...(cursor ? [{ $match: { _id: { $gt: cursor } } }] : []),
    { $sort: { _id: 1 } },
    { $limit: limit + 1 },
  ];
}

export function buildInterestUsersPipeline(
  interest: string,
  limit: number,
  cursor?: string,
): Record<string, unknown>[] {
  return [
    {
      $match: {
        interests: interest,
        ...(cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {}),
      },
    },
    { $sort: { _id: -1 } },
    { $limit: limit + 1 },
    {
      $project: {
        _id: 1,
        name: 1,
        email: 1,
        role: 1,
        interests: 1,
      },
    },
  ];
}
