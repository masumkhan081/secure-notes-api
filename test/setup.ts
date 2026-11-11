import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import mongoose, { Types } from "mongoose";

const REQUIRED_TEST_DB = "secure_notes_test";

function extractDatabaseName(uri: string): string {
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, "");
  const atIndex = withoutScheme.lastIndexOf("@");
  const authorityAndPath =
    atIndex === -1 ? withoutScheme : withoutScheme.slice(atIndex + 1);
  const slashIndex = authorityAndPath.indexOf("/");
  if (slashIndex === -1) return "";
  const pathAndQuery = authorityAndPath.slice(slashIndex + 1);
  const queryIndex = pathAndQuery.indexOf("?");
  const rawDb =
    queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
  return rawDb.replace(/\/+$/, "");
}

function loadAndVerifyTestUri(): string {
  let candidate = process.env.TEST_MONGODB_URI?.trim();

  if (!candidate) {
    // Load .env into a throwaway object so app MONGODB_URI/JWT_SECRET never enter process.env.
    const fileEnv: Record<string, string> = {};
    dotenv.config({ processEnv: fileEnv, quiet: true });
    candidate = fileEnv.TEST_MONGODB_URI?.trim();
  }

  if (!candidate) {
    throw new Error(
      `TEST_MONGODB_URI is not configured. Set TEST_MONGODB_URI to a dedicated MongoDB URI targeting the "${REQUIRED_TEST_DB}" database before running database tests.`,
    );
  }

  if (!/^mongodb(\+srv)?:\/\/\S+$/.test(candidate)) {
    throw new Error(
      "TEST_MONGODB_URI must be a valid MongoDB connection string.",
    );
  }

  if (extractDatabaseName(candidate) !== REQUIRED_TEST_DB) {
    throw new Error(
      `Refusing to run tests: TEST_MONGODB_URI must target the "${REQUIRED_TEST_DB}" database.`,
    );
  }

  return candidate;
}

const verifiedTestUri = loadAndVerifyTestUri();
const ephemeralJwtSecret = randomBytes(32).toString("hex");

// Lock test environment variables before importing any application module.
process.env.MONGODB_URI = verifiedTestUri;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = ephemeralJwtSecret;
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.TRUST_PROXY_HOPS = "0";
process.env.PORT = "4000";

const [
  { app },
  { connectDatabase },
  { User },
  { Note },
  { Post },
  { hashPassword },
  { createAccessToken },
  { withActiveUser },
] = await Promise.all([
  import("../src/app.js"),
  import("../src/config/database.js"),
  import("../src/models/user.model.js"),
  import("../src/models/note.model.js"),
  import("../src/models/post.model.js"),
  import("../src/lib/password.js"),
  import("../src/lib/token.js"),
  import("../src/lib/with-active-user.js"),
]);

export {
  app,
  User,
  Note,
  Post,
  hashPassword,
  createAccessToken,
  withActiveUser,
};

export async function connectTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 0) {
    await connectDatabase();
  }

  const dbName = mongoose.connection.db?.databaseName;
  if (dbName !== REQUIRED_TEST_DB) {
    await mongoose.disconnect();
    throw new Error(
      `Connected to unexpected database "${dbName ?? "unknown"}"; expected "${REQUIRED_TEST_DB}".`,
    );
  }

  await Promise.all([
    User.createCollection(),
    Note.createCollection(),
    Post.createCollection(),
  ]);

  await Promise.all([
    User.createIndexes(),
    Note.createIndexes(),
    Post.createIndexes(),
  ]);
}

export async function disconnectTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export function createExpiredAccessToken(userId: string): string {
  const secret = Buffer.from(ephemeralJwtSecret, "hex");
  const nowSec = Math.floor(Date.now() / 1000);
  return jwt.sign({ iat: nowSec - 1200, exp: nowSec - 60 }, secret, {
    algorithm: "HS256",
    subject: userId,
    issuer: "secure-notes-api",
    audience: "secure-notes-web",
  });
}

export class FixtureTracker {
  public readonly runId = `it-${Date.now()}-${randomBytes(4).toString("hex")}`;
  private readonly userIds = new Set<string>();
  private readonly noteIds = new Set<string>();
  private readonly postIds = new Set<string>();

  email(tag: string): string {
    return `${this.runId}-${tag}@example.test`.toLowerCase();
  }

  trackUser(id: string): string {
    this.userIds.add(id);
    return id;
  }

  trackNote(id: string): string {
    this.noteIds.add(id);
    return id;
  }

  trackPost(id: string): string {
    this.postIds.add(id);
    return id;
  }

  async createUser(input: {
    tag: string;
    name?: string;
    password?: string;
    role?: "USER" | "ADMIN";
    interests?: string[];
  }): Promise<{
    id: string;
    email: string;
    name: string;
    role: "USER" | "ADMIN";
    interests: string[];
    token: string;
  }> {
    const email = this.email(input.tag);
    const name = input.name ?? `Test ${input.tag}`;
    const role = input.role ?? "USER";
    const interests = input.interests ?? [];
    const passwordHash = await hashPassword(
      input.password ?? "TestPass123456!",
    );

    const user = await User.create({
      name,
      email,
      passwordHash,
      role,
      interests,
    });

    const id = user._id.toString();
    this.trackUser(id);

    return {
      id,
      email: user.email,
      name: user.name,
      role: user.role,
      interests: user.interests,
      token: createAccessToken(id),
    };
  }

  async cleanup(): Promise<void> {
    if (mongoose.connection.readyState === 0) return;

    const trackedUsers = [...this.userIds].map((id) => new Types.ObjectId(id));
    const runPrefixRegex = new RegExp(
      `^${this.runId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-`,
      "i",
    );

    const prefixedUsers = await User.find({ email: runPrefixRegex })
      .select("_id")
      .lean()
      .exec();
    const allUserIds = [
      ...new Map(
        [...trackedUsers, ...prefixedUsers.map((u) => u._id)].map((id) => [
          id.toString(),
          id,
        ]),
      ).values(),
    ];

    const trackedNotes = [...this.noteIds].map((id) => new Types.ObjectId(id));
    const trackedPosts = [...this.postIds].map((id) => new Types.ObjectId(id));

    if (trackedNotes.length > 0 || allUserIds.length > 0) {
      const noteConditions: Record<string, unknown>[] = [];
      if (trackedNotes.length > 0) {
        noteConditions.push({ _id: { $in: trackedNotes } });
      }
      if (allUserIds.length > 0) {
        noteConditions.push({ ownerId: { $in: allUserIds } });
      }
      await Note.deleteMany({ $or: noteConditions });
    }

    if (trackedPosts.length > 0 || allUserIds.length > 0) {
      const postConditions: Record<string, unknown>[] = [];
      if (trackedPosts.length > 0) {
        postConditions.push({ _id: { $in: trackedPosts } });
      }
      if (allUserIds.length > 0) {
        postConditions.push({ authorId: { $in: allUserIds } });
      }
      await Post.deleteMany({ $or: postConditions });
    }

    if (allUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: allUserIds } });
    }
  }
}
