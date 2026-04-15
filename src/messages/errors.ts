import { MacOSError } from "../errors.ts";

export class ChatNotFoundError extends MacOSError {
  constructor(chatId: number) {
    super(`Chat not found: ${chatId}`);
    this.name = "ChatNotFoundError";
  }
}

export class MessageNotFoundError extends MacOSError {
  constructor(messageId: number) {
    super(`Message not found: ${messageId}`);
    this.name = "MessageNotFoundError";
  }
}
