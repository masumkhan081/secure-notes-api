import express from "express";
import { authRouter } from "./features/auth/auth.routes.js";
import { errorHandler } from "./middleware/error-handler.js";
import { noteRouter } from "./features/notes/note.routes.js";
import { adminRouter } from "./features/admin/admin.routes.js";
import { interestRouter } from "./features/admin/interest.routes.js";
import { postRouter } from "./features/posts/post.routes.js";
//
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY_HOPS);

app.use(helmet());

app.use(
  cors({
    origin: env.CORS_ORIGINS,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "secure-notes-api",
  });
});

app.use("/api/auth", authRouter);
app.use("/api/notes", noteRouter);
app.use("/api/admin", adminRouter);
app.use("/api/admin/interests", interestRouter);
app.use("/api/posts", postRouter);

app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Route not found.",
    },
  });
});

app.use(errorHandler);
