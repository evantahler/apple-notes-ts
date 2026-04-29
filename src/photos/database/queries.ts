export { dateToMacTime, macTimeToDate } from "../../database/timestamps.ts";

const PHOTO_COLUMNS = `
    a.Z_PK as id,
    a.ZFILENAME as filename,
    a.ZKIND as kind,
    a.ZWIDTH as width,
    a.ZHEIGHT as height,
    a.ZDATECREATED as dateCreated,
    a.ZADDEDDATE as dateAdded,
    a.ZFAVORITE as favorite,
    a.ZHIDDEN as hidden,
    a.ZLATITUDE as latitude,
    a.ZLONGITUDE as longitude`;

const PHOTO_DETAIL_COLUMNS = `
    ${PHOTO_COLUMNS},
    a.ZUUID as uuid,
    a.ZUNIFORMTYPEIDENTIFIER as uniformTypeIdentifier,
    a.ZDURATION as duration,
    a.ZORIENTATION as orientation,
    attr.ZORIGINALFILENAME as originalFilename,
    attr.ZTITLE as title,
    attr.ZORIGINALFILESIZE as fileSize`;

const VISIBLE_FILTER = `a.ZTRASHEDSTATE = 0 AND a.ZVISIBILITYSTATE = 0`;

export const LIST_PHOTOS = `
  SELECT ${PHOTO_COLUMNS}
  FROM ZASSET a
  WHERE ${VISIBLE_FILTER}
  ORDER BY a.ZDATECREATED DESC
`;

export const LIST_PHOTOS_IN_ALBUM = `
  SELECT ${PHOTO_COLUMNS}
  FROM ZASSET a
  JOIN Z_33ASSETS j ON j.Z_3ASSETS = a.Z_PK
  WHERE j.Z_33ALBUMS = ? AND ${VISIBLE_FILTER}
  ORDER BY a.ZDATECREATED DESC
`;

export const GET_PHOTO = `
  SELECT ${PHOTO_DETAIL_COLUMNS}
  FROM ZASSET a
  LEFT JOIN ZADDITIONALASSETATTRIBUTES attr ON attr.ZASSET = a.Z_PK
  WHERE a.Z_PK = ? AND ${VISIBLE_FILTER}
`;

// For videos (ZASSET.ZKIND = 1) the master file lives at ZRESOURCETYPE = 1;
// ZRESOURCETYPE = 0 is the still poster image. For photos the master is ZRESOURCETYPE = 0.
export const CHECK_LOCAL_AVAILABILITY = `
  SELECT r.ZLOCALAVAILABILITY as localAvailability
  FROM ZINTERNALRESOURCE r
  JOIN ZASSET a ON a.Z_PK = r.ZASSET
  WHERE r.ZASSET = ?
    AND r.ZDATASTORESUBTYPE = 1
    AND (
      (a.ZKIND = 1 AND r.ZRESOURCETYPE = 1)
      OR (a.ZKIND <> 1 AND r.ZRESOURCETYPE = 0)
    )
  LIMIT 1
`;

export const LIST_ALBUMS = `
  SELECT
    a.Z_PK as id,
    a.ZTITLE as title,
    a.ZKIND as kind,
    a.ZCACHEDCOUNT as photoCount,
    a.ZCREATIONDATE as createdAt,
    a.ZLASTMODIFIEDDATE as modifiedAt
  FROM ZGENERICALBUM a
  WHERE a.ZTRASHEDSTATE = 0
    AND a.ZTITLE IS NOT NULL
    AND a.ZKIND IN (2, 4000)
  ORDER BY a.ZTITLE ASC
`;

export const GET_ALBUM = `
  SELECT
    a.Z_PK as id,
    a.ZTITLE as title,
    a.ZKIND as kind,
    a.ZCACHEDCOUNT as photoCount,
    a.ZCREATIONDATE as createdAt,
    a.ZLASTMODIFIEDDATE as modifiedAt
  FROM ZGENERICALBUM a
  WHERE a.Z_PK = ? AND a.ZTRASHEDSTATE = 0
`;

export const GET_ALBUM_PHOTO_IDS = `
  SELECT j.Z_3ASSETS as photoId
  FROM Z_33ASSETS j
  JOIN ZASSET a ON a.Z_PK = j.Z_3ASSETS
  WHERE j.Z_33ALBUMS = ? AND ${VISIBLE_FILTER}
  ORDER BY a.ZDATECREATED DESC
`;

export const SEARCH_PHOTOS = `
  SELECT ${PHOTO_COLUMNS}
  FROM ZASSET a
  LEFT JOIN ZADDITIONALASSETATTRIBUTES attr ON attr.ZASSET = a.Z_PK
  WHERE ${VISIBLE_FILTER}
    AND (
      attr.ZORIGINALFILENAME LIKE ?
      OR attr.ZTITLE LIKE ?
      OR a.ZFILENAME LIKE ?
    )
  ORDER BY a.ZDATECREATED DESC
`;
