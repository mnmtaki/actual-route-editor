package com.actualroute.server;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class ProjectSocketConfig implements WebSocketConfigurer {
    private final ProjectSocketHub hub;
    private final String trustedOrigin;

    ProjectSocketConfig(ProjectSocketHub hub,
                        @Value("${ara.cors-origin}") String trustedOrigin) {
        this.hub = hub;
        this.trustedOrigin = trustedOrigin;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(hub, "/ws/projects/*")
            .addInterceptors(hub)
            .setAllowedOrigins(trustedOrigin);
    }
}
