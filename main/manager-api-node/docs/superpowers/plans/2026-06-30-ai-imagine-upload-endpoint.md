# AI Imagine — manager-api Upload Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated internal endpoint `POST /toy/imagine/upload` that accepts a JPEG (≤200 KB) from the mqtt-gateway (service-key auth), uploads it to S3 under an `imagine/` prefix with a random key, and returns the public CloudFront URL.

**Architecture:** A new `uploadImagineImage(fileBuffer)` function in the existing `upload.service.js` reuses the already-configured v3 S3 client. A new thin route module `imagine.routes.js` (multer memory storage, JPEG-only, 200 KB cap, `requireServiceKey`) calls it and returns the standard `{code,msg,data}` envelope. No DB persistence — the gateway owns the device-facing `image{url}` message. See line_art's [ADR-0001](../../../../../line_art/docs/adr/0001-imagine-image-delivery-via-gateway-upload.md) for why bytes flow gateway→manager-api rather than line_art uploading directly.

**Tech Stack:** Node.js 18+, Express, multer, `@aws-sdk/client-s3` v3, Jest + supertest.

## Global Constraints

- Endpoint: `POST /toy/imagine/upload`, guarded by **`requireServiceKey`** only (header `X-Service-Key` == env `SERVICE_SECRET_KEY`). No Firebase auth.
- Accept **only `image/jpeg`**, **≤ 200 KB** (`200 * 1024` bytes), multipart field name **`file`**.
- S3 key: **`imagine/<uuid>.jpg`** (random, unguessable). Reuse existing module-level `s3Client`, `S3_BUCKET`, `CLOUDFRONT_DOMAIN` in `upload.service.js`.
- Returned URL: **`https://${CLOUDFRONT_DOMAIN}/imagine/<uuid>.jpg`** (public via CloudFront; no ACL set, matching existing uploads). CacheControl `max-age=31536000`.
- Response envelope via `src/utils/response.js`: success → `success(res, {success:true, url, s3Key})`; client errors → `badRequest(res, msg)`.
- No Prisma/DB row (existing uploads don't persist either).
- Reuse existing patterns from `src/routes/content.routes.js` (multer config, `asyncHandler`, imports) and `src/services/upload.service.js` (PutObjectCommand usage). Do not modify `uploadContentFile` / `uploadThumbnail`.

---

### Task 1: `uploadImagineImage` service function

**Files:**
- Modify: `D:\cheeko-backend\main\manager-api-node\src\services\upload.service.js` (add `crypto` import, add function, add to `module.exports`)
- Test: `D:\cheeko-backend\main\manager-api-node\tests\unit\uploadImagine.test.js`

**Interfaces:**
- Consumes: module-level `s3Client`, `S3_BUCKET`, `CLOUDFRONT_DOMAIN`, and `PutObjectCommand` (all already in the file).
- Produces: `uploadImagineImage(fileBuffer: Buffer) -> Promise<{ success: true, url: string, s3Key: string }>` where `s3Key` matches `^imagine/[0-9a-f-]+\.jpg$` and `url === https://${CLOUDFRONT_DOMAIN}/${s3Key}`.

- [ ] **Step 1: Write the failing test**

```javascript
// D:\cheeko-backend\main\manager-api-node\tests\unit\uploadImagine.test.js
// Mock the v3 S3 SDK BEFORE requiring the service so the module-level client is the mock.
const sendMock = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: sendMock })),
  PutObjectCommand: jest.fn((input) => ({ __input: input })),
}));

const { PutObjectCommand } = require('@aws-sdk/client-s3');
const uploadService = require('../../src/services/upload.service');

describe('uploadImagineImage', () => {
  beforeEach(() => {
    sendMock.mockClear();
    PutObjectCommand.mockClear();
  });

  it('uploads a JPEG under the imagine/ prefix and returns a public CloudFront URL', async () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // minimal JPEG-ish bytes
    const result = await uploadService.uploadImagineImage(buf);

    // S3 was called once with a PutObjectCommand
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmdInput = PutObjectCommand.mock.calls[0][0];
    expect(cmdInput.Key).toMatch(/^imagine\/[0-9a-f-]+\.jpg$/);
    expect(cmdInput.ContentType).toBe('image/jpeg');
    expect(cmdInput.Body).toBe(buf);

    // Returned contract
    expect(result.success).toBe(true);
    expect(result.s3Key).toBe(cmdInput.Key);
    expect(result.url).toBe(`https://${process.env.CLOUDFRONT_DOMAIN || 'dsmzc13oafp54.cloudfront.net'}/${cmdInput.Key}`);
  });

  it('generates a unique key per call', async () => {
    const a = await uploadService.uploadImagineImage(Buffer.from([1]));
    const b = await uploadService.uploadImagineImage(Buffer.from([1]));
    expect(a.s3Key).not.toBe(b.s3Key);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/cheeko-backend/main/manager-api-node && npx jest tests/unit/uploadImagine.test.js`
Expected: FAIL — `uploadService.uploadImagineImage is not a function`

- [ ] **Step 3: Write minimal implementation**

In `src/services/upload.service.js`:

3a. Add near the top imports (after the existing `require` lines):
```javascript
const { randomUUID } = require('crypto');
```

3b. Add this function (do NOT modify `uploadContentFile`/`uploadThumbnail`). Use the SAME module-level identifiers those functions use (`s3Client`, `S3_BUCKET`, `CLOUDFRONT_DOMAIN`, `PutObjectCommand`):
```javascript
/**
 * AI Imagine: upload a generated JPEG to S3 under imagine/<uuid>.jpg and return
 * the public CloudFront URL. No DB persistence — caller (mqtt-gateway) owns the
 * device-facing image{url} message.
 */
async function uploadImagineImage(fileBuffer) {
  const s3Key = `imagine/${randomUUID()}.jpg`;
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'max-age=31536000',
  }));
  const url = `https://${CLOUDFRONT_DOMAIN}/${s3Key}`;
  return { success: true, url, s3Key };
}
```

3c. Add `uploadImagineImage` to the existing `module.exports` object (keep the existing exports; match the file's export style).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /d/cheeko-backend/main/manager-api-node && npx jest tests/unit/uploadImagine.test.js`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
cd /d/cheeko-backend/main/manager-api-node && git add src/services/upload.service.js tests/unit/uploadImagine.test.js && git commit -m "feat(imagine): uploadImagineImage S3 service (imagine/ prefix)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `POST /toy/imagine/upload` route

