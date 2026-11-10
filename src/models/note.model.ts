import { Schema, model } from "mongoose";

const noteSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20_000,
    },
  },
  {
    timestamps: true,
    collection: "notes",
  },
);

noteSchema.index(
  { ownerId: 1, _id: -1 },
  { name: "notes_owner_id_desc" },
);

export const Note = model("Note", noteSchema);