package gov.bee.api.document;

import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyReplayGuard;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.brand.BrandAuthRepository;
import gov.bee.api.brand.BrandAuthService;
import gov.bee.api.document.LocalSha256FileStore.FileTooLargeException;
import gov.bee.api.document.LocalSha256FileStore.InvalidDocumentException;
import gov.bee.api.document.LocalSha256FileStore.StagedBlob;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository;
import gov.bee.api.policy.ApplicationFacts;
import gov.bee.api.policy.SlicePolicy;
import gov.bee.api.policy.SlicePolicy.ReadScope;
import gov.bee.api.web.ApiErrors;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class DocumentService {

    static final String ROUTE_UPLOAD = "/api/model-applications/{id}/documents";
    static final String KIND_TEST_REPORT = "test_report";
    static final String VERIFICATION_NOTE =
        "Local store only — pending verification. Upload does not claim laboratory accreditation, malware clearance or BEE approval.";
    private static final int MAX_STEM = 176;
    private static final int ZWNJ = 0x200C;
    private static final int ZWJ = 0x200D;
    private static final byte[] PDF_MAGIC = "%PDF-".getBytes(StandardCharsets.US_ASCII);

    private final IdentityRepository identity;
    private final ModelApplicationRepository applications;
    private final DocumentRepository documents;
    private final DocumentRecorder recorder;
    private final LocalSha256FileStore store;
    private final BrandAuthRepository brands;
    private final BrandAuthService brandService;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public DocumentService(IdentityRepository identity, ModelApplicationRepository applications,
                           DocumentRepository documents, DocumentRecorder recorder, LocalSha256FileStore store, BrandAuthRepository brands,
                           BrandAuthService brandService, IdempotencyRepository idempotency, ObjectMapper json) {
        this.identity = identity;
        this.applications = applications;
        this.documents = documents;
        this.recorder = recorder;
        this.store = store;
        this.brands = brands;
        this.brandService = brandService;
        this.idempotency = idempotency;
        this.json = json;
    }

    public ResponseEntity<Map<String, Object>> list(Caller caller, UUID appId) {
        Optional<ModelApplicationRepository.Row> row = readable(caller, appId);
        if (row.isEmpty()) {
            return rowDenial(caller);
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (DocumentRepository.DocumentRow doc : documents.listDocuments(appId)) {
            items.add(documentView(doc, documents.listVersions(doc.id())));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", items);
        body.put("count", items.size());
        body.put("authority", "spring-database");
        body.put("verificationNote", VERIFICATION_NOTE);
        body.put("localStore", true);
        return ResponseEntity.ok(body);
    }

    public ResponseEntity<?> content(Caller caller, UUID appId, UUID documentId, UUID versionId) {
        Optional<ModelApplicationRepository.Row> row = readable(caller, appId);
        if (row.isEmpty()) {
            return rowDenial(caller);
        }
        Optional<DocumentRepository.DocumentRow> doc = documents.findDocument(documentId, appId);
        if (doc.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        Optional<DocumentRepository.VersionRow> version = documents.findVersion(versionId, documentId);
        if (version.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        try {
            Optional<byte[]> bytes = store.read(version.get().contentSha256());
            if (bytes.isEmpty() || bytes.get().length != version.get().sizeBytes()) {
                return error(HttpStatus.SERVICE_UNAVAILABLE, "service_unavailable");
            }
            String filename = asciiHeaderFilename(version.get().originalFilename());
            return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(bytes.get());
        } catch (IOException e) {
            return error(HttpStatus.SERVICE_UNAVAILABLE, "service_unavailable");
        }
    }

    public ResponseEntity<Map<String, Object>> upload(Caller caller, UUID appId, String idempotencyKey,
                                                      MultipartFile file, String documentKind, String reportLabel,
                                                      String testedOnRaw, String laboratoryName) {
        // Authorisation before anything is parsed or read: a caller who cannot write to this application learns
        // nothing about its payload rules and costs the server no file read or hash.
        if (!ModelDraftPolicy.canWrite(caller)) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        UUID filing = ModelDraftPolicy.filingOrganisation(caller).orElseThrow();
        Optional<ModelApplicationRepository.Row> existing = applications.findOwned(appId, filing);
        if (existing.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        if (!KIND_TEST_REPORT.equals(DraftRequestSupport.trim(documentKind))) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        String label = DraftRequestSupport.trim(reportLabel);
        if (label.isEmpty() || label.length() > 120) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        Optional<LocalDate> testedOn = parseOptionalDate(testedOnRaw);
        if (testedOnRaw != null && !testedOnRaw.isBlank() && testedOn.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        String lab = laboratoryName == null || laboratoryName.isBlank() ? null : DraftRequestSupport.trim(laboratoryName);
        if (lab != null && lab.length() > 120) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        if (file == null || file.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        String filename = sanitizeFilename(file.getOriginalFilename());
        final byte[] fileBytes;
        try {
            fileBytes = readLimited(file);
        } catch (FileTooLargeException e) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        } catch (IOException e) {
            return error(HttpStatus.SERVICE_UNAVAILABLE, "service_unavailable");
        }
        if (!startsWithPdfMagic(fileBytes)) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        byte[] bodyHash = uploadBodyHash(fileBytes, documentKind, reportLabel, testedOnRaw, laboratoryName, filename);
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, appId, idempotencyKey, bodyHash);
        if (replay.isPresent()) {
            return replay.get();
        }
        ModelApplicationRepository.Row row = existing.get();
        if (!"draft".equals(row.state())) {
            return error(HttpStatus.FORBIDDEN, "not_editable");
        }
        Optional<String> brandDeny = brandDenial(caller, row);
        if (brandDeny.isPresent()) {
            return error(HttpStatus.FORBIDDEN, brandDeny.get());
        }
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE_UPLOAD, appId, idempotencyKey, bodyHash)) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }

        /*
         * Consistency: commit the content-addressed blob, then write metadata and complete the idempotency
         * record in one DB transaction (DocumentRecorder).
         * Orphan blobs after a DB failure are harmless (addressed by hash). Missing blobs after
         * a successful insert surface as 503 on read.
         */
        StagedBlob staged = null;
        String sha;
        long size;
        try {
            staged = store.stage(new java.io.ByteArrayInputStream(fileBytes));
            sha = staged.sha256();
            size = staged.sizeBytes();
            store.commit(staged);
            staged = null;
        } catch (FileTooLargeException | InvalidDocumentException e) {
            store.discard(staged);
            abandon(caller, appId, idempotencyKey);
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        } catch (IOException e) {
            store.discard(staged);
            abandon(caller, appId, idempotencyKey);
            return error(HttpStatus.SERVICE_UNAVAILABLE, "service_unavailable");
        }

        try {
            AtomicReference<Map<String, Object>> rendered = new AtomicReference<>();
            recorder.record(caller.accountId(), appId, idempotencyKey,
                new DocumentRecorder.NewVersion(sha, size, filename, label, testedOn.orElse(null), lab),
                r -> {
                    Map<String, Object> view = documentView(r.document(), r.versions());
                    rendered.set(view);
                    return writeJson(view);
                });
            return ResponseEntity.status(HttpStatus.CREATED).body(rendered.get());
        } catch (DocumentRecorder.Denied denied) {
            abandon(caller, appId, idempotencyKey);
            return error(denied.status(), denied.code());
        } catch (Exception e) {
            // Everything the recorder did (metadata and idempotency completion) rolled back together.
            abandon(caller, appId, idempotencyKey);
            return error(HttpStatus.SERVICE_UNAVAILABLE, "service_unavailable");
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

    private void abandon(Caller caller, UUID appId, String key) {
        if (key != null) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE_UPLOAD, appId, key);
        }
    }

    private Optional<ModelApplicationRepository.Row> readable(Caller caller, UUID appId) {
        ReadScope scope = SlicePolicy.readScope(caller);
        if (scope.isEmpty()) {
            return Optional.empty();
        }
        return applications.find(appId, scope, caller.accountId())
            .filter(r -> SlicePolicy.canRead(scope, facts(r)));
    }

    private ResponseEntity<Map<String, Object>> rowDenial(Caller caller) {
        if (SlicePolicy.readScope(caller).isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_read_scope");
        }
        return error(HttpStatus.NOT_FOUND, "not_found");
    }

    private static ApplicationFacts facts(ModelApplicationRepository.Row r) {
        return new ApplicationFacts(r.id(), r.organisationId(), r.state(), r.assignedStagesForCaller(), Set.of(), false);
    }

    private Optional<String> brandDenial(Caller caller, ModelApplicationRepository.Row row) {
        if (row.brandId() == null) {
            return Optional.of("brand_not_permitted");
        }
        var memberships = identity.activeMemberships(caller.accountId());
        LocalDate today = LocalDate.now(ModelDraftPolicy.IST);
        var brandDecision = ModelDraftPolicy.brandForFiling(caller, memberships, row.brandId(), brands, brandService, today);
        if (!brandDecision.allowed()) {
            return Optional.of(brandDecision.denial());
        }
        return Optional.empty();
    }

    private Map<String, Object> documentView(DocumentRepository.DocumentRow doc, List<DocumentRepository.VersionRow> versions) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", doc.id().toString());
        m.put("documentKind", doc.documentKind());
        m.put("verificationStatus", "pending_local_verification");
        m.put("verificationNote", VERIFICATION_NOTE);
        List<Map<String, Object>> vs = new ArrayList<>();
        for (DocumentRepository.VersionRow v : versions) {
            vs.add(versionView(v));
        }
        m.put("versions", vs);
        if (!versions.isEmpty()) {
            m.put("latestVersion", versionView(versions.get(versions.size() - 1)));
        }
        return m;
    }

    private Map<String, Object> versionView(DocumentRepository.VersionRow v) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", v.id().toString());
        m.put("versionNumber", v.versionNumber());
        m.put("contentSha256", v.contentSha256());
        m.put("sizeBytes", v.sizeBytes());
        m.put("mediaType", v.mediaType());
        m.put("originalFilename", v.originalFilename());
        m.put("reportLabel", v.reportLabel());
        if (v.testedOn() != null) {
            m.put("testedOn", v.testedOn().toString());
        }
        if (v.laboratoryName() != null) {
            m.put("laboratoryName", v.laboratoryName());
        }
        m.put("uploadedByAccountId", v.uploadedByAccountId().toString());
        m.put("uploadedAt", v.uploadedAt().toString());
        m.put("verificationStatus", "pending_local_verification");
        return m;
    }

    private Optional<ResponseEntity<Map<String, Object>>> replayOrRequireKey(Caller caller, UUID appId, String key, byte[] hash) {
        if (key == null || !DraftRequestSupport.IDEMPOTENCY_KEY.matcher(key).matches()) {
            return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency_key_required"));
        }
        var stored = idempotency.find(caller.accountId(), "POST", ROUTE_UPLOAD, appId, key);
        if (stored.isEmpty()) {
            return Optional.empty();
        }
        var s = stored.get();
        if (s.inProgress()) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_in_progress"));
        }
        Optional<byte[]> priorHash = idempotency.bodyHash(caller.accountId(), "POST", ROUTE_UPLOAD, appId, key);
        if (priorHash.isEmpty() || !MessageDigest.isEqual(priorHash.get(), hash)) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_key_conflict"));
        }
        Optional<String> scopeDeny = IdempotencyReplayGuard.denialBeforeReplay(caller, applications, identity, json, appId, s.responseBody());
        if (scopeDeny.isPresent()) {
            HttpStatus status = "not_found".equals(scopeDeny.get()) ? HttpStatus.NOT_FOUND : HttpStatus.FORBIDDEN;
            if ("internal_error".equals(scopeDeny.get())) {
                status = HttpStatus.INTERNAL_SERVER_ERROR;
            }
            return Optional.of(error(status, scopeDeny.get()));
        }
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> replayBody = json.readValue(s.responseBody(), Map.class);
            return Optional.of(ResponseEntity.status(s.responseStatus()).header("Idempotency-Replayed", "true").body(replayBody));
        } catch (Exception e) {
            return Optional.of(error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error"));
        }
    }

    private static byte[] uploadBodyHash(byte[] fileBytes, String kind, String label, String testedOn, String lab,
                                         String filename) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(DraftRequestSupport.trim(kind).getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            digest.update(DraftRequestSupport.trim(label).getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            digest.update(DraftRequestSupport.trim(testedOn).getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            digest.update(DraftRequestSupport.trim(lab).getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            digest.update(filename.getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            digest.update(fileBytes);
            return digest.digest();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * The stored display name: path stripped, anything outside letters, digits, combining marks, the zero-width
     * joiners Indic scripts need and ._ ()[]+,- replaced, always ending in .pdf and at most 180 characters.
     * Never rejects; the bytes are judged by the PDF check, not the name.
     */
    static String sanitizeFilename(String raw) {
        String base = raw == null ? "" : raw.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1);
        StringBuilder out = new StringBuilder();
        base.codePoints().forEach(cp -> {
            if (Character.isLetterOrDigit(cp) || isCombiningMark(cp) || cp == ZWNJ || cp == ZWJ
                || "._ ()[]+,-".indexOf(cp) >= 0) {
                out.appendCodePoint(cp);
            } else {
                out.append('_');
            }
        });
        String name = out.toString().replaceAll("\\s+", " ").trim();
        if (name.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
            name = name.substring(0, name.length() - 4);
        }
        String stem = trimEdges(name);
        if (stem.length() > MAX_STEM) {
            stem = stem.substring(0, MAX_STEM);
            if (Character.isHighSurrogate(stem.charAt(stem.length() - 1))) {
                stem = stem.substring(0, stem.length() - 1);
            }
            stem = trimEdges(stem);
        }
        if (stem.codePoints().noneMatch(Character::isLetterOrDigit)) {
            stem = "report";
        }
        return stem + ".pdf";
    }

    private static String trimEdges(String value) {
        return value.replaceAll("^[. ]+|[. ]+$", "");
    }

    private static boolean isCombiningMark(int cp) {
        int type = Character.getType(cp);
        return type == Character.NON_SPACING_MARK || type == Character.COMBINING_SPACING_MARK;
    }

    /** Header-safe name: the BFF only forwards ASCII; the exact name stays in the version metadata. */
    static String asciiHeaderFilename(String stored) {
        String ascii = stored.replaceAll("[^A-Za-z0-9._ -]", "_");
        return ascii.isBlank() || ascii.length() > 180 ? "document.pdf" : ascii;
    }

    private static Optional<LocalDate> parseOptionalDate(String raw) {
        if (raw == null || raw.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.of(LocalDate.parse(raw.trim()));
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private String writeJson(Map<String, Object> view) {
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