**Files:**
- Create: `D:\cheeko-backend\main\manager-api-node\src\routes\imagine.routes.js`
- Modify: `D:\cheeko-backend\main\manager-api-node\src\routes\index.js` (import + mount)
- Test: `D:\cheeko-backend\main\manager-api-node\tests\integration\imagine.test.js`

**Interfaces:**
- Consumes: `uploadService.uploadImagineImage(buffer)` (Task 1); `requireServiceKey` from `src/middleware/auth.js`; `success`/`badRequest` from `src/utils/response.js`; `asyncHandler` (import it the same way `content.routes.js` does — check that file's imports and mirror them).
- Produces: route `POST /upload` mounted at `/imagine` → full path `/toy/imagine/upload`. Success response `{code:0,msg:'success',data:{success:true,url,s3Key}}`.

- [ ] **Step 1: Write the failing test**

```javascript
// D:\cheeko-backend\main\manager-api-node\tests\integration\imagine.test.js
// Mock the upload service so no real S3 call happens.
jest.mock('../../src/services/upload.service', () => ({
  uploadImagineImage: jest.fn().mockResolvedValue({
    success: true,
    url: 'https://cdn.example.net/imagine/abc.jpg',
    s3Key: 'imagine/abc.jpg',
  }),
}));

const request = require('supertest');
const app = require('../../src/app');
const uploadService = require('../../src/services/upload.service');

const SERVICE_KEY = process.env.SERVICE_SECRET_KEY || 'test-service-key';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

describe('POST /toy/imagine/upload', () => {
  beforeEach(() => uploadService.uploadImagineImage.mockClear());

  it('rejects without a service key (401)', async () => {
    const res = await request(app)
      .post('/toy/imagine/upload')
      .attach('file', JPEG, { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
    expect(uploadService.uploadImagineImage).not.toHaveBeenCalled();
  });

  it('uploads a JPEG and returns the URL (200)', async () => {
    const res = await request(app)
      .post('/toy/imagine/upload')
      .set('X-Service-Key', SERVICE_KEY)
      .attach('file', JPEG, { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.url).toBe('https://cdn.example.net/imagine/abc.jpg');
    expect(uploadService.uploadImagineImage).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-JPEG file (400)', async () => {
    const res = await request(app)
      .post('/toy/imagine/upload')
      .set('X-Service-Key', SERVICE_KEY)
      .attach('file', Buffer.from('hello'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(uploadService.uploadImagineImage).not.toHaveBeenCalled();
  });

  it('rejects when no file is attached (400)', async () => {
    const res = await request(app)
      .post('/toy/imagine/upload')
      .set('X-Service-Key', SERVICE_KEY);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/cheeko-backend/main/manager-api-node && npx jest tests/integration/imagine.test.js`
Expected: FAIL — all 4 return 404 (route not mounted yet)

- [ ] **Step 3: Create the route module**

Create `src/routes/imagine.routes.js`. First open `src/routes/content.routes.js` and copy its exact import lines for `asyncHandler`, `success`, and `badRequest` (paths differ between repos — mirror the sibling). Then:

```javascript
const express = require('express');
const multer = require('multer');
const { requireServiceKey } = require('../middleware/auth');
// asyncHandler, success, badRequest: import exactly as content.routes.js does.
const uploadService = require('../services/upload.service');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 }, // 200 KB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/jpeg') return cb(null, true);
    cb(new Error('Only JPEG images are allowed'));
  },
});

// Wrap multer so size/mime errors become deterministic 400s instead of bubbling.
const uploadJpeg = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (err) return badRequest(res, err.message);
  next();
});

router.post('/upload', requireServiceKey, uploadJpeg, asyncHandler(async (req, res) => {
  if (!req.file) return badRequest(res, 'No file uploaded');
  const result = await uploadService.uploadImagineImage(req.file.buffer);
  return success(res, result);
}));

module.exports = router;
```

- [ ] **Step 4: Mount the route**

In `src/routes/index.js`:
- Add with the other route requires: `const imagineRoutes = require('./imagine.routes');`
- Add next to `router.use('/content', contentRoutes);`: `router.use('/imagine', imagineRoutes);`

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /d/cheeko-backend/main/manager-api-node && npx jest tests/integration/imagine.test.js`
Expected: PASS (4 passed)

- [ ] **Step 6: Run the focused suites to confirm no regression**

Run: `cd /d/cheeko-backend/main/manager-api-node && npx jest tests/integration/content.test.js tests/integration/imagine.test.js tests/unit/uploadImagine.test.js`
Expected: PASS (all green)

- [ ] **Step 7: Commit**

```bash
cd /d/cheeko-backend/main/manager-api-node && git add src/routes/imagine.routes.js src/routes/index.js tests/integration/imagine.test.js && git commit -m "feat(imagine): POST /toy/imagine/upload endpoint (service-key, jpeg<=200KB)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** dedicated endpoint ✓; service-key auth ✓; JPEG-only + 200 KB ✓; `imagine/<uuid>.jpg` random key ✓; public CloudFront URL ✓; standard envelope ✓; no DB ✓; reuses existing S3 client / patterns, existing uploads untouched ✓.
- **Placeholder scan:** the only deferred specifics are the `asyncHandler/success/badRequest` import paths, explicitly resolved by "mirror content.routes.js" (those paths are repo-local and verifiable in one Read) — not a logic placeholder.
- **Type consistency:** `uploadImagineImage(buffer) -> {success,url,s3Key}` produced in Task 1, consumed identically in Task 2's route and mocked with the same shape in Task 2's test.
