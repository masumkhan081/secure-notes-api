import { Router } from "express";
import { Types } from "mongoose";
import { User } from "../../models/user.model.js";
import { Post } from "../../models/post.model.js";
import { requireAuth } from "../../middleware/auth.js";
import { AppError } from "../../lib/app-error.js";
import { withActiveUser } from "../../lib/with-active-user.js";
import {
  objectIdSchema,
  paginationSchema,
  paginate,
} from "../../lib/pagination.js";
import { createPostSchema } from "./post.schema.js";

export const postRouter = Router();

interface PostRecord {
  _id: Types.ObjectId;
  authorId: Types.ObjectId;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

interface UserPostsResult {
  _id: Types.ObjectId;
  name: string;
  posts: PostRecord[];
}

function toPostResponse(post: PostRecord) {
  return {
    id: post._id.toString(),
    authorId: post.authorId.toString(),
    title: post.title,
    content: post.content,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

postRouter.post("/", requireAuth, async (req, res) => {
  if (!req.auth) {
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Authentication is required.",
    );
  }

  const input = createPostSchema.parse(req.body);
  const authorId = req.auth.userId;

  const post = await withActiveUser(authorId, async (session) => {
    const document = new Post({
      title: input.title,
      content: input.content,
      authorId,
    });

    await document.save({ session });
    return document;
  });

  res.status(201).json({ post: toPostResponse(post) });
});

postRouter.get("/", async (req, res) => {
  const { cursor, limit } = paginationSchema.parse(req.query);

  const posts = await Post.find(
    cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {},
  )
    .select("_id authorId title content createdAt updatedAt")
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean()
    .exec();

  const page = paginate(posts, limit);

  res.json({
    items: page.items.map(toPostResponse),
    pageInfo: page.pageInfo,
  });
});

postRouter.get("/by-user/:userId", async (req, res) => {
  const userId = objectIdSchema.parse(req.params.userId);
  const { cursor, limit } = paginationSchema.parse(req.query);

  const results = await User.collection
    .aggregate<UserPostsResult>([
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
    ])
    .toArray();

  const user = results[0];

  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found.");
  }

  const page = paginate(user.posts, limit);

  res.json({
    author: {
      id: user._id.toString(),
      name: user.name,
    },
    items: page.items.map(toPostResponse),
    pageInfo: page.pageInfo,
  });
});