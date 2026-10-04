package gov.bee.api;

import gov.bee.api.document.DocumentProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(DocumentProperties.class)
public class BeeApiApplication {
    public static void main(String[] args) {
        SpringApplication.run(BeeApiApplication.class, args);
    }
}
