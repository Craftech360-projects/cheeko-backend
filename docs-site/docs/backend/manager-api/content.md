---
id: content
sidebar_position: 5
---

# Content Endpoints

Music, stories, and educational content management. Base path: `/toy/content`.

Content is organized in two layers:

- **Content Library** (`/content/library`) — the unified catalog of individual content items (music tracks, story audio files). This is the primary system.
- **Legacy routes** (`/content/music/*`, `/content/story/*`) — older per-type endpoints kept for compatibility.

Most read endpoints use `requireFlexAuth` (accepts Firebase ID token or admin custom token). Write/delete operations require admin auth.

## Endpoint Summary

### Content Library

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/toy/content/library` | FlexAuth | List library items (paginated, filterable) |
| `GET` | `/toy/content/library/search` | FlexAuth | Full-text search |
| `GET` | `/toy/content/library/categories` | FlexAuth | List categories with counts |
| `GET` | `/toy/content/library/statistics` | FlexAuth | Aggregate statistics |
| `POST` | `/toy/content/library/batch` | Admin | Batch create items |
| `POST` | `/toy/content/library/upload` | Admin | Upload audio/image file to S3 |
| `GET` | `/toy/content/library/:id` | FlexAuth | Get single item by ID |
| `POST` | `/toy/content/library` | Admin | Create single item |
| `PUT` | `/toy/content/library/:id` | Admin | Update item |
| `DELETE` | `/toy/content/library/:id` | Admin | Delete item |

### Music (legacy)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/toy/content/music/list` | None | List music (paginated) |
| `GET` | `/toy/content/music/:id` | None | Get music by ID |
| `POST` | `/toy/content/music/create` | User | Create music entry |
| `PUT` | `/toy/content/music/update/:id` | User | Update music entry |

---

## Content Library

### GET `/toy/content/library`

Returns paginated content items with optional filters.

#### Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `limit` | integer | `10` | Items per page |
| `contentType` | string | — | Filter: `music` or `story` |
| `category` | string | — | Filter by category (language/genre) |
| `isActive` | boolean | — | Filter by active status |

#### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "list": [
      {
        "id": "uuid",
        "title": "Twinkle Twinkle",
        "romanized": "twinkle twinkle",
        "filename": "twinkle_twinkle.mp3",
        "contentType": "music",
        "category": "English",
        "alternatives": ["twinkle", "star song"],
        "awsS3Url": "https://cdn.example.com/music/twinkle_twinkle.mp3",
        "durationSeconds": 120,
        "fileSizeBytes": 1920000,
        "isActive": 1,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "total": 250,
    "page": 1,
    "limit": 10
  }
}
```

---

### GET `/toy/content/library/search`

Full-text search across title, romanized title, and alternative search terms.

#### Query Parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | Yes | Search query (min 2 characters) |
| `page` | integer | No | Default `1` |
| `limit` | integer | No | Default `20` |
| `contentType` | string | No | Filter: `music` or `story` |
| `category` | string | No | Filter by category |

Returns `400` if `q` is shorter than 2 characters.

---

### GET `/toy/content/library/categories`

Returns all categories with item counts.

#### Query Parameters

| Param | Description |
|---|---|
| `contentType` | Optional. Filter by `music` or `story` |

#### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": [
    { "category": "English", "contentType": "music", "count": 45 },
    { "category": "Hindi", "contentType": "music", "count": 30 },
    { "category": "Bedtime", "contentType": "story", "count": 20 }
  ]
}
```

---

### GET `/toy/content/library/statistics`

Returns aggregate counts for the library.

#### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "total": 350,
    "byType": {
      "music": 200,
      "story": 150
    },
    "byCategory": {
      "English": 100,
      "Hindi": 80,
      "Bedtime": 50
    }
  }
}
```

---

### POST `/toy/content/library/upload`

Uploads an audio or image file to AWS S3 via multipart form data. Returns the CloudFront URL for the uploaded file.

#### Request (multipart/form-data)

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | binary | Yes | Audio file (mp3, wav, ogg, m4a) or image (jpeg, png, gif, webp) or `.bin` file. Max 50 MB. |
| `contentType` | string | Yes | `music`, `story`, or `rfidcontent` |
| `category` | string | No | Category/language (defaults to `"English"`) |

#### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "url": "https://cdn.example.com/music/english/twinkle_twinkle.mp3",
    "filename": "twinkle_twinkle.mp3"
  }
}
```

---

### POST `/toy/content/library`

Creates a new content item record (after uploading the file separately).

#### Request

```json
{
  "title": "Twinkle Twinkle",
  "romanized": "twinkle twinkle",
  "filename": "twinkle_twinkle.mp3",
  "contentType": "music",
  "category": "English",
  "alternatives": ["twinkle", "star song"],
  "awsS3Url": "https://cdn.example.com/music/english/twinkle_twinkle.mp3",
  "durationSeconds": 120,
  "fileSizeBytes": 1920000,
  "isActive": 1
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Display title |
| `romanized` | string | No | Romanized/transliterated title for search |
| `filename` | string | No | Original filename |
| `contentType` | string | Yes | `music` or `story` |
| `category` | string | No | Language/genre category |
| `alternatives` | string[] | No | Alternative search terms |
| `awsS3Url` | string | No | S3/CDN URL for the audio file |
| `durationSeconds` | integer | No | Audio duration |
| `fileSizeBytes` | integer | No | File size in bytes |
| `isActive` | integer | No | `1` = active (default), `0` = inactive |

---

### POST `/toy/content/library/batch`

Creates multiple content items in a single request. Each item in the `items` array uses the same fields as the single create endpoint.

#### Request

```json
{
  "items": [
    {
      "title": "Twinkle Twinkle",
      "contentType": "music",
      "category": "English",
      "awsS3Url": "https://cdn.example.com/music/twinkle.mp3"
    },
    {
      "title": "The Three Little Pigs",
      "contentType": "story",
      "category": "Bedtime"
    }
  ]
}
```

#### Response

```json
{
  "code": 0,
  "msg": "Successfully created 2 content items",
  "data": { "created": 2 }
}
```

---

### PUT `/toy/content/library/:id`

Updates an existing library item. All fields optional; only provided fields are updated. Returns `404` if item does not exist.

---

### DELETE `/toy/content/library/:id`

Deletes a library item. Returns `404` if item does not exist.

---

## Music (Legacy Routes)

### GET `/toy/content/music/list`

#### Query Parameters

| Param | Description |
|---|---|
| `page` | Page number (default `1`) |
| `limit` | Items per page (default `10`) |
| `category` | Filter by category |
| `language` | Filter by language |

### POST `/toy/content/music/create`

#### Request

```json
{
  "title": "Song Title",
  "artist": "Artist Name",
  "album": "Album Name",
  "category": "English",
  "language": "en",
  "duration": 180,
  "fileUrl": "https://cdn.example.com/song.mp3",
  "coverUrl": "https://cdn.example.com/cover.jpg",
  "lyrics": "La la la..."
}
```

### PUT `/toy/content/music/update/:id`

Updates fields on an existing music record. Same body shape as create; all fields optional.
