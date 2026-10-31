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
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DataAccessException;
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

    public record ProjectView(UUID id, String name, long revision, JsonNode document,
                              OffsetDateTime updatedAt) {}

    public record Summary(UUID id, String name, long revision, OffsetDateTime updatedAt) {}

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

    @GetMapping
    public List<Summary> list(@AuthenticationPrincipal UUID user) {
        return jdbc.query("SELECT id,name,revision,updated_at FROM cloud_projects WHERE owner_id=? ORDER BY updated_at DESC",
                (rs, i) -> new Summary(rs.getObject("id", UUID.class), rs.getString("name"),
                        rs.getLong("revision"), rs.getObject("updated_at", OffsetDateTime.class)), user);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ProjectView create(@AuthenticationPrincipal UUID user, @Valid @RequestBody SaveRequest input) {
        var id = UUID.randomUUID();
        jdbc.update("INSERT INTO cloud_projects(id,owner_id,name,document,revision) VALUES (?,?,?,CAST(? AS jsonb),1)",
                id, user, input.name(), json(input.document()));
        return get(user, id);
    }

    @GetMapping("/{id}")
    public ProjectView get(@AuthenticationPrincipal UUID user, @PathVariable UUID id) {
        var records = jdbc.query("SELECT id,name,revision,document,updated_at FROM cloud_projects WHERE id=? AND owner_id=?",
                this::view, id, user);
        if (records.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "工程不存在");
        return records.get(0);
    }

    @PutMapping("/{id}")
    @Transactional
    public ProjectView update(@AuthenticationPrincipal UUID user, @PathVariable UUID id,
                              @Valid @RequestBody SaveRequest input) {
        if (input.expectedRevision() == null || input.expectedRevision() < 1)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "保存需要有效的 expectedRevision");
        int changed = jdbc.update("""
            UPDATE cloud_projects SET name=?, document=CAST(? AS jsonb), revision=revision+1,
                updated_at=now()
            WHERE id=? AND owner_id=? AND revision=?
            """, input.name(), json(input.document()), id, user, input.expectedRevision());
        if (changed != 1) {
            // Do not reveal whether another user's project exists.
            if (jdbc.queryForObject("SELECT count(*) FROM cloud_projects WHERE id=? AND owner_id=?",
                    Integer.class, id, user) == 0)
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "工程不存在");
            throw new ResponseStatusException(HttpStatus.CONFLICT, "工程版本冲突，请刷新或另存后重试");
        }
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
