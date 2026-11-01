// 聊天：一次回复 = 一个工具循环。模型读两段 JSON（设定 + 数据），
// 需要改动时调用 propose_* 工具；每次调用先过 verifyTool，不合格把原因退回让它改。
// 浏览器（设备直连）和服务端共用这一份。
import { generateText, jsonSchema, stepCountIs, tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  buildChatSystem, toolDescriptions, toolSchemas, verifyTool,
  type CardKind, type ChatAction, type ChatBundle, type ChatContext, type ChatMessage, type ChatReply, type ToolName,
} from "@contracts/chat";
import type { AiBackend } from "../ai/provider";

const MAX_STEPS = 6;
const MAX_REJECTIONS = 4;
const HISTORY = 16;

export async function runChat(
  input: { bundle: ChatBundle; context: ChatContext; messages: ChatMessage[] },
  ai: AiBackend,
  signal?: AbortSignal,
): Promise<ChatReply> {
  const actions: ChatAction[] = [];
  const cards: CardKind[] = [];
  let rejected = 0;

  const tools: ToolSet = {};
  for (const name of Object.keys(toolSchemas) as ToolName[]) {
    tools[name] = tool({
      description: toolDescriptions[name],
      inputSchema: jsonSchema<Record<string, unknown>>(z.toJSONSchema(toolSchemas[name], { target: "draft-7", io: "input" }) as Parameters<typeof jsonSchema>[0]),
      execute: async (args) => {
        const { errors, action, card } = verifyTool(name, args, input.context);
        if (errors.length) {
          rejected += 1;
          return { ok: false, errors, hint: rejected >= MAX_REJECTIONS ? "别再调用这个工具了，直接用文字回复" : "按 errors 改正后重新调用" };
        }
        if (card && !cards.includes(card)) cards.push(card);
        if (action) {
          actions.push(action);
          return { ok: true, note: "已作为提议显示给用户，点「采用」才生效" };
        }
        return { ok: true };
      },
    });
  }

  const messages = input.messages.slice(-HISTORY).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  const result = await generateText({
    model: ai.model,
    system: buildChatSystem(input.bundle, input.context),
    messages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    providerOptions: ai.options("none"),
    temperature: ai.temperature("warm"),
    maxRetries: 1,
    abortSignal: signal,
  });

  // 只要最后一步的文字；中间步骤的话常常是“我来查一下”之类
  const text = result.text.trim() || (actions.length ? "要的话点「采用」。" : cards.length ? "" : "咕噜……我没想好怎么回，换个说法再问我一次？");
  return { text, actions, cards, steps: result.steps.length, rejected, model: ai.modelId };
}
