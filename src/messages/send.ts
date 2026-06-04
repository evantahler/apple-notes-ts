import { MacOSError } from "../errors.ts";
import { MessageSendError } from "./errors.ts";
import type { Chat, MessageService, SendMessageOptions } from "./types.ts";

export interface SendArgs {
  /** Handle (phone/email) in handle mode, or chat guid in chat mode. */
  target: string;
  service: MessageService;
  mode: "handle" | "chat";
}

/**
 * AppleScript program run via `osascript -e SEND_APPLESCRIPT <target> <body> <kind> <mode>`.
 *
 * The trailing CLI arguments bind positionally to `on run {target, body, kind, mode}`.
 * User-supplied values (the recipient and the message body) are passed as argv
 * — never interpolated into the script source — so a message containing quotes
 * or script-like text cannot inject into the automation.
 *
 * Why AppleScript and not JXA: on macOS 26 the JavaScript-for-Automation bridge
 * to Messages is broken — `Application("Messages").services()` throws
 * "Application isn't running" even when it is, and `.whose()` is unavailable on
 * the element accessor. The AppleScript `whose`-clause resolution below works.
 *
 * NOTE: the `1st service whose service type is …` / `participant … of …` /
 * `chat id …` resolution is the one part that cannot be exercised by the test
 * fixtures (it drives a live Messages.app). It was validated end-to-end against
 * a real Messages.app; if Apple changes the Messages scripting dictionary, this
 * is the line to revisit.
 */
export const SEND_APPLESCRIPT = `on run {target, body, kind, mode}
  tell application "Messages"
    if mode is "chat" then
      send body to chat id target
    else
      if kind is "SMS" then
        set targetService to 1st service whose service type is SMS
      else
        set targetService to 1st service whose service type is iMessage
      end if
      send body to participant target of targetService
    end if
  end tell
end run`;

/**
 * Validates send options and resolves the osascript arguments. Pure and
 * synchronous so it can be unit-tested without spawning osascript. When sending
 * by `chatId`, the caller must resolve and pass the `chat` first.
 */
export function buildSendArgs(
  options: SendMessageOptions,
  chat?: Chat,
): SendArgs {
  const hasHandle =
    typeof options.handle === "string" && options.handle.length > 0;
  const hasChat = options.chatId !== undefined;

  if (hasHandle === hasChat) {
    throw new MacOSError(
      "Provide exactly one of `handle` or `chatId` to send a message.",
      {
        category: "invalid_input",
        recovery:
          "Pass `handle` (a phone number or email) OR `chatId` (from list_chats), but not both.",
      },
    );
  }

  if (typeof options.text !== "string" || options.text.length === 0) {
    throw new MacOSError("Message text must be a non-empty string.", {
      category: "invalid_input",
      recovery: "Pass a non-empty `text` value.",
    });
  }

  if (hasChat) {
    if (!chat) {
      throw new MacOSError(
        "Chat must be resolved before building send arguments.",
        { category: "internal" },
      );
    }
    return {
      target: chat.guid,
      service: chat.serviceName === "SMS" ? "SMS" : "iMessage",
      mode: "chat",
    };
  }

  return {
    target: options.handle as string,
    service: options.service ?? "iMessage",
    mode: "handle",
  };
}

/**
 * Maps a failed osascript invocation to a {@link MessageSendError}, detecting
 * the TCC/Automation-denied case so the recovery hint can point at the right
 * System Settings pane.
 */
export function classifySendError(
  exitCode: number,
  stderr: string,
): MessageSendError {
  const denied =
    stderr.includes("-1743") ||
    /not authori[sz]ed to send apple events/i.test(stderr) ||
    /not allowed to send apple events/i.test(stderr);

  if (denied) {
    return new MessageSendError(
      `Messages automation is not authorized: ${stderr.trim()}`,
      {
        category: "access_denied",
        retryable: true,
        recovery:
          'Grant Automation access for "Messages" to your terminal/host app in System Settings > Privacy & Security > Automation, then retry.',
      },
    );
  }

  return new MessageSendError(
    `Failed to send message (osascript exit ${exitCode}): ${stderr.trim() || "no error output"}`,
    {
      category: "internal",
      retryable: true,
      recovery:
        "Ensure Messages.app is open and signed in, and that the recipient handle or chat is valid and reachable.",
    },
  );
}
