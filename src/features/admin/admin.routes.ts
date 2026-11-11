import { Router } from "express";
import mongoose, { Types } from "mongoose";
import { User } from "../../models/user.model.js";
import { Note } from "../../models/note.model.js";
import { Post } from "../../models/post.model.js";
import {
  requireAuth,
  requireAdmin,
} from "../../middleware/auth.js";
import { AppError } from "../../lib/app-error.js";
import { hashPassword } from "../../lib/password.js";
import {
  objectIdSchema,
  paginationSchema,
  paginate,
} from "../../lib/pagination.js";
import { registerSchema } from "../auth/auth.schema.js";
import { updateUserSchema } from "./admin.schema.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

const userFields = "_id name email role interests createdAt updatedAt";

function toUserResponse(user: {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: string;
  interests: string[];
}) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    interests: user.interests,
  };
}

adminRouter.get("/users", async (req, res) => {
  const { cursor, limit } = paginationSchema.parse(req.query);

  const users = await User.find(
    cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {},
  )
    .select(userFields)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean()
    .exec();

  const page = paginate(users, limit);

  res.json({
    items: page.items.map(toUserResponse),
    pageInfo: page.pageInfo,
  });
});

adminRouter.post("/users", async (req, res) => {
  const input = registerSchema.parse(req.body);

  const user = await User.create({
    name: input.name,
    email: input.email,
    interests: input.interests,
    passwordHash: await hashPassword(input.password),
    role: "USER",
  });

  res.status(201).json({ user: toUserResponse(user) });
});

adminRouter.get("/users/:id", async (req, res) => {
  const id = objectIdSchema.parse(req.params.id);

  const user = await User.findById(id)
    .select(userFields)
    .lean()
    .exec();

  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found.");
  }

  res.json({ user: toUserResponse(user) });
});

adminRouter.patch("/users/:id", async (req, res) => {
  const id = objectIdSchema.parse(req.params.id);
  const input = updateUserSchema.parse(req.body);

  const user = await User.findByIdAndUpdate(
    id,
    { $set: input },
    { new: true, runValidators: true },
  )
    .select(userFields)
    .lean()
    .exec();

  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found.");
  }

  res.json({ user: toUserResponse(user) });
});

adminRouter.delete("/users/:id", async (req, res) => {
  const id = objectIdSchema.parse(req.params.id);

  await mongoose.connection.transaction(async (session) => {
    const user = await User.findById(id)
      .select("_id role")
      .session(session)
      .lean()
      .exec();

    if (!user) {
      throw new AppError(404, "NOT_FOUND", "User not found.");
    }

    if (user.role === "ADMIN") {
      throw new AppError(
        403,
        "ADMIN_PROTECTED",
        "Administrator accounts cannot be deleted.",
      );
    }

    await User.deleteOne({ _id: id }, { session });
    await Note.deleteMany({ ownerId: id }, { session });
    await Post.deleteMany({ authorId: id }, { session });
  });

  res.status(204).send();
});

adminRouter.get("/notes", async (req, res) => {
  const { cursor, limit } = paginationSchema.parse(req.query);

  const notes = await Note.find(
    cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {},
  )
    .select("_id ownerId title content createdAt updatedAt")
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean()
    .exec();

  const page = paginate(notes, limit);

  res.json({
    items: page.items.map((note) => ({
      id: note._id.toString(),
      ownerId: note.ownerId.toString(),
      title: note.title,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })),
    pageInfo: page.pageInfo,
  });
});

adminRouter.get("/notes/:id", async (req, res) => {
  const id = objectIdSchema.parse(req.params.id);

  const note = await Note.findById(id)
    .select("_id ownerId title content createdAt updatedAt")
    .lean()
    .exec();

  if (!note) {
    throw new AppError(404, "NOT_FOUND", "Note not found.");
  }

  res.json({
    note: {
      id: note._id.toString(),
      ownerId: note.ownerId.toString(),
      title: note.title,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
  });
});