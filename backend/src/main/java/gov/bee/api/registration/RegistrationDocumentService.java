package gov.bee.api.registration;

import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.administration.AdminDemonstrationAccess;
import gov.bee.api.document.DocumentService;
import gov.bee.api.document.LocalSha256FileStore;
import gov.bee.api.document.LocalSha256FileStore.FileTooLargeException;
import gov.bee.api.document.LocalSha256FileStore.InvalidDocumentException;
import gov.bee.api.document.LocalSha256FileStore.StagedBlob;
import gov.bee.api.identity.Caller;
import gov.bee.api.web.ApiErrors;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * WP04.2b-1: the trade-licence PDF of a registration request. The same local content-addressed store and PDF rules as the test report
 * (WP06.1a); the file is stored as pending local verification and nothing claims that BEE has checked it.
 */
@Service
public class RegistrationDocumentService {

    static final String ROUTE_UPLOAD = "/api/registrations/{id}/documents";
    static final String NOTE = "Local store only, pending verification. Upload does not claim the licence is genuine, malware-checked or accepted by BEE.";
    private static final byte[] PDF_MAGIC = "%PDF-".getBytes(StandardCharsets.US_ASCII);

    private final RegistrationRepository registrations;
    private final RegistrationDocumentRepository documents;
    private final RegistrationDocumentRecorder recorder;
    private final LocalSha256FileStore store;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public RegistrationDocumentService(RegistrationRepository registrations, RegistrationDocumentRepository documents,
                                       RegistrationDocumentRecorder recorder, LocalSha256FileStore store, IdempotencyRepository idempotency,
                                       ObjectMapper json) {
        this.registrations = registrations;
        this.documents = documents;
        this.recorder = recorder;
        this.store = store;
        this.idempotency = idempotency;
        this.json = json;
    }

