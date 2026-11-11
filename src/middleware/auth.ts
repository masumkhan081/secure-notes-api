import type { RequestHandler } from "express";
import { User } from "../models/user.model.js";
import { verifyAccessToken } from "../lib/token.js";
import { AppError } from "../lib/app-error.js";

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  const token = match?.[1];

  if (!token) {
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "A Bearer access token is required.",
    );
  }

  let userId: string;

  try {
    userId = verifyAccessToken(token);
  } catch {
    throw new AppError(
      401,
      "INVALID_TOKEN",
      "Your session is invalid or expired. Please log in again.",
    );
  }

  const user = await User.findById(userId)
    .select("_id role")
    .lean()
    .exec();

  if (!user) {
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "This account is no longer available.",
    );
  }

  req.auth = {
    userId: user._id.toString(),
    role: user.role,
  };

  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Authentication is required.",
    );
  }

  if (req.auth.role !== "ADMIN") {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Administrator access is required.",
    );
  }

  next();
};