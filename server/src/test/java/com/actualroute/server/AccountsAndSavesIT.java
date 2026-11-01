package com.actualroute.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@AutoConfigureMockMvc
class AccountsAndSavesIT {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired AuthService auth;
    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;
    @Autowired ProjectSocketHub projectSocketHub;

    record Session(Cookie sessionCookie, Cookie csrfCookie) {
        Cookie[] cookies() { return new Cookie[]{sessionCookie, csrfCookie}; }
        String csrf() { return csrfCookie.getValue(); }
    }

    private Session account(String prefix) throws Exception {
        var credentials = Map.of("username", prefix + UUID.randomUUID().toString().replace("-", "").substring(0, 15),
                                 "password", "long-test-password-123");
        String ip = "10.0." + (prefix.charAt(0) % 200) + "." + (1 + (System.nanoTime() % 200));
        mvc.perform(post("/api/auth/register").remoteAddress(ip)
                    .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(credentials)))
                .andExpect(status().isCreated());
        var response = mvc.perform(post("/api/auth/login").remoteAddress(ip)
                    .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(credentials)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").doesNotExist())
                .andReturn().getResponse();
        String sessionHeader = response.getHeaders("Set-Cookie").stream()
                .filter(header -> header.startsWith("ara_session=")).findFirst().orElseThrow();
        String csrfHeader = response.getHeaders("Set-Cookie").stream()
                .filter(header -> header.startsWith("ara_csrf=")).findFirst().orElseThrow();
        assertTrue(sessionHeader.contains("HttpOnly"));
        assertTrue(sessionHeader.contains("SameSite=Lax"));
        assertFalse(csrfHeader.contains("HttpOnly"));
        return new Session(cookie(sessionHeader), cookie(csrfHeader));
    }

    private Cookie cookie(String header) {
        String[] pieces = header.split(";", 2)[0].split("=", 2);
        return new Cookie(pieces[0], pieces[1]);
    }

    private MockHttpServletRequestBuilder authorized(MockHttpServletRequestBuilder request, Session session) {
        return request.cookie(session.cookies()).header("X-ARA-CSRF", session.csrf());
    }

    private JsonNode document() throws Exception {
        return mapper.readTree("""
                {"version":1,"name":"City","stations":[],"lines":[],"geometry":{"segments":[]}}
                """);
    }

    private String createProject(Session session) throws Exception {
        var saved = mvc.perform(authorized(post("/api/projects")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(mapper.writeValueAsString(Map.of("name","City","document",document()))), session))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return mapper.readTree(saved).get("id").asText();
    }

