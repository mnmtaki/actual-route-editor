package com.actualroute.server;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class LoginRateLimiter {
    private final JdbcTemplate jdbc;
    LoginRateLimiter(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    void checkLogin(String username, String ip) {
        count("login-user:" + username.toLowerCase(java.util.Locale.ROOT), Duration.ofMinutes(15), 8);
        count("login-ip:" + ip, Duration.ofMinutes(15), 50);
    }

    void checkRegister(String ip) {
        count("register-ip:" + ip, Duration.ofHours(1), 5);
    }

    private void count(String key, Duration period, int maximum) {
        String hash = hash(key);
        Integer attempts = jdbc.queryForObject("""
            INSERT INTO auth_rate_limits(rate_key,window_start,attempts)
            VALUES (?,now(),1)
            ON CONFLICT(rate_key) DO UPDATE SET
              window_start = CASE WHEN auth_rate_limits.window_start < now() - (? * INTERVAL '1 second')
                 THEN now() ELSE auth_rate_limits.window_start END,
              attempts = CASE WHEN auth_rate_limits.window_start < now() - (? * INTERVAL '1 second')
                 THEN 1 ELSE auth_rate_limits.attempts + 1 END
            RETURNING attempts
            """, Integer.class, hash, period.toSeconds(), period.toSeconds());
        if (attempts != null && attempts > maximum)
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "操作太频繁，请稍后再试");
    }

    private static String hash(String input) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(input.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
