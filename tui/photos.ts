import type { Album, PhotoMeta, Photos } from "../src/photos/index.ts";
import {
  type AppState,
  bodyRows,
  highlightLine,
  hyperlink,
  moveTo,
  photoAlbumPanelWidth,
  photoDetailPanelWidth,
  photoListPanelWidth,
  scrollIntoView,
  term,
  totalCols,
  truncate,
  visibleLength,
} from "./helpers.ts";

// ── Actions ─────────────────────────────────────────────────────────────────

export function loadPhotosForAlbum(state: AppState, photosDb: Photos) {
  const ps = state.photosState;
  if (ps.albumIndex === 0) {
    ps.photos = ps.allPhotos;
  } else {
    const album = ps.albums[ps.albumIndex - 1];
    if (album) {
      ps.photos = photosDb.photos({ albumId: album.id });
    }
  }
  ps.photoIndex = 0;
  ps.photoScroll = 0;
  state.statusMessage = "";
  loadSelectedPhoto(state, photosDb);
}

function loadSelectedPhoto(state: AppState, photosDb: Photos) {
  const ps = state.photosState;
  const photo = ps.photos[ps.photoIndex];
  if (!photo) {
    ps.detailLines = [];
    ps.detailScroll = 0;
    return;
  }
  ps.detailScroll = 0;
  try {
    const details = photosDb.getPhoto(photo.id);
    const lines: string[] = [];
    const w = Math.max(20, photoDetailPanelWidth() - 2);

    // Filename header
    lines.push(`${term.bold}${truncate(details.filename, w)}${term.reset}`);
    lines.push(
      `${term.fg.gray}${details.mediaType === "video" ? "Video" : "Photo"}  ${details.width}×${details.height}${term.reset}`,
    );
    if (details.title) {
      lines.push(`${term.fg.cyan}${truncate(details.title, w)}${term.reset}`);
    }
    lines.push("");

    // Dates
    lines.push(`${term.bold}Date${term.reset}`);
    lines.push(
      `  Created: ${details.dateCreated.toLocaleDateString()} ${details.dateCreated.toLocaleTimeString()}`,
    );
    lines.push(
      `  Added: ${details.dateAdded.toLocaleDateString()} ${details.dateAdded.toLocaleTimeString()}`,
    );
    lines.push("");

    // Location
    if (details.latitude != null && details.longitude != null) {
      lines.push(`${term.bold}Location${term.reset}`);
      lines.push(
        `  ${details.latitude.toFixed(4)}, ${details.longitude.toFixed(4)}`,
      );
      lines.push("");
    }

    // File info
    lines.push(`${term.bold}File${term.reset}`);
    if (details.originalFilename) {
      lines.push(`  Original: ${truncate(details.originalFilename, w - 12)}`);
    }
    lines.push(`  Type: ${details.uniformTypeIdentifier}`);
    if (details.fileSize != null) {
      const mb = (details.fileSize / 1024 / 1024).toFixed(1);
      lines.push(`  Size: ${mb} MB`);
    }
    if (details.mediaType === "video" && details.duration > 0) {
      const min = Math.floor(details.duration / 60);
      const sec = Math.floor(details.duration % 60);
      lines.push(`  Duration: ${min}:${sec.toString().padStart(2, "0")}`);
    }
    const photoUrl = photosDb.getPhotoUrl(photo.id);
    const filePath = photoUrl.url.replace("file://", "");
    const displayPath = truncate(filePath, w - 8);
    lines.push(`  Path: ${hyperlink(photoUrl.url, displayPath)}`);
    lines.push("");

    // Flags
    const flags: string[] = [];
    if (details.favorite)
      flags.push(`${term.fg.yellow}\u2605 Favorite${term.reset}`);
    if (details.hidden) flags.push(`${term.fg.gray}\u25CF Hidden${term.reset}`);
    if (details.locallyAvailable) {
      flags.push(`${term.fg.green}\u2713 Local${term.reset}`);
    } else {
      flags.push(`${term.fg.blue}\u2601 iCloud${term.reset}`);
    }
    if (flags.length > 0) {
      lines.push(flags.join("  "));
    }

    ps.detailLines = lines;
  } catch {
    ps.detailLines = [
      "",
      `  ${term.fg.red}Error loading photo details${term.reset}`,
    ];
  }
}

