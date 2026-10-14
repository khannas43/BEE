package gov.bee.api.delegation;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Registers the delegation-use log on the API routes. */
@Configuration
public class DelegationWebConfig implements WebMvcConfigurer {

    private final DelegationUseInterceptor interceptor;

    public DelegationWebConfig(DelegationUseInterceptor interceptor) {
        this.interceptor = interceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(interceptor).addPathPatterns("/api/**");
    }
}
