import mongoose from "mongoose";
import { app } from "./app.js";
import { connectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
//
import { User } from "./models/user.model.js";
import { Note } from "./models/note.model.js";
import { Post } from "./models/post.model.js";

async function startServer(): Promise<void> {
  await connectDatabase();

  await Promise.all([User.init(), Note.init(), Post.init()]);
  console.log("Database models and indexes ready");

  const server = app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`Secure Notes API listening on port ${env.PORT}`);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(`HTTP server failed: ${error.code ?? "UNKNOWN"}`);
    process.exit(1);
  });

  let shuttingDown = false;

  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log("Shutting down");

    setTimeout(() => process.exit(1), 10_000).unref();

    server.close(() => {
      void mongoose.disconnect().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(
    `Startup failed (${name}). Check Atlas access and configuration.`,
  );
  process.exit(1);
});
