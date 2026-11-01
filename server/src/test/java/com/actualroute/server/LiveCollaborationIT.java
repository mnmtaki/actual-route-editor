package com.actualroute.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Two independent network clients exercise the real embedded HTTP and
 * WebSocket servers, not just MockMvc or mocked WebSocketSession.
 * This verifies the transport; graphical browser/UI E2E remains separate.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"ara.cookie-secure=false"})
class LiveCollaborationIT {
    @LocalServerPort int port;
    @Autowired AuthService auth;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;

    record Client(String session, String csrf, UUID user) {
        String cookie() { return "ara_session=" + session + "; ara_csrf=" + csrf; }
    }

    Client account(String prefix) {
        String name = prefix + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        auth.register(name, "integration-test-password");
        var login = auth.login(name, "integration-test-password");
        return new Client(login.token(), login.csrf(), auth.resolve(login.token()));
    }

    HttpResponse<String> request(HttpClient http, Client client, String method, String path,
                                 Object payload) throws Exception {
        var builder = HttpRequest.newBuilder(
                URI.create("http://localhost:" + port + path))
            .timeout(Duration.ofSeconds(15))
            .header("Cookie", client.cookie())
            .header("Origin", "http://localhost:5173");
        if (payload == null) builder.GET();
        else builder.header("Content-Type", "application/json")
            .header("X-ARA-CSRF", client.csrf())
            .method(method, HttpRequest.BodyPublishers.ofString(
                mapper.writeValueAsString(payload)));
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    static class Messages implements WebSocket.Listener {
        final BlockingQueue<String> received = new LinkedBlockingQueue<>();
        final StringBuilder buffer = new StringBuilder();
        @Override
        public void onOpen(WebSocket webSocket) { webSocket.request(1); }
        @Override
        public java.util.concurrent.CompletionStage<?> onText(WebSocket ws,
                                                               CharSequence data, boolean last) {
            buffer.append(data);
            if (last) {
                received.add(buffer.toString());
                buffer.setLength(0);
            }
            ws.request(1);
            return null;
        }
        boolean sawAllRevisions(java.util.Set<Long> expected, long timeoutSeconds)
                throws Exception {
            var seen = new java.util.HashSet<Long>();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds);
            while (System.nanoTime() < deadline) {
                long time = deadline - System.nanoTime();
                String raw = received.poll(Math.max(1, time), TimeUnit.NANOSECONDS);
                if (raw == null) return false;
                JsonNode event = new ObjectMapper().readTree(raw);
                if ("revision".equals(event.path("type").asText()))
                    seen.add(event.path("revision").asLong());
                if (seen.containsAll(expected)) return true;
            }
            return false;
        }
    }

    @Test
    void twoRealClientsPublishMergeAndReceiveWebSocketEvents() throws Exception {
        try (HttpClient http = HttpClient.newHttpClient()) {
            Client owner=account("netOwner");
            Client peer=account("netPeer");
            String peerName=jdbc.queryForObject("SELECT username FROM app_users WHERE id=?",
                String.class,peer.user());
            Object original=Map.of("version",1,"name","Network City",
                "stations",java.util.List.of(),"lines",java.util.List.of(),
                "geometry",Map.of("segments",java.util.List.of()));
            var created=request(http,owner,"POST","/api/projects",
                Map.of("name","Network City","document",original));
            assertEquals(201,created.statusCode(),created.body());
            String id=mapper.readTree(created.body()).path("id").asText();
            var granted=request(http,owner,"POST","/api/projects/" + id + "/access-rules",
                Map.of("username",peerName,"action","edit","allowed",true));
            assertEquals(200,granted.statusCode(),granted.body());

            URI endpoint=URI.create("ws://localhost:" + port + "/ws/projects/" + id);
            Messages ownerMessages=new Messages();
            Messages peerMessages=new Messages();
            WebSocket ownerSocket=http.newWebSocketBuilder()
                .header("Origin","http://localhost:5173")
                .header("Cookie",owner.cookie())
                .buildAsync(endpoint,ownerMessages).get(10,TimeUnit.SECONDS);
            WebSocket peerSocket=http.newWebSocketBuilder()
                .header("Origin","http://localhost:5173")
                .header("Cookie",peer.cookie())
                .buildAsync(endpoint,peerMessages).get(10,TimeUnit.SECONDS);
            try {
                String path="/api/projects/" + id + "/operations";
                Object first=Map.of("operationId",UUID.randomUUID(),
                    "expectedRevision",1,"type","station.create",
                    "station",Map.of("id","station-a","name","A","x",10,"y",20));
                Object second=Map.of("operationId",UUID.randomUUID(),
                    "expectedRevision",1,"type","station.create",
                    "station",Map.of("id","station-b","name","B","x",30,"y",40));
                CompletableFuture<HttpResponse<String>> a=CompletableFuture.supplyAsync(() -> {
                    try { return request(http,owner,"POST",path,first); }
                    catch(Exception error) { throw new RuntimeException(error); }
                });
                CompletableFuture<HttpResponse<String>> b=CompletableFuture.supplyAsync(() -> {
                    try { return request(http,peer,"POST",path,second); }
                    catch(Exception error) { throw new RuntimeException(error); }
                });
                var aResult=a.get(20,TimeUnit.SECONDS);
                var bResult=b.get(20,TimeUnit.SECONDS);
                assertEquals(200,aResult.statusCode(),aResult.body());
                assertEquals(200,bResult.statusCode(),bResult.body());
                assertTrue(ownerMessages.sawAllRevisions(java.util.Set.of(2L,3L),10));
                assertTrue(peerMessages.sawAllRevisions(java.util.Set.of(2L,3L),10));
                var finalState=request(http,owner,"GET","/api/projects/" + id,null);
                assertEquals(200,finalState.statusCode(),finalState.body());
                JsonNode parsed=mapper.readTree(finalState.body());
                assertEquals(3,parsed.path("revision").asInt());
                assertEquals(2,parsed.path("document").path("stations").size());
                var ids=new java.util.HashSet<String>();
                for (JsonNode station:parsed.path("document").path("stations"))
                    ids.add(station.path("id").asText());
                assertEquals(java.util.Set.of("station-a","station-b"),ids);
            } finally {
                ownerSocket.sendClose(WebSocket.NORMAL_CLOSURE,"done").get(5,TimeUnit.SECONDS);
                peerSocket.sendClose(WebSocket.NORMAL_CLOSURE,"done").get(5,TimeUnit.SECONDS);
            }
        }
    }
}