    @Test
    void sessionPersistsThroughCookieAndLogoutRevokesIt() throws Exception {
        Session s = account("session");
        mvc.perform(get("/api/auth/me").cookie(s.cookies()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.userId").isString());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + s.sessionCookie().getValue()))
                .andExpect(status().isUnauthorized());
        mvc.perform(authorized(post("/api/auth/logout"), s))
                .andExpect(status().isOk()).andExpect(header().exists("Set-Cookie"));
        mvc.perform(get("/api/auth/me").cookie(s.cookies())).andExpect(status().isUnauthorized());
    }

    @Test
    void crossUserReadWriteDeleteAndCsrfAreRejected() throws Exception {
        Session user1 = account("first");
        Session user2 = account("second");
        String id = createProject(user1);
        mvc.perform(get("/api/projects/" + id).cookie(user2.cookies())).andExpect(status().isNotFound());
        mvc.perform(get("/api/projects/" + id)).andExpect(status().isNotFound());
        mvc.perform(get("/api/projects").cookie(user2.cookies()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
        mvc.perform(put("/api/projects/" + id).cookie(user1.cookies())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(mapper.writeValueAsString(Map.of(
                        "name", "NoCsrf", "document", document(), "expectedRevision", 1))))
                .andExpect(status().isForbidden());
        mvc.perform(put("/api/projects/" + id).cookie(user1.cookies())
                    .header("X-ARA-CSRF", user2.csrf())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(mapper.writeValueAsString(Map.of(
                        "name", "WrongCsrf", "document", document(), "expectedRevision", 1))))
                .andExpect(status().isForbidden());
        mvc.perform(authorized(put("/api/projects/" + id)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(mapper.writeValueAsString(Map.of(
                        "name", "Denied", "document", document(), "expectedRevision", 1))), user2))
                .andExpect(status().isNotFound());
        mvc.perform(authorized(delete("/api/projects/" + id), user2))
                .andExpect(status().isNotFound());
        mvc.perform(authorized(put("/api/projects/" + id)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(mapper.writeValueAsString(Map.of(
                        "name", "Updated", "document", document(), "expectedRevision", 1))), user1))
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(2));
        mvc.perform(authorized(put("/api/projects/" + id)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(mapper.writeValueAsString(Map.of(
                        "name", "Old", "document", document(), "expectedRevision", 1))), user1))
                .andExpect(status().isConflict());
        mvc.perform(get("/api/projects/" + id).cookie(user1.cookies()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Updated"));
    }

    @Test
    void versionHistoryIsImmutableAndRestoreAppendsWithoutOverwriting() throws Exception {
        Session owner = account("history");
        Session other = account("otherhistory");
        String id = createProject(owner);

        // Creation already has v1, which is the baseline immutable snapshot.
        mvc.perform(get("/api/projects/" + id + "/revisions").cookie(owner.cookies()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].revision").value(1));

        var changedDocument = mapper.readTree("""
                {"version":1,"name":"Changed","stations":[{"id":"station-1"}],
                "lines":[],"geometry":{"segments":[]}}
                """);
        mvc.perform(authorized(put("/api/projects/" + id)
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("name","Changed","document",changedDocument,"expectedRevision",1))), owner))
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(2));

        mvc.perform(get("/api/projects/" + id + "/revisions").cookie(owner.cookies()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].revision").value(2))
                .andExpect(jsonPath("$[1].revision").value(1));

        mvc.perform(get("/api/projects/" + id + "/revisions/1").cookie(owner.cookies()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("City"))
                .andExpect(jsonPath("$.document.stations.length()").value(0));
        mvc.perform(get("/api/projects/" + id + "/revisions/2").cookie(owner.cookies()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.document.stations.length()").value(1));

        String restoreOld = mapper.writeValueAsString(Map.of("sourceRevision",1,"expectedRevision",1));
        mvc.perform(authorized(post("/api/projects/" + id + "/restore")
                .contentType(MediaType.APPLICATION_JSON).content(restoreOld), owner))
                .andExpect(status().isConflict());

        var restore = mapper.writeValueAsString(Map.of("sourceRevision",1,"expectedRevision",2));
        mvc.perform(post("/api/projects/" + id + "/restore").cookie(owner.cookies())
                .contentType(MediaType.APPLICATION_JSON).content(restore))
                .andExpect(status().isForbidden());
        mvc.perform(authorized(post("/api/projects/" + id + "/restore")
                .contentType(MediaType.APPLICATION_JSON).content(restore), other))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/projects/" + id + "/revisions").cookie(other.cookies()))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/projects/" + id + "/revisions/1").cookie(other.cookies()))
                .andExpect(status().isNotFound());

        mvc.perform(authorized(post("/api/projects/" + id + "/restore")
                .contentType(MediaType.APPLICATION_JSON).content(restore), owner))
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(3))
                .andExpect(jsonPath("$.document.stations.length()").value(0));
        mvc.perform(get("/api/projects/" + id + "/revisions").cookie(owner.cookies()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(3));
        // The pre-restore v2 is still available even after restoring v1 as v3.
        mvc.perform(get("/api/projects/" + id + "/revisions/2").cookie(owner.cookies()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.document.stations.length()").value(1));
        mvc.perform(get("/api/projects/" + id + "/revisions/3").cookie(owner.cookies()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.document.stations.length()").value(0));

        mvc.perform(authorized(post("/api/projects/" + id + "/restore")
                .contentType(MediaType.APPLICATION_JSON).content(restore), owner))
                .andExpect(status().isConflict());
        mvc.perform(authorized(delete("/api/projects/" + id), owner)).andExpect(status().isNoContent());
        mvc.perform(get("/api/projects/" + id + "/revisions").cookie(owner.cookies()))
                .andExpect(status().isNotFound());
    }

    @Test
    void historyKeepsOnlyTenNewestVersionsAndNeverReusesRevisionNumbers() throws Exception {
        Session owner = account("limit");
        Session outsider = account("outsider");
        String id = createProject(owner);
        // v1 exists. Write through v12; each successful save appends a snapshot.
        for (int revision = 1; revision <= 11; revision++) {
            mvc.perform(authorized(put("/api/projects/" + id)
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of(
                    "name", "City-v" + (revision + 1),
                    "document", document(), "expectedRevision", revision))), owner))
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(revision + 1));
        }

        mvc.perform(get("/api/projects/" + id + "/revisions").cookie(owner.cookies()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(10))
            .andExpect(jsonPath("$[0].revision").value(12))
            .andExpect(jsonPath("$[9].revision").value(3));
        mvc.perform(get("/api/projects/" + id + "/revisions/1").cookie(owner.cookies()))
            .andExpect(status().isNotFound());
        mvc.perform(get("/api/projects/" + id + "/revisions/2").cookie(owner.cookies()))
            .andExpect(status().isNotFound());
        mvc.perform(get("/api/projects/" + id + "/revisions/3").cookie(owner.cookies()))
            .andExpect(status().isOk());

        // Failed writes must neither increment revision nor prune a snapshot.
        mvc.perform(authorized(put("/api/projects/" + id)
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "name", "Stale", "document", document(), "expectedRevision", 11))), owner))
            .andExpect(status().isConflict());
        mvc.perform(get("/api/projects/" + id + "/revisions").cookie(owner.cookies()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(10));

        mvc.perform(authorized(post("/api/projects/" + id + "/restore")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "sourceRevision", 3, "expectedRevision", 12))), outsider))
            .andExpect(status().isNotFound());

        // Restoring v3 creates v13 and prunes v3, with no renumbering.
        mvc.perform(authorized(post("/api/projects/" + id + "/restore")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "sourceRevision", 3, "expectedRevision", 12))), owner))
            .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(13))
            .andExpect(jsonPath("$.name").value("City-v3"));
        mvc.perform(get("/api/projects/" + id + "/revisions").cookie(owner.cookies()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(10))
            .andExpect(jsonPath("$[0].revision").value(13))
            .andExpect(jsonPath("$[9].revision").value(4));
        mvc.perform(get("/api/projects/" + id + "/revisions/3").cookie(owner.cookies()))
            .andExpect(status().isNotFound());
        mvc.perform(get("/api/projects/" + id).cookie(owner.cookies()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.revision").value(13))
            .andExpect(jsonPath("$.name").value("City-v3"));
    }

    @Test
    void publicVisibilitySupportsAnonymousViewingAndLoggedInEditingWithoutInvites() throws Exception {
        Session owner = account("publicowner");
        Session visitor = account("publiceditor");
        String id = createProject(owner);
        String visibilityUrl = "/api/projects/" + id + "/visibility";

        mvc.perform(get("/api/projects/" + id))
            .andExpect(status().isNotFound());
        mvc.perform(get("/api/projects/" + id).cookie(visitor.cookies()))
            .andExpect(status().isNotFound());
        mvc.perform(get("/api/projects/public"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));

        String viewMode = mapper.writeValueAsString(Map.of("visibility", "public_view"));
        mvc.perform(authorized(put(visibilityUrl).contentType(MediaType.APPLICATION_JSON)
            .content(viewMode), visitor)).andExpect(status().isNotFound());
        mvc.perform(authorized(put(visibilityUrl).contentType(MediaType.APPLICATION_JSON)
            .content(viewMode), owner)).andExpect(status().isOk())
            .andExpect(jsonPath("$.visibility").value("public_view"));
        mvc.perform(get("/api/projects/public")).andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value(id));
        mvc.perform(get("/api/projects/" + id)).andExpect(status().isOk())
            .andExpect(jsonPath("$.visibility").value("public_view"));
        mvc.perform(get("/api/projects/" + id + "/revisions/1"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/projects/" + id + "/revisions"))
            .andExpect(status().isOk());
        String edit = mapper.writeValueAsString(Map.of(
            "name","Edited", "document",document(), "expectedRevision",1));
        mvc.perform(authorized(put("/api/projects/" + id)
            .contentType(MediaType.APPLICATION_JSON).content(edit), visitor))
            .andExpect(status().isNotFound());
        mvc.perform(put("/api/projects/" + id)
            .contentType(MediaType.APPLICATION_JSON).content(edit))
            .andExpect(status().isUnauthorized());

        mvc.perform(authorized(put(visibilityUrl).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("visibility", "public_edit"))), owner))
            .andExpect(status().isOk());
        mvc.perform(authorized(put("/api/projects/" + id)
            .contentType(MediaType.APPLICATION_JSON).content(edit), visitor))
            .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(2));
        mvc.perform(authorized(put("/api/projects/" + id)
            .contentType(MediaType.APPLICATION_JSON).content(edit), owner))
            .andExpect(status().isConflict());
        mvc.perform(authorized(delete("/api/projects/" + id), visitor))
            .andExpect(status().isNotFound());
        mvc.perform(authorized(post("/api/projects/" + id + "/restore")
            .contentType(MediaType.APPLICATION_JSON).content(
                mapper.writeValueAsString(Map.of("sourceRevision",1,"expectedRevision",2))), visitor))
            .andExpect(status().isNotFound());
        mvc.perform(authorized(put(visibilityUrl).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("visibility", "unknown"))), owner))
            .andExpect(status().isBadRequest());
        mvc.perform(authorized(put(visibilityUrl).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("visibility", "private"))), owner))
            .andExpect(status().isOk());
        mvc.perform(get("/api/projects/" + id)).andExpect(status().isNotFound());
        mvc.perform(authorized(put("/api/projects/" + id)
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "name","Revoked","document",document(),"expectedRevision",2))), visitor))
            .andExpect(status().isNotFound());
    }

    @Test
    void specificAccountRulesOverridePublicDefaultsAndAllowPrivateCollaboration() throws Exception {
        Session owner = account("ruleOwner");
        Session friend = account("ruleFriend");
        Session stranger = account("ruleStranger");
        String id = createProject(owner);
        String root = "/api/projects/" + id;
        UUID friendId = auth.resolve(friend.sessionCookie().getValue());
        String friendName = jdbc.queryForObject(
            "SELECT username FROM app_users WHERE id=?", String.class, friendId);

        // A private project is hidden from non-owners until explicitly authorized.
        mvc.perform(get(root).cookie(friend.cookies())).andExpect(status().isNotFound());
        mvc.perform(get("/api/projects").cookie(friend.cookies()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
        String grantEdit = mapper.writeValueAsString(Map.of(
            "username", friendName, "action", "edit", "allowed", true));
        mvc.perform(authorized(post(root + "/access-rules")
            .contentType(MediaType.APPLICATION_JSON).content(grantEdit), friend))
            .andExpect(status().isNotFound());
        mvc.perform(authorized(post(root + "/access-rules")
            .contentType(MediaType.APPLICATION_JSON).content(grantEdit), owner))
            .andExpect(status().isOk()).andExpect(jsonPath("$.allowed").value(true));

        mvc.perform(get(root).cookie(friend.cookies()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.canEdit").value(true));
        mvc.perform(get("/api/projects").cookie(friend.cookies()))
            .andExpect(status().isOk()).andExpect(jsonPath("$[0].canEdit").value(true))
            .andExpect(jsonPath("$[0].visibility").value("private"));
        mvc.perform(get(root + "/revisions").cookie(friend.cookies()))
            .andExpect(status().isOk());
        mvc.perform(get(root).cookie(stranger.cookies()))
            .andExpect(status().isNotFound());
        mvc.perform(get(root)).andExpect(status().isNotFound());

        // Private collaborator writes; expectedRevision still serializes concurrent saves.
        String write1 = mapper.writeValueAsString(Map.of(
            "name","PrivateCollaborative","document",document(),"expectedRevision",1));
        mvc.perform(authorized(put(root).contentType(MediaType.APPLICATION_JSON)
            .content(write1), friend)).andExpect(status().isOk())
            .andExpect(jsonPath("$.revision").value(2));
        mvc.perform(authorized(put(root).contentType(MediaType.APPLICATION_JSON)
            .content(write1), owner)).andExpect(status().isConflict());

        // A specific view denial supersedes an edit grant.
        mvc.perform(authorized(post(root + "/access-rules").contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "username",friendName,"action","view","allowed",false))),owner))
            .andExpect(status().isOk());
        mvc.perform(get(root).cookie(friend.cookies())).andExpect(status().isNotFound());
        mvc.perform(authorized(put(root).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "name","Denied","document",document(),"expectedRevision",2))),friend))
            .andExpect(status().isNotFound());

        // Now make the project public-edit: explicit user view denial must still win.
        mvc.perform(authorized(put(root + "/visibility")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("visibility","public_edit"))),owner))
            .andExpect(status().isOk());
        mvc.perform(get(root).cookie(friend.cookies())).andExpect(status().isNotFound());
        mvc.perform(get("/api/projects/public").cookie(friend.cookies()))
            .andExpect(status().isOk()).andExpect(jsonPath(
                "$[?(@.id=='" + id + "')]").isEmpty());
        mvc.perform(get(root)).andExpect(status().isOk())
            .andExpect(jsonPath("$.canEdit").value(false));
        mvc.perform(get(root).cookie(stranger.cookies()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.canEdit").value(true));

        // Replace view denial with view grant, then deny editing specifically.
        mvc.perform(authorized(post(root + "/access-rules").contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "username",friendName,"action","view","allowed",true))),owner))
            .andExpect(status().isOk());
        mvc.perform(authorized(post(root + "/access-rules").contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "username",friendName,"action","edit","allowed",false))),owner))
            .andExpect(status().isOk());
        mvc.perform(get(root).cookie(friend.cookies()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.canEdit").value(false));
        mvc.perform(authorized(put(root).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "name","DeniedEdit","document",document(),"expectedRevision",2))),friend))
            .andExpect(status().isNotFound());
        mvc.perform(get(root + "/access-rules").cookie(friend.cookies()))
            .andExpect(status().isNotFound());
        String rulesJson = mvc.perform(get(root + "/access-rules").cookie(owner.cookies()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2))
            .andReturn().getResponse().getContentAsString();
        JsonNode savedRules = mapper.readTree(rulesJson);
        String editRuleId = "";
        for (JsonNode rule : savedRules) {
            if (rule.get("action").asText().equals("edit"))
                editRuleId = rule.get("id").asText();
        }
        assertFalse(editRuleId.isEmpty());
        mvc.perform(authorized(delete(root + "/access-rules/" + editRuleId),friend))
            .andExpect(status().isNotFound());
        mvc.perform(authorized(delete(root + "/access-rules/" + editRuleId),owner))
            .andExpect(status().isNoContent());
        mvc.perform(get(root).cookie(friend.cookies()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.canEdit").value(true));
    }

    @Test
    void socketRequiresTrustedOriginSessionAndEditPermissionAndOnlyNotifiesAfterCommit() throws Exception {
        Session owner = account("socketOwner");
        Session collaborator = account("socketPeer");
        String id = createProject(owner);
        UUID projectId = UUID.fromString(id);

        var request = new org.springframework.mock.web.MockHttpServletRequest("GET", "/ws/projects/" + id);
        request.addHeader("Origin", "http://localhost:5173");
        request.setCookies(collaborator.sessionCookie());
        var handler = org.mockito.Mockito.mock(org.springframework.web.socket.WebSocketHandler.class);
        var response = org.mockito.Mockito.mock(org.springframework.http.server.ServerHttpResponse.class);
        var attrs = new java.util.HashMap<String, Object>();
        var servletRequest = new org.springframework.http.server.ServletServerHttpRequest(request);

        // A private project does not allow arbitrary WebSocket subscriptions.
        assertFalse(projectSocketHub.beforeHandshake(servletRequest, response, handler, attrs));
        mvc.perform(authorized(put("/api/projects/" + id + "/visibility")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("visibility", "public_view"))), owner))
            .andExpect(status().isOk());
        assertFalse(projectSocketHub.beforeHandshake(servletRequest, response, handler, attrs));

        mvc.perform(authorized(put("/api/projects/" + id + "/visibility")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("visibility", "public_edit"))), owner))
            .andExpect(status().isOk());
        var wrongOrigin = new org.springframework.mock.web.MockHttpServletRequest("GET", "/ws/projects/" + id);
        wrongOrigin.addHeader("Origin", "https://untrusted.example");
        wrongOrigin.setCookies(collaborator.sessionCookie());
        assertFalse(projectSocketHub.beforeHandshake(
            new org.springframework.http.server.ServletServerHttpRequest(wrongOrigin),
            response, handler, new java.util.HashMap<>()));
        var noCookie = new org.springframework.mock.web.MockHttpServletRequest("GET", "/ws/projects/" + id);
        noCookie.addHeader("Origin", "http://localhost:5173");
        assertFalse(projectSocketHub.beforeHandshake(
            new org.springframework.http.server.ServletServerHttpRequest(noCookie),
            response, handler, new java.util.HashMap<>()));
        assertTrue(projectSocketHub.beforeHandshake(servletRequest, response, handler, attrs));
        assertEquals(projectId, attrs.get("project"));

        var ws = org.mockito.Mockito.mock(org.springframework.web.socket.WebSocketSession.class);
        org.mockito.Mockito.when(ws.getId()).thenReturn("test-socket-" + id);
        org.mockito.Mockito.when(ws.getAttributes()).thenReturn(attrs);
        org.mockito.Mockito.when(ws.isOpen()).thenReturn(true);
        projectSocketHub.afterConnectionEstablished(ws); // sends ready

        String write = mapper.writeValueAsString(Map.of(
            "name","SocketChanged","document",document(),"expectedRevision",1));
        mvc.perform(authorized(put("/api/projects/" + id).contentType(MediaType.APPLICATION_JSON)
            .content(write), owner)).andExpect(status().isOk());
        var captured = org.mockito.ArgumentCaptor.forClass(org.springframework.web.socket.TextMessage.class);
        org.mockito.Mockito.verify(ws, org.mockito.Mockito.atLeast(2)).sendMessage(captured.capture());
        assertTrue(captured.getAllValues().stream().anyMatch(
            msg -> msg.getPayload().contains("revision")
                && msg.getPayload().contains(":2") && msg.getPayload().contains("type")));

        // Stale write conflicts never emit revision 3.
        mvc.perform(authorized(put("/api/projects/" + id).contentType(MediaType.APPLICATION_JSON)
            .content(write), owner)).andExpect(status().isConflict());
        captured = org.mockito.ArgumentCaptor.forClass(org.springframework.web.socket.TextMessage.class);
        org.mockito.Mockito.verify(ws, org.mockito.Mockito.atLeast(2)).sendMessage(captured.capture());
        assertFalse(captured.getAllValues().stream().anyMatch(
            msg -> msg.getPayload().contains("revision") && msg.getPayload().contains(":3")));

        UUID peerId = auth.resolve(collaborator.sessionCookie().getValue());
        String peerName = jdbc.queryForObject(
            "SELECT username FROM app_users WHERE id=?", String.class, peerId);
        mvc.perform(authorized(post("/api/projects/" + id + "/access-rules")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "username",peerName,"action","edit","allowed",false))),owner))
            .andExpect(status().isOk());
        assertFalse(projectSocketHub.beforeHandshake(servletRequest, response, handler,
            new java.util.HashMap<>()));
        // Revoked subscribers are no longer notified, even if already connected.
        mvc.perform(authorized(put("/api/projects/" + id).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "name","AfterRevocation","document",document(),"expectedRevision",2))),owner))
            .andExpect(status().isOk());
        org.mockito.Mockito.verify(ws, org.mockito.Mockito.atLeastOnce())
            .close(org.springframework.web.socket.CloseStatus.POLICY_VIOLATION);
        projectSocketHub.afterConnectionClosed(ws,
            org.springframework.web.socket.CloseStatus.NORMAL);
    }

    @Test
    void stationOperationsSerializeValidateDeduplicateAndRejectStaleWrites() throws Exception {
        Session owner = account("opsowner");
        Session editor = account("opsfriend");
        Session outsider = account("opsother");
        String id = createProject(owner);
        String endpoint = "/api/projects/" + id + "/operations";
        UUID editorId = auth.resolve(editor.sessionCookie().getValue());
        String name = jdbc.queryForObject(
            "SELECT username FROM app_users WHERE id=?", String.class, editorId);
        mvc.perform(authorized(post("/api/projects/" + id + "/access-rules")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "username",name,"action","edit","allowed",true))), owner))
            .andExpect(status().isOk());

        UUID opCreate = UUID.randomUUID();
        Map<String,Object> created = Map.of(
            "operationId", opCreate, "expectedRevision", 1,
            "type", "station.create",
            "station", Map.of("id","solo-1","name","独立站","x",110,"y",220));
        String createBody = mapper.writeValueAsString(created);
        mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
            .content(createBody), outsider)).andExpect(status().isNotFound());
        mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
            .content(createBody), editor))
            .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(2))
            .andExpect(jsonPath("$.document.stations[0].name").value("独立站"));

        // Exact retry remains idempotent even with an outdated base revision.
        mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
            .content(createBody), editor))
            .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(2));
        mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "operationId",opCreate,"expectedRevision",1,
                "type","station.create",
                "station",Map.of("id","solo-1","name","伪造操作","x",111,"y",220)))),editor))
            .andExpect(status().isConflict());

        String rename = mapper.writeValueAsString(Map.of(
            "operationId",UUID.randomUUID(),"expectedRevision",2,"type","station.rename",
            "station",Map.of("id","solo-1","name","新的站名","nameS","New Station")));
        mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
            .content(rename), owner))
            .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(3))
            .andExpect(jsonPath("$.document.stations[0].name").value("新的站名"))
            .andExpect(jsonPath("$.document.stations[0].nameS").value("New Station"));

        String move = mapper.writeValueAsString(Map.of(
            "operationId",UUID.randomUUID(),"expectedRevision",3,"type","station.move",
            "station",Map.of("id","solo-1","x",300,"y",400)));
        mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
            .content(move), editor))
            .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(4))
            .andExpect(jsonPath("$.document.stations[0].x").value(300))
            .andExpect(jsonPath("$.document.stations[0].y").value(400));
        mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "operationId",UUID.randomUUID(),"expectedRevision",3,
                "type","station.move",
                "station",Map.of("id","solo-1","x",500,"y",600)))),owner))
            .andExpect(status().isConflict());
        mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "operationId",UUID.randomUUID(),"expectedRevision",4,
                "type","station.create",
                "station",Map.of("id","solo-1","name","重复 ID","x",1,"y",2)))),owner))
            .andExpect(status().isConflict());
        mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "operationId",UUID.randomUUID(),"expectedRevision",4,
                "type","station.delete",
                "station",Map.of("id","solo-1")))),owner))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/projects/" + id).cookie(owner.cookies()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(4));
        Integer count = jdbc.queryForObject(
            "SELECT count(*) FROM cloud_project_operations WHERE project_id=?",
            Integer.class,UUID.fromString(id));
        assertEquals(3,count);
    }

    @Test
    void twoEditorsMergeDisjointStationEditsButRejectOverlappingOrFullSaves() throws Exception {
        Session owner=account("mergeOwner");
        Session peer=account("mergePeer");
        String id=createProject(owner);
        String endpoint="/api/projects/" + id + "/operations";
        UUID peerId=auth.resolve(peer.sessionCookie().getValue());
        String peerName=jdbc.queryForObject(
            "SELECT username FROM app_users WHERE id=?",String.class,peerId);
        mvc.perform(authorized(post("/api/projects/" + id + "/access-rules")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "username",peerName,"action","edit","allowed",true))),owner))
            .andExpect(status().isOk());

        // Simulate two independent browser WebSocket sessions using real
        // cookie-authenticated handshake checks and mocked wire endpoints.
        var wsHandler=org.mockito.Mockito.mock(org.springframework.web.socket.WebSocketHandler.class);
        var wsResponse=org.mockito.Mockito.mock(org.springframework.http.server.ServerHttpResponse.class);
        var ownerReq=new org.springframework.mock.web.MockHttpServletRequest("GET","/ws/projects/" + id);
        ownerReq.addHeader("Origin","http://localhost:5173");
        ownerReq.setCookies(owner.sessionCookie());
        var peerReq=new org.springframework.mock.web.MockHttpServletRequest("GET","/ws/projects/" + id);
        peerReq.addHeader("Origin","http://localhost:5173");
        peerReq.setCookies(peer.sessionCookie());
        var ownerAttrs=new java.util.HashMap<String,Object>();
        var peerAttrs=new java.util.HashMap<String,Object>();
        assertTrue(projectSocketHub.beforeHandshake(
            new org.springframework.http.server.ServletServerHttpRequest(ownerReq),
            wsResponse,wsHandler,ownerAttrs));
        assertTrue(projectSocketHub.beforeHandshake(
            new org.springframework.http.server.ServletServerHttpRequest(peerReq),
            wsResponse,wsHandler,peerAttrs));
        var ownerSocket=org.mockito.Mockito.mock(org.springframework.web.socket.WebSocketSession.class);
        var peerSocket=org.mockito.Mockito.mock(org.springframework.web.socket.WebSocketSession.class);
        org.mockito.Mockito.when(ownerSocket.getId()).thenReturn("owner-" + id);
        org.mockito.Mockito.when(peerSocket.getId()).thenReturn("peer-" + id);
        org.mockito.Mockito.when(ownerSocket.getAttributes()).thenReturn(ownerAttrs);
        org.mockito.Mockito.when(peerSocket.getAttributes()).thenReturn(peerAttrs);
        org.mockito.Mockito.when(ownerSocket.isOpen()).thenReturn(true);
        org.mockito.Mockito.when(peerSocket.isOpen()).thenReturn(true);
        projectSocketHub.afterConnectionEstablished(ownerSocket);
        projectSocketHub.afterConnectionEstablished(peerSocket);

        // Both editors begin from exactly the same v1 document.
        String makeA=mapper.writeValueAsString(Map.of(
            "operationId",UUID.randomUUID(),"expectedRevision",1,"type","station.create",
            "station",Map.of("id","a","name","A","x",10,"y",20)));
        String makeB=mapper.writeValueAsString(Map.of(
            "operationId",UUID.randomUUID(),"expectedRevision",1,"type","station.create",
            "station",Map.of("id","b","name","B","x",30,"y",40)));
        mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
            .content(makeA),owner)).andExpect(status().isOk())
            .andExpect(jsonPath("$.revision").value(2));
        mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
            .content(makeB),peer)).andExpect(status().isOk())
            .andExpect(jsonPath("$.revision").value(3));
        mvc.perform(get("/api/projects/" + id).cookie(owner.cookies()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.document.stations.length()").value(2))
            .andExpect(jsonPath("$.document.stations[0].name").value("A"))
            .andExpect(jsonPath("$.document.stations[1].name").value("B"));

        // Two editors concurrently work on different existing stations from v3.
        // Server-side row locking determines v4 and v5, both changes survive.
        var ready=new java.util.concurrent.CountDownLatch(2);
        var go=new java.util.concurrent.CountDownLatch(1);
        var pool=java.util.concurrent.Executors.newFixedThreadPool(2);
        java.util.concurrent.Future<Integer> first=null,second=null;
        try {
            String moveA=mapper.writeValueAsString(Map.of(
                "operationId",UUID.randomUUID(),"expectedRevision",3,"type","station.move",
                "station",Map.of("id","a","x",111,"y",222)));
            String renameB=mapper.writeValueAsString(Map.of(
                "operationId",UUID.randomUUID(),"expectedRevision",3,"type","station.rename",
                "station",Map.of("id","b","name","B renamed")));
            first=pool.submit(() -> {
                ready.countDown();go.await();
                return mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
                    .content(moveA),owner)).andReturn().getResponse().getStatus();
            });
            second=pool.submit(() -> {
                ready.countDown();go.await();
                return mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
                    .content(renameB),peer)).andReturn().getResponse().getStatus();
            });
            assertTrue(ready.await(10,java.util.concurrent.TimeUnit.SECONDS));
            go.countDown();
            assertEquals(200,first.get(20,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(200,second.get(20,java.util.concurrent.TimeUnit.SECONDS));
        } finally {
            go.countDown();
            pool.shutdownNow();
        }
        // Both connected clients see the winning serialized v5 event.
        for (var socket : java.util.List.of(ownerSocket,peerSocket)) {
            var messages=org.mockito.ArgumentCaptor.forClass(org.springframework.web.socket.TextMessage.class);
            org.mockito.Mockito.verify(socket,org.mockito.Mockito.atLeast(4))
                .sendMessage(messages.capture());
            assertTrue(messages.getAllValues().stream().anyMatch(message ->
                message.getPayload().contains("revision")
                    && message.getPayload().contains(":5")));
        }
        mvc.perform(get("/api/projects/" + id).cookie(owner.cookies()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(5))
            .andExpect(jsonPath("$.document.stations[0].x").value(111))
            .andExpect(jsonPath("$.document.stations[1].name").value("B renamed"));

        // Same-station collision must still fail even with otherwise valid v3 base.
        mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "operationId",UUID.randomUUID(),"expectedRevision",3,"type","station.move",
                "station",Map.of("id","a","x",999,"y",999)))),peer))
            .andExpect(status().isConflict());

        // Full-project save is a hard merge boundary even for unrelated stations.
        JsonNode saved=mapper.readTree(mvc.perform(get("/api/projects/" + id)
            .cookie(owner.cookies())).andReturn().getResponse().getContentAsString());
        mvc.perform(authorized(put("/api/projects/" + id)
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "name","Changed whole document","document",saved.get("document"),
                "expectedRevision",5))),owner))
            .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(6));
        mvc.perform(authorized(post(endpoint).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of(
                "operationId",UUID.randomUUID(),"expectedRevision",5,"type","station.create",
                "station",Map.of("id","c","name","C","x",50,"y",60)))),peer))
            .andExpect(status().isConflict());
        mvc.perform(get("/api/projects/" + id).cookie(owner.cookies()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(6))
            .andExpect(jsonPath("$.document.stations.length()").value(2));
        projectSocketHub.afterConnectionClosed(ownerSocket,
            org.springframework.web.socket.CloseStatus.NORMAL);
        projectSocketHub.afterConnectionClosed(peerSocket,
            org.springframework.web.socket.CloseStatus.NORMAL);
    }

    @Test
    void rateLimitBlocksRepeatedFailedLogins() throws Exception {
        String user = "wrong" + UUID.randomUUID().toString().replace("-", "").substring(0, 15);
        String ip = "198.51.100.77";
        var credentials = mapper.writeValueAsString(Map.of("username", user, "password", "invalid-password-123"));
        for (int i = 0; i < 8; i++)
            mvc.perform(post("/api/auth/login").remoteAddress(ip).contentType(MediaType.APPLICATION_JSON)
                        .content(credentials)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/login").remoteAddress(ip).contentType(MediaType.APPLICATION_JSON)
                    .content(credentials)).andExpect(status().isTooManyRequests());
    }
}
