package gov.bee.api.security;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;

/**
 * Deny by default. Only the health probe is public and only GET /api/me is open to
 * an authenticated caller; every other request is denied until a reviewed
 * first-slice rule allows it (ADR-001 D-RT4). No screen-matrix capacity is imported.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        http
            .csrf(c -> c.disable())
            .httpBasic(b -> b.disable())
            .formLogin(f -> f.disable())
            .logout(l -> l.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/health/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/me").authenticated()
                .anyRequest().denyAll())
            .oauth2ResourceServer(o -> o
                .jwt(Customizer.withDefaults())
                .authenticationEntryPoint(unauthenticated())
                .accessDeniedHandler(denied()))
            .exceptionHandling(e -> e
                .authenticationEntryPoint(unauthenticated())
                .accessDeniedHandler(denied()));
        return http.build();
    }

    /** Validates signature (Keycloak JWKS, fetched lazily), expiry, issuer and audience. */
    @Bean
    JwtDecoder jwtDecoder(@Value("${bee.security.issuer}") String issuer,
                          @Value("${bee.security.audience}") String audience) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(issuer + "/protocol/openid-connect/certs").build();
        OAuth2TokenValidator<Jwt> audienceValidator =
            new JwtClaimValidator<List<String>>("aud", aud -> aud != null && aud.contains(audience));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(issuer), audienceValidator));
        return decoder;
    }

    private static AuthenticationEntryPoint unauthenticated() {
        return (request, response, ex) -> write(response, HttpServletResponse.SC_UNAUTHORIZED, "unauthenticated");
    }

    private static AccessDeniedHandler denied() {
        return (request, response, ex) -> write(response, HttpServletResponse.SC_FORBIDDEN, "denied_by_default");
    }

    static void write(HttpServletResponse response, int status, String error) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"error\":\"" + error + "\"}");
    }
}
