package gov.bee.api;

import gov.bee.api.document.DocumentProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableConfigurationProperties(DocumentProperties.class)
@EnableScheduling
public class BeeApiApplication {
    public static void main(String[] args) {
        SpringApplication.run(BeeApiApplication.class, args);
    }
}
