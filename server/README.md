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
GET /api/projects/{uuid} — load when effective view permission allows (including private grants)
PUT /api/projects/{uuid} — atomic CAS save by owner or effectively authorized editor
GET /api/projects/public — discover publicly shared projects
GET /api/projects/{uuid}/status — lightweight current revision and effective edit permission
WS /ws/projects/{uuid} — authenticated, edit-authorized revision notifications
POST /api/projects/{uuid}/operations — serialize isolated station.create/rename/move mutations (operationId, expectedRevision, station)
PUT /api/projects/{uuid}/visibility — owner sets private / public_view / public_edit
GET /api/projects/{uuid}/access-rules — owner lists specific user permissions
POST /api/projects/{uuid}/access-rules — owner sets an allow/deny rule by registered username
DELETE /api/projects/{uuid}/access-rules/{ruleId} — owner deletes a rule
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
- Private access can also be granted explicitly to specific registered accounts.
  Public viewing may be anonymous; cloud updates require login, CSRF, and effective
  edit permission. Only owners may change permissions, delete a project or restore
  its history. Version conflicts return HTTP 409 without overwriting newer saves.

## Boundaries
- Cloud saves remain opt-in and do not replace browser IndexedDB saves.
- This version does not include password recovery, multi-device management,
  email verification, operation-based real-time collaboration or automatic
  per-edit cloud syncing. WebSocket revision notifications are available.
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

## Public access and early collaboration

New projects default to `private`. Owners may change visibility at any time:
- `private`: owner only.
- `public_view`: anyone, including anonymous visitors, may view by shared link, browse and download a local copy. Only owner can publish.
- `public_edit`: anyone may view; any authenticated account may publish a complete working copy.

Visibility uses the database, not client-side controls. Owners alone may change
visibility, restore revisions or permanently delete projects. The old
invitation/member table is removed by Flyway V6 (existing invitations are
discarded). The old invitation API is no longer exposed.

The UI exposes sharing links (`?cloudProject=<uuid>`) and a public project
browser. Opening a shared project in the editor creates a distinct local
IndexedDB working copy. In collaborative mode, publishing uses expectedRevision
to reject stale writes. The editor uses an authenticated WebSocket connection
to receive committed revision notifications, with 30-second metadata polling
as fallback. No mouse/operation-level real-time merge is implemented yet.

## Per-user project access grants (Flyway V7)

The visibility selector remains a *default policy*; the owner can now add a
specific account's **allow** or **deny** rule for `view` or `edit`, without an
invitation acceptance flow or a secret token. Existing registered usernames
must be used. Rules are stored on the server and checked for project loading,
listing, history reads, and CAS cloud saves.

Precedence is:
1. The owner always has full access and alone controls visibility, access
   rules, restoration, and deletion.
2. An explicit per-user **view deny** blocks both viewing and editing.
3. An explicit per-user **edit allow** also permits viewing unless view was
   explicitly denied. An explicit edit deny blocks editing but may still
   allow viewing.
4. If no per-user rule applies, project visibility supplies defaults:
   private (owner only), public_view (anyone sees), public_edit
   (anyone sees, logged-in accounts may write).

A typical private collaboration uses `private` visibility plus an explicit
`edit allow` for each collaborator. Those users find the project in their
cloud project list once logged in, without invitations. Access can be revoked
by removing the explicit allow. Conversely, `public_edit` plus a user's
`edit deny` excludes that user while keeping public access for others.

Per-user rules are not an approval mechanism and do not provide true
operation-level real-time merge. CAS revisions still protect against
overwriting a newer version. V7 does not modify the ten-snapshot cap.

## Real-time revision notifications (single server)

The frontend connects to `/ws/projects/{uuid}` after opening an editable
shared project. This is a **server-to-client** channel, not an operation
replication protocol. Browser connections carry the HttpOnly session cookie
automatically: the handshake rejects untrusted `Origin`, unauthenticated
requests and accounts without effective `edit` permission. The server
rechecks the cookie session and edit permission on every broadcast and each
client `ping` (sent every 30 seconds), closing revoked connections.