export function selectAlbum(state: AppState, photosDb: Photos, index: number) {
  const ps = state.photosState;
  const maxIndex = ps.albums.length; // +1 for "All Photos" row at index 0
  const result = scrollIntoView(index, ps.albumScroll, maxIndex, bodyRows());
  ps.albumIndex = result.index;
  ps.albumScroll = result.scroll;
  loadPhotosForAlbum(state, photosDb);
}

function selectPhoto(state: AppState, photosDb: Photos, index: number) {
  const ps = state.photosState;
  const result = scrollIntoView(
    index,
    ps.photoScroll,
    ps.photos.length - 1,
    bodyRows(),
  );
  ps.photoIndex = result.index;
  ps.photoScroll = result.scroll;
  loadSelectedPhoto(state, photosDb);
}

// ── Drawing ─────────────────────────────────────────────────────────────────

export function drawPhotosTab(state: AppState): string {
  const ps = state.photosState;
  const tc = totalCols();
  const aw = photoAlbumPanelWidth();
  const plw = photoListPanelWidth();
  const dw = photoDetailPanelWidth();
  const br = bodyRows();

  let buf = "";

  // Header
  const albumsLabel =
    ps.focus === "albums"
      ? `${term.underline}Albums${term.reset}${term.inverse}${term.bold}`
      : "Albums";
  const photosLabel =
    ps.focus === "photos"
      ? `${term.underline}Photos${term.reset}${term.inverse}${term.bold}`
      : "Photos";
  const detailsLabel =
    ps.focus === "details"
      ? `${term.underline}Details${term.reset}${term.inverse}${term.bold}`
      : "Details";
  const headerText = ` ${albumsLabel} \u2192 ${photosLabel} \u2192 ${detailsLabel} `;
  const headerVis = visibleLength(headerText);
  buf += `${term.inverse}${term.bold}${headerText}${" ".repeat(Math.max(0, tc - headerVis))}${term.reset}`;

  // Body rows
  for (let row = 0; row < br; row++) {
    buf += moveTo(row + 2, 0);

    // Albums panel
    const albumIdx = row + ps.albumScroll;
    const totalAlbumItems = ps.albums.length + 1;
    if (albumIdx < totalAlbumItems) {
      const isSelected = albumIdx === ps.albumIndex;
      const isFocused = ps.focus === "albums";

      let line: string;
      if (albumIdx === 0) {
        line = ` \u25C6 All Photos (${ps.allPhotos.length})`;
      } else {
        const album = ps.albums[albumIdx - 1] as Album;
        const kindTag = album.kind === "smart" ? "\u2606" : "\u25B8";
        line = ` ${kindTag} ${album.title} (${album.photoCount})`;
      }

      buf += highlightLine(line, aw, isSelected, isFocused);
    } else {
      buf += " ".repeat(aw);
    }

    buf += `${term.dim}\u2502${term.reset}`;

    // Photo list panel
    const photoIdx = row + ps.photoScroll;
    if (photoIdx < ps.photos.length) {
      const photo = ps.photos[photoIdx] as PhotoMeta;
      const isSelected = photoIdx === ps.photoIndex;
      const isFocused = ps.focus === "photos";

      const fav = photo.favorite ? `${term.fg.yellow}\u2605${term.reset} ` : "";
      const typeIcon = photo.mediaType === "video" ? "\u25B6 " : "";
      const date = photo.dateCreated.toLocaleDateString();
      const name = truncate(photo.filename, Math.max(5, plw - 16));
      const line = ` ${fav}${typeIcon}${name} ${term.dim}${date}${term.reset}`;

      buf += highlightLine(line, plw, isSelected, isFocused);
    } else {
      buf += " ".repeat(plw);
    }

    buf += `${term.dim}\u2502${term.reset}`;

    // Details panel
    const detailIdx = row + ps.detailScroll;
    if (detailIdx >= 0 && detailIdx < ps.detailLines.length) {
      const line = ps.detailLines[detailIdx] as string;
      buf += ` ${truncate(line, dw - 1)}`;
    }
  }

  return buf;
}

