package gov.bee.api.security;

import gov.bee.api.web.ApiErrors;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
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
 * Deny by default. Only the health probe is public. GET /api/me, the model-application list and read, and the
 * history read are open to an authenticated caller, and their controllers apply the Spring-database scope. Every
 * other request is denied until a reviewed first-slice rule is implemented by its owning work package (ADR-001
 * D-RT4). No screen-matrix capacity is imported.
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
                .requestMatchers(HttpMethod.GET, "/api/model-applications/eligible-brands").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/model-applications", "/api/model-applications/*").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/model-applications").authenticated()
                .requestMatchers(HttpMethod.PATCH, "/api/model-applications/*").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/model-applications/*/submit").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/model-applications/*/submit").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/model-applications/*/history").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/model-applications/*/documents").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/model-applications/*/documents").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/model-applications/*/documents/*/versions/*/content").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/model-applications/*/fee-confirmation").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/model-applications/*/iame-recommendation").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/model-applications/*/reviewer-forward").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/model-applications/*/rating").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/model-applications/*/director-recommendation").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/model-applications/*/secretary-approval").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/model-applications/*/return").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/model-applications/*/resubmit").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/model-applications/*/reject").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/fee-rules").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/fee-rules/proposals").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/fee-rules/proposals/*/decision").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/fee-corrections").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/fee-corrections/proposals").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/fee-corrections/proposals/*/decision").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/rating-schemes").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/rating-schemes/proposals").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/rating-schemes/proposals/*/decision").authenticated()
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
                          @Value("${bee.security.audience}") String audience,
                          @Value("${bee.security.jwk-set-uri:}") String jwkSetUri) {
        // The issuer is the name in the tokens. Where the API cannot reach Keycloak at that address (a container), the keys
        // are fetched from the address it can reach; the issuer check is unchanged.
        String keys = jwkSetUri.isBlank() ? issuer + "/protocol/openid-connect/certs" : jwkSetUri;
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(keys).build();
        OAuth2TokenValidator<Jwt> audienceValidator =
            new JwtClaimValidator<List<String>>("aud", aud -> aud != null && aud.contains(audience));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(issuer), audienceValidator));
        return decoder;
    }

    private static AuthenticationEntryPoint unauthenticated() {
        return (request, response, ex) -> ApiErrors.write(response, HttpServletResponse.SC_UNAUTHORIZED, "unauthenticated");
    }

    private static AccessDeniedHandler denied() {
        return (request, response, ex) -> ApiErrors.write(response, HttpServletResponse.SC_FORBIDDEN, "denied_by_default");
    }
}