After a cloud CAS save or restore, Spring transaction synchronization sends
`{"type":"revision","projectId":"...","revision":N}` **only after commit**.
Failed/conflicting writes send no event. On receiving a newer revision, clients
load the updated document automatically **only when the local working copy
matches its last acknowledged baseline**. If local edits are pending, the
client preserves them and surfaces a conflict/update notice instead.

The client reconnects with exponential backoff, and checks the lightweight
`GET /api/projects/{uuid}/status` every 30 seconds to recover missed events.
This implementation uses an in-process WebSocket room registry. Running
multiple API instances requires Redis pub/sub or another shared event bus and
additional session/routing verification. There is no automatic merging,
cursor sharing or pixel-level simultaneous drawing yet.

## Stage-one station operation collaboration (Flyway V8 + V9)

Three narrow commands are now supported: `station.create` (standalone,
unconnected stations only), `station.rename` (including foreign name and
existing name-history metadata), and `station.move` (world coordinates).
These commands are sent as authenticated HTTP requests and committed by the
Spring Boot server; other connected clients receive a WebSocket revision
announcement and fetch the latest project. This is not streaming pointer
movement and not a CRDT/OT merge.

The server takes a PostgreSQL row lock, checks effective edit permission,
validates the command, checks `expectedRevision`, and persists both the
resulting immutable project version and the operation ID in a single
transaction. Identical operation-ID retries are deduplicated; using the
same ID for different payloads returns 409. Stale versions return 409
without altering server state. Operation IDs are not truncated with the
ten-revision history; future retention policies must avoid compromising
retry semantics.

The React editor watches its existing history state and auto-submits only
when the *entire* difference from the loaded baseline is provably one of
these isolated station changes; a short debounce coalesces edits. Changes
to line station sequences, segments, waypoints, station styling, multiple
stations, or other metadata deliberately retain the manual full-document
CAS save path. The collaborative toolbar also provides a standalone station
creation action. Live edits are not allowed to overwrite a dirty local
working copy. If clients write concurrently, the stale writer must reconcile
or reload explicitly. Existing user permissions continue to apply.

## Disjoint-station merge and two-client verification

The operation endpoint now supports conservative rebasing: a stale station
operation may be committed against the newest project when **every**
intervening revision is an operation on a **different station ID**. The
project row lock serializes concurrent requests, while the operation journal
proves that no intervening full-document save, historical restoration,
unlogged revision or same-station change occurred. Any unsafe overlap still
returns HTTP 409. The rebased result retains all earlier station changes,
increments the authoritative revision and broadcasts the committed revision.
`expectedRevision` is still required: automatic merging applies only to
this narrow operation endpoint, never to whole-document PUT/restore.

In the React collaborative workspace, an isolated station edit is allowed to
submit even if another editor has already published an update. On successful
merge, the client replaces the unchanged local working state with the
authoritative merged response. If further local edits or an in-progress
drawing appeared during the request, the local state is left untouched and
an explicit reconcile notice appears.

Tests:
- `AccountsAndSavesIT` checks two independently authenticated editors,
  different-station stale operations, concurrent move/rename, same-station
  rejection, full-document save barriers, operation deduplication, and both
  clients receiving WebSocket notifications through simulated sessions.
- `LiveCollaborationIT` launches the real embedded Spring Boot HTTP and
  WebSocket server, connects two separate cookie-authenticated WebSocket
  clients, simultaneously sends station operations over HTTP and verifies
  each client receives committed version notifications and the merged state.
  These are **network-level integration tests**, not browser-UI E2E.
- Full browser canvas validation with two actual graphical browser contexts
  remains a separate acceptance step, as does CRDT/OT for topology editing.
