package com.actualroute.server;

import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.OncePerRequestFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@Configuration
public class SecurityConfig {
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(12); }

    @Bean SecurityFilterChain security(HttpSecurity http, TokenFilter filter) throws Exception {
        // CSRF is enforced for all state-changing cookie-authenticated API requests in TokenFilter.
        return http.csrf(csrf -> csrf.disable())
            .cors(Customizer.withDefaults())
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .exceptionHandling(exceptions -> exceptions.authenticationEntryPoint(
                (request, response, error) -> response.sendError(HttpStatus.UNAUTHORIZED.value())))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .requestMatchers("/api/auth/register", "/api/auth/login").permitAll()
                .anyRequest().authenticated())
            .addFilterBefore(filter, org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter.class)
            .build();
    }

    @Bean CorsConfigurationSource cors(@Value("${ara.cors-origin}") String origin) {
        var config = new CorsConfiguration();
        config.setAllowedOrigins(List.of(origin));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Content-Type", "X-ARA-CSRF"));
        config.setAllowCredentials(true);
        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    @org.springframework.stereotype.Component
    static class TokenFilter extends OncePerRequestFilter {
        private final AuthService auth;
        private final String trustedOrigin;

        TokenFilter(AuthService auth, @Value("${ara.cors-origin}") String trustedOrigin) {
            this.auth = auth;
            this.trustedOrigin = trustedOrigin;
        }

        @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                                    FilterChain chain) throws ServletException, IOException {
            if (!"OPTIONS".equals(request.getMethod()) && !isSafe(request.getMethod())) {
                String origin = request.getHeader("Origin");
                if (origin != null && !origin.equals(trustedOrigin)) {
                    response.sendError(HttpStatus.FORBIDDEN.value(), "跨站请求已拒绝");
                    return;
                }
            }

            String token = SessionCookies.read(request, SessionCookies.SESSION);
            UUID user = auth.resolve(token);
            if (user != null) {
                var principal = new UsernamePasswordAuthenticationToken(user, null, List.of());
                principal.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(principal);
            }
            if (user != null && !isSafe(request.getMethod())
                && !request.getRequestURI().equals("/api/auth/login")
                && !request.getRequestURI().equals("/api/auth/register")) {
                if (!auth.verifyCsrf(token, request.getHeader("X-ARA-CSRF"),
                                     SessionCookies.read(request, SessionCookies.CSRF))) {
                    response.sendError(HttpStatus.FORBIDDEN.value(), "CSRF 校验失败");
                    return;
                }
            }
            chain.doFilter(request, response);
        }

        private static boolean isSafe(String method) {
            return method.equals("GET") || method.equals("HEAD") || method.equals("OPTIONS") || method.equals("TRACE");
        }
    }
}
