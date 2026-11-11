import type { ErrorRequestHandler } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { AppError } from "../lib/app-error.js";

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Check the submitted fields.",
        details: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  if (
    error instanceof mongoose.mongo.MongoServerError &&
    error.code === 11000
  ) {
    res.status(409).json({
      error: {
        code: "DUPLICATE_VALUE",
        message: "A record with that unique value already exists.",
      },
    });
    return;
  }

  if (error instanceof Error && "type" in error) {
    if (error.type === "entity.parse.failed") {
      res.status(400).json({
        error: {
          code: "INVALID_JSON",
          message: "Request body must contain valid JSON.",
        },
      });
      return;
    }

    if (error.type === "entity.too.large") {
      res.status(413).json({
        error: {
          code: "BODY_TOO_LARGE",
          message: "Request body is too large.",
        },
      });
      return;
    }
  }

  console.error(
    "Unhandled request error:",
    error instanceof Error ? error.name : "UnknownError",
  );

  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
    },
  });
};