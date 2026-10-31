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
        mvc.perform(get("/api/projects/" + id)).andExpect(status().isUnauthorized());
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
