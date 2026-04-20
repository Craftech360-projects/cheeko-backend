# Creator Content Portal Plan

## Goal

Build a separate web portal for Cheeko content creators where they can either upload their own `audio + cover image` or generate new content using the existing `content-poc` pipeline patterns. In both cases, content must stay in an internal review state until a reviewer explicitly clicks `Upload to AWS`, at which point the existing backend upload and content-pack creation flow is used.

## Context

This plan is based on the current behavior already present in the repository:

- `content-poc/app.py` provides a working internal generation UI for plan creation, asset generation, and export.
- `content-poc/exporters.py` already knows how to push generated assets through the backend and create content packs.
- `main/manager-api-node/src/routes/content.routes.js` exposes `/content/library/upload`.
- `main/manager-api-node/src/services/upload.service.js` already uploads files to S3/CloudFront under `music/`, `stories/`, and `rfidcontent/`.
- `main/manager-api-node/src/routes/rfid.routes.js` already exposes content-pack creation endpoints.

The plan below deliberately reuses those backend contracts instead of creating a second AWS upload path.

## Product Decisions Confirmed

- Creator uploads in v1:
  - Audio file
  - Cover image
- App shape:
  - Separate portal, not part of the existing `manager-web`
- Publishing rule:
  - Generated and uploaded content must wait for manual review
  - A reviewer must click a visible `Upload to AWS` button

## Scope

### In Scope

- Separate creator portal frontend
- Creator authentication and access control
- Audio + cover image upload flow
- AI generation flow based on `content-poc`
- Draft, review, approved, rejected, uploaded states
- Manual `Upload to AWS` action from review/detail view
- Content history for creators
- Review queue for admins/reviewers
- Reuse of current backend S3 upload and content-pack registration flow

### Out of Scope

- Auto-upload after generation
- Uploading extra asset types in v1 beyond audio and cover image
- Full moderation tooling beyond simple review states and reviewer notes
- Folding this portal into `manager-web`
- Replacing the generation models/prompts in `content-poc` during the first release

## High-Level Architecture

### Frontend

Create a new standalone web app for creators and reviewers.

Recommended structure:

- `creator-portal`
  - Login
  - Creator dashboard
  - Upload content form
  - Generate content form
  - My submissions list
  - Submission detail page
  - Reviewer queue
  - Review/detail page with `Upload to AWS`

Suggested stack:

- Frontend: React + Vite or Next.js
- UI: simple internal admin-style component library
- Auth: token-based auth against `manager-api-node`
- File upload: multipart upload to portal backend endpoints

### Backend

Extend `manager-api-node` with creator-portal APIs rather than sending the portal directly to AWS.

The backend will handle:

- Draft content records
- File staging
- Review actions
- Manual AWS upload
- Content-pack creation after upload

### Generation Worker

Move the reusable logic from `content-poc` into service/worker-style backend code so the portal can:

- Create generation jobs
- Poll status
- Preview outputs
- Retry failed generation steps

The portal should not depend on Streamlit or local session state.

## Core Workflow

### Flow A: Creator Uploads Their Own Content

1. Creator logs in.
2. Creator opens `Upload Content`.
3. Creator enters metadata:
   - Title
   - Content type
   - Language
   - Description
4. Creator uploads:
   - One audio file
   - One cover image
5. System stores the submission as `draft`.
6. Creator submits it for review.
7. Reviewer opens the item in `Review Queue`.
8. Reviewer checks metadata and previews the assets.
9. Reviewer marks it `approved` or `rejected`.
10. If approved, reviewer clicks `Upload to AWS`.
11. Backend uploads assets to S3 using the existing upload service.
12. Backend stores returned URLs and optionally creates/links the content pack.
13. Submission moves to `uploaded`.

### Flow B: Creator Generates New Content

1. Creator logs in.
2. Creator opens `Generate Content`.
3. Creator enters the topic and generation settings.
4. Backend starts a generation job using extracted `content-poc` logic.
5. Generated outputs are saved as internal draft assets only.
6. Creator previews and edits metadata.
7. Creator submits the generated content for review.
8. Reviewer opens the item in `Review Queue`.
9. Reviewer checks the generated content.
10. Reviewer approves or rejects it.
11. If approved, reviewer clicks `Upload to AWS`.
12. Backend uploads assets to S3 and creates/links the pack.
13. Submission moves to `uploaded`.

## Roles and Permissions

### Creator

Can:

- Create draft uploads
- Start generation jobs
- View their own submissions
- Edit draft metadata before review
- Submit draft for review
- View review status and reviewer notes

Cannot:

- Upload directly to AWS
- Approve content
- See other creators' submissions unless explicitly allowed

### Reviewer

Can:

- View review queue
- Preview all submitted assets
- Approve or reject submissions
- Add review notes
- Click `Upload to AWS`
- Retry failed upload if needed

### Admin

Can:

