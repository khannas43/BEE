package gov.bee.api.document;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Local document store settings (ADR-001 D-RT6 / WP06.1a). */
@ConfigurationProperties(prefix = "bee.documents")
public class DocumentProperties {

    /** Absolute or process-relative directory for SHA-256-named blobs. Must stay git-ignored. */
    private String storePath = ".local/documents";

    /** Maximum accepted upload size in bytes (PDF test reports). */
    private long maxUploadBytes = 5_242_880L;

    public String getStorePath() {
        return storePath;
    }

    public void setStorePath(String storePath) {
        this.storePath = storePath;
    }

    public long getMaxUploadBytes() {
        return maxUploadBytes;
    }

    public void setMaxUploadBytes(long maxUploadBytes) {
        this.maxUploadBytes = maxUploadBytes;
    }
}
