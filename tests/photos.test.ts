import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Photos } from "../src/index.ts";
import {
  AlbumNotFoundError,
  PhotoNotFoundError,
} from "../src/photos/errors.ts";

const FIXTURE_DB = resolve(
  import.meta.dir,
  "fixtures/photos-library/database/Photos.sqlite",
);

function idOf<T extends { id: number }>(item: T | undefined): number {
  if (!item) throw new Error("Expected item to be defined");
  return item.id;
}

let db: Photos;

beforeAll(() => {
  db = new Photos({ dbPath: FIXTURE_DB });
});

afterAll(() => {
  db.close();
});

// ============================================================================
// photos()
// ============================================================================

describe("photos", () => {
  test("returns all visible non-hidden photos by default", () => {
    const photos = db.photos();
    // 10 total - 1 trashed - 1 hidden = 8
    expect(photos).toHaveLength(8);
  });

  test("excludes trashed photos", () => {
    const photos = db.photos();
    const filenames = photos.map((p) => p.filename);
    expect(filenames).not.toContain("IMG_TRASHED.JPG");
  });

  test("excludes hidden photos by default", () => {
    const photos = db.photos();
    expect(photos.every((p) => !p.hidden)).toBe(true);
  });

  test("includes hidden photos when hidden=true", () => {
    const photos = db.photos({ hidden: true });
    expect(photos.some((p) => p.hidden)).toBe(true);
  });

  test("defaults to sorting by dateCreated descending (newest first)", () => {
    const photos = db.photos();
    const dates = photos.map((p) => p.dateCreated.getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeLessThanOrEqual(dates[i - 1] as number);
    }
  });

  test("sorts by dateCreated ascending", () => {
    const photos = db.photos({ order: "asc" });
    const dates = photos.map((p) => p.dateCreated.getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1] as number);
    }
  });

  test("filters by mediaType=photo", () => {
    const photos = db.photos({ mediaType: "photo" });
    expect(photos.every((p) => p.mediaType === "photo")).toBe(true);
    expect(photos.length).toBeGreaterThan(0);
  });

  test("filters by mediaType=video", () => {
    const photos = db.photos({ mediaType: "video" });
    expect(photos.every((p) => p.mediaType === "video")).toBe(true);
    expect(photos).toHaveLength(2);
  });

  test("filters by favorite=true", () => {
    const photos = db.photos({ favorite: true });
    expect(photos.every((p) => p.favorite)).toBe(true);
    expect(photos).toHaveLength(2);
  });

  test("filters by date range", () => {
    const after = new Date("2025-06-01T00:00:00Z");
    const before = new Date("2025-06-10T00:00:00Z");
    const photos = db.photos({ afterDate: after, beforeDate: before });
    for (const p of photos) {
      expect(p.dateCreated.getTime()).toBeGreaterThanOrEqual(after.getTime());
      expect(p.dateCreated.getTime()).toBeLessThanOrEqual(before.getTime());
    }
  });

  test("filters by albumId", () => {
    const albums = db.albums();
    const vacation = albums.find((a) => a.title === "Vacation 2025");
    expect(vacation).toBeDefined();

    const photos = db.photos({ albumId: idOf(vacation) });
    expect(photos).toHaveLength(2);
  });

  test("limit restricts result count", () => {
    const limited = db.photos({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  test("photos have dates as Date objects", () => {
    const photos = db.photos();
    for (const p of photos) {
      expect(p.dateCreated).toBeInstanceOf(Date);
      expect(p.dateAdded).toBeInstanceOf(Date);
      expect(p.dateCreated.getTime()).toBeGreaterThan(0);
    }
  });

  test("photos have GPS coordinates when available", () => {
    const photos = db.photos({ favorite: true });
    const withGps = photos.filter((p) => p.latitude !== null);
    expect(withGps.length).toBeGreaterThan(0);
    for (const p of withGps) {
      expect(p.latitude).toBeTypeOf("number");
      expect(p.longitude).toBeTypeOf("number");
    }
  });
});

// ============================================================================
// getPhoto()
// ============================================================================

describe("getPhoto", () => {
  test("returns full details for a photo", () => {
    const photos = db.photos();
    const sunset = photos.find((p) => p.filename === "IMG_0001.JPG");
    expect(sunset).toBeDefined();

    const details = db.getPhoto(idOf(sunset));
    expect(details.filename).toBe("IMG_0001.JPG");
    expect(details.width).toBe(4032);
    expect(details.height).toBe(3024);
    expect(details.title).toBe("Sunset at the Beach");
    expect(details.originalFilename).toBe("IMG_0001.JPG");
    expect(details.fileSize).toBe(5200000);
    expect(details.favorite).toBe(true);
    expect(details.locallyAvailable).toBe(true);
  });

  test("returns video details with duration", () => {
    const photos = db.photos({ mediaType: "video" });
    const vid = photos[0];
    expect(vid).toBeDefined();

    const details = db.getPhoto(idOf(vid));
    expect(details.mediaType).toBe("video");
    expect(details.duration).toBe(15.5);
  });

  test("iCloud-only photo shows locallyAvailable=false", () => {
    const photos = db.photos();
    const old = photos.find((p) => p.filename === "IMG_0005.JPG");
    expect(old).toBeDefined();

    const details = db.getPhoto(idOf(old));
    expect(details.locallyAvailable).toBe(false);
  });

  test("video with locally available master stream returns locallyAvailable=true", () => {
    // The fixture inserts a poster row (ZRESOURCETYPE=0) with availability=-1
    // for this video, so a passing assertion proves the query selects the
    // master row (ZRESOURCETYPE=1) rather than the poster.
    const videos = db.photos({ mediaType: "video" });
    const local = videos.find((v) => v.filename === "IMG_0003.MOV");
    expect(local).toBeDefined();

    const details = db.getPhoto(idOf(local));
    expect(details.locallyAvailable).toBe(true);
  });

  test("iCloud-only video shows locallyAvailable=false", () => {
    const videos = db.photos({ mediaType: "video" });
    const remote = videos.find((v) => v.filename === "IMG_0008.MOV");
    expect(remote).toBeDefined();

    const details = db.getPhoto(idOf(remote));
    expect(details.locallyAvailable).toBe(false);
  });

  test("stale metadata: DB flag=1 but file missing → locallyAvailable=false", () => {
    // Issue #35: Apple's "Optimize Mac Storage" can purge a file without
    // flipping ZLOCALAVAILABILITY. The fixture inserts ZLOCALAVAILABILITY=1
    // for IMG_STALE.JPG but does not create the placeholder file on disk.
    const photos = db.photos();
    const stale = photos.find((p) => p.filename === "IMG_STALE.JPG");
    expect(stale).toBeDefined();

    const details = db.getPhoto(idOf(stale));
    expect(details.locallyAvailable).toBe(false);
  });

  test("throws PhotoNotFoundError for missing photo", () => {
    expect(() => db.getPhoto(99999)).toThrow(PhotoNotFoundError);
  });
});

// ============================================================================
// getPhotoUrl()
// ============================================================================

describe("getPhotoUrl", () => {
  test("returns file URL for a photo", () => {
    const photos = db.photos();
    const sunset = photos.find((p) => p.filename === "IMG_0001.JPG");
    expect(sunset).toBeDefined();

    const result = db.getPhotoUrl(idOf(sunset));
    expect(result.url).toStartWith("file://");
    expect(result.url).toContain("originals/0/IMG_0001.JPG");
    expect(result.locallyAvailable).toBe(true);
  });

  test("iCloud-only photo has locallyAvailable=false", () => {
    const photos = db.photos();
    const old = photos.find((p) => p.filename === "IMG_0005.JPG");
    expect(old).toBeDefined();

    const result = db.getPhotoUrl(idOf(old));
    expect(result.locallyAvailable).toBe(false);
  });

  test("video with locally available master stream has locallyAvailable=true", () => {
    const videos = db.photos({ mediaType: "video" });
    const local = videos.find((v) => v.filename === "IMG_0003.MOV");
    expect(local).toBeDefined();

    const result = db.getPhotoUrl(idOf(local));
    expect(result.url).toContain("originals/0/IMG_0003.MOV");
    expect(result.locallyAvailable).toBe(true);
  });

  test("iCloud-only video has locallyAvailable=false", () => {
    const videos = db.photos({ mediaType: "video" });
    const remote = videos.find((v) => v.filename === "IMG_0008.MOV");
    expect(remote).toBeDefined();

    const result = db.getPhotoUrl(idOf(remote));
    expect(result.locallyAvailable).toBe(false);
  });

  test("stale metadata: DB flag=1 but file missing → locallyAvailable=false", () => {
    // Issue #35: ZLOCALAVAILABILITY can lag behind Apple's storage purges.
    // The library must stat the constructed path and override the flag when
    // the file is gone.
    const photos = db.photos();
    const stale = photos.find((p) => p.filename === "IMG_STALE.JPG");
    expect(stale).toBeDefined();

    const result = db.getPhotoUrl(idOf(stale));
    expect(result.url).toContain("originals/0/IMG_STALE.JPG");
    expect(result.locallyAvailable).toBe(false);
  });

  test("syndicated photo (ZBUNDLESCOPE=3) resolves to scopes/syndication/originals", () => {
    // Issue #40: "Shared with You" assets live under scopes/syndication/
    // originals/, not the main originals/ tree. The constructed path must
    // honor ZBUNDLESCOPE so locallyAvailable stays true for these.
    const photos = db.photos();
    const syndicated = photos.find((p) => p.filename === "IMG_SYNDICATED.JPG");
    expect(syndicated).toBeDefined();

    const result = db.getPhotoUrl(idOf(syndicated));
    expect(result.url).toContain(
      "scopes/syndication/originals/0/IMG_SYNDICATED.JPG",
    );
    expect(result.locallyAvailable).toBe(true);
  });

  test("throws PhotoNotFoundError for missing photo", () => {
    expect(() => db.getPhotoUrl(99999)).toThrow(PhotoNotFoundError);
  });
});

// ============================================================================
// albums()
// ============================================================================

describe("albums", () => {
  test("returns all albums", () => {
    const albums = db.albums();
    expect(albums).toHaveLength(3);
  });

  test("albums have photo counts", () => {
    const albums = db.albums();
    const vacation = albums.find((a) => a.title === "Vacation 2025");
    expect(vacation?.photoCount).toBe(2);

    const empty = albums.find((a) => a.title === "To Sort");
    expect(empty?.photoCount).toBe(0);
  });

  test("albums have correct kind", () => {
    const albums = db.albums();
    const smart = albums.find((a) => a.title === "Best Shots");
    expect(smart?.kind).toBe("smart");

    const user = albums.find((a) => a.title === "Vacation 2025");
    expect(user?.kind).toBe("user");
  });

  test("albums are sorted by title", () => {
    const albums = db.albums();
    const titles = albums.map((a) => a.title);
    const sorted = [...titles].sort((a, b) => a.localeCompare(b));
    expect(titles).toEqual(sorted);
  });

  test("search filters by title", () => {
    const albums = db.albums({ search: "vacation" });
    expect(albums).toHaveLength(1);
    expect(albums[0]?.title).toBe("Vacation 2025");
  });

  test("limit restricts result count", () => {
    const limited = db.albums({ limit: 1 });
    expect(limited).toHaveLength(1);
  });
});

// ============================================================================
// getAlbum()
// ============================================================================

describe("getAlbum", () => {
  test("returns album with photo IDs", () => {
    const albums = db.albums();
    const vacation = albums.find((a) => a.title === "Vacation 2025");
    expect(vacation).toBeDefined();

    const details = db.getAlbum(idOf(vacation));
    expect(details.title).toBe("Vacation 2025");
    expect(details.photoIds).toHaveLength(2);
  });

  test("empty album has empty photoIds array", () => {
    const albums = db.albums();
    const empty = albums.find((a) => a.title === "To Sort");
    expect(empty).toBeDefined();

    const details = db.getAlbum(idOf(empty));
    expect(details.photoIds).toHaveLength(0);
  });

  test("throws AlbumNotFoundError for missing album", () => {
    expect(() => db.getAlbum(99999)).toThrow(AlbumNotFoundError);
  });
});

// ============================================================================
// search()
// ============================================================================

describe("search", () => {
  test("finds photos by title", () => {
    const results = db.search("Sunset");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.filename === "IMG_0001.JPG")).toBe(true);
  });

  test("finds photos by original filename", () => {
    const results = db.search("IMG_0002");
    expect(results.length).toBeGreaterThan(0);
  });

  test("search is case-insensitive", () => {
    const results = db.search("sunset");
    expect(results.length).toBeGreaterThan(0);
  });

  test("filters by mediaType", () => {
    const results = db.search("IMG", { mediaType: "video" });
    expect(results.every((r) => r.mediaType === "video")).toBe(true);
  });

  test("respects limit", () => {
    const results = db.search("IMG", { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("returns empty for non-matching query", () => {
    const results = db.search("xyznonexistent999");
    expect(results).toHaveLength(0);
  });

  test("excludes hidden photos from search", () => {
    const results = db.search("Screenshot");
    expect(results).toHaveLength(0);
  });
});

// ============================================================================
// close()
// ============================================================================

describe("close", () => {
  test("does not throw", () => {
    const tempDb = new Photos({ dbPath: FIXTURE_DB });
    expect(() => tempDb.close()).not.toThrow();
  });
});