- Manage reviewers and creators
- View all submissions
- Override stuck states
- Reprocess failed jobs

## Data Model

Add database tables or equivalent models for creator portal content management.

### Table: `creator_content`

Purpose:

- One row per submission, whether uploaded or generated

Suggested fields:

- `id`
- `title`
- `description`
- `content_type`
- `language`
- `source_type` (`upload` or `generated`)
- `status` (`draft`, `in_review`, `approved`, `rejected`, `uploading`, `uploaded`, `failed`)
- `creator_id`
- `reviewer_id`
- `review_notes`
- `pack_code`
- `aws_uploaded_at`
- `created_at`
- `updated_at`

### Table: `creator_content_assets`

Purpose:

- Store asset references for each submission

Suggested fields:

- `id`
- `creator_content_id`
- `asset_type` (`audio`, `cover_image`)
- `storage_type` (`local`, `draft_bucket`, `aws`)
- `local_path`
- `aws_url`
- `mime_type`
- `original_filename`
- `generated_step` nullable
- `created_at`

### Table: `generation_jobs`

Purpose:

- Track async generation requests

Suggested fields:

- `id`
- `creator_content_id`
- `topic`
- `requested_by`
- `job_status` (`queued`, `running`, `succeeded`, `failed`)
- `job_payload`
- `result_summary`
- `error_message`
- `started_at`
- `completed_at`

### Table: `creator_content_audit_log`

Purpose:

- Audit every important action

Suggested fields:

- `id`
- `creator_content_id`
- `actor_id`
- `action`
- `details`
- `created_at`

## Content States

Define a strict workflow to avoid accidental upload:

- `draft`
  - Initial save
  - Can still be edited by creator
- `in_review`
  - Creator has submitted for review
  - Reviewer action required
- `approved`
  - Reviewer accepts content quality
  - Not yet uploaded to AWS
- `rejected`
  - Reviewer rejects content
  - Creator must revise/resubmit
- `uploading`
  - `Upload to AWS` button was pressed and backend is processing
- `uploaded`
  - AWS upload succeeded and URLs are persisted
- `failed`
  - Upload or generation failed
  - Can be retried

Important rule:

- No asset may move to AWS unless state is `approved` and a reviewer explicitly triggers upload.

## Backend API Plan

Add dedicated creator portal routes in `manager-api-node`.

### Creator APIs

- `POST /creator/content`
  - Create draft submission
- `POST /creator/content/:id/assets`
  - Upload draft audio/cover image
- `PUT /creator/content/:id`
  - Update metadata while editable
- `POST /creator/content/:id/submit-review`
  - Move content to `in_review`
- `GET /creator/content/my`
  - List creator-owned content
- `GET /creator/content/:id`
  - Submission detail

### Generation APIs

- `POST /creator/generation`
  - Start generation job and create linked draft content
- `GET /creator/generation/:jobId`
  - Fetch job status
- `POST /creator/generation/:jobId/retry`
  - Retry failed generation

### Reviewer APIs

- `GET /review/content`
  - Review queue
- `GET /review/content/:id`
  - Review detail
- `POST /review/content/:id/approve`
  - Approve content
- `POST /review/content/:id/reject`
  - Reject content with notes
- `POST /review/content/:id/upload`
  - Manual AWS upload action

### Admin APIs

- `POST /admin/creator/content/:id/retry-upload`
  - Retry failed AWS upload
- `POST /admin/creator/content/:id/rebuild-pack`
  - Recreate linked pack if needed

## AWS Upload Strategy

Reuse the existing backend upload path already present in the repo.

### Current Reusable Path

- Portal reviewer clicks `Upload to AWS`
- Backend loads the internal draft asset
- Backend calls existing upload logic from `upload.service.js`
- Backend receives CloudFront URL
- Backend persists returned URLs

### Folder Mapping

Keep the same mapping conventions as the existing system:

- `music/...`
- `stories/...`
- `rfidcontent/...`

Final folder mapping should remain centralized in backend code rather than duplicated in the frontend.

## Content-Pack Strategy

After successful AWS upload:

- For simple uploaded creator content:
  - Either create a single-item content pack
  - Or create a content library item and optionally wrap it as a pack

- For generated multi-step content:
  - Use the same pack-style export pattern already implemented in `content-poc/exporters.py`

Suggested rule:

- Uploaded creator content:
  - single content item + optional pack wrapper
- Generated story/routine/song bundles:
  - content pack by default

## Frontend Screens

### 1. Login

- Email/password
- Role-aware redirect

### 2. Creator Dashboard

- Summary counts:
  - Draft
  - In review
  - Approved
  - Uploaded
  - Rejected
- Quick actions:
  - Upload content
  - Generate content

### 3. Upload Content

Fields:

- Title
- Description
- Content type
- Language
- Audio upload
- Cover image upload

Actions:

- Save draft
- Submit for review

### 4. Generate Content

Fields:

- Topic
- Content type
- Language
- Optional generation settings

