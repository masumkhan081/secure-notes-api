import mongoose from "mongoose";
import { z } from "zod";
import { connectDatabase } from "../config/database.js";
import { User } from "../models/user.model.js";
import { hashPassword } from "../lib/password.js";

const seedSchema = z.object({
  SEED_ADMIN_NAME: z.string().trim().min(1).max(100),
  SEED_ADMIN_EMAIL: z.string().trim().toLowerCase().email().max(254),
  SEED_ADMIN_PASSWORD: z.string().min(12).max(128),
});

async function seedAdmin(): Promise<void> {
  const result = seedSchema.safeParse(process.env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid seed configuration: ${details}`);
  }

  const input = result.data;

  await connectDatabase();
  await User.createCollection();
  await User.createIndexes();

  const existing = await User.findOne({
    email: input.SEED_ADMIN_EMAIL,
  })
    .select("_id role")
    .lean()
    .exec();

  if (existing) {
    if (existing.role !== "ADMIN") {
      throw new Error(
        "This email belongs to a normal user. Seed will not promote it.",
      );
    }

    console.log("Admin already exists. No changes made.");
    return;
  }

  await User.create({
    name: input.SEED_ADMIN_NAME,
    email: input.SEED_ADMIN_EMAIL,
    passwordHash: await hashPassword(input.SEED_ADMIN_PASSWORD),
    role: "ADMIN",
    interests: [],
  });

  console.log("Admin created successfully.");
}

try {
  await seedAdmin();
} catch (error: unknown) {
  console.error(
    "Admin seed failed:",
    error instanceof Error ? error.message : "Unknown error",
  );

  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}