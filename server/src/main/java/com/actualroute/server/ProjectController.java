package com.actualroute.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final ProjectSocketHub socketHub;
    ProjectController(JdbcTemplate jdbc, ObjectMapper mapper, ProjectSocketHub socketHub) {
        this.jdbc = jdbc; this.mapper = mapper; this.socketHub = socketHub;
    }

    public record SaveRequest(@NotBlank @Size(max = 200) String name,
                              @NotNull JsonNode document,
                              Long expectedRevision) {}
    public record RestoreRequest(@NotNull Long sourceRevision, @NotNull Long expectedRevision) {}

    public record ProjectView(UUID id, String name, long revision, JsonNode document,
                              OffsetDateTime updatedAt, String visibility, boolean canEdit) {}

    public record Summary(UUID id, String name, long revision, OffsetDateTime updatedAt, String role, String visibility, boolean canEdit) {}
    public record VisibilityRequest(@NotNull String visibility) {}
    public record ProjectStatus(UUID id, String name, long revision, String visibility, boolean canEdit) {}
    public record RuleRequest(@NotBlank String username, @NotBlank String action, @NotNull Boolean allowed) {}
    public record AccessRule(UUID id, UUID userId, String username, String action, boolean allowed) {}
    public record RevisionSummary(long revision, String name, OffsetDateTime createdAt) {}
    public record RevisionView(long revision, String name, JsonNode document, OffsetDateTime createdAt) {}

    private String json(JsonNode value) {
        if (!value.isObject() || !value.has("stations") || !value.get("stations").isArray()
                || !value.has("lines") || !value.get("lines").isArray()
                || !value.has("geometry") || !value.get("geometry").isObject())
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "无效的 ActualRoute 工程");
        String text = value.toString();
        if (text.length() > 8_000_000)
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "工程超过 8MB 限额");
        return text;
    }

    private ProjectView view(ResultSet rs, int i) throws SQLException {
        try {
            return new ProjectView(rs.getObject("id", UUID.class), rs.getString("name"),
                    rs.getLong("revision"), mapper.readTree(rs.getString("document")),
                    rs.getObject("updated_at", OffsetDateTime.class), rs.getString("visibility"), rs.getBoolean("can_edit"));
        } catch (java.io.IOException e) { throw new SQLException(e); }
    }

    private RevisionView revisionView(ResultSet rs, int i) throws SQLException {
        try {
            return new RevisionView(rs.getLong("revision"), rs.getString("name"),
                    mapper.readTree(rs.getString("document")),
                    rs.getObject("created_at", OffsetDateTime.class));
        } catch (java.io.IOException e) { throw new SQLException(e); }
    }

    private void requireOwned(UUID user, UUID id) {
        var count = jdbc.queryForObject(
            "SELECT count(*) FROM cloud_projects WHERE id=? AND owner_id=?", Integer.class, id, user);
        if (count == null || count == 0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "工程不存在");
    }

    private boolean hasAccess(UUID user, UUID project, String action) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
            "SELECT COALESCE(project_can_access(?, ?, ?), false)", Boolean.class,
            project, user, action));
    }

    private void requireReadable(UUID user, UUID id) {
        if (!hasAccess(user, id, "view"))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "工程不存在");
    }

    private void requireWritable(UUID user, UUID id) {
        if (!hasAccess(user, id, "edit"))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "工程不存在");
    }

    @GetMapping("/{id}/access-rules")
    public List<AccessRule> rules(@AuthenticationPrincipal UUID user, @PathVariable UUID id) {
        requireOwned(user, id);
        return jdbc.query("""
            SELECT r.id,r.user_id,u.username,r.action,r.allowed
            FROM cloud_project_access_rules r
            JOIN app_users u ON u.id=r.user_id
            WHERE r.project_id=?
            ORDER BY u.username,r.action
            """, (rs,n) -> new AccessRule(rs.getObject("id",UUID.class),
                rs.getObject("user_id",UUID.class),rs.getString("username"),
                rs.getString("action"),rs.getBoolean("allowed")), id);
    }

    @PostMapping("/{id}/access-rules")
    @Transactional
    public AccessRule setRule(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                              @Valid @RequestBody RuleRequest input) {
        requireOwned(user, id);
        if (!List.of("view","edit").contains(input.action()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效的授权类型");
        var targets = jdbc.query("SELECT id,username FROM app_users WHERE username=?",
            (rs,n) -> new java.util.AbstractMap.SimpleEntry<>(
                rs.getObject("id",UUID.class),rs.getString("username")),input.username());
        if (targets.isEmpty())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"用户不存在");
        var target=targets.get(0);
        if (target.getKey().equals(user))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"所有者始终拥有工程权限");
        UUID ruleId=UUID.randomUUID();
        return jdbc.queryForObject("""
            INSERT INTO cloud_project_access_rules(id,project_id,user_id,action,allowed)
            VALUES(?,?,?,?,?)
            ON CONFLICT(project_id,user_id,action) DO UPDATE SET allowed=EXCLUDED.allowed
            RETURNING id,user_id,action,allowed
            """, (rs,n) -> new AccessRule(rs.getObject("id",UUID.class),
                rs.getObject("user_id",UUID.class),target.getValue(),
                rs.getString("action"),rs.getBoolean("allowed")),
                ruleId,id,target.getKey(),input.action(),input.allowed());
    }

    @DeleteMapping("/{id}/access-rules/{ruleId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void deleteRule(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                           @PathVariable UUID ruleId) {
        requireOwned(user,id);
        if (jdbc.update("DELETE FROM cloud_project_access_rules WHERE project_id=? AND id=?",
            id,ruleId)==0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"授权规则不存在");
    }

    @PutMapping("/{id}/visibility")
    @Transactional
    public Summary setVisibility(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                                  @Valid @RequestBody VisibilityRequest input) {
        if (!List.of("private", "public_view", "public_edit").contains(input.visibility()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效的工程访问权限");
        int changed = jdbc.update(
            "UPDATE cloud_projects SET visibility=? WHERE id=? AND owner_id=?",
            input.visibility(), id, user);
        if (changed == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"工程不存在");
        return jdbc.queryForObject("""
            SELECT id,name,revision,updated_at,visibility FROM cloud_projects WHERE id=?
            """, (rs,n) -> new Summary(rs.getObject("id",UUID.class),rs.getString("name"),
                rs.getLong("revision"),rs.getObject("updated_at",OffsetDateTime.class),
                "owner",rs.getString("visibility"),true), id);
    }

    @GetMapping("/public")
    public List<Summary> publicProjects(@AuthenticationPrincipal UUID user) {
        return jdbc.query("""
            SELECT id,name,revision,updated_at,visibility FROM cloud_projects
            WHERE visibility IN ('public_view','public_edit') AND project_can_access(id,?,'view')
            ORDER BY updated_at DESC LIMIT 100
            """, (rs,n) -> new Summary(rs.getObject("id",UUID.class),rs.getString("name"),
                rs.getLong("revision"),rs.getObject("updated_at",OffsetDateTime.class),
                "viewer",rs.getString("visibility"),hasAccess(user,rs.getObject("id",UUID.class),"edit")), user);
    }

    @GetMapping
    public List<Summary> list(@AuthenticationPrincipal UUID user) {
        return jdbc.query("""
            SELECT id,name,revision,updated_at,visibility,owner_id FROM cloud_projects
            WHERE project_can_access(id, ?, 'view') ORDER BY updated_at DESC
            """, (rs,n) -> new Summary(rs.getObject("id",UUID.class),rs.getString("name"),
                rs.getLong("revision"),rs.getObject("updated_at",OffsetDateTime.class),
                user.equals(rs.getObject("owner_id",UUID.class)) ? "owner" : "viewer",
                rs.getString("visibility"),
                hasAccess(user,rs.getObject("id",UUID.class),"edit")), user);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ProjectView create(@AuthenticationPrincipal UUID user, @Valid @RequestBody SaveRequest input) {
        UUID id = UUID.randomUUID();
        String document = json(input.document());
        jdbc.update("INSERT INTO cloud_projects(id,owner_id,name,document,revision) VALUES (?,?,?,CAST(? AS jsonb),1)",
                id, user, input.name(), document);
        jdbc.update("""
            INSERT INTO cloud_project_revisions(project_id,revision,name,document)
            VALUES (?,1,?,CAST(? AS jsonb))
            """, id, input.name(), document);
        return get(user, id);
    }

    @GetMapping("/{id}/status")
    public ProjectStatus status(@AuthenticationPrincipal UUID user, @PathVariable UUID id) {
        var records = jdbc.query("""
            SELECT p.id,p.name,p.revision,p.visibility,
                   project_can_access(p.id,?,'edit') AS can_edit
            FROM cloud_projects p
            WHERE p.id=? AND project_can_access(p.id,?,'view')
            """, (rs,n) -> new ProjectStatus(rs.getObject("id", UUID.class),
                rs.getString("name"), rs.getLong("revision"),
                rs.getString("visibility"), rs.getBoolean("can_edit")), user, id, user);
        if (records.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "工程不存在");
        return records.get(0);
    }

    @GetMapping("/{id}")
    public ProjectView get(@AuthenticationPrincipal UUID user, @PathVariable UUID id) {
        var records = jdbc.query("""
            SELECT p.id,p.name,p.revision,p.document,p.updated_at,p.visibility,
                   project_can_access(p.id,?,'edit') AS can_edit
            FROM cloud_projects p WHERE p.id=? AND project_can_access(p.id,?,'view')
            """, this::view, user, id, user);
        if (records.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "工程不存在");
        return records.get(0);
    }

    @GetMapping("/{id}/revisions")
    public List<RevisionSummary> revisions(@AuthenticationPrincipal UUID user, @PathVariable UUID id) {
        requireReadable(user, id);
        return jdbc.query("""
            SELECT r.revision,r.name,r.created_at
              FROM cloud_project_revisions r
              JOIN cloud_projects p ON p.id=r.project_id
             WHERE r.project_id=? AND project_can_access(p.id,?,'view')
             ORDER BY r.revision DESC
            """, (rs, i) -> new RevisionSummary(rs.getLong("revision"),rs.getString("name"),
                    rs.getObject("created_at", OffsetDateTime.class)), id, user);
    }

    @GetMapping("/{id}/revisions/{revision}")
    public RevisionView revision(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                                 @PathVariable long revision) {
        if (revision < 1) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "版本不存在");
        var records = jdbc.query("""
            SELECT r.revision,r.name,r.document,r.created_at
              FROM cloud_project_revisions r
              JOIN cloud_projects p ON p.id=r.project_id
             WHERE r.project_id=? AND r.revision=? AND
                 project_can_access(p.id,?,'view')
            """, this::revisionView, id, revision, user);
        if (records.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "版本不存在");
        return records.get(0);
    }

    /**
     * Only isolated station changes use the live protocol. Changes to line
     * topology/relations must still be saved through the full-document CAS.
     * A row lock serializes a read, mutation and increment across instances.
     */
    public record StationOperation(@NotNull UUID operationId, @NotNull Long expectedRevision,
                                   @NotBlank String type, @NotNull JsonNode station) {}

    @PostMapping("/{id}/operations")
    @Transactional
    public ProjectView applyStationOperation(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                                             @Valid @RequestBody StationOperation input) {
        requireWritable(user, id);
        if (input.expectedRevision() < 1 || input.expectedRevision() == Long.MAX_VALUE)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "无效的操作基线版本");
        if (!List.of("station.create", "station.rename", "station.move").contains(input.type()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "暂不支持该实时操作");
        if (!input.station().isObject())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "无效的车站操作");
        // Lock before checking idempotency or the base revision.
        var record = jdbc.query("""
            SELECT revision,name,document FROM cloud_projects WHERE id=? FOR UPDATE
            """, (rs,n) -> new Object[] { rs.getLong("revision"),rs.getString("name"),
                rs.getString("document") }, id);
        if (record.isEmpty())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"工程不存在");
        var previous = jdbc.query("""
            SELECT revision,action,station_id,payload FROM cloud_project_operations
            WHERE project_id=? AND operation_id=?
            """, (rs,n) -> new Object[] {rs.getLong("revision"),rs.getString("action"),
                rs.getString("station_id"),rs.getString("payload")}, id,input.operationId());
        JsonNode station = input.station();
        String stationId = station.path("id").asText("");
        if (!previous.isEmpty()) {
            Object[] prior=previous.get(0);
            try {
                if (!prior[1].equals(input.type()) || !prior[2].equals(stationId)
                    || !mapper.readTree((String)prior[3]).equals(station))
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"operationId 已被不同操作使用");
            } catch (com.fasterxml.jackson.core.JsonProcessingException error) {
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,"操作记录损坏");
            }
            // An identical retry is idempotent, even if a later revision exists.
            return get(user,id);
        }
        Object[] row = record.get(0);
        long currentRevision = (Long) row[0];
        if (input.expectedRevision() > currentRevision)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"操作基线版本超前");
        if (input.expectedRevision() < currentRevision) {
            // Accept stale writes only when EVERY intervening revision is a
            // station operation on a different station. A full-project save,
            // restore or missing operation record is an unsafe merge boundary.
            Long recorded = jdbc.queryForObject("""
                SELECT count(*) FROM cloud_project_operations
                 WHERE project_id=? AND revision>? AND revision<=?
                """, Long.class, id, input.expectedRevision(), currentRevision);
            Long overlaps = jdbc.queryForObject("""
                SELECT count(*) FROM cloud_project_operations
                 WHERE project_id=? AND revision>? AND revision<=?
                   AND (station_id=? OR action NOT LIKE 'station.%')
                """, Long.class, id, input.expectedRevision(), currentRevision, stationId);
            if (recorded == null || recorded != currentRevision-input.expectedRevision()
                || overlaps == null || overlaps > 0)
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "存在同站或整图更改，无法自动合并，请同步最新版");
        }
        ObjectNode document;
        try {
            document = (ObjectNode) mapper.readTree((String)row[2]);
        } catch (Exception error) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"工程数据损坏");
        }
        ArrayNode stations = (ArrayNode) document.get("stations");
        if (stationId.isBlank() || stationId.length() > 128)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效车站 ID");
        int index = -1;
        for (int i=0; i<stations.size(); i++) {
            if (stationId.equals(stations.get(i).path("id").asText())) { index=i; break; }
        }
        // Persist undo snapshots only for bounded rename/move actions. The
        // complete station snapshot guards against partial/hidden field loss.
        JsonNode beforeStation = index >= 0 ? stations.get(index).deepCopy() : null;
        switch(input.type()) {
            case "station.create" -> {
                if (index != -1)
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"车站 ID 已存在");
                if (!validName(station.path("name")) || !validCoord(station.path("x"))
                    || !validCoord(station.path("y")))
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效新车站");
                // Only standalone station creation; no implicit line topology mutation.
                ObjectNode created = mapper.createObjectNode();
                created.put("id",stationId);
                created.put("name",station.path("name").asText());
                created.put("x",station.path("x").asDouble());
                created.put("y",station.path("y").asDouble());
                created.put("labelOffsetX",0);
                created.put("labelOffsetY",0);
                stations.add(created);
            }
            case "station.rename" -> {
                if (index == -1)
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"车站已不存在");
                if (!validName(station.path("name")))
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效车站名称");
                ObjectNode target=(ObjectNode)stations.get(index);
                target.put("name",station.path("name").asText());
                if (station.has("nameS")) {
                    if (!station.get("nameS").isTextual() || station.get("nameS").asText().length()>200)
                        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效外文站名");
                    target.put("nameS",station.get("nameS").asText());
                } else target.remove("nameS");
                if (station.has("nameHistory")) {
                    if (!station.get("nameHistory").isArray() || station.get("nameHistory").size()>100)
                        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效站名历史");
                    target.set("nameHistory",station.get("nameHistory").deepCopy());
                } else target.remove("nameHistory");
            }
            case "station.move" -> {
                if (index == -1)
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"车站已不存在");
                if (!validCoord(station.path("x")) || !validCoord(station.path("y")))
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效站点坐标");
                ObjectNode target=(ObjectNode)stations.get(index);
                target.put("x",station.path("x").asDouble());
                target.put("y",station.path("y").asDouble());
            }
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"不支持的操作");
        }
        ProjectView result = saveRevision(user,id,currentRevision,(String)row[1],json(document));
        jdbc.update("""
            INSERT INTO cloud_project_operations(project_id,operation_id,revision,actor_id,action,station_id,payload)
            VALUES(?,?,?,?,?,?,CAST(? AS jsonb))
            """, id,input.operationId(),result.revision(),user,input.type(),stationId,station.toString());
        if(beforeStation != null &&
            ("station.rename".equals(input.type()) || "station.move".equals(input.type()))) {
            jdbc.update("""
                INSERT INTO cloud_station_undo_entries(
                    project_id,operation_id,actor_id,station_id,action,
                    before_station,after_station,state_revision)
                VALUES (?,?,?,?,?,CAST(? AS jsonb),CAST(? AS jsonb),?)
                """, id,input.operationId(),user,stationId,input.type(),
                    beforeStation.toString(),stations.get(index).toString(),result.revision());
        }
        return result;
    }

    public record OperationFeedItem(UUID operationId,long revision,String actorName,
                                    String action,String resourceId,OffsetDateTime createdAt) {}
    @GetMapping("/{id}/operations/history")
    public List<OperationFeedItem> operationHistory(@AuthenticationPrincipal UUID user,
                                                     @PathVariable UUID id,
                                                     @RequestParam(defaultValue = "50") int limit) {
        // The audit trail is deliberately available to editors only: it
        // exposes collaborator usernames, never raw operation payloads.
        requireWritable(user,id);
        if(limit<1 || limit>100)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效的历史条数");
        return jdbc.query("""
            SELECT o.operation_id,o.revision,u.username AS actor_name,
                   o.action,o.station_id,o.created_at
            FROM cloud_project_operations o
            JOIN app_users u ON u.id=o.actor_id
            WHERE o.project_id=?
            ORDER BY o.revision DESC, o.created_at DESC
            LIMIT ?
            """,(rs,n)->new OperationFeedItem(
                rs.getObject("operation_id",UUID.class),rs.getLong("revision"),
                rs.getString("actor_name"),rs.getString("action"),
                rs.getString("station_id"),
                rs.getObject("created_at",OffsetDateTime.class)),id,limit);
    }

    public record UndoEntry(UUID operationId, String stationId, String action,
                            boolean undone, long stateRevision) {}
    public record CompensationRequest(@NotNull UUID operationId,
                                      @NotNull UUID targetOperationId,
                                      @NotNull Long expectedRevision,
                                      @NotBlank String direction) {}

    @GetMapping("/{id}/operations/my-undo")
    public List<UndoEntry> myUndo(@AuthenticationPrincipal UUID user,@PathVariable UUID id) {
        requireWritable(user,id);
        return jdbc.query("""
            SELECT operation_id,station_id,action,undone,state_revision
            FROM cloud_station_undo_entries
            WHERE project_id=? AND actor_id=?
            ORDER BY state_revision DESC LIMIT 25
            """,(rs,n)->new UndoEntry(rs.getObject("operation_id",UUID.class),
                rs.getString("station_id"),rs.getString("action"),
                rs.getBoolean("undone"),rs.getLong("state_revision")),id,user);
    }

    /**
     * Inverse compensation is a NEW project revision, never a destructive
     * rollback of a shared document. Only the original actor can revert.
     * Strictly reject all same-station changes and any non-journaled revision
     * since the previous state of this operation.
     */
    @PostMapping("/{id}/operations/compensate")
    @Transactional
    public ProjectView compensate(@AuthenticationPrincipal UUID user,@PathVariable UUID id,
                                  @Valid @RequestBody CompensationRequest request) {
        requireWritable(user,id);
        if(request.expectedRevision()<1 ||request.expectedRevision()==Long.MAX_VALUE
           || !List.of("undo","redo").contains(request.direction()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效撤销或重做请求");
        var locked=jdbc.query("""
            SELECT revision,name,document FROM cloud_projects WHERE id=? FOR UPDATE
            """,(rs,n)->new Object[]{rs.getLong("revision"),rs.getString("name"),
                rs.getString("document")},id);
        if(locked.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND,"工程不存在");
        ObjectNode payload=mapper.createObjectNode();
        payload.put("targetOperationId",request.targetOperationId().toString());
        payload.put("direction",request.direction());
        var existing=jdbc.query("""
            SELECT action,station_id,payload FROM cloud_project_operations
            WHERE project_id=? AND operation_id=?
            """,(rs,n)->new String[]{rs.getString("action"),rs.getString("station_id"),
                rs.getString("payload")},id,request.operationId());
        if(!existing.isEmpty()) {
            String[] saved=existing.get(0);
            try {
                if(!("station."+request.direction()).equals(saved[0]) ||
                   !mapper.readTree(saved[2]).equals(payload))
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"补偿操作 ID 已被其他操作占用");
            }catch(com.fasterxml.jackson.core.JsonProcessingException error){
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,"操作日志损坏");
            }
            return get(user,id);
        }
        var entry=jdbc.query("""
            SELECT station_id,action,before_station,after_station,undone,state_revision
            FROM cloud_station_undo_entries
            WHERE project_id=? AND operation_id=? AND actor_id=? FOR UPDATE
            """,(rs,n)->new Object[]{rs.getString("station_id"),rs.getString("action"),
                rs.getString("before_station"),rs.getString("after_station"),
                rs.getBoolean("undone"),rs.getLong("state_revision")},
            id,request.targetOperationId(),user);
        if(entry.isEmpty())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"没有可撤销的本人操作");
        Object[] record=entry.get(0);
        boolean undone=(boolean)record[4];
        if(undone != "redo".equals(request.direction()))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"当前操作状态不允许该补偿");
        long revision=(long)((Object[])locked.get(0))[0];
        long previousRevision=(long)record[5];
        if(request.expectedRevision()!=revision)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"工程已更新，请先同步");
        Long count=jdbc.queryForObject("""
            SELECT count(*) FROM cloud_project_operations
            WHERE project_id=? AND revision>? AND revision<=?
            """,Long.class,id,previousRevision,revision);
        Long overlaps=jdbc.queryForObject("""
            SELECT count(*) FROM cloud_project_operations
            WHERE project_id=? AND revision>? AND revision<=?
              AND (station_id=? OR action NOT IN
                    ('station.create','station.rename','station.move',
                     'station.undo','station.redo'))
            """,Long.class,id,previousRevision,revision,(String)record[0]);
        // Every intermediate revision must be explicitly recorded, and none
        // may touch this station. Full-document PUT / restore lack such logs.
        if(count==null || count!=revision-previousRevision ||
           overlaps==null || overlaps>0)
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "其他操作已经影响该站或存在整图修改，不能安全撤销/重做");
        ObjectNode document;
        JsonNode expected;
        JsonNode target;
        try {
            document=(ObjectNode)mapper.readTree((String)((Object[])locked.get(0))[2]);
            expected=mapper.readTree((String)record[undone?2:3]);
            target=mapper.readTree((String)record[undone?3:2]);
        }catch(Exception error) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"撤销快照无效");
        }
        if(!(document.path("stations") instanceof ArrayNode stations))
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"车站数据损坏");
        int index=-1;
        for(int i=0;i<stations.size();i++)
            if(record[0].equals(stations.get(i).path("id").asText())) {
                if(index>=0)throw new ResponseStatusException(HttpStatus.CONFLICT,"车站 ID 重复");
                index=i;
            }
        if(index<0 || !stations.get(index).equals(expected))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"车站内容已变化，禁止覆盖");
        stations.set(index,target.deepCopy());
        ProjectView result=saveRevision(user,id,revision,(String)((Object[])locked.get(0))[1],json(document));
        jdbc.update("""
            UPDATE cloud_station_undo_entries SET undone=?,state_revision=?
            WHERE project_id=? AND operation_id=? AND actor_id=?
            """,!undone,result.revision(),id,request.targetOperationId(),user);
        jdbc.update("""
            INSERT INTO cloud_project_operations(project_id,operation_id,revision,actor_id,
                                                 action,station_id,payload)
            VALUES(?,?,?,?,?,?,CAST(? AS jsonb))
            """,id,request.operationId(),result.revision(),user,
                "station."+request.direction(),record[0],payload.toString());
        return result;
    }

    public record WaypointOperation(@NotNull UUID operationId, @NotNull Long expectedRevision,
                                    @NotBlank String segmentId, @NotBlank String waypointId,
                                    @NotNull Double x, @NotNull Double y) {}

    /**
     * First bounded topology-adjacent operation: moving a control point
     * inside an existing segment. Its endpoint stations and topology remain
     * untouched. Never rebase through a station edit or a full-project save.
     */
    @PostMapping("/{id}/operations/waypoint")
    @Transactional
    public ProjectView moveWaypoint(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                                    @Valid @RequestBody WaypointOperation input) {
        requireWritable(user,id);
        if (input.expectedRevision()<1 || input.expectedRevision()==Long.MAX_VALUE
            || !Double.isFinite(input.x()) || !Double.isFinite(input.y())
            || Math.abs(input.x())>1_000_000 || Math.abs(input.y())>1_000_000
            || input.segmentId().length()>120 || input.waypointId().length()>128)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效控制点操作");
        String resource="segment:"+input.segmentId();
        ObjectNode payload=mapper.createObjectNode();
        payload.put("segmentId",input.segmentId());
        payload.put("waypointId",input.waypointId());
        payload.put("x",input.x());
        payload.put("y",input.y());
        var locked=jdbc.query("""
            SELECT revision,name,document FROM cloud_projects WHERE id=? FOR UPDATE
            """,(rs,n)->new Object[]{rs.getLong("revision"),rs.getString("name"),
                rs.getString("document")},id);
        if (locked.isEmpty())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"工程不存在");
        var previous=jdbc.query("""
            SELECT action,station_id,payload FROM cloud_project_operations
             WHERE project_id=? AND operation_id=?
            """,(rs,n)->new String[]{rs.getString("action"),rs.getString("station_id"),
                rs.getString("payload")},id,input.operationId());
        if (!previous.isEmpty()) {
            var prior=previous.get(0);
            try {
                if (!"segment.waypoint.move".equals(prior[0]) || !resource.equals(prior[1])
                    || !mapper.readTree(prior[2]).equals(payload))
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"operationId 已被不同操作使用");
            } catch (com.fasterxml.jackson.core.JsonProcessingException error) {
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,"操作记录损坏");
            }
            return get(user,id);
        }
        Object[] row=locked.get(0);
        long current=(Long)row[0];
        if (input.expectedRevision()>current)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"版本超前");
        if (input.expectedRevision()<current) {
            Long recorded=jdbc.queryForObject("""
                SELECT count(*) FROM cloud_project_operations
                 WHERE project_id=? AND revision>? AND revision<=?
                """,Long.class,id,input.expectedRevision(),current);
            Long unsafe=jdbc.queryForObject("""
                SELECT count(*) FROM cloud_project_operations
                 WHERE project_id=? AND revision>? AND revision<=?
                   AND (station_id=? OR action<>'segment.waypoint.move')
                """,Long.class,id,input.expectedRevision(),current,resource);
            if (recorded==null || recorded!=current-input.expectedRevision()
                || unsafe==null || unsafe>0)
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "同区间或其他类型修改发生冲突，请同步最新版");
        }
        ObjectNode document;
        try {
            document=(ObjectNode)mapper.readTree((String)row[2]);
        } catch (Exception error) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"工程数据损坏");
        }
        JsonNode geometry=document.path("geometry");
        if (!(geometry instanceof ObjectNode) || !geometry.path("segments").isArray())
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"区间数据损坏");
        ArrayNode segments=(ArrayNode)geometry.path("segments");
        ObjectNode found=null;
        for(JsonNode item:segments)
            if(input.segmentId().equals(item.path("id").asText())) {
                found=(ObjectNode)item;
                break;
            }
        if (found==null || !found.path("waypoints").isArray())
            throw new ResponseStatusException(HttpStatus.CONFLICT,"区间不存在");
        ObjectNode waypoint=null;
        for(JsonNode item:found.path("waypoints"))
            if(input.waypointId().equals(item.path("id").asText())) {
                waypoint=(ObjectNode)item;
                break;
            }
        if(waypoint==null)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"控制点已不存在");
        waypoint.put("x",input.x());
        waypoint.put("y",input.y());
        ProjectView saved=saveRevision(user,id,current,(String)row[1],json(document));
        jdbc.update("""
            INSERT INTO cloud_project_operations(project_id,operation_id,revision,actor_id,
                                                 action,station_id,payload)
            VALUES(?,?,?,?,?,?,CAST(? AS jsonb))
            """,id,input.operationId(),saved.revision(),user,"segment.waypoint.move",
            resource,payload.toString());
        return saved;
    }

    /**
     * Safely extend the terminal station of an existing native line to a
     * different station that already exists in this project. Other topology
     * operations (splits, loops, branches, deletions) are not allowed here.
     * All topology mutations require an exact global revision.
     */
    public record LineAppendOperation(@NotNull UUID operationId, @NotNull Long expectedRevision,
                                      @NotBlank String lineId, @NotBlank String fromStationId,
                                      @NotBlank String toStationId, @NotBlank String segmentId,
                                      @NotBlank String relationId) {}

    @PostMapping("/{id}/operations/line-append")
    @Transactional
    public ProjectView appendExistingStation(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                                             @Valid @RequestBody LineAppendOperation input) {
        requireWritable(user,id);
        if(input.expectedRevision()<1 || input.expectedRevision()==Long.MAX_VALUE
            || !validId(input.lineId()) || !validId(input.fromStationId())
            || !validId(input.toStationId()) || !validId(input.segmentId())
            || !validId(input.relationId())
            || input.fromStationId().equals(input.toStationId()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效的线路连接操作");
        ObjectNode payload=mapper.createObjectNode();
        payload.put("lineId",input.lineId());
        payload.put("fromStationId",input.fromStationId());
        payload.put("toStationId",input.toStationId());
        payload.put("segmentId",input.segmentId());
        payload.put("relationId",input.relationId());
        String resource="line:"+input.lineId();
        var locked=jdbc.query("""
            SELECT revision,name,document FROM cloud_projects WHERE id=? FOR UPDATE
            """,(rs,n)->new Object[]{rs.getLong("revision"),rs.getString("name"),
                rs.getString("document")},id);
        if(locked.isEmpty())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"工程不存在");
        var previous=jdbc.query("""
            SELECT action,station_id,payload FROM cloud_project_operations
             WHERE project_id=? AND operation_id=?
            """,(rs,n)->new String[]{rs.getString("action"),rs.getString("station_id"),
                rs.getString("payload")},id,input.operationId());
        if(!previous.isEmpty()) {
            String[] prior=previous.get(0);
            try {
                if(!"line.append-existing".equals(prior[0]) || !resource.equals(prior[1])
                    || !mapper.readTree(prior[2]).equals(payload))
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"operationId 已被其他操作使用");
            } catch(com.fasterxml.jackson.core.JsonProcessingException ex) {
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,"操作日志损坏");
            }
            return get(user,id);
        }
        Object[] row=locked.get(0);
        long revision=(Long)row[0];
        if(revision!=input.expectedRevision())
            throw new ResponseStatusException(HttpStatus.CONFLICT,"线路拓扑已更新，请先同步最新版");
        ObjectNode document;
        try {
            document=(ObjectNode)mapper.readTree((String)row[2]);
        } catch(Exception ex) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"工程数据损坏");
        }
        if(!document.path("lines").isArray() || !document.path("stations").isArray()
            || !document.path("stationLineRelations").isArray()
            || !document.path("geometry").path("segments").isArray())
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"工程拓扑结构无效");
        ObjectNode line=null;
        for(JsonNode item:document.path("lines"))
            if(input.lineId().equals(item.path("id").asText())) {
                if(!(item instanceof ObjectNode))
                    throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"线路结构损坏");
                line=(ObjectNode)item; break;
            }
        if(line==null || line.path("locked").asBoolean(false)
            || line.path("isFake").asBoolean(false)
            || line.path("source").path("format").asText().equals("aarc"))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"线路不可编辑或不支持此类连接");
        if(!(line.path("stationSequence") instanceof ArrayNode sequence) || sequence.isEmpty()
            || !input.fromStationId().equals(sequence.get(sequence.size()-1).asText()))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"连接起点不再是线路终点");
        for(JsonNode station:sequence)
            if(input.toStationId().equals(station.asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"目标站已在线路中，禁止隐式环线与分叉");
        boolean fromExists=false,toExists=false;
        for(JsonNode station:document.path("stations")) {
            if(input.fromStationId().equals(station.path("id").asText())) fromExists=true;
            if(input.toStationId().equals(station.path("id").asText())) toExists=true;
        }
        if(!fromExists || !toExists)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"连接端点车站不存在");
        // This endpoint supports only simple, contiguous native lines.
        // Branches, gaps, and opening-phase-specific geometry must not be
        // silently rewritten by a convenient terminal-append command.
        if(line.path("operationHistory").isArray()
            && !line.path("operationHistory").isEmpty())
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "含线路历史状态的工程请使用完整工程保存");
        for(JsonNode phase:document.path("openingPhases"))
            if(input.lineId().equals(phase.path("lineId").asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "含分期工程的线路暂不支持快捷拓扑追加");
        ArrayNode segments=(ArrayNode)document.path("geometry").path("segments");
        int matchingSegments=0;
        for(JsonNode old:segments)
            if(input.lineId().equals(old.path("lineId").asText())) matchingSegments++;
        if(matchingSegments!=sequence.size()-1)
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "线路拓扑不是单一连续链，不允许快捷追加");
        java.util.Set<String> already=new java.util.HashSet<>();
        for(JsonNode value:sequence)
            if(!already.add(value.asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "线路站序存在重复节点");
        for(int k=0;k<sequence.size()-1;k++) {
            String a=sequence.get(k).asText(), c=sequence.get(k+1).asText();
            int matching=0;
            for(JsonNode old:segments) {
                if(!input.lineId().equals(old.path("lineId").asText())) continue;
                String first=old.path("fromStationId").asText();
                String second=old.path("toStationId").asText();
                if((a.equals(first)&&c.equals(second)) ||
                   (a.equals(second)&&c.equals(first))) matching++;
            }
            if(matching!=1)
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "站序与区间连接不一致，请使用完整工程保存");
        }
        for(JsonNode segment:segments) {
            if(input.segmentId().equals(segment.path("id").asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"区间 ID 冲突");
            if(input.lineId().equals(segment.path("lineId").asText()) &&
                ((input.fromStationId().equals(segment.path("fromStationId").asText())
                    && input.toStationId().equals(segment.path("toStationId").asText()))
                ||(input.toStationId().equals(segment.path("fromStationId").asText())
                    && input.fromStationId().equals(segment.path("toStationId").asText()))))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"线路区间已存在");
        }
        ArrayNode relations=(ArrayNode)document.path("stationLineRelations");
        for(JsonNode rel:relations) {
            if(input.relationId().equals(rel.path("id").asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"关联 ID 冲突");
            if(input.lineId().equals(rel.path("lineId").asText())
                && input.toStationId().equals(rel.path("stationId").asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"目标车站已有此线路关联，请改用完整工程保存");
        }
        JsonNode opened=line.path("openedAt");
        if(opened.isMissingNode() || opened.isNull()) opened=document.path("timeline").path("currentDate");
        ObjectNode relation=mapper.createObjectNode();
        relation.put("id",input.relationId());
        relation.put("stationId",input.toStationId());
        relation.put("lineId",input.lineId());
        if(opened.isTextual()) relation.put("openedAt",opened.asText()); else relation.putNull("openedAt");
        relation.putNull("closedAt");
        ObjectNode segment=mapper.createObjectNode();
        segment.put("id",input.segmentId());
        segment.put("lineId",input.lineId());
        segment.put("fromStationId",input.fromStationId());
        segment.put("toStationId",input.toStationId());
        segment.put("mode","straight");
        segment.put("structureType","underground");
        segment.set("structureNodes",mapper.createArrayNode());
        segment.set("waypoints",mapper.createArrayNode());
        if(opened.isTextual()) segment.put("openedAt",opened.asText()); else segment.putNull("openedAt");
        segment.putNull("closedAt");
        sequence.add(input.toStationId());
        segments.add(segment);
        relations.add(relation);
        ProjectView saved=saveRevision(user,id,revision,(String)row[1],json(document));
        jdbc.update("""
            INSERT INTO cloud_project_operations(project_id,operation_id,revision,actor_id,
                                                 action,station_id,payload)
            VALUES(?,?,?,?,?,?,CAST(? AS jsonb))
            """,id,input.operationId(),saved.revision(),user,"line.append-existing",
            resource,payload.toString());
        return saved;
    }

    /**
     * Bounded topology split. The client supplies an insertion position in
     * the existing waypoint chain; complex structure boundaries, phases,
     * imported AARC and branched lines are explicitly excluded.
     * Full graph state and operation journal update in one transaction.
     */
    public record SegmentSplitOperation(
        @NotNull UUID operationId, @NotNull Long expectedRevision,
        @NotBlank String segmentId, @NotBlank String stationId,
        @NotBlank String stationName, @NotNull Double x, @NotNull Double y,
        @NotBlank String beforeSegmentId, @NotBlank String afterSegmentId,
        @NotBlank String relationId, @NotNull Integer splitWaypointIndex
    ) {}

    @PostMapping("/{id}/operations/segment-split")
    @Transactional
    public ProjectView splitSegment(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                                    @Valid @RequestBody SegmentSplitOperation input) {
        requireWritable(user,id);
        if (input.expectedRevision()<1 || input.expectedRevision()==Long.MAX_VALUE
            || !validId(input.segmentId()) || !validId(input.stationId())
            || !validId(input.beforeSegmentId()) || !validId(input.afterSegmentId())
            || !validId(input.relationId()) || !validName(mapper.getNodeFactory().textNode(input.stationName()))
            || !Double.isFinite(input.x()) || !Double.isFinite(input.y())
            || Math.abs(input.x())>1_000_000 || Math.abs(input.y())>1_000_000
            || input.splitWaypointIndex()<0
            || input.segmentId().equals(input.beforeSegmentId())
            || input.segmentId().equals(input.afterSegmentId())
            || input.beforeSegmentId().equals(input.afterSegmentId()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效的区间拆分请求");

        ObjectNode payload=mapper.createObjectNode();
        payload.put("segmentId",input.segmentId());
        payload.put("stationId",input.stationId());
        payload.put("stationName",input.stationName());
        payload.put("x",input.x());
        payload.put("y",input.y());
        payload.put("beforeSegmentId",input.beforeSegmentId());
        payload.put("afterSegmentId",input.afterSegmentId());
        payload.put("relationId",input.relationId());
        payload.put("splitWaypointIndex",input.splitWaypointIndex());

        var rows=jdbc.query("""
            SELECT revision,name,document FROM cloud_projects WHERE id=? FOR UPDATE
            """,(rs,n)->new Object[]{rs.getLong("revision"),rs.getString("name"),
                rs.getString("document")},id);
        if(rows.isEmpty())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"工程不存在");

        String resource="segment:"+input.segmentId();
        var previous=jdbc.query("""
            SELECT action,station_id,payload FROM cloud_project_operations
            WHERE project_id=? AND operation_id=?
            """,(rs,n)->new String[]{rs.getString("action"),rs.getString("station_id"),
                rs.getString("payload")},id,input.operationId());
        if(!previous.isEmpty()) {
            String[] prior=previous.get(0);
            try {
                if(!"segment.split-station".equals(prior[0]) || !resource.equals(prior[1])
                    || !mapper.readTree(prior[2]).equals(payload))
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"operationId 已用于不同操作");
            } catch(com.fasterxml.jackson.core.JsonProcessingException ex) {
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,"操作记录损坏");
            }
            return get(user,id);
        }
        Object[] row=rows.get(0);
        long revision=(Long)row[0];
        if(revision!=input.expectedRevision())
            throw new ResponseStatusException(HttpStatus.CONFLICT,"线路拓扑版本冲突，请同步最新版");
        ObjectNode document;
        try {
            document=(ObjectNode)mapper.readTree((String)row[2]);
        } catch(Exception ex) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"工程 JSON 无效");
        }
        if(!(document.path("stations") instanceof ArrayNode stations)
            || !(document.path("lines") instanceof ArrayNode lines)
            || !(document.path("stationLineRelations") instanceof ArrayNode relations)
            || !(document.path("geometry").path("segments") instanceof ArrayNode segments))
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"线路拓扑数据不完整");

        ObjectNode source=null;
        int sourceIndex=-1;
        for(int i=0;i<segments.size();i++) {
            JsonNode segment=segments.get(i);
            String segmentId=segment.path("id").asText();
            if(segmentId.equals(input.segmentId())) {
                if(!(segment instanceof ObjectNode))
                    throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"区间对象无效");
                source=(ObjectNode)segment;
                sourceIndex=i;
            }
            if(segmentId.equals(input.beforeSegmentId()) ||
               segmentId.equals(input.afterSegmentId()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"新拆分区间 ID 已存在");
        }
        if(source==null)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"待拆区间已不存在");
        for(JsonNode station:stations)
            if(input.stationId().equals(station.path("id").asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"车站 ID 已存在");
        for(JsonNode relation:relations)
            if(input.relationId().equals(relation.path("id").asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"车站关联 ID 已存在");

        String lineId=source.path("lineId").asText();
        String from=source.path("fromStationId").asText();
        String to=source.path("toStationId").asText();
        ObjectNode line=null;
        for(JsonNode node:lines) {
            if(lineId.equals(node.path("id").asText())) {
                line=(ObjectNode)node;break;
            }
        }
        if(line==null || line.path("locked").asBoolean(false) ||
           line.path("isFake").asBoolean(false) ||
           "aarc".equals(line.path("source").path("format").asText()))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"此线路不能进行实时拆分");
        if(!(line.path("stationSequence") instanceof ArrayNode sequence) ||
           sequence.size()<2)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"线路站序无效");
        int insertAfter=-1;
        for(int i=0;i<sequence.size()-1;i++)
            if(from.equals(sequence.get(i).asText())
                && to.equals(sequence.get(i+1).asText())) {
                if(insertAfter>=0)
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"线路存在重复区间");
                insertAfter=i;
            }
        if(insertAfter<0)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"区间方向与站序不一致");
        int lineSegmentCount=0;
        for(JsonNode segment:segments)
            if(lineId.equals(segment.path("lineId").asText())) lineSegmentCount++;
        if(lineSegmentCount!=sequence.size()-1)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"分叉或站序不一致，请使用完整工程保存");
        // Exact chain validation: a matching count alone could hide branches
        // or gaps, in which case splitting would corrupt station ordering.
        java.util.Set<String> sequenceIds=new java.util.HashSet<>();
        for(JsonNode element:sequence)
            if(!sequenceIds.add(element.asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"线路站序存在重复车站");
        for(int i=0;i<sequence.size()-1;i++) {
            String a=sequence.get(i).asText(), c=sequence.get(i+1).asText();
            int matches=0;
            for(JsonNode segment:segments) {
                if(!lineId.equals(segment.path("lineId").asText()))continue;
                if(a.equals(segment.path("fromStationId").asText())
                    && c.equals(segment.path("toStationId").asText()))matches++;
            }
            if(matches!=1)
                throw new ResponseStatusException(HttpStatus.CONFLICT,"区间和站序不构成唯一连续链");
        }

        for(JsonNode old:sequence)
            if(input.stationId().equals(old.asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"车站已在线路中");
        // No complex historical/phase/structural dependencies may be dropped.
        if((source.path("structureNodes").isArray() && !source.path("structureNodes").isEmpty())
            ||(source.path("operationHistory").isArray() && !source.path("operationHistory").isEmpty())
            ||(source.path("lineHistory").isArray() && !source.path("lineHistory").isEmpty())
            ||(line.path("operationHistory").isArray() && !line.path("operationHistory").isEmpty())
            ||!source.path("source").isMissingNode()
            ||!line.path("source").isMissingNode())
            throw new ResponseStatusException(HttpStatus.CONFLICT,"复杂历史或结构区间不支持快捷拆分");
        for(JsonNode phase:document.path("openingPhases")) {
            boolean referencesSegment=false;
            for(JsonNode segmentId:phase.path("segmentIds"))
                if(input.segmentId().equals(segmentId.asText()))referencesSegment=true;
            if(lineId.equals(phase.path("lineId").asText()) || referencesSegment)
                throw new ResponseStatusException(HttpStatus.CONFLICT,"分期区间不允许快捷拆分");
        }
        if(!(source.path("waypoints") instanceof ArrayNode waypoints)
            ||input.splitWaypointIndex()>waypoints.size())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"控制点分割位置无效");

        boolean fromExists=false,toExists=false;
        for(JsonNode station:stations) {
            if(from.equals(station.path("id").asText()))fromExists=true;
            if(to.equals(station.path("id").asText()))toExists=true;
        }
        if(!fromExists||!toExists)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"区间端点不存在");
        JsonNode opened=source.path("openedAt");
        if(!opened.isTextual())opened=line.path("openedAt");
        if(!opened.isTextual())opened=document.path("timeline").path("currentDate");

        ObjectNode station=mapper.createObjectNode();
        station.put("id",input.stationId());
        station.put("name",input.stationName().trim());
        station.put("x",input.x());
        station.put("y",input.y());
        station.put("labelOffsetX",0);
        station.put("labelOffsetY",0);

        ObjectNode relation=mapper.createObjectNode();
        relation.put("id",input.relationId());
        relation.put("stationId",input.stationId());
        relation.put("lineId",lineId);
        if(opened.isTextual())relation.put("openedAt",opened.asText());
        else relation.putNull("openedAt");
        relation.putNull("closedAt");

        ObjectNode before=source.deepCopy();
        ObjectNode after=source.deepCopy();
        before.put("id",input.beforeSegmentId());
        before.put("toStationId",input.stationId());
        after.put("id",input.afterSegmentId());
        after.put("fromStationId",input.stationId());
        ArrayNode firstWaypoints=mapper.createArrayNode();
        ArrayNode secondWaypoints=mapper.createArrayNode();
        for(int i=0;i<waypoints.size();i++) {
            if(i<input.splitWaypointIndex())firstWaypoints.add(waypoints.get(i).deepCopy());
            else secondWaypoints.add(waypoints.get(i).deepCopy());
        }
        before.set("waypoints",firstWaypoints);
        after.set("waypoints",secondWaypoints);
        // Copy basic elevated/underground state and style metadata, but
        // reject structural control nodes above: they require geometry splitting.
        stations.add(station);
        relations.add(relation);
        sequence.insert(insertAfter+1,input.stationId());
        segments.remove(sourceIndex);
        segments.insert(sourceIndex,before);
        segments.insert(sourceIndex+1,after);

        ProjectView saved=saveRevision(user,id,revision,(String)row[1],json(document));
        jdbc.update("""
            INSERT INTO cloud_project_operations(project_id,operation_id,revision,actor_id,
                action,station_id,payload)
            VALUES(?,?,?,?,?,?,CAST(? AS jsonb))
            """,id,input.operationId(),saved.revision(),user,
                "segment.split-station",resource,payload.toString());
        return saved;
    }

    public record RemoveMiddleStationOperation(
        @NotNull UUID operationId, @NotNull Long expectedRevision,
        @NotBlank String lineId, @NotBlank String stationId,
        @NotBlank String beforeSegmentId, @NotBlank String afterSegmentId,
        @NotBlank String mergedSegmentId, @NotBlank String preservedWaypointId) {}

    /**
     * Bounded middle-station removal. Keeps cross-line transfer stations.
     * Replaces two compatible segments by one, retaining their waypoints and
     * the deleted stop's world position as a corner waypoint.
     */
    @PostMapping("/{id}/operations/remove-middle-station")
    @Transactional
    public ProjectView removeMiddleStation(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                                            @Valid @RequestBody RemoveMiddleStationOperation input) {
        requireWritable(user,id);
        if(input.expectedRevision()<1 || input.expectedRevision()==Long.MAX_VALUE
            || !validId(input.lineId()) || !validId(input.stationId())
            || !validId(input.beforeSegmentId()) || !validId(input.afterSegmentId())
            || !validId(input.mergedSegmentId()) || !validId(input.preservedWaypointId())
            || input.beforeSegmentId().equals(input.afterSegmentId()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效的车站删除操作");

        ObjectNode payload=mapper.createObjectNode();
        payload.put("lineId",input.lineId());
        payload.put("stationId",input.stationId());
        payload.put("beforeSegmentId",input.beforeSegmentId());
        payload.put("afterSegmentId",input.afterSegmentId());
        payload.put("mergedSegmentId",input.mergedSegmentId());
        payload.put("preservedWaypointId",input.preservedWaypointId());
        String resource="line:"+input.lineId();

        var locked=jdbc.query("""
            SELECT revision,name,document FROM cloud_projects WHERE id=? FOR UPDATE
            """,(rs,n)->new Object[]{rs.getLong("revision"),rs.getString("name"),rs.getString("document")},id);
        if(locked.isEmpty())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"工程不存在");
        var prior=jdbc.query("""
            SELECT action,station_id,payload FROM cloud_project_operations
            WHERE project_id=? AND operation_id=?
            """,(rs,n)->new String[]{rs.getString("action"),rs.getString("station_id"),
                rs.getString("payload")},id,input.operationId());
        if(!prior.isEmpty()) {
            String[] priorRow=prior.get(0);
            try {
                if(!"line.remove-middle-station".equals(priorRow[0])
                    || !resource.equals(priorRow[1])
                    || !mapper.readTree(priorRow[2]).equals(payload))
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"operationId 已用于其他操作");
            } catch(com.fasterxml.jackson.core.JsonProcessingException e) {
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,"操作日志损坏");
            }
            return get(user,id);
        }
        Object[] row=locked.get(0);
        long revision=(Long)row[0];
        if(revision!=input.expectedRevision())
            throw new ResponseStatusException(HttpStatus.CONFLICT,"拓扑版本已更新，请先同步");

        ObjectNode document;
        try {
            document=(ObjectNode)mapper.readTree((String)row[2]);
        } catch(Exception e) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"工程 JSON 无效");
        }
        if(!(document.path("stations") instanceof ArrayNode stations)
            || !(document.path("lines") instanceof ArrayNode lines)
            || !(document.path("stationLineRelations") instanceof ArrayNode relations)
            || !(document.path("geometry").path("segments") instanceof ArrayNode segments))
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"拓扑数据不完整");

        ObjectNode line=null,station=null;
        int stationIndex=-1;
        for(JsonNode item:lines)
            if(input.lineId().equals(item.path("id").asText()))line=(ObjectNode)item;
        for(int i=0;i<stations.size();i++)
            if(input.stationId().equals(stations.get(i).path("id").asText())) {
                stationIndex=i;station=(ObjectNode)stations.get(i);
            }
        if(line==null || station==null || line.path("locked").asBoolean(false)
            || line.path("isFake").asBoolean(false)
            || !line.path("source").isMissingNode()
            || !station.path("source").isMissingNode()
            || line.path("operationHistory").isArray() && !line.path("operationHistory").isEmpty())
            throw new ResponseStatusException(HttpStatus.CONFLICT,"不支持此线路或车站的快捷删除");

        if(!(line.path("stationSequence") instanceof ArrayNode sequence) || sequence.size()<3)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"线路至少需要三个车站");
        int position=-1;
        for(int i=0;i<sequence.size();i++)
            if(input.stationId().equals(sequence.get(i).asText())) {
                if(position!=-1)
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"站序出现重复节点");
                position=i;
            }
        if(position<=0 || position>=sequence.size()-1)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"只能删除线路中间站");
        java.util.Set<String> unique=new java.util.HashSet<>();
        for(JsonNode node:sequence)
            if(!unique.add(node.asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"站序存在循环或重复");
        String from=sequence.get(position-1).asText();
        String to=sequence.get(position+1).asText();

        ObjectNode before=null,after=null;
        int beforeIndex=-1,afterIndex=-1, lineSegments=0;
        for(int i=0;i<segments.size();i++) {
            JsonNode seg=segments.get(i);
            if(input.mergedSegmentId().equals(seg.path("id").asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"合并区间 ID 已存在");
            if(!input.lineId().equals(seg.path("lineId").asText()))continue;
            lineSegments++;
            if(input.beforeSegmentId().equals(seg.path("id").asText())) {
                before=(ObjectNode)seg;beforeIndex=i;
            }
            if(input.afterSegmentId().equals(seg.path("id").asText())) {
                after=(ObjectNode)seg;afterIndex=i;
            }
        }
        if(before==null || after==null || lineSegments!=sequence.size()-1)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"区间拓扑不连续或存在分叉");
        // Validate every edge rather than relying on a matching segment count.
        for(int k=0;k<sequence.size()-1;k++) {
            String a=sequence.get(k).asText(), c=sequence.get(k+1).asText();
            int matches=0;
            for(JsonNode seg:segments)
                if(input.lineId().equals(seg.path("lineId").asText())
                    && a.equals(seg.path("fromStationId").asText())
                    && c.equals(seg.path("toStationId").asText()))matches++;
            if(matches!=1)
                throw new ResponseStatusException(HttpStatus.CONFLICT,"站序与区间连接不一致");
        }
        if(!from.equals(before.path("fromStationId").asText())
            ||!input.stationId().equals(before.path("toStationId").asText())
            ||!input.stationId().equals(after.path("fromStationId").asText())
            ||!to.equals(after.path("toStationId").asText()))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"两段区间不构成连续链");
        for(JsonNode seg:segments) {
            if(!seg.path("waypoints").isArray())continue;
            for(JsonNode waypoint:seg.path("waypoints"))
                if(input.preservedWaypointId().equals(waypoint.path("id").asText()))
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"控制点 ID 已存在");
        }
        for(JsonNode ref:document.path("openingPhases")) {
            if(input.lineId().equals(ref.path("lineId").asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"有分期记录，不允许快捷删除");
            for(String name:java.util.List.of("segmentIds","stationRelationIds",
                "overriddenSegmentIds","overriddenStationRelationIds")) {
                for(JsonNode value:ref.path(name))
                    if(input.beforeSegmentId().equals(value.asText())
                        ||input.afterSegmentId().equals(value.asText()))
                        throw new ResponseStatusException(HttpStatus.CONFLICT,"区间被分期引用");
            }
        }
        for(JsonNode event:document.path("operationEvents")) {
            if(input.lineId().equals(event.path("lineId").asText()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"有运营历史，不允许快捷删除");
            for(JsonNode val:event.path("segmentIds"))
                if(input.beforeSegmentId().equals(val.asText())
                    ||input.afterSegmentId().equals(val.asText()))
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"运营历史引用了区间");
        }
        for(JsonNode seg:java.util.List.of(before,after)) {
            if(!seg.path("source").isMissingNode()
                ||seg.path("structureNodes").isArray() && !seg.path("structureNodes").isEmpty()
                ||seg.path("operationHistory").isArray() && !seg.path("operationHistory").isEmpty()
                ||seg.path("lineHistory").isArray() && !seg.path("lineHistory").isEmpty()
                ||!seg.path("waypoints").isArray())
                throw new ResponseStatusException(HttpStatus.CONFLICT,"复杂结构或历史区间不可快捷合并");
        }
        for(String key:java.util.List.of("lineId","mode","cornerRadius","structureType",
            "lineStyleId","openedAt","closedAt")) {
            JsonNode left=before.get(key),right=after.get(key);
            if(!java.util.Objects.equals(left,right))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"相邻区间样式或运营时间不同");
        }
        int relationIndex=-1,relationCount=0,remainingMemberships=0;
        for(int i=0;i<relations.size();i++) {
            JsonNode rel=relations.get(i);
            if(!input.stationId().equals(rel.path("stationId").asText()))continue;
            if(input.lineId().equals(rel.path("lineId").asText())) {
                relationIndex=i;relationCount++;
                if(rel.path("operationHistory").isArray() && !rel.path("operationHistory").isEmpty())
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"车站关联有历史状态");
            } else remainingMemberships++;
        }
        if(relationCount!=1)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"车站成员关系不唯一");
        String removedRelationId=relations.get(relationIndex).path("id").asText();
        for(JsonNode phase:document.path("openingPhases")) {
            for(String key:java.util.List.of("stationRelationIds","overriddenStationRelationIds"))
                for(JsonNode value:phase.path(key))
                    if(removedRelationId.equals(value.asText()))
                        throw new ResponseStatusException(HttpStatus.CONFLICT,"分期引用了车站关联");
        }
        for(JsonNode event:document.path("operationEvents"))
            for(JsonNode value:event.path("stationRelationIds"))
                if(removedRelationId.equals(value.asText()))
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"运营事件引用了车站关联");
        // Never remove a shared transfer station or a referenced node globally.
        boolean referenced=false;
        for(JsonNode lineNode:lines) {
            if(input.lineId().equals(lineNode.path("id").asText()))continue;
            for(JsonNode stationId:lineNode.path("stationSequence"))
                if(input.stationId().equals(stationId.asText()))referenced=true;
        }
        for(JsonNode seg:segments)
            if(!input.beforeSegmentId().equals(seg.path("id").asText())
                && !input.afterSegmentId().equals(seg.path("id").asText())
                && (input.stationId().equals(seg.path("fromStationId").asText())
                    ||input.stationId().equals(seg.path("toStationId").asText())))referenced=true;
        // Other features can reference station IDs in arbitrary metadata.
        // Keep the shared station object; never delete globally unless only
        // this line owns it and no complex metadata can reference it.
        boolean safelyRemoveStation=remainingMemberships==0 && !referenced
            && document.path("openingPhases").isEmpty()
            && document.path("operationEvents").isEmpty()
            && document.path("aarc").isMissingNode()
            && station.path("compoundGroupId").isMissingNode()
            && station.path("orientationAnchorLineId").isMissingNode();

        ObjectNode merged=before.deepCopy();
        merged.put("id",input.mergedSegmentId());
        merged.put("toStationId",to);
        ArrayNode waypoints=mapper.createArrayNode();
        for(JsonNode wp:before.path("waypoints"))waypoints.add(wp.deepCopy());
        ObjectNode formerStation=mapper.createObjectNode();
        formerStation.put("id",input.preservedWaypointId());
        formerStation.put("x",station.path("x").asDouble());
        formerStation.put("y",station.path("y").asDouble());
        formerStation.put("type","corner");
        waypoints.add(formerStation);
        for(JsonNode wp:after.path("waypoints"))waypoints.add(wp.deepCopy());
        merged.set("waypoints",waypoints);

        // Remove high indices first to avoid positional shifts.
        segments.remove(Math.max(beforeIndex,afterIndex));
        segments.remove(Math.min(beforeIndex,afterIndex));
        segments.insert(Math.min(beforeIndex,afterIndex),merged);
        sequence.remove(position);
        relations.remove(relationIndex);
        if(safelyRemoveStation)stations.remove(stationIndex);
        else if(input.lineId().equals(station.path("orientationAnchorLineId").asText()))
            station.remove("orientationAnchorLineId");

        ProjectView saved=saveRevision(user,id,revision,(String)row[1],json(document));
        jdbc.update("""
            INSERT INTO cloud_project_operations(project_id,operation_id,revision,actor_id,
                action,station_id,payload)
            VALUES(?,?,?,?,?,?,CAST(? AS jsonb))
            """,id,input.operationId(),saved.revision(),user,
                "line.remove-middle-station",resource,payload.toString());
        return saved;
    }

    private boolean validId(String id) {
        return id!=null && !id.isBlank() && id.length()<=120;
    }

    private boolean validName(JsonNode value) {
        return value.isTextual() && !value.asText().isBlank() && value.asText().length()<=200;
    }

    private boolean validCoord(JsonNode value) {
        return value.isNumber() && Double.isFinite(value.asDouble()) &&
            Math.abs(value.asDouble())<=1_000_000;
    }

    @PutMapping("/{id}")
    @Transactional
    public ProjectView update(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                              @Valid @RequestBody SaveRequest input) {
        ProjectView result=saveRevision(user, id, input.expectedRevision(), input.name(), json(input.document()));
        journalDocumentChange(user,id,result.revision(),"project.save");
        return result;
    }

    @PostMapping("/{id}/restore")
    @Transactional
    public ProjectView restore(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                               @Valid @RequestBody RestoreRequest input) {
        if (input.sourceRevision() == null || input.sourceRevision() < 1)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "需要有效的 sourceRevision");
        requireOwned(user, id);
        RevisionView source = revision(user, id, input.sourceRevision());
        // Restore is an append-only NEW revision, never a destructive historical overwrite.
        ProjectView result=saveRevision(user, id, input.expectedRevision(), source.name(), json(source.document()));
        journalDocumentChange(user,id,result.revision(),"project.restore");
        return result;
    }

    private void journalDocumentChange(UUID user,UUID id,long revision,String action) {
        jdbc.update("""
            INSERT INTO cloud_project_operations(project_id,operation_id,revision,
                                                 actor_id,action,station_id,payload)
            VALUES(?,?,?,?,?,'project',CAST('{}' AS jsonb))
            """,id,UUID.randomUUID(),revision,user,action);
    }

    private ProjectView saveRevision(UUID user, UUID id, Long expected, String name, String document) {
        if (expected == null || expected < 1 || expected == Long.MAX_VALUE)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "需要有效的 expectedRevision");
        int changed = jdbc.update("""
            UPDATE cloud_projects SET name=?, document=CAST(? AS jsonb), revision=revision+1,
                updated_at=now()
            WHERE id=? AND revision=? AND project_can_access(id,?,'edit')
            """, name, document, id, expected, user);
        if (changed != 1) {
            requireWritable(user, id);
            throw new ResponseStatusException(HttpStatus.CONFLICT, "工程版本冲突，请刷新或另存后重试");
        }
        // Same database transaction as the CAS update. Any failure rolls back both writes.
        jdbc.update("""
            INSERT INTO cloud_project_revisions(project_id,revision,name,document)
            VALUES (?,?,?,CAST(? AS jsonb))
            """, id, expected + 1, name, document);
        // Keep only the ten newest snapshots after a successful CAS write.
        // This runs in the SAME transaction as the current document update and
        // revision insert: rollback preserves consistency if pruning fails.
        jdbc.update("""
            DELETE FROM cloud_project_revisions
            WHERE project_id = ? AND revision NOT IN (
                SELECT revision FROM cloud_project_revisions
                WHERE project_id = ?
                ORDER BY revision DESC
                LIMIT 10
            )
            """, id, id);
        // Inform connected editors only after the transaction commits.
        socketHub.publishAfterCommit(id, expected + 1);
        return get(user, id);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@AuthenticationPrincipal UUID user, @PathVariable UUID id) {
        if (jdbc.update("DELETE FROM cloud_projects WHERE id=? AND owner_id=?", id, user) == 0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "工程不存在");
    }
}