Actions:

- Start generation
- View progress
- Save draft
- Submit for review

### 5. My Content

Table or cards showing:

- Title
- Type
- Source (`upload` or `generated`)
- Status
- Last updated
- Reviewer note indicator

### 6. Submission Detail

Sections:

- Metadata
- Audio preview
- Cover image preview
- History/audit trail
- Review notes

### 7. Review Queue

Columns:

- Title
- Creator
- Type
- Source
- Submitted at
- Status

Actions:

- Open review
- Approve
- Reject

### 8. Review Detail

Sections:

- Metadata
- Asset preview
- Reviewer notes
- Approve button
- Reject button
- `Upload to AWS` button visible only when approved and not yet uploaded

## Generation Refactor Plan

The current `content-poc` implementation is useful but not web-portal-ready because it is tightly coupled to Streamlit session state and local file output. Refactor it into reusable services.

### Extractable Parts

- Planning logic
- Writing logic
- Visual prompt generation
- Audio generation
- Image generation
- Export packaging logic

### Refactor Target

Create backend service modules such as:

- `generation/planner.service.js` or Python worker equivalent
- `generation/audio.service.js`
- `generation/image.service.js`
- `generation/export.service.js`
- `generation/job-runner.js`

### Output Handling

Instead of writing only to ad hoc local folders, write to:

- structured draft storage
- linked DB records
- generation job records

## Validation Plan

### Upload Path Validation

Verify:

- Creator can upload audio + cover image
- Draft is stored correctly
- Reviewer can approve it
- `Upload to AWS` sends files to S3
- Returned CloudFront URLs are stored
- Content status becomes `uploaded`

### Generation Path Validation

Verify:

- Creator can start generation
- Job status updates correctly
- Generated draft assets are viewable before upload
- Reviewer can approve generated result
- `Upload to AWS` uses existing backend upload path
- Content pack creation succeeds

### Security Validation

Verify:

- Creator cannot upload to AWS directly
- Creator cannot approve their own content unless explicitly allowed
- Reviewer-only upload endpoint is protected
- Creators can only see their own submissions

## Implementation Phases

## Phase 1: Backend Foundation

Goal:

- Add data models, roles, and basic draft APIs

Tasks:

- Add creator/reviewer role handling
- Add `creator_content` and related tables
- Add draft CRUD APIs
- Add audit logging

Done when:

- Draft content can be created, edited, and queried by owner

## Phase 2: Separate Portal MVP

Goal:

- Ship the standalone portal shell and creator upload flow

Tasks:

- Scaffold separate frontend app
- Add auth
- Add dashboard
- Add upload form for audio + cover image
- Add my content list/detail

Done when:

- A creator can submit upload-based content into review state

## Phase 3: Reviewer Workflow

Goal:

- Add approval, rejection, and manual AWS upload

Tasks:

- Add review queue UI
- Add approve/reject actions
- Add `Upload to AWS` endpoint
- Reuse existing upload service
- Persist AWS URLs and upload state

Done when:

- A reviewer can manually push approved content to AWS from the portal

## Phase 4: Generation Integration

Goal:

- Bring `content-poc` generation into the portal workflow

Tasks:

- Extract generation logic from Streamlit app
- Add job runner/status endpoints
- Add generation UI
- Save generated assets as drafts
- Support reviewer upload after approval

Done when:

- Generated content follows the same review-before-upload lifecycle

## Phase 5: Pack Creation and Hardening

Goal:

- Finalize content-pack integration and production readiness

Tasks:

- Link uploaded/generated assets into packs
- Add retries for failed uploads
- Improve audit history
- Add better validation and error messaging
- Add smoke tests for both flows

Done when:

- End-to-end creator and reviewer workflows are stable and support pack publishing

## Risks and Mitigations

### Risk: Generation code remains tightly coupled to Streamlit

Mitigation:

- Treat `content-poc` as reference logic
- Extract service boundaries before portal integration

### Risk: Review and upload states become inconsistent

Mitigation:

- Enforce state transitions in backend only
- Record every action in audit log

### Risk: Duplicate AWS upload logic appears in multiple places

Mitigation:

- Keep all S3 uploads centralized in the existing upload service layer

### Risk: Generated outputs are too slow for synchronous web requests

Mitigation:

- Run generation asynchronously with job polling

## Recommended First Build Slice

The best first slice is:

1. Separate portal app shell
2. Creator upload of audio + cover image
3. Review queue
4. Reviewer `Upload to AWS` button

This gives immediate business value and proves the portal, permissions, and AWS flow before generation is added.

## Done When

- A creator can upload audio and cover image in a separate portal
- A reviewer can approve or reject the submission
- Approved content is not uploaded automatically
- A reviewer can manually click `Upload to AWS`
- Backend reuses the existing AWS upload service
- Uploaded assets receive persisted CloudFront URLs
- Generated content later follows the exact same manual-review-upload workflow
