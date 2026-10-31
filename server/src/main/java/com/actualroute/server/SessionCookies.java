package com.actualroute.server;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

@Component
public class SessionCookies {
    static final String SESSION = "ara_session";
    static final String CSRF = "ara_csrf";
    private final boolean secure;

    SessionCookies(@Value("${ara.cookie-secure:true}") boolean secure) {
        this.secure = secure;
    }

    static String read(HttpServletRequest request, String name) {
        if (request.getCookies() == null) return null;
        for (Cookie cookie : request.getCookies())
            if (cookie.getName().equals(name)) return cookie.getValue();
        return null;
    }

    void issue(HttpServletResponse response, String session, String csrf) {
        cookie(response, SESSION, session, true, 7 * 24 * 3600);
        cookie(response, CSRF, csrf, false, 7 * 24 * 3600);
    }

    void clear(HttpServletResponse response) {
        cookie(response, SESSION, "", true, 0);
        cookie(response, CSRF, "", false, 0);
    }

    private void cookie(HttpServletResponse response, String name, String value, boolean httpOnly, long seconds) {
        response.addHeader("Set-Cookie", ResponseCookie.from(name, value)
            .httpOnly(httpOnly).secure(secure).sameSite("Lax")
            .path("/").maxAge(seconds).build().toString());
    }
}
