export { dateToMacTime, macTimeToDate } from "../../database/timestamps.ts";

const CONTACT_COLUMNS = `
    r.Z_PK as id,
    r.ZFIRSTNAME as firstName,
    r.ZLASTNAME as lastName,
    r.ZORGANIZATION as organization,
    r.ZJOBTITLE as jobTitle,
    r.ZDEPARTMENT as department,
    r.ZBIRTHDAY as birthday,
    r.ZCREATIONDATE as createdAt,
    r.ZMODIFICATIONDATE as modifiedAt,
    CASE WHEN r.ZIMAGEDATA IS NOT NULL THEN 1 ELSE 0 END as hasImage`;

export const LIST_CONTACTS = `
  SELECT ${CONTACT_COLUMNS}
  FROM ZABCDRECORD r
  WHERE r.Z_ENT = 22
  ORDER BY r.ZSORTINGLASTNAME ASC, r.ZSORTINGFIRSTNAME ASC
`;

export const GET_CONTACT = `
  SELECT ${CONTACT_COLUMNS}
  FROM ZABCDRECORD r
  WHERE r.Z_PK = ? AND r.Z_ENT = 22
`;

// Each whitespace-separated query token must match at least one column; tokens
// are AND-ed together so "Ben Sabrin" matches a contact with ZFIRSTNAME='Ben'
// and ZLASTNAME='Sabrin' (no single column holds the whole phrase). Each clause
// binds 5 `?` patterns positionally.
const SEARCH_TOKEN_CLAUSE = `(
      r.ZFIRSTNAME LIKE ?
      OR r.ZLASTNAME LIKE ?
      OR r.ZORGANIZATION LIKE ?
      OR p.ZFULLNUMBER LIKE ?
      OR e.ZADDRESS LIKE ?
    )`;

export const SEARCH_CONTACTS = (tokenCount: number): string => `
  SELECT DISTINCT ${CONTACT_COLUMNS}
  FROM ZABCDRECORD r
  LEFT JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
  LEFT JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
  WHERE r.Z_ENT = 22
    AND ${Array(tokenCount).fill(SEARCH_TOKEN_CLAUSE).join("\n    AND ")}
  ORDER BY r.ZSORTINGLASTNAME ASC, r.ZSORTINGFIRSTNAME ASC
`;

export const LIST_CONTACTS_IN_GROUP = `
  SELECT ${CONTACT_COLUMNS}
  FROM ZABCDRECORD r
  JOIN Z_22PARENTGROUPS j ON j.Z_22CONTACTS = r.Z_PK
  WHERE j.Z_19PARENTGROUPS1 = ? AND r.Z_ENT = 22
  ORDER BY r.ZSORTINGLASTNAME ASC, r.ZSORTINGFIRSTNAME ASC
`;

export const LIST_EMAILS = `
  SELECT ZADDRESS as address, ZLABEL as label, ZISPRIMARY as isPrimary
  FROM ZABCDEMAILADDRESS WHERE ZOWNER = ?
  ORDER BY ZISPRIMARY DESC, ZORDERINGINDEX ASC
`;

export const LIST_PHONES = `
  SELECT ZFULLNUMBER as number, ZLABEL as label, ZISPRIMARY as isPrimary
  FROM ZABCDPHONENUMBER WHERE ZOWNER = ?
  ORDER BY ZISPRIMARY DESC, ZORDERINGINDEX ASC
`;

// Batched lookups for enriching search results: one query each for phones and
// emails across many owners. The IN list is sized at call time (bun:sqlite
// binds positionally). Ordering mirrors LIST_PHONES/LIST_EMAILS so per-owner
// grouping keeps primary numbers/addresses first.
export const PHONES_FOR_OWNERS = (n: number): string => `
  SELECT ZOWNER as owner, ZFULLNUMBER as number, ZLABEL as label, ZISPRIMARY as isPrimary
  FROM ZABCDPHONENUMBER WHERE ZOWNER IN (${Array(n).fill("?").join(",")})
  ORDER BY ZISPRIMARY DESC, ZORDERINGINDEX ASC
`;

export const EMAILS_FOR_OWNERS = (n: number): string => `
  SELECT ZOWNER as owner, ZADDRESS as address, ZLABEL as label, ZISPRIMARY as isPrimary
  FROM ZABCDEMAILADDRESS WHERE ZOWNER IN (${Array(n).fill("?").join(",")})
  ORDER BY ZISPRIMARY DESC, ZORDERINGINDEX ASC
`;

export const LIST_ADDRESSES = `
  SELECT ZSTREET as street, ZCITY as city, ZSTATE as state,
         ZZIPCODE as zipCode, ZCOUNTRYNAME as country, ZLABEL as label
  FROM ZABCDPOSTALADDRESS WHERE ZOWNER = ?
  ORDER BY ZORDERINGINDEX ASC
`;

export const LIST_URLS = `
  SELECT ZURL as url, ZLABEL as label
  FROM ZABCDURLADDRESS WHERE ZOWNER = ?
  ORDER BY ZORDERINGINDEX ASC
`;

