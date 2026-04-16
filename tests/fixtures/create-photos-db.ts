/**
 * Creates a test Photos.sqlite database with realistic Photos data.
 * Run with: bun run tests/fixtures/create-photos-db.ts
 *
 * The generated DB is checked into git so tests run without Full Disk Access.
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import {
  FIXTURE_DIR,
  cleanupDatabase,
  dateToMacTime as toMacTime,
} from "./helpers.ts";

const DB_PATH = resolve(FIXTURE_DIR, "Photos.sqlite");

// Delete existing DB
cleanupDatabase(DB_PATH);

const db = new Database(DB_PATH);

// ============================================================================
// Create schema (simplified version of the real Photos Core Data schema)
// ============================================================================

db.exec(`
  CREATE TABLE Z_PRIMARYKEY (
    Z_ENT INTEGER PRIMARY KEY,
    Z_NAME VARCHAR,
    Z_SUPER INTEGER DEFAULT 0,
    Z_MAX INTEGER DEFAULT 0
  );

  CREATE TABLE ZASSET (
    Z_PK INTEGER PRIMARY KEY,
    Z_ENT INTEGER NOT NULL DEFAULT 3,
    Z_OPT INTEGER DEFAULT 1,
    ZKIND INTEGER DEFAULT 0,
    ZWIDTH INTEGER DEFAULT 0,
    ZHEIGHT INTEGER DEFAULT 0,
    ZORIENTATION INTEGER DEFAULT 1,
    ZFAVORITE INTEGER DEFAULT 0,
    ZHIDDEN INTEGER DEFAULT 0,
    ZTRASHEDSTATE INTEGER DEFAULT 0,
    ZVISIBILITYSTATE INTEGER DEFAULT 0,
    ZDURATION FLOAT DEFAULT 0,
    ZLATITUDE FLOAT,
    ZLONGITUDE FLOAT,
    ZDATECREATED TIMESTAMP,
    ZADDEDDATE TIMESTAMP,
    ZMODIFICATIONDATE TIMESTAMP,
    ZDIRECTORY VARCHAR,
    ZFILENAME VARCHAR,
    ZUNIFORMTYPEIDENTIFIER VARCHAR,
    ZUUID VARCHAR
  );

  CREATE TABLE ZADDITIONALASSETATTRIBUTES (
    Z_PK INTEGER PRIMARY KEY,
    Z_ENT INTEGER NOT NULL DEFAULT 1,
    Z_OPT INTEGER DEFAULT 1,
    ZASSET INTEGER,
    ZORIGINALFILENAME VARCHAR,
    ZTITLE VARCHAR,
    ZORIGINALFILESIZE INTEGER,
    ZCAMERACAPTUREDEVICE INTEGER DEFAULT 0
  );
  CREATE INDEX IDX_ATTR_ASSET ON ZADDITIONALASSETATTRIBUTES(ZASSET);

  CREATE TABLE ZINTERNALRESOURCE (
    Z_PK INTEGER PRIMARY KEY,
    Z_ENT INTEGER NOT NULL DEFAULT 51,
    Z_OPT INTEGER DEFAULT 1,
    ZASSET INTEGER,
    ZRESOURCETYPE INTEGER DEFAULT 0,
    ZDATASTORESUBTYPE INTEGER DEFAULT 1,
    ZLOCALAVAILABILITY INTEGER DEFAULT 1
  );
  CREATE INDEX IDX_RES_ASSET ON ZINTERNALRESOURCE(ZASSET);

  CREATE TABLE ZGENERICALBUM (
    Z_PK INTEGER PRIMARY KEY,
    Z_ENT INTEGER NOT NULL DEFAULT 33,
    Z_OPT INTEGER DEFAULT 1,
    ZKIND INTEGER DEFAULT 2,
    ZTRASHEDSTATE INTEGER DEFAULT 0,
    ZCACHEDCOUNT INTEGER DEFAULT 0,
    ZTITLE VARCHAR,
    ZUUID VARCHAR,
    ZCREATIONDATE TIMESTAMP,
    ZLASTMODIFIEDDATE TIMESTAMP
  );

  CREATE TABLE Z_33ASSETS (
    Z_33ALBUMS INTEGER,
    Z_3ASSETS INTEGER,
    Z_FOK_3ASSETS INTEGER,
    PRIMARY KEY (Z_33ALBUMS, Z_3ASSETS)
  );
  CREATE INDEX IDX_33_ASSETS ON Z_33ASSETS(Z_3ASSETS, Z_33ALBUMS);
`);

// ============================================================================
// Z_PRIMARYKEY entries
// ============================================================================

const entities: [number, string][] = [
  [1, "AdditionalAssetAttributes"],
  [3, "Asset"],
  [32, "GenericAlbum"],
  [33, "Album"],
  [51, "InternalResource"],
];

for (const [ent, name] of entities) {
  db.query("INSERT INTO Z_PRIMARYKEY (Z_ENT, Z_NAME) VALUES (?, ?)").run(
    ent,
    name,
  );
}

// ============================================================================
// Timestamps
// ============================================================================

const now = new Date("2025-06-15T10:00:00Z");
const yesterday = new Date("2025-06-14T10:00:00Z");
const lastWeek = new Date("2025-06-08T10:00:00Z");
const lastMonth = new Date("2025-05-15T10:00:00Z");
const twoMonthsAgo = new Date("2025-04-15T10:00:00Z");
const lastYear = new Date("2024-06-15T10:00:00Z");

// ============================================================================
// Assets (photos and videos)
// ============================================================================

let assetPk = 0;
let attrPk = 0;
let resPk = 0;

function insertAsset(opts: {
  filename: string;
  kind?: number; // 0=photo, 1=video
  width?: number;
  height?: number;
  favorite?: boolean;
  hidden?: boolean;
  trashed?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  duration?: number;
  uti?: string;
  directory?: string;
  dateCreated: Date;
  dateAdded?: Date;
  originalFilename?: string;
  title?: string;
  fileSize?: number;
  locallyAvailable?: boolean;
}): number {
  const pk = ++assetPk;
  const uuid = `photo-uuid-${pk}`;
  const dir = opts.directory ?? "0";

  db.query(
    `INSERT INTO ZASSET
     (Z_PK, Z_ENT, ZKIND, ZWIDTH, ZHEIGHT, ZORIENTATION, ZFAVORITE, ZHIDDEN,
      ZTRASHEDSTATE, ZVISIBILITYSTATE, ZDURATION, ZLATITUDE, ZLONGITUDE,
      ZDATECREATED, ZADDEDDATE, ZMODIFICATIONDATE,
      ZDIRECTORY, ZFILENAME, ZUNIFORMTYPEIDENTIFIER, ZUUID)
     VALUES (?, 3, ?, ?, ?, 1, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    pk,
    opts.kind ?? 0,
    opts.width ?? 4032,
    opts.height ?? 3024,
    opts.favorite ? 1 : 0,
    opts.hidden ? 1 : 0,
    opts.trashed ? 1 : 0,
    opts.duration ?? 0,
    opts.latitude ?? null,
    opts.longitude ?? null,
    toMacTime(opts.dateCreated),
    toMacTime(opts.dateAdded ?? opts.dateCreated),
    toMacTime(opts.dateCreated),
    dir,
    opts.filename,
    opts.uti ?? "public.jpeg",
    uuid,
  );

  // Additional attributes
  const aPk = ++attrPk;
  db.query(
    `INSERT INTO ZADDITIONALASSETATTRIBUTES
     (Z_PK, ZASSET, ZORIGINALFILENAME, ZTITLE, ZORIGINALFILESIZE)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    aPk,
    pk,
    opts.originalFilename ?? opts.filename,
    opts.title ?? null,
    opts.fileSize ?? 2500000,
  );

  // Internal resource (for local availability)
  const rPk = ++resPk;
  db.query(
    `INSERT INTO ZINTERNALRESOURCE
     (Z_PK, ZASSET, ZRESOURCETYPE, ZDATASTORESUBTYPE, ZLOCALAVAILABILITY)
     VALUES (?, ?, 0, 1, ?)`,
  ).run(rPk, pk, opts.locallyAvailable !== false ? 1 : -1);

  return pk;
}

// --- Photo 1: Vacation sunset (favorite, with GPS) ---
const sunset = insertAsset({
  filename: "IMG_0001.JPG",
  width: 4032,
  height: 3024,
  favorite: true,
  latitude: 37.7749,
  longitude: -122.4194,
  dateCreated: twoMonthsAgo,
  originalFilename: "IMG_0001.JPG",
  title: "Sunset at the Beach",
  fileSize: 5200000,
});

// --- Photo 2: Portrait photo ---
const portrait = insertAsset({
  filename: "IMG_0002.HEIC",
  uti: "public.heic",
  width: 3024,
  height: 4032,
  dateCreated: lastMonth,
  originalFilename: "IMG_0002.HEIC",
  title: "Portrait",
  fileSize: 3100000,
});

// --- Photo 3: Video ---
const video = insertAsset({
  filename: "IMG_0003.MOV",
  kind: 1,
  uti: "com.apple.quicktime-movie",
  width: 1920,
  height: 1080,
  duration: 15.5,
  dateCreated: lastWeek,
  originalFilename: "IMG_0003.MOV",
  title: "Birthday Party",
  fileSize: 45000000,
});

// --- Photo 4: Screenshot (hidden) ---
const screenshot = insertAsset({
  filename: "Screenshot_2025.png",
  uti: "public.png",
  width: 1284,
  height: 2778,
  hidden: true,
  dateCreated: yesterday,
  originalFilename: "Screenshot 2025-06-14.png",
  fileSize: 850000,
});

// --- Photo 5: iCloud-only photo (not locally available) ---
const icloudOnly = insertAsset({
  filename: "IMG_0005.JPG",
  width: 4032,
  height: 3024,
  dateCreated: lastYear,
  dateAdded: lastYear,
  originalFilename: "IMG_0005.JPG",
  title: "Old Vacation",
  fileSize: 4800000,
  locallyAvailable: false,
});

// --- Photo 6: Recent favorite ---
const recentFav = insertAsset({
  filename: "IMG_0006.HEIC",
  uti: "public.heic",
  width: 4032,
  height: 3024,
  favorite: true,
  latitude: 40.7128,
  longitude: -74.006,
  dateCreated: now,
  originalFilename: "IMG_0006.HEIC",
  title: "NYC Skyline",
  fileSize: 6100000,
});

// --- Photo 7: Trashed photo (should not appear in queries) ---
insertAsset({
  filename: "IMG_TRASHED.JPG",
  trashed: true,
  dateCreated: lastMonth,
});

// ============================================================================
// Albums
// ============================================================================

let albumPk = 0;

function insertAlbum(opts: {
  title: string;
  kind?: number; // 2=user, 4000=smart
  photoIds: number[];
  createdAt: Date;
}): number {
  const pk = ++albumPk;
  const kind = opts.kind ?? 2;
  db.query(
    `INSERT INTO ZGENERICALBUM
     (Z_PK, Z_ENT, ZKIND, ZTRASHEDSTATE, ZCACHEDCOUNT, ZTITLE, ZUUID, ZCREATIONDATE, ZLASTMODIFIEDDATE)
     VALUES (?, 33, ?, 0, ?, ?, ?, ?, ?)`,
  ).run(
    pk,
    kind,
    opts.photoIds.length,
    opts.title,
    `album-uuid-${pk}`,
    toMacTime(opts.createdAt),
    toMacTime(opts.createdAt),
  );

  for (const photoId of opts.photoIds) {
    db.query(
      "INSERT INTO Z_33ASSETS (Z_33ALBUMS, Z_3ASSETS, Z_FOK_3ASSETS) VALUES (?, ?, ?)",
    ).run(pk, photoId, photoId);
  }

  return pk;
}

// --- Album 1: Vacation ---
insertAlbum({
  title: "Vacation 2025",
  photoIds: [sunset, icloudOnly],
  createdAt: twoMonthsAgo,
});

// --- Album 2: Favorites (smart album) ---
insertAlbum({
  title: "Best Shots",
  kind: 4000,
  photoIds: [sunset, recentFav],
  createdAt: lastMonth,
});

// --- Album 3: Empty album ---
insertAlbum({
  title: "To Sort",
  photoIds: [],
  createdAt: lastWeek,
});

// ============================================================================
// Done
// ============================================================================

db.close();
console.log(`Created test Photos database at ${DB_PATH}`);
console.log(`Assets created: ${assetPk} (including 1 trashed)`);
console.log(`Albums created: ${albumPk}`);
console.log("Photos: sunset (fav+gps), portrait, video, screenshot (hidden), iCloud-only, NYC (fav+gps), trashed");
console.log("Albums: Vacation 2025, Best Shots (smart), To Sort (empty)");
