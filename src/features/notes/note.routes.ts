import { Router, type Request } from "express";
import { Types } from "mongoose";
import { Note } from "../../models/note.model.js";
import { requireAuth } from "../../middleware/auth.js";
import { AppError } from "../../lib/app-error.js";
import {
  objectIdSchema,
  paginationSchema,
  paginate,
} from "../../lib/pagination.js";
import {
  createNoteSchema,
  updateNoteSchema,
} from "./note.schema.js";

export const noteRouter = Router();

noteRouter.use(requireAuth);

function getOwnerId(req: Request): string {
  if (!req.auth) {
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Authentication is required.",
    );
  }

  return req.auth.userId;
}

function toNoteResponse(note: {
  _id: Types.ObjectId;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: note._id.toString(),
    title: note.title,
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

noteRouter.post("/", async (req, res) => {
  const input = createNoteSchema.parse(req.body);

  const note = await Note.create({
    title: input.title,
    content: input.content,
    ownerId: getOwnerId(req),
  });

  res.status(201).json({ note: toNoteResponse(note) });
});

noteRouter.get("/", async (req, res) => {
  const { cursor, limit } = paginationSchema.parse(req.query);

  const notes = await Note.find({
    ownerId: getOwnerId(req),
    ...(cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {}),
  })
    .select("_id title content createdAt updatedAt")
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean()
    .exec();

  const page = paginate(notes, limit);

  res.status(200).json({
    items: page.items.map(toNoteResponse),
    pageInfo: page.pageInfo,
  });
});

noteRouter.get("/:id", async (req, res) => {
  const id = objectIdSchema.parse(req.params.id);

  const note = await Note.findOne({
    _id: id,
    ownerId: getOwnerId(req),
  })
    .select("_id title content createdAt updatedAt")
    .lean()
    .exec();

  if (!note) {
    throw new AppError(404, "NOT_FOUND", "Note not found.");
  }

  res.status(200).json({ note: toNoteResponse(note) });
});

noteRouter.patch("/:id", async (req, res) => {
  const id = objectIdSchema.parse(req.params.id);
  const input = updateNoteSchema.parse(req.body);

  const note = await Note.findOneAndUpdate(
    {
      _id: id,
      ownerId: getOwnerId(req),
    },
    { $set: input },
    {
      new: true,
      runValidators: true,
    },
  )
    .select("_id title content createdAt updatedAt")
    .lean()
    .exec();

  if (!note) {
    throw new AppError(404, "NOT_FOUND", "Note not found.");
  }

  res.status(200).json({ note: toNoteResponse(note) });
});

noteRouter.delete("/:id", async (req, res) => {
  const id = objectIdSchema.parse(req.params.id);

  const note = await Note.findOneAndDelete({
    _id: id,
    ownerId: getOwnerId(req),
  }).exec();

  if (!note) {
    throw new AppError(404, "NOT_FOUND", "Note not found.");
  }

  res.status(204).send();
});