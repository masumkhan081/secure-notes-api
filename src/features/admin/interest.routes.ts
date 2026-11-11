import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { User } from "../../models/user.model.js";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";
import { paginationSchema, paginate } from "../../lib/pagination.js";
import {
  buildInterestGroupsPipeline,
  buildInterestUsersPipeline,
} from "./interest.pipelines.js";

export const interestRouter = Router();

interestRouter.use(requireAuth, requireAdmin);

const interestSchema = z.string().trim().toLowerCase().min(1).max(40);

const groupPaginationSchema = paginationSchema.extend({
  cursor: interestSchema.optional(),
});

interface InterestGroup {
  _id: string;
  userCount: number;
}

interface InterestUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  interests: string[];
}

interestRouter.get("/", async (req, res) => {
  const { cursor, limit } = groupPaginationSchema.parse(req.query);

  const groups = await User.collection
    .aggregate<InterestGroup>(buildInterestGroupsPipeline(limit, cursor))
    .toArray();

  const hasMore = groups.length > limit;
  const items = groups.slice(0, limit);
  const lastGroup = items.at(-1);

  res.json({
    items: items.map((group) => ({
      interest: group._id,
      userCount: group.userCount,
    })),
    pageInfo: {
      hasMore,
      nextCursor: hasMore && lastGroup ? lastGroup._id : null,
    },
  });
});

interestRouter.get("/users", async (req, res) => {
  const query = paginationSchema
    .extend({ interest: interestSchema })
    .parse(req.query);

  const users = await User.collection
    .aggregate<InterestUser>(
      buildInterestUsersPipeline(query.interest, query.limit, query.cursor),
    )
    .toArray();

  const page = paginate(users, query.limit);

  res.json({
    interest: query.interest,
    items: page.items.map((user) => ({
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      interests: user.interests,
    })),
    pageInfo: page.pageInfo,
  });
});
