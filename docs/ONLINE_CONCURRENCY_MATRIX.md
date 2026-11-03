# Actual Route Editor — Online Concurrency Contract

Branch: `feat/java-accounts-cloud-saves-20261101`

## Core contract

The ordinary editor toolbar is the write entry point. Independent browser tabs use per-tab sessionStorage outboxes, with migration from legacy localStorage journals. Operation-level changes
are serialized by a PostgreSQL project-row lock and logged with a stable
`operationId`; a stale operation may rebase only across a complete, provably
disjoint revision journal. Otherwise the server returns 409 and the client
retains its working copy. Whole-project PUT/restore is an explicit conflict
boundary, not an automatic three-way merge.

**Important: code and test cases committed ≠ CI or browser acceptance passed.**
All test results must be recorded from a real execution before release.

## Operation-pair matrix

| Concurrent operations | Desired policy | Implementation / test coverage |
|---|---|---|
| Two independent station creations | Merge; reject duplicate station ID | `concurrentIndependentStationRequestsSerializeWithoutLostUpdates` |
| Distinct station moves/renames | Merge | `twoEditorsMergeDisjointStationEditsButRejectOverlappingOrFullSaves` |
| Same-station edits | 409, never last-write-wins | Same test |
| Two distinct segment waypoint moves | Merge | `waypointOperationsMergeSeparateSegmentsButRejectOverlapAndFullSave` |
| Two changes to same segment's waypoints | 409 | Same test |
| Station rename + waypoint edit | Merge (non-geometric) | `endpointAndWaypointConflictsButDisjointStationCanRebase` |
| Segment endpoint station move + waypoint edit | 409 (geometry dependency) | Same test |
| Other station move + waypoint edit | Merge | Same test |
| New main line + new main line | Merge; server assigns unique line order | `independentLineCreationRebasesAndResolvesConcurrentOrdering` |
| Two regular new-line toolbar actions in different browser accounts | Merge, both rendered | `two editors create independent native lines concurrently through regular toolbar` |
| Two regular new-line toolbar actions in same-account tabs | Merge, per-tab outboxes | `same-account tabs keep independent pending operations during concurrent line creation` |
| Fast new-line creation + immediate first station on both clients | Must retain both lines/stations; test is expected to expose any compound-edit gap | `rapid native line creation then first station survives a concurrent peer line creation` (not executed) |
| New station / terminal append on independent lines | Merge | `differentLinesRebaseTopologyWhileSameLineAndFullSaveConflict` |
| Split a segment on line A + append new station on line B | Merge | `independentSplitAndNewStationRebaseAcrossLinesButRejectSameLine` |
| Same-line topology writes | 409 unless explicitly ordered by a fresh revision | Same tests |
| Cross-line append involving shared station | 409 | `crossLineExistingStationAppendConflictsWithSharedEndpoint` |
| Station move on line A + independent topology on line B (both orders) | Merge only if no shared endpoint/line membership | `unrelatedStationEditDoesNotBlockOtherLineTopologyButSameLineDoes`, `independentStationCanRebaseAfterTopologyButSharedEndpointCannot` |
| Delete middle station + other-line topology | Merge only if no shared station; otherwise 409 | `removeSharedMiddleStationKeepsGlobalStationForOtherLine` and line-journal dependency guard; pair E2E pending |
| Segment split + other-line waypoint | Merge only when line ownership is provable | Java dependency guard; pair E2E pending |
| Existing-station terminal append + unrelated station change | Merge only with proof of no shared endpoint | Java dependency guard; pair E2E pending |
| Station move vs waypoint edit on its endpoint (both orders) | 409 | `endpointAndWaypointConflictsButDisjointStationCanRebase` |
| Station rename vs waypoint edit on its endpoint (both orders) | Merge | Same Java test |
| Same station rename from two browser accounts | Exactly one 200, one 409; converge | `same-station concurrent writes produce one winner and never lose a version` |
| Existing topology first, unrelated station change later | Merge only after journal dependency proof | `independentStationCanRebaseAfterTopologyButSharedEndpointCannot` |
| Missing operation journal entry | 409, no revision change | `missingOperationJournalRevisionBlocksOtherwiseDisjointRebase` |
| Mid-session editor permission revoked | 404 on subsequent write, no revision change | `permissionRevocationRejectsStaleCollaboratorWriteWithoutAdvancingRevision` |
| Full document save/restore vs any stale operation | 409 (conflict boundary) | `differentLinesRebaseTopologyWhileSameLineAndFullSaveConflict`, waypoint/station tests |
| Unknown/legacy action or missing operation journal revision | 409 | Guarded by complete contiguous journal; fault-injection test pending |
| Same `operationId`, identical payload | Idempotent, no extra revision | Multiple Java IT cases |
| Same `operationId`, different payload | 409 | Multiple Java IT cases |
| Network response lost after server commit | Replay same operation ID | `pendingTopology.test.ts` + server idempotency; browser fault injection pending |
| New local drawing while prior request is in flight | Preserve local canvas; auto-continue only with safe proven merge | `collaborationRouting.test.ts`; `rapid native line creation then first station survives a concurrent peer line creation` (added, not executed) |
| New remote revision while local canvas is clean | Update canvas promptly | WebSocket + poll catch-up; E2E tests, missed-event test pending |
| New remote revision while local canvas is dirty | Do not replace locally; show recovery | `collaboration history and conflict recovery preserve the local canvas and export backup` |
| Permissions revoked while editing | Reject further writes; preserve local document | Auth/permission Java IT; browser race pending |
| Phase-owned terminal append, single unambiguous phase | Atomically update line, segment, relation and phase | `appendExistingStationUpdatesExactlyOneOpeningPhase` |
| Concurrent edits to same phase | 409 | Line-scoped conflict; explicit pair test pending |
| New native child branch (empty or seeded from existing parent station) | Atomic line + initial phase + optional membership; conflicting parent edits rejected | `seededBranchCreationAndContinuationAreAtomicAndIdempotent`, `collaborationRouting.test.ts` |
| Continuing native child branch with new stations | Atomic station + segment + phase membership | Same Java IT; client routing tests |
| Simple native loop closure (last station to first) | Atomic closing interval, no duplicate station; same-line concurrent closure rejected | `nativeLoopClosureAddsOneSegmentAndRejectsConcurrentDuplicate`, `collaborationRouting.test.ts` |
| Loop closure on line A + seeded child branch on independent parent B | Merge after line/parent dependency proof | `loop closure and independently seeded branch creation converge across browsers` (added, not executed) |
| Multi-object edit confined to one native line | Verified historical baseline, scoped three-way merge; no global overwrite | `LineCompoundMergeTest`, `lineCompoundMergesDisjointRemoteStationEditAndRejectsSameLineOverlap` |
| Compound edit touching multiple lines or global fields | Idempotent full-project atomic transaction with strict revision CAS; never infer independence | `projectAtomicCompoundIsIdempotentAndRejectsConcurrentWholeMapEdits` |
| Compound transaction with deleted or shared station | Reject unless independently covered by dedicated safe operation | `LineCompoundMergeTest`; extended scope pending |
| Arbitrary phase-history / AARC / imported geometry edits | Strict document CAS; never automatically replay unknown metadata | Routing exclusions; dedicated E2E pending |
| Multi-server WebSocket deployments | Database writes remain serialized; realtime delivery needs shared pubsub | **Not implemented**, 30s polling fallback only |
| Collaborative undo/redo vs other-editor changes | Compensating operations, no global rewind; only covered station actions | `collaborativeUndoRedoAffectsOnlyOwnStationAndRetainsOtherEditorsWork` |

