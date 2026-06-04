import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { MacOSError } from "../src/errors.ts";
import { Messages } from "../src/index.ts";
import { ChatNotFoundError, MessageSendError } from "../src/messages/errors.ts";
import { buildSendArgs, classifySendError } from "../src/messages/send.ts";
import type { Chat } from "../src/messages/types.ts";

const FIXTURE_DB = resolve(import.meta.dir, "fixtures/chat.db");

// The actual osascript dispatch cannot be exercised against a fixture (it would
// drive a real Messages.app). These tests cover everything around it: argument
// validation, chat resolution, and error classification.

const fakeChat = (overrides: Partial<Chat> = {}): Chat => ({
  id: 1,
  guid: "iMessage;-;+15551234567",
  displayName: "Alice",
  chatIdentifier: "+15551234567",
  isGroup: false,
  serviceName: "iMessage",
  participants: ["+15551234567"],
  lastMessageDate: new Date(),
  ...overrides,
});

describe("buildSendArgs", () => {
  test("resolves a handle send (default service iMessage)", () => {
    const args = buildSendArgs({ text: "hi", handle: "+15551234567" });
    expect(args).toEqual({
      target: "+15551234567",
      service: "iMessage",
      mode: "handle",
    });
  });

  test("honors an explicit SMS service for handle sends", () => {
    const args = buildSendArgs({
      text: "hi",
      handle: "+15551234567",
      service: "SMS",
    });
    expect(args.service).toBe("SMS");
  });

  test("resolves a chat send and derives the service from the chat", () => {
    const args = buildSendArgs(
      { text: "hi", chatId: 1 },
      fakeChat({ guid: "iMessage;-;group", serviceName: "iMessage" }),
    );
    expect(args).toEqual({
      target: "iMessage;-;group",
      service: "iMessage",
      mode: "chat",
    });
  });

  test("derives SMS service from an SMS chat", () => {
    const args = buildSendArgs(
      { text: "hi", chatId: 1 },
      fakeChat({ serviceName: "SMS" }),
    );
    expect(args.service).toBe("SMS");
  });

  test("rejects when both handle and chatId are provided", () => {
    expect(() =>
      buildSendArgs({ text: "hi", handle: "+1", chatId: 1 }, fakeChat()),
    ).toThrow(MacOSError);
    try {
      buildSendArgs({ text: "hi", handle: "+1", chatId: 1 }, fakeChat());
    } catch (e) {
      expect((e as MacOSError).category).toBe("invalid_input");
    }
  });

  test("rejects when neither handle nor chatId is provided", () => {
    expect(() => buildSendArgs({ text: "hi" })).toThrow(MacOSError);
  });

  test("rejects empty text", () => {
    expect(() => buildSendArgs({ text: "", handle: "+1" })).toThrow(MacOSError);
  });
});

describe("classifySendError", () => {
  test("flags TCC/Automation denial as access_denied", () => {
    const err = classifySendError(
      1,
      "execution error: Not authorized to send Apple events to Messages. (-1743)",
    );
    expect(err).toBeInstanceOf(MessageSendError);
    expect(err.category).toBe("access_denied");
    expect(err.recovery).toContain("Automation");
  });

  test("treats other failures as retryable internal errors", () => {
    const err = classifySendError(1, "some other osascript failure");
    expect(err.category).toBe("internal");
    expect(err.retryable).toBe(true);
  });
});

describe("Messages.send", () => {
  let db: Messages;

  beforeAll(() => {
    db = new Messages({ dbPath: FIXTURE_DB });
  });

  afterAll(() => {
    db.close();
  });

  test("throws ChatNotFoundError for an unknown chatId before dispatching", () => {
    expect(() => db.send({ text: "hi", chatId: 999999 })).toThrow(
      ChatNotFoundError,
    );
  });

  test("rejects bad arguments before dispatching", () => {
    expect(() => db.send({ text: "hi" })).toThrow(MacOSError);
  });
});
