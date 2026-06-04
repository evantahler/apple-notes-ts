import { MacOSError } from "../errors.ts";

export class ChatNotFoundError extends MacOSError {
  constructor(chatId: number) {
    super(`Chat not found: ${chatId}`, {
      category: "not_found",
      recovery: "Use list_chats to find valid chat IDs.",
    });
    this.name = "ChatNotFoundError";
  }
}

export class MessageNotFoundError extends MacOSError {
  constructor(messageId: number) {
    super(`Message not found: ${messageId}`, {
      category: "not_found",
      recovery:
        "Use list_messages or search_messages to find valid message IDs.",
    });
    this.name = "MessageNotFoundError";
  }
}

/**
 * Raised when sending a message via osascript fails. `category` is
 * "access_denied" when macOS blocks the Apple Events automation (TCC),
 * "invalid_input" for bad arguments, and "internal" for any other osascript
 * failure.
 */
export class MessageSendError extends MacOSError {
  constructor(
    message: string,
    options?: {
      category?: "internal" | "access_denied" | "invalid_input";
      retryable?: boolean;
      recovery?: string;
    },
  ) {
    super(message, options);
    this.name = "MessageSendError";
  }
}
