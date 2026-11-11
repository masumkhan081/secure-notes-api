import { z } from "zod";

export const createNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const updateNoteSchema = createNoteSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field to update",
  );
