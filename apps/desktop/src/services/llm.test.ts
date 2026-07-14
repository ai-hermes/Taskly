import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./llm";

function mockFetch(response: Partial<Response> & { ok: boolean }) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

function jsonResponse(body: unknown): Partial<Response> & { ok: boolean } {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe("OpenAIProvider.extractTodos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("happy path — returns one TodoItem from a JSON array response", async () => {
    const item = { title: "Fix the bug", priority: 1, todoKind: "actionable" };
    mockFetch(
      jsonResponse({
        choices: [{ message: { content: JSON.stringify([item]) } }],
      })
    );

    const provider = new OpenAIProvider("sk-test", "gpt-4o-mini");
    const todos = await provider.extractTodos("Fix the bug please");

    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe("Fix the bug");
    expect(todos[0].todoKind).toBe("actionable");
    expect(todos[0].reviewStatus).toBe("pending_confirmation");
    expect(todos[0].fingerprint).toBeTruthy();
  });

  it("object-wrapped array — extracts items from {todos: [...]} shape", async () => {
    const item = { title: "Review PR", priority: 2, todoKind: "actionable" };
    mockFetch(
      jsonResponse({
        choices: [{ message: { content: JSON.stringify({ todos: [item] }) } }],
      })
    );

    const provider = new OpenAIProvider("sk-test", "gpt-4o-mini");
    const todos = await provider.extractTodos("Please review the PR");

    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe("Review PR");
  });

  it("non-OK response — rejects with an error containing the status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve("invalid api key"),
      })
    );

    const provider = new OpenAIProvider("bad-key", "gpt-4o-mini");
    await expect(provider.extractTodos("some text")).rejects.toThrow("401");
  });

  it("malformed content — resolves with [] and does not throw", async () => {
    mockFetch(
      jsonResponse({
        choices: [{ message: { content: "not json {" } }],
      })
    );

    const provider = new OpenAIProvider("sk-test", "gpt-4o-mini");
    const todos = await provider.extractTodos("some text");
    expect(todos).toEqual([]);
  });

  it("missing content — empty choices resolves with []", async () => {
    mockFetch(jsonResponse({ choices: [] }));

    const provider = new OpenAIProvider("sk-test", "gpt-4o-mini");
    const todos = await provider.extractTodos("some text");
    expect(todos).toEqual([]);
  });
});
