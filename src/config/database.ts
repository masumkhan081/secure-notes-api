import mongoose from "mongoose";
import { env } from "./env.js";

mongoose.set("bufferCommands", false);

export async function connectDatabase(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
  });

  console.log("MongoDB connected");
}