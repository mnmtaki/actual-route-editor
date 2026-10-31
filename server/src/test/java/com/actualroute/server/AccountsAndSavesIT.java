package com.actualroute.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class AccountsAndSavesIT {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    private JsonNode postJson(String path, Object value, String bearer, int expected) throws Exception {
        var request = post(path).contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(value));
        if (bearer != null) request.header("Authorization", "Bearer " + bearer);
        var response = mvc.perform(request).andExpect(status().is(expected)).andReturn();
        return response.getResponse().getContentAsString().isBlank()
                ? mapper.createObjectNode()
                : mapper.readTree(response.getResponse().getContentAsString());
    }

    private String token(String username) throws Exception {
        var credentials = java.util.Map.of("username", username, "password", "long-test-password-123");
        postJson("/api/auth/register", credentials, null, 201);
        return postJson("/api/auth/login", credentials, null, 200).get("accessToken").asText();
    }

    @Test
    void accountsAreIsolatedAndRevisionConflictsAreRejected() throws Exception {
        var user1 = token("a" + UUID.randomUUID().toString().replace("-", "").substring(0, 15));
        var user2 = token("b" + UUID.randomUUID().toString().replace("-", "").substring(0, 15));
        var document = mapper.readTree("""
                {"version":1,"name":"City","stations":[],"lines":[],"geometry":{"segments":[]}}
                """);
        var saved = postJson("/api/projects", java.util.Map.of("name", "City", "document", document), user1, 201);
        String id = saved.get("id").asText();
        mvc.perform(get("/api/projects/" + id).header("Authorization", "Bearer " + user2))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/projects/" + id))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/projects").header("Authorization", "Bearer " + user2))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
        var changed = mvc.perform(put("/api/projects/" + id)
                        .header("Authorization", "Bearer " + user1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(java.util.Map.of(
                                "name", "Updated", "document", document, "expectedRevision", 1))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(2))
                .andReturn();
        mvc.perform(put("/api/projects/" + id)
                        .header("Authorization", "Bearer " + user1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(java.util.Map.of(
                                "name", "Old", "document", document, "expectedRevision", 1))))
                .andExpect(status().isConflict());
        mvc.perform(get("/api/projects/" + id).header("Authorization", "Bearer " + user1))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Updated"));
    }
}
