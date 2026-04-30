import { dateToMacTime } from "../../database/timestamps.ts";
import type { ListPhotosOptions } from "../types.ts";

export { dateToMacTime, macTimeToDate } from "../../database/timestamps.ts";

const PHOTO_COLUMNS = `
    a.Z_PK as id,
    a.ZFILENAME as filename,
    a.ZKIND as kind,
    a.ZWIDTH as width,
    a.ZHEIGHT as height,
    a.ZDATECREATED as dateCreated,
    a.ZADDEDDATE as dateAdded,
    a.ZMODIFICATIONDATE as modifiedAt,
    a.ZFAVORITE as favorite,
    a.ZHIDDEN as hidden,
    a.ZLATITUDE as latitude,
    a.ZLONGITUDE as longitude,
    attr.ZORIGINALFILESIZE as fileSize`;

const PHOTO_DETAIL_COLUMNS = `
    ${PHOTO_COLUMNS},
    a.ZUUID as uuid,
    a.ZUNIFORMTYPEIDENTIFIER as uniformTypeIdentifier,
    a.ZDURATION as duration,
    a.ZORIENTATION as orientation,
    attr.ZORIGINALFILENAME as originalFilename,
    attr.ZTITLE as title`;

const VISIBLE_FILTER = `a.ZTRASHEDSTATE = 0 AND a.ZVISIBILITYSTATE = 0`;

// LEFT JOIN clause that pulls in the master ZINTERNALRESOURCE row for an
// asset. For videos (ZASSET.ZKIND = 1) the master file is at ZRESOURCETYPE = 1;
// for photos and other types the master is ZRESOURCETYPE = 0. ZRESOURCETYPE = 0
// for videos is the still poster image and we don't want it.
const RESOURCE_JOIN = `
  LEFT JOIN ZINTERNALRESOURCE r ON r.ZASSET = a.Z_PK
    AND r.ZDATASTORESUBTYPE = 1
    AND (
      (a.ZKIND = 1 AND r.ZRESOURCETYPE = 1)
      OR (a.ZKIND <> 1 AND r.ZRESOURCETYPE = 0)
    )`;

const LOCATION_COLUMNS = `
    a.ZDIRECTORY as directory,
    a.ZBUNDLESCOPE as bundleScope,
    r.ZLOCALAVAILABILITY as localAvailability`;

// Build the SELECT for listPhotos with all filters/sort/limit pushed into SQL.
// On a 200K-photo library this returns ~50 rows instead of 200K, so the JS
// side never materializes the whole table just to slice off a page.
export function buildListPhotosQuery(options?: ListPhotosOptions): {
  sql: string;
  params: (string | number)[];
} {
  const params: (string | number)[] = [];
  const conditions: string[] = [VISIBLE_FILTER];
  // PHOTO_COLUMNS references attr.ZORIGINALFILESIZE, so the join is mandatory.
  const ATTR_JOIN =
    "LEFT JOIN ZADDITIONALASSETATTRIBUTES attr ON attr.ZASSET = a.Z_PK";
  let fromClause = `ZASSET a ${ATTR_JOIN}`;

  if (options?.albumId != null) {
    fromClause = `ZASSET a ${ATTR_JOIN} JOIN Z_33ASSETS j ON j.Z_3ASSETS = a.Z_PK`;
    conditions.push("j.Z_33ALBUMS = ?");
    params.push(options.albumId);
  }

  if (options?.mediaType === "video") conditions.push("a.ZKIND = 1");
  else if (options?.mediaType === "photo") conditions.push("a.ZKIND <> 1");

  if (options?.favorite === true) conditions.push("a.ZFAVORITE = 1");
  else if (options?.favorite === false) conditions.push("a.ZFAVORITE = 0");

  // Hidden photos are excluded by default — pass hidden:true to opt in.
  if (options?.hidden === true) conditions.push("a.ZHIDDEN = 1");
  else conditions.push("(a.ZHIDDEN = 0 OR a.ZHIDDEN IS NULL)");

  if (options?.afterDate) {
    conditions.push("a.ZDATECREATED >= ?");
    params.push(dateToMacTime(options.afterDate));
  }
  if (options?.beforeDate) {
    conditions.push("a.ZDATECREATED <= ?");
    params.push(dateToMacTime(options.beforeDate));
  }

  const sortCol =
    options?.sortBy === "dateAdded" ? "a.ZADDEDDATE" : "a.ZDATECREATED";
  const sortOrder = options?.order === "asc" ? "ASC" : "DESC";

  let sql = `
    SELECT ${PHOTO_COLUMNS}
    FROM ${fromClause}
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${sortCol} ${sortOrder}
  `;

  if (options?.limit != null && options.limit > 0) {
    sql += ` LIMIT ?`;
    params.push(options.limit);
  }

  return { sql, params };
}

// One round-trip for getPhoto: detail columns + location + availability.
export const GET_PHOTO = `
  SELECT ${PHOTO_DETAIL_COLUMNS},
${LOCATION_COLUMNS}
  FROM ZASSET a
  LEFT JOIN ZADDITIONALASSETATTRIBUTES attr ON attr.ZASSET = a.Z_PK
  ${RESOURCE_JOIN}
  WHERE a.Z_PK = ? AND ${VISIBLE_FILTER}
  LIMIT 1
`;

// One round-trip for getPhotoUrl: just the location bits, no detail columns.
export const GET_PHOTO_LOCATION = `
  SELECT
    a.ZFILENAME as filename,
${LOCATION_COLUMNS}
  FROM ZASSET a
  ${RESOURCE_JOIN}
  WHERE a.Z_PK = ? AND a.ZTRASHEDSTATE = 0
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
