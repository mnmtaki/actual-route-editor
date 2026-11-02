package com.actualroute.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Regression for concurrent removal of an empty project room and registration
 * of its next editor. A newly registered editor must never be orphaned from
 * the room registry when the previous editor disconnects simultaneously.
 */
class ProjectSocketHubConcurrencyTest {
    @Test
    void concurrentDisconnectAndRegistrationPreserveNewEditorsBroadcast() throws Exception {
        var jdbc = mock(JdbcTemplate.class);
        var auth = mock(AuthService.class);
        UUID project = UUID.randomUUID();
        UUID user = UUID.randomUUID();
        String token = "test-session";
        when(auth.resolve(token)).thenReturn(user);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class),
            eq(project), eq(user))).thenReturn(true);
        var hub = new ProjectSocketHub(jdbc, auth, new ObjectMapper(), "http://localhost:5173");
        Method publish = ProjectSocketHub.class.getDeclaredMethod("publish", UUID.class, long.class);
        publish.setAccessible(true);

        for (int i = 0; i < 100; i++) {
            WebSocketSession previous = editor("previous-" + i, project, user, token);
            WebSocketSession incoming = editor("incoming-" + i, project, user, token);
            hub.afterConnectionEstablished(previous);
            var start = new CountDownLatch(1);
            CompletableFuture<Void> leave = CompletableFuture.runAsync(() -> {
                try {
                    start.await();
                    hub.afterConnectionClosed(previous,
                        org.springframework.web.socket.CloseStatus.NORMAL);
                } catch (Exception error) {
                    throw new RuntimeException(error);
                }
            });
            CompletableFuture<Void> join = CompletableFuture.runAsync(() -> {
                try {
                    start.await();
                    hub.afterConnectionEstablished(incoming);
                } catch (Exception error) {
                    throw new RuntimeException(error);
                }
            });
            start.countDown();
            CompletableFuture.allOf(leave, join).get(10, TimeUnit.SECONDS);
            publish.invoke(hub, project, (long) i + 2);
            verify(incoming, atLeastOnce()).sendMessage(argThat(message ->
                message instanceof TextMessage text &&
                text.getPayload().contains("\"revision\":" + ((long) i + 2))));
            hub.afterConnectionClosed(incoming,
                org.springframework.web.socket.CloseStatus.NORMAL);
        }
    }

    private static WebSocketSession editor(String id, UUID project, UUID user, String token) {
        var session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(id);
        when(session.getAttributes()).thenReturn(Map.of(
            "project", project, "user", user, "token", token));
        when(session.isOpen()).thenReturn(true);
        return session;
    }
}
