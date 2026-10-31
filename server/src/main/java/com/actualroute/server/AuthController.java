package com.actualroute.server;

import java.util.Map;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService auth;
    AuthController(AuthService auth) { this.auth = auth; }

    record Credentials(
        @NotBlank @Pattern(regexp = "^[a-zA-Z0-9_]{3,40}$") String username,
        @NotBlank @Size(min = 8, max = 72) String password
    ) {}

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, String> register(@Valid @RequestBody Credentials data) {
        auth.register(data.username(), data.password());
        return Map.of("status", "registered");
    }

    @PostMapping("/login")
    public Map<String, String> login(@Valid @RequestBody Credentials data) {
        return Map.of("accessToken", auth.login(data.username(), data.password()), "tokenType", "Bearer");
    }

    @GetMapping("/me")
    public Map<String, String> me(@AuthenticationPrincipal UUID user) {
        return Map.of("userId", user.toString());
    }

    @PostMapping("/logout")
    public Map<String, String> logout(@RequestHeader("Authorization") String bearer) {
        if (!bearer.startsWith("Bearer ")) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        auth.logout(bearer.substring(7));
        return Map.of("status", "logged_out");
    }
}
