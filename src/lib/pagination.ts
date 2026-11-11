import { Types } from "mongoose";
import { z } from "zod";

export const objectIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, "Invalid document ID");

export const paginationSchema = z.object({
  cursor: objectIdSchema.optional(),
  limit: z
    .string()
    .regex(/^\d+$/, "Limit must be a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .default(20),
});

export function paginate<T extends { _id: Types.ObjectId }>(
  records: T[],
  limit: number,
) {
  const hasMore = records.length > limit;
  const items = records.slice(0, limit);
  const lastItem = items.at(-1);

  return {
    items,
    pageInfo: {
      hasMore,
      nextCursor:
        hasMore && lastItem ? lastItem._id.toString() : null,
    },
  };
}