import { z } from "zod";

export const taskAnalysisSchema = z.object({
  definition: z.string().trim().min(1).max(120),
  nextAction: z.string().trim().min(1).max(100),
  cadence: z.string().trim().min(1).max(100),
});

export const taskAnalysisInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  category: z.string().trim().max(30).default("未分类"),
  why: z.string().trim().max(800).default(""),
  type: z.enum(["once", "routine", "learning"]),
  intervalDays: z.number().int().min(1).max(365),
});

export type TaskAnalysis = z.infer<typeof taskAnalysisSchema>;
export type TaskAnalysisInput = z.infer<typeof taskAnalysisInputSchema>;
