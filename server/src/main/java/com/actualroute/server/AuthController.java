package com.actualroute.server;

import java.util.Map;
import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService auth;
    private final LoginRateLimiter limiter;
    private final SessionCookies cookies;

    AuthController(AuthService auth, LoginRateLimiter limiter, SessionCookies cookies) {
        this.auth = auth; this.limiter = limiter; this.cookies = cookies;
    }

    record Credentials(
        @NotBlank @Pattern(regexp = "^[a-zA-Z0-9_]{3,40}$") String username,
        @NotBlank @Size(min = 8, max = 72) String password
    ) {}

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, String> register(@Valid @RequestBody Credentials data, HttpServletRequest request) {
        limiter.checkRegister(request.getRemoteAddr());
        auth.register(data.username(), data.password());
        return Map.of("status", "registered");
    }

    @PostMapping("/login")
    public Map<String, String> login(@Valid @RequestBody Credentials data,
                                     HttpServletRequest request, HttpServletResponse response) {
        limiter.checkLogin(data.username(), request.getRemoteAddr());
        var session = auth.login(data.username(), data.password());
        cookies.issue(response, session.token(), session.csrf());
        return Map.of("status", "logged_in");
    }

    @GetMapping("/me")
    public Map<String, String> me(@AuthenticationPrincipal UUID user) {
        return Map.of("userId", user.toString());
    }

    @PostMapping("/logout")
    public Map<String, String> logout(HttpServletRequest request, HttpServletResponse response) {
        auth.logout(SessionCookies.read(request, SessionCookies.SESSION));
        cookies.clear(response);
        return Map.of("status", "logged_out");
    }
}
