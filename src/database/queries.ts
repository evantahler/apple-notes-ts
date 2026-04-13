// Mac Absolute Time epoch: 2001-01-01 00:00:00 UTC
// Offset from Unix epoch (1970-01-01) in seconds
export const MAC_EPOCH_OFFSET = 978307200;

export function macTimeToDate(macTime: number | null): Date {
  if (macTime == null) return new Date(0);
  return new Date((macTime + MAC_EPOCH_OFFSET) * 1000);
}

export function dateToMacTime(date: Date): number {
  return date.getTime() / 1000 - MAC_EPOCH_OFFSET;
}

// Entity types in ZICCLOUDSYNCINGOBJECT.Z_ENT
// These vary by macOS version. We discover them at runtime.

export const LIST_ACCOUNTS = `
  SELECT
    z.Z_PK as id,
    z.ZNAME as name
  FROM ZICCLOUDSYNCINGOBJECT z
  WHERE z.ZNAME IS NOT NULL
    AND z.Z_ENT = ?
  ORDER BY z.Z_PK
`;

export const LIST_FOLDERS = `
  SELECT
    f.Z_PK as id,
    f.ZTITLE2 as name,
    f.ZPARENT as accountId
  FROM ZICCLOUDSYNCINGOBJECT f
  WHERE f.ZTITLE2 IS NOT NULL
    AND f.ZMARKEDFORDELETION != 1
    AND f.Z_ENT = ?
  ORDER BY f.ZTITLE2
`;

export const COUNT_NOTES_PER_FOLDER = `
  SELECT
    n.ZFOLDER as folderId,
    COUNT(*) as count
  FROM ZICCLOUDSYNCINGOBJECT n
  WHERE n.ZTITLE1 IS NOT NULL
    AND n.ZMARKEDFORDELETION != 1
    AND n.Z_ENT = ?
  GROUP BY n.ZFOLDER
`;

export const LIST_NOTES = `
  SELECT
    n.Z_PK as id,
    n.ZTITLE1 as title,
    n.ZSNIPPET as snippet,
    n.ZFOLDER as folderId,
    n.ZCREATIONDATE1 as createdAt,
    n.ZMODIFICATIONDATE1 as modifiedAt,
    n.ZISPASSWORDPROTECTED as isPasswordProtected,
    nd.ZDATA as zdata,
    nd.Z_PK as noteDataId
  FROM ZICCLOUDSYNCINGOBJECT n
  LEFT JOIN ZICNOTEDATA nd ON nd.ZNOTE = n.Z_PK
  WHERE n.ZTITLE1 IS NOT NULL
    AND n.ZMARKEDFORDELETION != 1
    AND n.Z_ENT = ?
  ORDER BY n.ZMODIFICATIONDATE1 DESC
`;

export const GET_NOTE = `
  SELECT
    n.Z_PK as id,
    n.ZTITLE1 as title,
    n.ZSNIPPET as snippet,
    n.ZFOLDER as folderId,
    n.ZCREATIONDATE1 as createdAt,
    n.ZMODIFICATIONDATE1 as modifiedAt,
    n.ZISPASSWORDPROTECTED as isPasswordProtected,
    nd.ZDATA as zdata,
    nd.Z_PK as noteDataId
  FROM ZICCLOUDSYNCINGOBJECT n
  LEFT JOIN ZICNOTEDATA nd ON nd.ZNOTE = n.Z_PK
  WHERE n.Z_PK = ?
`;

export const SEARCH_BY_TITLE = `
  SELECT
    n.Z_PK as id,
    n.ZTITLE1 as title,
    n.ZSNIPPET as snippet,
    n.ZFOLDER as folderId,
    n.ZCREATIONDATE1 as createdAt,
    n.ZMODIFICATIONDATE1 as modifiedAt,
    n.ZISPASSWORDPROTECTED as isPasswordProtected
  FROM ZICCLOUDSYNCINGOBJECT n
  WHERE n.ZTITLE1 LIKE ?
    AND n.ZMARKEDFORDELETION != 1
    AND n.Z_ENT = ?
  ORDER BY n.ZMODIFICATIONDATE1 DESC
  LIMIT ?
`;

export const SEARCH_BY_SNIPPET = `
  SELECT
    n.Z_PK as id,
    n.ZTITLE1 as title,
    n.ZSNIPPET as snippet,
    n.ZFOLDER as folderId,
    n.ZCREATIONDATE1 as createdAt,
    n.ZMODIFICATIONDATE1 as modifiedAt,
    n.ZISPASSWORDPROTECTED as isPasswordProtected
  FROM ZICCLOUDSYNCINGOBJECT n
  WHERE (n.ZTITLE1 LIKE ? OR n.ZSNIPPET LIKE ?)
    AND n.ZMARKEDFORDELETION != 1
    AND n.Z_ENT = ?
  ORDER BY n.ZMODIFICATIONDATE1 DESC
  LIMIT ?
`;

export const GET_ATTACHMENTS = `
  SELECT
    a.Z_PK as id,
    a.ZIDENTIFIER as identifier,
    a.ZFILENAME as name,
    a.ZTYPEUTI as contentType,
    a.ZNOTE1 as noteId
  FROM ZICCLOUDSYNCINGOBJECT a
  WHERE a.ZNOTE1 = ?
    AND a.ZTYPEUTI IS NOT NULL
    AND a.Z_ENT = ?
`;

// Resolve an attachment identifier to its media identifier via the ZMEDIA FK.
// The protobuf embeds the attachment ZIDENTIFIER, but files on disk are stored
// under the media row's ZIDENTIFIER (a different UUID).
export const RESOLVE_MEDIA_IDENTIFIER = `
  SELECT
    media.ZIDENTIFIER as mediaIdentifier,
    media.ZFILENAME as mediaFilename
  FROM ZICCLOUDSYNCINGOBJECT att
  JOIN ZICCLOUDSYNCINGOBJECT media ON media.Z_PK = att.ZMEDIA
  WHERE att.ZIDENTIFIER = ?
`;

// Fetch the ZMERGEABLEDATA1 blob for a table attachment (com.apple.notes.table)
export const GET_TABLE_MERGEABLE_DATA = `
  SELECT ZMERGEABLEDATA1 as mergeableData
  FROM ZICCLOUDSYNCINGOBJECT
  WHERE ZIDENTIFIER = ?
`;

// Discover entity types from Z_PRIMARYKEY table
export const GET_ENTITY_TYPES = `
  SELECT Z_ENT, Z_NAME FROM Z_PRIMARYKEY
`;