// ── Input ───────────────────────────────────────────────────────────────────

export function handlePhotosInput(
  state: AppState,
  photosDb: Photos,
  s: string,
) {
  const ps = state.photosState;
  const maxDetailScroll = Math.max(0, ps.detailLines.length - bodyRows());

  switch (s) {
    case "\x1b[D": // Left arrow
      if (ps.focus === "details") ps.focus = "photos";
      else if (ps.focus === "photos") ps.focus = "albums";
      break;
    case "\x1b[C": // Right arrow
      if (ps.focus === "albums") ps.focus = "photos";
      else if (ps.focus === "photos") ps.focus = "details";
      break;
    case "\x1b[A": // Up
      if (ps.focus === "albums")
        selectAlbum(state, photosDb, ps.albumIndex - 1);
      else if (ps.focus === "photos")
        selectPhoto(state, photosDb, ps.photoIndex - 1);
      else ps.detailScroll = Math.max(0, ps.detailScroll - 1);
      break;
    case "\x1b[B": // Down
      if (ps.focus === "albums")
        selectAlbum(state, photosDb, ps.albumIndex + 1);
      else if (ps.focus === "photos")
        selectPhoto(state, photosDb, ps.photoIndex + 1);
      else ps.detailScroll = Math.min(maxDetailScroll, ps.detailScroll + 1);
      break;
    case "\x1b[5~": // Page Up
      if (ps.focus === "albums")
        selectAlbum(state, photosDb, ps.albumIndex - bodyRows());
      else if (ps.focus === "photos")
        selectPhoto(state, photosDb, ps.photoIndex - bodyRows());
      else ps.detailScroll = Math.max(0, ps.detailScroll - bodyRows());
      break;
    case "\x1b[6~": // Page Down
      if (ps.focus === "albums")
        selectAlbum(state, photosDb, ps.albumIndex + bodyRows());
      else if (ps.focus === "photos")
        selectPhoto(state, photosDb, ps.photoIndex + bodyRows());
      else
        ps.detailScroll = Math.min(
          maxDetailScroll,
          ps.detailScroll + bodyRows(),
        );
      break;
    case "j":
      ps.detailScroll = Math.min(maxDetailScroll, ps.detailScroll + 1);
      break;
    case "k":
      ps.detailScroll = Math.max(0, ps.detailScroll - 1);
      break;
    case "J":
      ps.detailScroll = Math.min(maxDetailScroll, ps.detailScroll + bodyRows());
      break;
    case "K":
      ps.detailScroll = Math.max(0, ps.detailScroll - bodyRows());
      break;
    case "\r":
    case "o": {
      const photo = ps.photos[ps.photoIndex];
      if (!photo) {
        state.statusMessage = "No photo selected";
        break;
      }
      try {
        const photoUrl = photosDb.getPhotoUrl(photo.id);
        if (!photoUrl.locallyAvailable) {
          state.statusMessage =
            "Photo is in iCloud only — not available locally";
          break;
        }
        const filePath = photoUrl.url.replace("file://", "");
        Bun.spawn(["open", filePath]);
        state.statusMessage = `Opened: ${photo.filename}`;
      } catch {
        state.statusMessage = "Could not open photo";
      }
      break;
    }
  }
}

// ── Search ──────────────────────────────────────────────────────────────────

export function doPhotosSearch(state: AppState, photosDb: Photos) {
  const query = state.searchQuery.trim();
  state.searchMode = false;
  if (!query) {
    loadPhotosForAlbum(state, photosDb);
    state.statusMessage = "";
    return;
  }
  state.photosState.photos = photosDb.search(query);
  state.statusMessage = `${state.photosState.photos.length} photo${state.photosState.photos.length === 1 ? "" : "s"} matching "${query}"`;
  state.photosState.photoIndex = 0;
  state.photosState.photoScroll = 0;
  loadSelectedPhoto(state, photosDb);
}