## Release gate

1. Java 21/Maven test and PostgreSQL integration suite green.
2. TypeScript type-check and complete Vitest suite green.
3. Playwright E2E passing in two independent browser contexts and two
   same-account tabs.
4. Fault-injection cases: slow request, lost ACK, delayed WebSocket event,
   permission revocation, and two concurrent writes on shared station.
5. Confirm invariant: no accepted operation is silently lost, no rejected
   mutation overwrites local work, no duplicate idempotent operation revision.
6. Verify the branch head's CI run (older green runs do not certify this branch
   revision). Keep the branch unmerged until these conditions are met.

## Operational limits

This is a bounded operation journal protocol, **not CRDT/OT**. Native
single-line branch creation, seeded branches, loop closure, and bounded
single-line compound topology updates have explicit transaction paths.
For a compound operation the Java endpoint compares the supplied baseline
against a stored immutable revision, checks the *entire target line and its
station/segment/phase dependency closure*, and patches the latest document
without overwriting unrelated lines. The compound endpoint has an 800 KB
two-snapshot request limit and requires the historical baseline to remain
available (up to the retained snapshot window).

Automatic merging is **not** promised for arbitrary cross-line compound edits,
unbounded sequences, global settings, imported AARC metadata, historical phase
operations, or deletions of globally shared stations. For smaller maps, these
ordinary edits use `project.atomic`: a single version-checked, idempotent
all-or-nothing save that never partially applies a batch. Large maps retain
the legacy whole-document CAS fallback. Neither path automatically merges
overlapping multi-line changes. In-flight compound requests are tracked with
per-tab persisted operation IDs where within storage limits.

All newly added branch/loop/compound tests are **committed but unexecuted** in
this environment. Do not mark this release complete until the release gate
above passes.
