import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

export const interestsSchema = z
  .array(z.string().trim().toLowerCase().min(1).max(40))
  .max(10)
  .transform((values) => [...new Set(values)]);

export const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: emailSchema,
    password: z.string().min(12).max(128),
    interests: interestsSchema.default([]),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();