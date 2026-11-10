import { Schema, model } from "mongoose";

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ["USER", "ADMIN"],
      default: "USER",
      required: true,
    },
    interests: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: "users",
  },
);

userSchema.index(
  { email: 1 },
  { unique: true, name: "users_email_unique" },
);

export const User = model("User", userSchema);