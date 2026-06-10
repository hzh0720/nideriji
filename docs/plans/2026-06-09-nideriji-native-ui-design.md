# 你的日记 Lite Native UI Design

## Goal

Replace the official-webpage shell with a custom client UI while keeping official server APIs as the source of truth.

## App Structure

The Android side is a thin WebView container that loads `file:///android_asset/app.html`. It exposes a small `NideRijiLite` JavaScript bridge:

- `requestAsync(callbackId, requestJson)` for official API calls;
- `imageAsync(callbackId, token, userId, imageId)` for authenticated image reads;
- `toast(message)` for native toast feedback.

The UI is fully local and lives in `app.html`, `app.css`, and `app.js`.

## Navigation

The app uses three bottom tabs:

- Write: a WYSIWYG editor with title, format toolbar, local image preview, author color context, and local draft persistence.
- Timeline: mixed two-person diary stream with owner colors, smooth entry animation, search, filters, and detail sheet.
- Profile: login/token management, sync, color customization for both people, cache clearing, and placeholders for original profile features whose fields still need confirmation.

## Data Flow

The app uses official endpoints where known:

- `POST /api/login/` with `email` and `password`;
- `POST /api/v2/sync/` for own/paired overview data and image indexes;
- `POST /api/diary/all_by_ids/{userId}/` for full diary detail;
- `GET https://f.nideriji.cn/api/image/{userId}/{imageId}/` for image display;
- `POST /api/write/` for text-only save attempt.

The local app stores UI preferences, colors, token, drafts, and timeline cache in WebView localStorage/sessionStorage.

## Known Gaps

Official image upload fields are still unknown, so the editor supports image preview but blocks saving drafts that contain local images. This prevents silent data loss.

Some profile features from the original app, such as signature/theme image, are visible as entries but not wired until request fields are confirmed.