    public ResponseEntity<Map<String, Object>> list(Caller caller, UUID id) {
        Optional<ResponseEntity<Map<String, Object>>> denied = readDenial(caller, id);
        if (denied.isPresent()) {
            return denied.get();
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (var doc : documents.listDocuments(id)) {
            items.add(documentView(doc, documents.listVersions(doc.id())));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", items);
        body.put("count", items.size());
        body.put("authority", "spring-database");
        body.put("verificationNote", NOTE);
        body.put("localStore", true);
        return ResponseEntity.ok(body);
    }

    public ResponseEntity<?> content(Caller caller, UUID id, UUID documentId, UUID versionId) {
        Optional<ResponseEntity<Map<String, Object>>> denied = readDenial(caller, id);
        if (denied.isPresent()) {
            return denied.get();
        }
        var doc = documents.findDocument(documentId, id);
        var version = doc.isEmpty() ? Optional.<RegistrationDocumentRepository.VersionRow>empty() : documents.findVersion(versionId, documentId);
        if (version.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        try {
            Optional<byte[]> bytes = store.read(version.get().contentSha256());
            if (bytes.isEmpty() || bytes.get().length != version.get().sizeBytes()) {
                return error(HttpStatus.SERVICE_UNAVAILABLE, "service_unavailable");
            }
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + DocumentService.asciiHeaderFilename(version.get().originalFilename()) + "\"")
                .header(HttpHeaders.CACHE_CONTROL, "no-store").header("X-Content-Type-Options", "nosniff").body(bytes.get());
        } catch (IOException e) {
            return error(HttpStatus.SERVICE_UNAVAILABLE, "service_unavailable");
        }
    }

    /** Scope and ownership are checked before the file is read, hashed or stored. */
    public ResponseEntity<Map<String, Object>> upload(Caller caller, UUID id, String key, MultipartFile file, String labelRaw) {
        if (AdminDemonstrationAccess.deniesOperationalMutation(caller)) {
            return error(org.springframework.http.HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        Optional<UUID> filing = RegistrationPolicy.filingOrganisation(caller);
        if (filing.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        if (registrations.findOwned(id, filing.get()).isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        String label = labelRaw == null || labelRaw.isBlank() ? "Trade licence" : DraftRequestSupport.trim(labelRaw);
        if (label.length() > 120 || file == null || file.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        String filename = DocumentService.sanitizeFilename(file.getOriginalFilename());
        final byte[] bytes;
        try {
            bytes = readLimited(file);
        } catch (FileTooLargeException | InvalidDocumentException e) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        } catch (IOException e) {
            return error(HttpStatus.SERVICE_UNAVAILABLE, "service_unavailable");
        }
        if (!startsWithPdfMagic(bytes)) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        byte[] hash = bodyHash(bytes, label, filename);
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, id, key, hash, filing.get());
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!RegistrationPolicy.editable(registrations.findOwned(id, filing.get()).orElseThrow().state())) {
            return error(HttpStatus.FORBIDDEN, "not_editable");
        }
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE_UPLOAD, id, key, hash)) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        StagedBlob staged = null;
        String sha;
        long size;
        try {
            staged = store.stage(new ByteArrayInputStream(bytes));
            sha = staged.sha256();
            size = staged.sizeBytes();
            store.commit(staged);
            staged = null;
        } catch (FileTooLargeException | InvalidDocumentException e) {
            store.discard(staged);
            idempotency.abandon(caller.accountId(), "POST", ROUTE_UPLOAD, id, key);
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        } catch (IOException e) {
            store.discard(staged);
            idempotency.abandon(caller.accountId(), "POST", ROUTE_UPLOAD, id, key);
            return error(HttpStatus.SERVICE_UNAVAILABLE, "service_unavailable");
        }
        try {
            AtomicReference<Map<String, Object>> rendered = new AtomicReference<>();
            recorder.record(caller.accountId(), id, key, sha, size, filename, label, r -> {
                Map<String, Object> view = documentView(r.document(), r.versions());
                rendered.set(view);
                return write(view);
            });
            return ResponseEntity.status(HttpStatus.CREATED).body(rendered.get());
        } catch (RegistrationDocumentRecorder.Denied denied) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE_UPLOAD, id, key);
            return error(denied.status(), denied.code());
        } catch (Exception e) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE_UPLOAD, id, key);
            return error(HttpStatus.SERVICE_UNAVAILABLE, "service_unavailable");
        }
    }

    private Optional<ResponseEntity<Map<String, Object>>> readDenial(Caller caller, UUID id) {
        var scope = RegistrationPolicy.readScope(caller);
        if (scope.isEmpty()) {
            return Optional.of(error(HttpStatus.FORBIDDEN, "no_read_scope"));
        }
        return registrations.find(id).filter(scope::canRead).isPresent() ? Optional.empty() : Optional.of(error(HttpStatus.NOT_FOUND, "not_found"));
    }

    private Optional<ResponseEntity<Map<String, Object>>> replayOrRequireKey(Caller caller, UUID id, String key, byte[] hash, UUID filing) {
        if (key == null || !DraftRequestSupport.IDEMPOTENCY_KEY.matcher(key).matches()) {
            return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency_key_required"));
        }
        var stored = idempotency.find(caller.accountId(), "POST", ROUTE_UPLOAD, id, key);
        if (stored.isEmpty()) {
            return Optional.empty();
        }
        if (stored.get().inProgress()) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_in_progress"));
        }
        Optional<byte[]> prior = idempotency.bodyHash(caller.accountId(), "POST", ROUTE_UPLOAD, id, key);
        if (prior.isEmpty() || !MessageDigest.isEqual(prior.get(), hash)) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_key_conflict"));
        }
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> body = json.readValue(stored.get().responseBody(), Map.class);
            return Optional.of(ResponseEntity.status(stored.get().responseStatus()).header("Idempotency-Replayed", "true").body(body));
        } catch (Exception e) {
            return Optional.of(error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error"));
        }
    }

    private byte[] readLimited(MultipartFile file) throws IOException {
        long max = store.maxUploadBytes();
        if (file.getSize() > max) {
            throw new FileTooLargeException(max);
        }
        try (InputStream in = file.getInputStream()) {
            byte[] buf = in.readNBytes((int) Math.min(max + 1, Integer.MAX_VALUE));
            if (buf.length > max) {
                throw new FileTooLargeException(max);
            }
            if (buf.length == 0) {
                throw new InvalidDocumentException("empty");
            }
            return buf;
        }
    }

    private static boolean startsWithPdfMagic(byte[] bytes) {
        if (bytes.length < PDF_MAGIC.length) {
            return false;
        }
        for (int i = 0; i < PDF_MAGIC.length; i++) {
            if (bytes[i] != PDF_MAGIC[i]) {
                return false;
            }
        }
        return true;
    }

    private static byte[] bodyHash(byte[] bytes, String label, String filename) {
        try {
            MessageDigest d = MessageDigest.getInstance("SHA-256");
            d.update(label.getBytes(StandardCharsets.UTF_8));
            d.update((byte) 0);
            d.update(filename.getBytes(StandardCharsets.UTF_8));
            d.update((byte) 0);
            d.update(bytes);
            return d.digest();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static Map<String, Object> documentView(RegistrationDocumentRepository.DocumentRow doc, List<RegistrationDocumentRepository.VersionRow> versions) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", doc.id().toString());
        m.put("documentKind", doc.documentKind());
        m.put("verificationStatus", "pending_local_verification");
        m.put("verificationNote", NOTE);
        List<Map<String, Object>> vs = new ArrayList<>();
        for (var v : versions) {
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("id", v.id().toString());
            x.put("versionNumber", v.versionNumber());
            x.put("contentSha256", v.contentSha256());
            x.put("sizeBytes", v.sizeBytes());
            x.put("mediaType", v.mediaType());
            x.put("originalFilename", v.originalFilename());
            x.put("label", v.label());
            x.put("uploadedByAccountId", v.uploadedByAccountId().toString());
            x.put("uploadedAt", v.uploadedAt().toString());
            x.put("verificationStatus", "pending_local_verification");
            vs.add(x);
        }
        m.put("versions", vs);
        if (!vs.isEmpty()) {
            m.put("latestVersion", vs.get(vs.size() - 1));
        }
        return m;
    }

    private String write(Map<String, Object> view) {
        try {
            return json.writeValueAsString(view);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String code) {
        return ApiErrors.response(status, code);
    }
}
