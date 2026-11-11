import mongoose, { type ClientSession } from "mongoose";
import { User } from "../models/user.model.js";
import { AppError } from "./app-error.js";

export async function withActiveUser<T>(
  userId: string,
  operation: (session: ClientSession) => Promise<T>,
): Promise<T> {
  return mongoose.connection.transaction(async (session) => {
    const result = await User.updateOne(
      { _id: userId },
      { $inc: { __v: 1 } },
      { session, timestamps: false },
    );

    if (result.matchedCount === 0) {
      throw new AppError(
        401,
        "UNAUTHENTICATED",
        "This account is no longer available.",
      );
    }

    return operation(session);
  });
}