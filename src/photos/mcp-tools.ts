import { z } from "zod";
import {
  type McpServerInstance,
  readOnlyAnnotations,
  wrapTool,
} from "../mcp-helpers.ts";
import type { Photos } from "./photos.ts";

export const photosCapability = {
  name: "Apple Photos",
  description: "Read-only access to Apple Photos library on this Mac",
  tools: [
    "list_photos",
    "get_photo",
    "get_photo_url",
    "list_albums",
    "get_album",
    "search_photos",
  ],
  startWith: "list_albums or list_photos",
};

export function registerPhotosTools(
  server: McpServerInstance,
  photos: Photos,
): void {
  server.registerTool(
    "list_photos",
    {
      title: "List photos",
      description:
        "List photos and videos from the Apple Photos library with filtering by media type, favorites, date range, and album. Returns summary metadata (filename, dimensions, dates, GPS). Follow-up: use get_photo with a photoId for full details, or get_photo_url to get the file path.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        mediaType: z
          .enum(["photo", "video"])
          .optional()
          .describe("Filter by media type: 'photo' or 'video'."),
        favorite: z
          .boolean()
          .optional()
          .describe(
            "Filter to only favorites (true) or non-favorites (false).",
          ),
        hidden: z
          .boolean()
          .optional()
          .describe(
            "Include hidden photos. By default hidden photos are excluded.",
          ),
        albumId: z
          .number()
          .int()
          .optional()
          .describe(
            "Numeric album ID (from list_albums) to filter photos by album.",
          ),
        afterDate: z
          .string()
          .optional()
          .describe(
            "Only include photos created on or after this date (ISO 8601 string, e.g. '2024-01-01').",
          ),
        beforeDate: z
          .string()
          .optional()
          .describe(
            "Only include photos created on or before this date (ISO 8601 string, e.g. '2024-12-31').",
          ),
        sortBy: z
          .enum(["dateCreated", "dateAdded"])
          .optional()
          .describe("Field to sort results by. Defaults to 'dateCreated'."),
        order: z
          .enum(["asc", "desc"])
          .optional()
          .describe("Sort direction. Defaults to 'desc' (newest first)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum number of photos to return."),
      },
    },
    async ({
      mediaType,
      favorite,
      hidden,
      albumId,
      afterDate,
      beforeDate,
      sortBy,
      order,
      limit,
    }) =>
      wrapTool(
        () =>
          photos.photos({
            mediaType,
            favorite,
            hidden,
            albumId,
            afterDate: afterDate ? new Date(afterDate) : undefined,
            beforeDate: beforeDate ? new Date(beforeDate) : undefined,
            sortBy,
            order,
            limit,
          }),
        [
          {
            tool: "get_photo",
            description: "Get full photo details (EXIF, file size, etc.)",
          },
          {
            tool: "get_photo_url",
            description: "Get the file:// URL for a photo",
          },
        ],
      ),
  );

  server.registerTool(
    "get_photo",
    {
      title: "Get photo details",
      description:
        "Get full details for a photo including dimensions, dates, GPS coordinates, file size, original filename, title, and iCloud availability. Requires a photoId from list_photos or search_photos.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        photoId: z
          .number()
          .int()
          .describe(
            "Numeric photo ID (from list_photos or search_photos results).",
          ),
      },
    },
    async ({ photoId }) =>
      wrapTool(
        () => photos.getPhoto(photoId),
        [
          {
            tool: "get_photo_url",
            description: "Get the file:// URL for this photo",
          },
        ],
      ),
  );

  server.registerTool(
    "get_photo_url",
    {
      title: "Get photo file URL",
      description:
        "Get the local file:// URL for a photo's original file. Returns the path and whether the file is locally available (vs. only in iCloud). Requires a photoId from list_photos or search_photos.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        photoId: z
          .number()
          .int()
          .describe(
            "Numeric photo ID (from list_photos or search_photos results).",
          ),
      },
    },
    async ({ photoId }) => wrapTool(() => photos.getPhotoUrl(photoId)),
  );

  server.registerTool(
    "list_albums",
    {
      title: "List photo albums",
      description:
        "List user-created and smart albums from Apple Photos with photo counts. Filter by name search. Follow-up: use get_album to see photo IDs in an album, or list_photos with albumId to browse album contents.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe("Text to filter albums by title."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum number of albums to return."),
      },
    },
    async ({ search, limit }) =>
      wrapTool(
        () => photos.albums({ search, limit }),
        [
          {
            tool: "get_album",
            description: "Get album details and photo IDs",
          },
          {
            tool: "list_photos",
            description: "List photos filtered by album",
          },
        ],
      ),
  );

  server.registerTool(
    "get_album",
    {
      title: "Get album details",
      description:
        "Get details for an album including the list of photo IDs it contains. Requires an albumId from list_albums. Follow-up: use get_photo or get_photo_url with the returned photo IDs.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        albumId: z
          .number()
          .int()
          .describe("Numeric album ID (from list_albums results)."),
      },
    },
    async ({ albumId }) =>
      wrapTool(
        () => photos.getAlbum(albumId),
        [
          {
            tool: "get_photo",
            description: "Get full details for a photo in this album",
          },
          {
            tool: "get_photo_url",
            description: "Get the file:// URL for a photo",
          },
        ],
      ),
  );

  server.registerTool(
    "search_photos",
    {
      title: "Search photos",
      description:
        "Search photos by filename or title. Returns summary metadata for matches. Follow-up: use get_photo with a photoId for full details.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        query: z
          .string()
          .describe("Text to search for in filenames and titles."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Maximum number of results to return. Defaults to 50."),
        mediaType: z
          .enum(["photo", "video"])
          .optional()
          .describe("Filter results by media type."),
      },
    },
    async ({ query, limit, mediaType }) =>
      wrapTool(
        () => photos.search(query, { limit, mediaType }),
        [
          {
            tool: "get_photo",
            description: "Get full details for a matching photo",
          },
          {
            tool: "get_photo_url",
            description: "Get the file:// URL for a photo",
          },
        ],
      ),
  );
}
