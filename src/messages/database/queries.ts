// Mac Absolute Time epoch: 2001-01-01 00:00:00 UTC
// Offset from Unix epoch (1970-01-01) in seconds
const MAC_EPOCH_OFFSET = 978307200;

// Messages timestamps are in nanoseconds since 2001-01-01
export function macNanosToDate(nanos: number | null): Date {
  if (nanos == null || nanos === 0) return new Date(0);
  return new Date((nanos / 1e9 + MAC_EPOCH_OFFSET) * 1000);
}

export function dateToMacNanos(date: Date): number {
  return (date.getTime() / 1000 - MAC_EPOCH_OFFSET) * 1e9;
}

export const LIST_HANDLES = `
  SELECT
    ROWID as id,
    id as identifier,
    service
  FROM handle
  ORDER BY ROWID
`;

export const LIST_CHATS = `
  SELECT
    c.ROWID as id,
    c.guid,
    c.display_name as displayName,
    c.chat_identifier as chatIdentifier,
    c.style,
    c.service_name as serviceName,
    MAX(cmj.message_date) as lastMessageDate
  FROM chat c
  LEFT JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
  GROUP BY c.ROWID
  ORDER BY lastMessageDate DESC
`;

export const GET_CHAT = `
  SELECT
    c.ROWID as id,
    c.guid,
    c.display_name as displayName,
    c.chat_identifier as chatIdentifier,
    c.style,
    c.service_name as serviceName,
    MAX(cmj.message_date) as lastMessageDate
  FROM chat c
  LEFT JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
  WHERE c.ROWID = ?
  GROUP BY c.ROWID
`;

export const LIST_CHAT_PARTICIPANTS = `
  SELECT h.id as identifier
  FROM chat_handle_join chj
  JOIN handle h ON h.ROWID = chj.handle_id
  WHERE chj.chat_id = ?
`;

export const LIST_MESSAGES = `
  SELECT
    m.ROWID as id,
    m.guid,
    cmj.chat_id as chatId,
    m.text,
    m.attributedBody,
    m.is_from_me as isFromMe,
    m.handle_id as handleId,
    m.date,
    m.date_read as dateRead,
    m.service,
    m.is_audio_message as isAudioMessage,
    m.cache_has_attachments as hasAttachments,
    m.thread_originator_guid as threadOriginatorGuid,
    m.reply_to_guid as replyToGuid
  FROM message m
  JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  WHERE cmj.chat_id = ?
  ORDER BY m.date DESC
`;

export const GET_MESSAGE = `
  SELECT
    m.ROWID as id,
    m.guid,
    cmj.chat_id as chatId,
    m.text,
    m.attributedBody,
    m.is_from_me as isFromMe,
    m.handle_id as handleId,
    m.date,
    m.date_read as dateRead,
    m.service,
    m.is_audio_message as isAudioMessage,
    m.cache_has_attachments as hasAttachments,
    m.thread_originator_guid as threadOriginatorGuid,
    m.reply_to_guid as replyToGuid
  FROM message m
  LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  WHERE m.ROWID = ?
`;

export const SEARCH_MESSAGES = `
  SELECT
    m.ROWID as id,
    m.guid,
    cmj.chat_id as chatId,
    m.text,
    m.attributedBody,
    m.is_from_me as isFromMe,
    m.handle_id as handleId,
    m.date,
    m.date_read as dateRead,
    m.service,
    m.is_audio_message as isAudioMessage,
    m.cache_has_attachments as hasAttachments,
    m.thread_originator_guid as threadOriginatorGuid,
    m.reply_to_guid as replyToGuid
  FROM message m
  LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  WHERE m.text LIKE ?
  ORDER BY m.date DESC
  LIMIT ?
`;

export const SEARCH_MESSAGES_IN_CHAT = `
  SELECT
    m.ROWID as id,
    m.guid,
    cmj.chat_id as chatId,
    m.text,
    m.attributedBody,
    m.is_from_me as isFromMe,
    m.handle_id as handleId,
    m.date,
    m.date_read as dateRead,
    m.service,
    m.is_audio_message as isAudioMessage,
    m.cache_has_attachments as hasAttachments,
    m.thread_originator_guid as threadOriginatorGuid,
    m.reply_to_guid as replyToGuid
  FROM message m
  JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  WHERE m.text LIKE ?
    AND cmj.chat_id = ?
  ORDER BY m.date DESC
  LIMIT ?
`;

export const LIST_MESSAGE_ATTACHMENTS = `
  SELECT
    a.ROWID as id,
    a.filename,
    a.mime_type as mimeType,
    a.transfer_name as transferName,
    a.total_bytes as totalBytes
  FROM attachment a
  JOIN message_attachment_join maj ON maj.attachment_id = a.ROWID
  WHERE maj.message_id = ?
`;
