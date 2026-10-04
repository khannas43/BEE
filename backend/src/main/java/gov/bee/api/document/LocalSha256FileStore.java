package gov.bee.api.document;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Git-ignored local folder of content-addressed blobs (ADR-001 D-RT6). Paths are constrained
 * to the configured store root; symlinks and path traversal are refused.
 */
@Component
public class LocalSha256FileStore {

    private static final Logger log = LoggerFactory.getLogger(LocalSha256FileStore.class);
    private static final HexFormat HEX = HexFormat.of();

    private final Path root;
    private final Path tmpDir;
    private final long maxUploadBytes;

    public LocalSha256FileStore(DocumentProperties properties) throws IOException {
        Path configured = Path.of(properties.getStorePath()).toAbsolutePath().normalize();
        Files.createDirectories(configured);
        if (Files.isSymbolicLink(configured)) {
            throw new IllegalStateException("document store path must not be a symlink");
        }
        this.root = configured.toRealPath();
        this.tmpDir = root.resolve(".tmp");
        Files.createDirectories(tmpDir);
        this.maxUploadBytes = properties.getMaxUploadBytes();
    }

    public long maxUploadBytes() {
        return maxUploadBytes;
    }

    public Path root() {
        return root;
    }

    public record StagedBlob(Path path, String sha256, long sizeBytes) {
    }

    /**
     * Streams bytes to a temp file under the store, validates size, returns SHA-256 and size.
     * Caller publishes via {@link #commit(StagedBlob)} or discards via {@link #discard(StagedBlob)}.
     */
    public StagedBlob stage(InputStream in) throws IOException {
        Path temp = tmpDir.resolve("up-" + UUID.randomUUID());
        MessageDigest digest = sha256();
        long size = 0L;
        try (InputStream dig = new DigestInputStream(in, digest);
             OutputStream out = Files.newOutputStream(temp, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = dig.read(buf)) >= 0) {
                size += n;
                if (size > maxUploadBytes) {
                    safeDelete(temp);
                    throw new FileTooLargeException(maxUploadBytes);
                }
                out.write(buf, 0, n);
            }
            out.flush();
        } catch (FileTooLargeException e) {
            throw e;
        } catch (IOException e) {
            safeDelete(temp);
            throw e;
        }
        if (size == 0) {
            safeDelete(temp);
            throw new InvalidDocumentException("empty");
        }
        return new StagedBlob(temp, HEX.formatHex(digest.digest()), size);
    }

    /** Publishes a staged blob under its SHA-256 name. Idempotent when the hash already exists. */
    public void commit(StagedBlob staged) throws IOException {
        Path target = resolveHash(staged.sha256());
        if (Files.exists(target)) {
            if (Files.size(target) != staged.sizeBytes()) {
                discard(staged);
                throw new InvalidDocumentException("collision");
            }
            discard(staged);
            return;
        }
        try {
            Files.move(staged.path(), target, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            if (Files.exists(target) && Files.size(target) == staged.sizeBytes()) {
                discard(staged);
                return;
            }
            throw e;
        }
    }

    public void discard(StagedBlob staged) {
        if (staged != null) {
            safeDelete(staged.path());
        }
    }

    public Optional<byte[]> read(String sha256) throws IOException {
        Path path = resolveHash(sha256);
        if (!Files.isRegularFile(path) || Files.isSymbolicLink(path)) {
            return Optional.empty();
        }
        byte[] bytes = Files.readAllBytes(path);
        String actual = HEX.formatHex(sha256().digest(bytes));
        if (!actual.equals(sha256.toLowerCase(Locale.ROOT))) {
            log.warn("document store hash mismatch");
            return Optional.empty();
        }
        return Optional.of(bytes);
    }

    public boolean exists(String sha256) {
        try {
            Path path = resolveHash(sha256);
            return Files.isRegularFile(path) && !Files.isSymbolicLink(path);
        } catch (IOException e) {
            return false;
        }
    }

    private Path resolveHash(String sha256) throws IOException {
        if (sha256 == null || !sha256.matches("^[0-9a-f]{64}$")) {
            throw new InvalidDocumentException("hash");
        }
        Path candidate = root.resolve(sha256).normalize();
        if (!candidate.startsWith(root)) {
            throw new InvalidDocumentException("path");
        }
        return candidate;
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void safeDelete(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
            // best-effort cleanup; no path names in logs
        }
    }

    public static final class FileTooLargeException extends IOException {
        private final long limit;

        FileTooLargeException(long limit) {
            super("too large");
            this.limit = limit;
        }

        public long limit() {
            return limit;
        }
    }

    public static final class InvalidDocumentException extends IOException {
        InvalidDocumentException(String reason) {
            super(reason);
        }
    }
}
