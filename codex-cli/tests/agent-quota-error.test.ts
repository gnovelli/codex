import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const openAiState: { createSpy?: ReturnType<typeof vi.fn> } = {};

function createStream(events: Array<any>, opts: { throwAfter?: Error } = {}) {
  return new (class {
    public controller = { abort: vi.fn() };
    async *[Symbol.asyncIterator]() {
      for (const ev of events) {
        yield ev;
      }
      if (opts.throwAfter) {
        throw opts.throwAfter;
      }
    }
  })();
}

vi.mock("openai", () => {
  class FakeOpenAI {
    public responses = {
      create: (...args: Array<any>) => openAiState.createSpy!(...args),
    };
  }

  class APIConnectionTimeoutError extends Error {}

  return {
    __esModule: true,
    default: FakeOpenAI,
    APIConnectionTimeoutError,
  };
});

vi.mock("../src/approvals.js", () => ({
  __esModule: true,
  alwaysApprovedCommands: new Set<string>(),
  canAutoApprove: () => ({ type: "auto-approve", runInSandbox: false }) as any,
  isSafeCommand: () => null,
}));

vi.mock("../src/format-command.js", () => ({
  __esModule: true,
  formatCommandForDisplay: (c: Array<string>) => c.join(" "),
}));

vi.mock("../src/utils/agent/log.js", () => ({
  __esModule: true,
  log: () => {},
  isLoggingEnabled: () => false,
}));

import { AgentLoop } from "../src/utils/agent/agent-loop.js";

describe("AgentLoop – insufficient quota handling", () => {
  it("shows billing URL for OpenAI provider", async () => {
    const quotaErr: any = new Error("quota");
    quotaErr.code = "insufficient_quota";

    openAiState.createSpy = vi.fn(async () => {
      return createStream([], { throwAfter: quotaErr });
    });

    const received: Array<any> = [];

    const agent = new AgentLoop({
      model: "any",
      instructions: "",
      approvalPolicy: { mode: "auto" } as any,
      additionalWritableRoots: [],
      onItem: (i) => received.push(i),
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" }) as any,
      onLastResponseId: () => {},
    });

    const userMsg = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      },
    ];

    await expect(agent.run(userMsg as any)).resolves.not.toThrow();

    await new Promise((r) => setTimeout(r, 20));

    const sysMsg = received.find(
      (i) =>
        i.role === "system" &&
        typeof i.content?.[0]?.text === "string" &&
        i.content[0].text.includes("account/billing"),
    );

    expect(sysMsg).toBeTruthy();
  });

  it("shows generic message for other providers", async () => {
    const quotaErr: any = new Error("quota");
    quotaErr.code = "insufficient_quota";

    openAiState.createSpy = vi.fn(async () => {
      return createStream([], { throwAfter: quotaErr });
    });

    const received: Array<any> = [];

    const agent = new AgentLoop({
      model: "any",
      provider: "groq",
      instructions: "",
      approvalPolicy: { mode: "auto" } as any,
      additionalWritableRoots: [],
      onItem: (i) => received.push(i),
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" }) as any,
      onLastResponseId: () => {},
    });

    const userMsg = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      },
    ];

    await expect(agent.run(userMsg as any)).resolves.not.toThrow();

    await new Promise((r) => setTimeout(r, 20));

    const sysMsg = received.find(
      (i) =>
        i.role === "system" &&
        typeof i.content?.[0]?.text === "string" &&
        i.content[0].text.includes("billing dashboard"),
    );

    expect(sysMsg).toBeTruthy();
  });
});
