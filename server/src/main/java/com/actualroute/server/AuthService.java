package com.actualroute.server;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService {
    private final JdbcTemplate jdbc;
    private final PasswordEncoder encoder;
    private final SecureRandom random = new SecureRandom();

    AuthService(JdbcTemplate jdbc, PasswordEncoder encoder) {
        this.jdbc = jdbc; this.encoder = encoder;
    }

    @Transactional
    public void register(String username, String password) {
        try {
            jdbc.update("INSERT INTO app_users(id,username,password_hash) VALUES (?,?,?)",
                    UUID.randomUUID(), username, encoder.encode(password));
        } catch (DuplicateKeyException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "用户名已存在");
        }
    }

    public record IssuedSession(String token, String csrf) {}

    public IssuedSession login(String username, String password) {
        var users = jdbc.query("SELECT id,password_hash FROM app_users WHERE username=?",
                (rs, i) -> new Credential(rs.getObject("id", UUID.class), rs.getString("password_hash")), username);
        if (users.size() != 1 || !encoder.matches(password, users.get(0).hash()))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "用户名或密码错误");
        String token = randomToken();
        String csrf = randomToken();
        jdbc.update("INSERT INTO auth_tokens(token_hash,user_id,csrf_hash,expires_at) VALUES (?,?,?,?)",
                sha256(token), users.get(0).id(), sha256(csrf),
                OffsetDateTime.now(ZoneOffset.UTC).plusDays(7));
        return new IssuedSession(token, csrf);
    }

    public UUID resolve(String token) {
        if (token == null || !token.matches("[0-9a-f]{64}")) return null;
        var users = jdbc.query("SELECT user_id FROM auth_tokens WHERE token_hash=? AND expires_at>now() AND csrf_hash IS NOT NULL",
                (rs, i) -> rs.getObject("user_id", UUID.class), sha256(token));
        return users.isEmpty() ? null : users.get(0);
    }

    public boolean verifyCsrf(String token, String csrfHeader, String csrfCookie) {
        if (resolve(token) == null || csrfHeader == null || !csrfHeader.matches("[0-9a-f]{64}")
                || !csrfHeader.equals(csrfCookie)) return false;
        var hashes = jdbc.query("SELECT csrf_hash FROM auth_tokens WHERE token_hash=? AND expires_at>now()",
                (rs, i) -> rs.getString("csrf_hash"), sha256(token));
        return hashes.size() == 1 && MessageDigest.isEqual(
                sha256(csrfHeader).getBytes(StandardCharsets.US_ASCII),
                hashes.get(0).getBytes(StandardCharsets.US_ASCII));
    }

    public void logout(String token) {
        if (token != null && token.matches("[0-9a-f]{64}"))
            jdbc.update("DELETE FROM auth_tokens WHERE token_hash=?", sha256(token));
    }

    private String randomToken() {
        byte[] raw = new byte[32];
        random.nextBytes(raw);
        return HexFormat.of().formatHex(raw);
    }

    private static String sha256(String input) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(input.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    private record Credential(UUID id, String hash) {}
}
