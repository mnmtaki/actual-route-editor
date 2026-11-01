# ARA Java backend — accounts and cloud saves

Java 21 / Spring Boot / Spring Security / PostgreSQL / Flyway.

## Local launch
Create the `actual_route` PostgreSQL database and a database user. Set
`DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD`,
`ARA_CORS_ORIGIN=http://localhost:5173`, and `ARA_COOKIE_SECURE=false`
for HTTP-only local development. Then run `mvn spring-boot:run` from server/.
Run the editor with `npm run dev` from repository root.

Production MUST use HTTPS, `ARA_COOKIE_SECURE=true` and one trusted
`ARA_CORS_ORIGIN`. Cookies use host-only scope, SameSite=Lax, path=/.
The browser uses credentials: include and sends X-ARA-CSRF for writes.
The HttpOnly session cookie is never exposed to JavaScript, and neither
bearer tokens nor credentials are stored in localStorage. Refreshing the page
restores the login via GET /api/auth/me. Sessions expire after 7 days;
logout deletes the server token.

## Routes
POST /api/auth/register — username and password
POST /api/auth/login — sets HttpOnly ara_session + readable ara_csrf cookie
GET /api/auth/me — returns userId while the cookie is valid
POST /api/auth/logout — revokes session, clears cookies
GET /api/projects — user's projects
POST /api/projects — create project
GET /api/projects/{uuid} — load (owner or invited editor)
GET /api/projects/{uuid}/members — list owner and invited editors
POST /api/projects/{uuid}/members — owner invites existing username
DELETE /api/projects/{uuid}/members/{userId} — owner removes collaborator
PUT /api/projects/{uuid} — require expectedRevision for atomic CAS save
GET /api/projects/{uuid}/revisions — list ten most recent snapshots
GET /api/projects/{uuid}/revisions/{revision} — download a retained snapshot
POST /api/projects/{uuid}/restore — sourceRevision + expectedRevision, restores as a NEW revision
DELETE /api/projects/{uuid} — delete

## Safeguards
- Password hashes use BCrypt. Session tokens are generated using SecureRandom;
  the database stores only SHA-256 hashes.
- Unsafe requests are checked with X-ARA-CSRF matched against a CSRF cookie
  and a per-session SHA-256 hash in PostgreSQL. Browser Origin, if sent,
  must match the configured trusted frontend origin.
- PostgreSQL-backed fixed-window throttling: login 8 attempts per username
  per 15m and 50 per remote IP per 15m; register 5 per IP per hour.
  Remote IP is taken directly from the socket: do not place the service
  behind an untrusted proxy; configure proxy source IP handling separately.
- Project reads and CAS saves are scoped to the owner or explicitly invited
  editors. Only owners may manage collaborators, delete a cloud project, or
  restore its history. Version conflicts return HTTP 409 without overwriting
  a newer save.

## Boundaries
- Cloud saves remain opt-in and do not replace browser IndexedDB saves.
- This version does not include password recovery, multi-device management,
  email verification, operation-based real-time collaboration or automatic
  per-edit cloud syncing.
- CSRF cookie is JS-readable by design; its session binding in PostgreSQL
  prevents arbitrary cookie spoofing. XSS prevention still matters.
- Configure a trusted proxy, API request size limits and cleanup for expired
  session/rate-limit rows before a public deployment.

## History retention
- Every successful cloud save and restore creates a full immutable JSONB snapshot.
- Each project keeps the latest **10** snapshots; older ones are automatically
  deleted in the same transaction as the save/restore.
- Revision numbers are NEVER reused or renumbered. Saving v13 yields v14
  even after pruning v1–v4. Fetching a pruned revision returns 404.
- Restoring a retained snapshot appends a new latest revision, then prunes
  the oldest snapshot. `expectedRevision` continues to enforce concurrency.
- Flyway migration V4 prunes existing histories above ten snapshots per project.
  This removal is irreversible; export any important older revisions before upgrading.
- There is no pinned/milestone version support yet: **all** versions, including
  manually saved and restored versions, count toward the ten-snapshot limit.
- Local IndexedDB saves and downloaded JSON backups are unaffected.

## Initial multi-user editing (revision-level collaboration)
1. Owner creates a cloud project in the editor project library.
2. Owner expands **共享成员** and invites a registered username.
3. Both owner and invited editor can see the cloud project; choose **进入协同编辑**.
4. A **separate local IndexedDB copy** is created for each editor. Local drawing
   is not automatically published. Press **发布当前画布** to save the entire JSON
   against the revision that was loaded.
5. Every ~4 seconds the browser polls the project revision. On a new version,
   an update indicator appears. Press **加载云端最新版** to load it into the
   current canvas. If local changes exist, the editor warns before replacing them.
6. If another editor published first, the stale writer's PUT returns HTTP 409.
   The client preserves its local working copy and does **not** overwrite remote.
7. Owner can revoke access immediately for subsequent server operations.

This is **NOT** pixel-level/cursor-level multiplayer or an OT/CRDT merge:
remote changes are shown after saving and refreshing, and concurrent edits to
different stations are not automatically merged. Only owner may restore an old
history snapshot or delete the shared project. All existing revision retention
rules (10 snapshots) still apply.
