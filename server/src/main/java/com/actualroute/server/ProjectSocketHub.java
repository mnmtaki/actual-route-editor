package com.actualroute.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

/**
 * Project-scoped, server-to-client revision notifications (NOT editing commands).
 * Access is checked at handshake and again on broadcast / client heartbeat.
 * This broker is per JVM. Multi-instance deployment requires a shared pub/sub.
 */
@Component
public class ProjectSocketHub extends TextWebSocketHandler implements HandshakeInterceptor {
    private static final Logger log = LoggerFactory.getLogger(ProjectSocketHub.class);
    private final JdbcTemplate jdbc;
    private final AuthService auth;
    private final ObjectMapper mapper;
    private final String trustedOrigin;
    private final ConcurrentHashMap<UUID, ConcurrentHashMap<String, WebSocketSession>> rooms =
        new ConcurrentHashMap<>();

    ProjectSocketHub(JdbcTemplate jdbc, AuthService auth, ObjectMapper mapper,
                     @Value("${ara.cors-origin}") String trustedOrigin) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.mapper = mapper;
        this.trustedOrigin = trustedOrigin;
    }

    private boolean canEdit(UUID project, UUID user) {
        if (project == null || user == null) return false;
        return Boolean.TRUE.equals(jdbc.queryForObject(
            "SELECT COALESCE(project_can_access(?, ?, 'edit'), false)",
            Boolean.class, project, user));
    }

    private UUID projectId(ServerHttpRequest request) {
        String path = request.getURI().getPath();
        String prefix = "/ws/projects/";
        if (!path.startsWith(prefix)) return null;
        String suffix = path.substring(prefix.length());
        if (!suffix.matches("[0-9a-fA-F-]{36}")) return null;
        try { return UUID.fromString(suffix); }
        catch (IllegalArgumentException e) { return null; }
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   org.springframework.web.socket.WebSocketHandler handler,
                                   Map<String, Object> attributes) {
        // WebSocket browsers have no custom CSRF header. Verify a trusted
        // Origin and the server-side HttpOnly session cookie instead.
        if (!trustedOrigin.equals(request.getHeaders().getOrigin())
                || !(request instanceof ServletServerHttpRequest servlet)) return false;
        HttpServletRequest raw = servlet.getServletRequest();
        String token = SessionCookies.read(raw, SessionCookies.SESSION);
        UUID user = auth.resolve(token);
        UUID project = projectId(request);
        if (!canEdit(project, user)) return false;
        attributes.put("user", user);
        attributes.put("project", project);
        attributes.put("token", token);
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               org.springframework.web.socket.WebSocketHandler handler,
                               Exception exception) {}

    private boolean stillAuthorized(WebSocketSession session) {
        UUID user = (UUID) session.getAttributes().get("user");
        UUID project = (UUID) session.getAttributes().get("project");
        String token = (String) session.getAttributes().get("token");
        return user != null && user.equals(auth.resolve(token)) && canEdit(project, user);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        if (!stillAuthorized(session)) {
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }
        UUID project = (UUID) session.getAttributes().get("project");
        rooms.computeIfAbsent(project, ignored -> new ConcurrentHashMap<>())
            .put(session.getId(), session);
        send(session, mapper.writeValueAsString(Map.of("type", "ready")));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        if (!stillAuthorized(session)) {
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }
        if ("ping".equals(message.getPayload()))
            send(session, mapper.writeValueAsString(Map.of("type", "pong")));
        else session.close(CloseStatus.NOT_ACCEPTABLE);
    }

    private void send(WebSocketSession session, String payload) throws IOException {
        synchronized (session) {
            if (session.isOpen()) session.sendMessage(new TextMessage(payload));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        UUID project = (UUID) session.getAttributes().get("project");
        if (project != null) {
            var room = rooms.get(project);
            if (room != null) {
                room.remove(session.getId());
                if (room.isEmpty()) rooms.remove(project, room);
            }
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        log.debug("Project socket disconnected: {}", exception.toString());
        if (session.isOpen()) session.close(CloseStatus.SERVER_ERROR);
    }

    void publishAfterCommit(UUID project, long revision) {
        Runnable dispatch = () -> publish(project, revision);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { dispatch.run(); }
            });
        } else {
            // Fail closed on programming mistakes: never announce uncommitted data.
            throw new IllegalStateException("Revision notification requires an active transaction");
        }
    }

    private void publish(UUID project, long revision) {
        var room = rooms.get(project);
        if (room == null) return;
        final String payload;
        try {
            payload = mapper.writeValueAsString(Map.of(
                "type", "revision", "projectId", project.toString(), "revision", revision));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            log.error("Cannot encode collaboration notification", e);
            return;
        }
        for (WebSocketSession session : room.values()) {
            try {
                if (!session.isOpen() || !stillAuthorized(session)) {
                    if (session.isOpen()) session.close(CloseStatus.POLICY_VIOLATION);
                    afterConnectionClosed(session, CloseStatus.POLICY_VIOLATION);
                } else {
                    send(session, payload);
                }
            } catch (Exception e) {
                log.debug("Failed collaboration notification: {}", e.toString());
                afterConnectionClosed(session, CloseStatus.SERVER_ERROR);
                try { session.close(CloseStatus.SERVER_ERROR); }
                catch (IOException ignored) {}
            }
        }
    }
}
