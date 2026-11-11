import { z } from "zod";
import { interestsSchema } from "../auth/auth.schema.js";

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .max(254)
      .optional(),
    interests: interestsSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field to update",
  );