import { describe, expect, it } from "vitest";
import { AiUnavailable, mapAiError } from "./ai-client";

describe("AI 降级", () => {
  it("把额度耗尽识别为终态，而不是要求用户改写内容", () => {
    const error = mapAiError(403, { error: { type: "access_terminated_error" } }, "");
    expect(error).toBeInstanceOf(AiUnavailable);
    expect(error.message).toContain("额度耗尽");
  });
});
