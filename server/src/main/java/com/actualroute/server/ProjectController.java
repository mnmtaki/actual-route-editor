package com.actualroute.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
    ProjectController(JdbcTemplate jdbc, ObjectMapper mapper) { this.jdbc = jdbc; this.mapper = mapper; }

    public record SaveRequest(@NotBlank @Size(max = 200) String name,
                              @NotNull JsonNode document,
                              Long expectedRevision) {}
    public record RestoreRequest(@NotNull Long sourceRevision, @NotNull Long expectedRevision) {}

    public record ProjectView(UUID id, String name, long revision, JsonNode document,
                              OffsetDateTime updatedAt) {}

    public record Summary(UUID id, String name, long revision, OffsetDateTime updatedAt, String role) {}
    public record RevisionSummary(long revision, String name, OffsetDateTime createdAt) {}
    public record RevisionView(long revision, String name, JsonNode document, OffsetDateTime createdAt) {}
    public record InviteRequest(@NotBlank @Size(min=3,max=40) String username) {}
    public record Collaborator(UUID userId, String username, String role) {}

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
                    rs.getObject("updated_at", OffsetDateTime.class));
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

    private void requireReadable(UUID user, UUID id) {
        Integer count = jdbc.queryForObject("""
            SELECT count(*) FROM cloud_projects p
            WHERE p.id=? AND (p.owner_id=? OR EXISTS (
                SELECT 1 FROM cloud_project_members m WHERE m.project_id=p.id AND m.user_id=?))
            """, Integer.class, id, user, user);
        if (count == null || count == 0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "工程不存在");
    }

    @GetMapping("/{id}/members")
    public List<Collaborator> members(@AuthenticationPrincipal UUID user, @PathVariable UUID id) {
        requireReadable(user, id);
        return jdbc.query("""
            SELECT u.id, u.username, 'owner' AS role FROM cloud_projects p
                JOIN app_users u ON u.id=p.owner_id WHERE p.id=?
            UNION ALL
            SELECT u.id, u.username, 'editor' AS role FROM cloud_project_members m
                JOIN app_users u ON u.id=m.user_id WHERE m.project_id=?
            ORDER BY role DESC, username
            """, (rs, n) -> new Collaborator(rs.getObject("id",UUID.class),
                 rs.getString("username"), rs.getString("role")), id, id);
    }

    @PostMapping("/{id}/members")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Collaborator invite(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                               @Valid @RequestBody InviteRequest input) {
        requireOwned(user, id);
        var target = jdbc.query("SELECT id,username FROM app_users WHERE username=?",
            (rs,n) -> new Collaborator(rs.getObject("id",UUID.class),rs.getString("username"),"editor"),
            input.username());
        if (target.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "用户名不存在");
        Collaborator member=target.get(0);
        if (member.userId().equals(user))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"不能邀请自己");
        int added=jdbc.update("""
            INSERT INTO cloud_project_members(project_id,user_id) VALUES (?,?)
            ON CONFLICT DO NOTHING
            """,id,member.userId());
        if(added==0) throw new ResponseStatusException(HttpStatus.CONFLICT,"成员已经存在");
        return member;
    }

    @DeleteMapping("/{id}/members/{memberId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void removeMember(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                             @PathVariable UUID memberId) {
        requireOwned(user, id);
        if (jdbc.update("DELETE FROM cloud_project_members WHERE project_id=? AND user_id=?",
                 id,memberId)==0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"成员不存在");
    }

    @GetMapping
    public List<Summary> list(@AuthenticationPrincipal UUID user) {
        return jdbc.query("""
            SELECT p.id,p.name,p.revision,p.updated_at, CASE WHEN p.owner_id=? THEN 'owner' ELSE 'editor' END AS role FROM cloud_projects p
            WHERE p.owner_id=? OR EXISTS (
                SELECT 1 FROM cloud_project_members m
                WHERE m.project_id=p.id AND m.user_id=?)
            ORDER BY p.updated_at DESC
            """, (rs, i) -> new Summary(rs.getObject("id", UUID.class), rs.getString("name"),
                        rs.getLong("revision"), rs.getObject("updated_at", OffsetDateTime.class), rs.getString("role")), user, user, user);
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

    @GetMapping("/{id}")
    public ProjectView get(@AuthenticationPrincipal UUID user, @PathVariable UUID id) {
        var records = jdbc.query("""
            SELECT p.id,p.name,p.revision,p.document,p.updated_at
            FROM cloud_projects p WHERE p.id=? AND
              (p.owner_id=? OR EXISTS (
                SELECT 1 FROM cloud_project_members m WHERE m.project_id=p.id AND m.user_id=?))
            """, this::view, id, user, user);
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
             WHERE r.project_id=? AND (p.owner_id=? OR EXISTS (
                 SELECT 1 FROM cloud_project_members m WHERE m.project_id=p.id AND m.user_id=?))
             ORDER BY r.revision DESC
            """, (rs, i) -> new RevisionSummary(rs.getLong("revision"),rs.getString("name"),
                    rs.getObject("created_at", OffsetDateTime.class)), id, user, user);
    }

    @GetMapping("/{id}/revisions/{revision}")
    public RevisionView revision(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                                 @PathVariable long revision) {
        if (revision < 1) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "版本不存在");
        var records = jdbc.query("""
            SELECT r.revision,r.name,r.document,r.created_at
              FROM cloud_project_revisions r
              JOIN cloud_projects p ON p.id=r.project_id
             WHERE r.project_id=? AND r.revision=? AND (p.owner_id=? OR EXISTS (
                 SELECT 1 FROM cloud_project_members m WHERE m.project_id=p.id AND m.user_id=?))
            """, this::revisionView, id, revision, user, user);
        if (records.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "版本不存在");
        return records.get(0);
    }

    @PutMapping("/{id}")
    @Transactional
    public ProjectView update(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                              @Valid @RequestBody SaveRequest input) {
        return saveRevision(user, id, input.expectedRevision(), input.name(), json(input.document()));
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
        return saveRevision(user, id, input.expectedRevision(), source.name(), json(source.document()));
    }

    private ProjectView saveRevision(UUID user, UUID id, Long expected, String name, String document) {
        if (expected == null || expected < 1 || expected == Long.MAX_VALUE)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "需要有效的 expectedRevision");
        int changed = jdbc.update("""
            UPDATE cloud_projects SET name=?, document=CAST(? AS jsonb), revision=revision+1,
                updated_at=now()
            WHERE id=? AND revision=? AND (owner_id=? OR EXISTS (
                SELECT 1 FROM cloud_project_members m
                WHERE m.project_id=cloud_projects.id AND m.user_id=?))
            """, name, document, id, expected, user, user);
        if (changed != 1) {
            requireReadable(user, id);
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
