import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  MONGODB_URI: z
    .string()
    .trim()
    .regex(/^mongodb(\+srv)?:\/\/\S+$/, "Must be a MongoDB connection string"),
  JWT_SECRET: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, "Must be a random 64-character hex secret"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) => value.split(",").map((origin) => origin.trim()))
    .pipe(z.array(z.string().url()).min(1)),

  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const details = result.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = result.data;
