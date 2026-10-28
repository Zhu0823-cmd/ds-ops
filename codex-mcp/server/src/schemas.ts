import { z } from "zod";

const fileRange = z
  .object({
    path: z.string().min(1),
    offset: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(10000).default(200)
  })
  .strict();

export const readFilesInput = z
  .object({
    files: z.array(fileRange).min(1).max(32),
    maxBytes: z.number().int().min(1024).max(65536).default(32768)
  })
  .strict();

export const searchInput = z
  .object({
    mode: z.enum(["files", "content"]),
    pattern: z.string().min(1),
    path: z.string().min(1).default("."),
    maxResults: z.number().int().min(1).max(200).default(50),
    maxBytes: z.number().int().min(1024).max(65536).default(32768)
  })
  .strict();

export const resultInput = z
  .object({
    ref: z.string().regex(/^opsref:\/\//),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(32),
    charOffset: z.number().int().min(0).default(0),
    maxBytes: z.number().int().min(1024).max(65536).default(32768)
  })
  .strict();