export const LIST_SOCIAL_PROFILES = `
  SELECT ZURLSTRING as url, ZUSERIDENTIFIER as username,
         ZSERVICENAME as service, ZLABEL as label
  FROM ZABCDSOCIALPROFILE WHERE ZOWNER = ?
  ORDER BY ZORDERINGINDEX ASC
`;

export const LIST_RELATED_NAMES = `
  SELECT ZNAME as name, ZLABEL as label
  FROM ZABCDRELATEDNAME WHERE ZOWNER = ?
  ORDER BY ZORDERINGINDEX ASC
`;

export const LIST_CONTACT_DATES = `
  SELECT ZDATE as date, ZLABEL as label
  FROM ZABCDCONTACTDATE WHERE ZOWNER = ?
  ORDER BY ZORDERINGINDEX ASC
`;

export const LIST_CONTACT_NOTE = `
  SELECT ZTEXT as text
  FROM ZABCDNOTE WHERE ZCONTACT = ?
`;

// One query that fetches every detail table for a single contact via UNION ALL.
// Each subquery returns (kind, payload-as-json), so the JS side demuxes by
// `kind` and parses the JSON payload. Replaces 9 separate queries with 1.
// Each `?` binds the same contactId; bun:sqlite's .all() takes them positionally.
export const GET_CONTACT_BUNDLE = `
  SELECT 'contact' AS kind, json_object(
    'id', r.Z_PK,
    'firstName', r.ZFIRSTNAME,
    'lastName', r.ZLASTNAME,
    'organization', r.ZORGANIZATION,
    'jobTitle', r.ZJOBTITLE,
    'department', r.ZDEPARTMENT,
    'birthday', r.ZBIRTHDAY,
    'createdAt', r.ZCREATIONDATE,
    'modifiedAt', r.ZMODIFICATIONDATE,
    'hasImage', CASE WHEN r.ZIMAGEDATA IS NOT NULL THEN 1 ELSE 0 END
  ) AS payload
  FROM ZABCDRECORD r WHERE r.Z_PK = ? AND r.Z_ENT = 22

  UNION ALL SELECT 'note', json_object('text', ZTEXT)
    FROM ZABCDNOTE WHERE ZCONTACT = ?

  UNION ALL SELECT 'email', json_object(
    'address', ZADDRESS, 'label', ZLABEL, 'isPrimary', ZISPRIMARY,
    'orderingIndex', ZORDERINGINDEX
  ) FROM ZABCDEMAILADDRESS WHERE ZOWNER = ?

  UNION ALL SELECT 'phone', json_object(
    'number', ZFULLNUMBER, 'label', ZLABEL, 'isPrimary', ZISPRIMARY,
    'orderingIndex', ZORDERINGINDEX
  ) FROM ZABCDPHONENUMBER WHERE ZOWNER = ?

  UNION ALL SELECT 'address', json_object(
    'street', ZSTREET, 'city', ZCITY, 'state', ZSTATE,
    'zipCode', ZZIPCODE, 'country', ZCOUNTRYNAME, 'label', ZLABEL,
    'orderingIndex', ZORDERINGINDEX
  ) FROM ZABCDPOSTALADDRESS WHERE ZOWNER = ?

  UNION ALL SELECT 'url', json_object(
    'url', ZURL, 'label', ZLABEL, 'orderingIndex', ZORDERINGINDEX
  ) FROM ZABCDURLADDRESS WHERE ZOWNER = ?

  UNION ALL SELECT 'social', json_object(
    'url', ZURLSTRING, 'username', ZUSERIDENTIFIER, 'service', ZSERVICENAME,
    'label', ZLABEL, 'orderingIndex', ZORDERINGINDEX
  ) FROM ZABCDSOCIALPROFILE WHERE ZOWNER = ?

  UNION ALL SELECT 'related', json_object(
    'name', ZNAME, 'label', ZLABEL, 'orderingIndex', ZORDERINGINDEX
  ) FROM ZABCDRELATEDNAME WHERE ZOWNER = ?

  UNION ALL SELECT 'date', json_object(
    'date', ZDATE, 'label', ZLABEL, 'orderingIndex', ZORDERINGINDEX
  ) FROM ZABCDCONTACTDATE WHERE ZOWNER = ?
`;

export const LIST_GROUPS = `
  SELECT r.Z_PK as id, r.ZNAME as name
  FROM ZABCDRECORD r
  WHERE r.Z_ENT = 19
  ORDER BY r.ZNAME ASC
`;

export const GET_GROUP = `
  SELECT r.Z_PK as id, r.ZNAME as name
  FROM ZABCDRECORD r
  WHERE r.Z_PK = ? AND r.Z_ENT = 19
`;

export const COUNT_GROUP_MEMBERS = `
  SELECT Z_19PARENTGROUPS1 as groupId, COUNT(*) as count
  FROM Z_22PARENTGROUPS
  GROUP BY Z_19PARENTGROUPS1
`;
