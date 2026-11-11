import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { User } from "../../models/user.model.js";
import { AppError } from "../../lib/app-error.js";
import {
  hashPassword,
  verifyPassword,
} from "../../lib/password.js";
import { createAccessToken } from "../../lib/token.js";
import { loginSchema, registerSchema } from "./auth.schema.js";
import { requireAuth } from "../../middleware/auth.js";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many authentication attempts. Try again later.",
    },
  },
});

authRouter.post("/register", authLimiter, async (req, res) => {
  const input = registerSchema.parse(req.body);
  const passwordHash = await hashPassword(input.password);

  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash,
    interests: input.interests,
    role: "USER",
  });

  res.status(201).json({
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      interests: user.interests,
    },
  });
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const input = loginSchema.parse(req.body);

  const user = await User.findOne({ email: input.email })
    .select("+passwordHash")
    .exec();

  if (
    !user ||
    !(await verifyPassword(user.passwordHash, input.password))
  ) {
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid email or password.",
    );
  }

  res.status(200).json({
    accessToken: createAccessToken(user._id.toString()),
    tokenType: "Bearer",
    expiresIn: 900,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      interests: user.interests,
    },
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  if (!req.auth) {
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Authentication is required.",
    );
  }

  const user = await User.findById(req.auth.userId)
    .select("_id name email role interests")
    .lean()
    .exec();

  if (!user) {
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "This account is no longer available.",
    );
  }

  res.status(200).json({
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      interests: user.interests,
    },
  });
});