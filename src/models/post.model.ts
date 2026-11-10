import { Schema, model } from "mongoose";

const postSchema = new Schema(
  {
    authorId: {
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
    collection: "posts",
  },
);

postSchema.index(
  { authorId: 1, _id: -1 },
  { name: "posts_author_id_desc" },
);

export const Post = model("Post", postSchema);