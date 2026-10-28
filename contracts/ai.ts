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

/** 措辞的松紧：路由要稳，方案和评判要像人，大肥鱼聊看法要活泼 */
export type Mood = "precise" | "warm" | "chatty";

/** DeepSeek 官方建议对话用 1.3；其他服务商多数只接受 0–1，按比例收一点 */
export function temperatureFor(isDeepSeek: boolean): (mood: Mood) => number {
  const table = isDeepSeek ? { precise: 0.3, warm: 1.0, chatty: 1.3 } : { precise: 0.2, warm: 0.7, chatty: 0.9 };
  return (mood) => table[mood];
}
