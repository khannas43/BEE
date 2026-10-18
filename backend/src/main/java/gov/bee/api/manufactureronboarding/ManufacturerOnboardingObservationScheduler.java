package gov.bee.api.manufactureronboarding;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Finalises clean manufacturer observation windows after their 15-day deadline. */
@Component
public class ManufacturerOnboardingObservationScheduler {

    private final ManufacturerOnboardingRepository repository;

    public ManufacturerOnboardingObservationScheduler(ManufacturerOnboardingRepository repository) {
        this.repository = repository;
    }

    @Scheduled(cron = "${bee.manufacturer-onboarding.observation-close-cron:0 5 0 * * *}", zone = "Asia/Kolkata")
    public void closeExpiredObservations() {
        repository.closeExpiredObservations();
    }
}
