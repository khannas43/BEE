package gov.bee.api.manufactureronboarding;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.UUID;

/** Mirrors {@code manufacturer_onboarding_canonical_hash} in V75. */
final class ManufacturerOnboardingCommandHash {

    private ManufacturerOnboardingCommandHash() {
    }

    static String canonicalHash(List<String> parts) {
        String joined = String.join("|", parts);
        return md5Hex(joined) + md5Hex("mob-canonical|" + joined);
    }

    static String submit(UUID applicationId, UUID actor, int version, BigDecimal amountInr, String feeRuleKey, int feeRuleVersion,
                         String verificationStatus, String sourceReference, String note) {
        return canonicalHash(List.of(
            "submit",
            applicationId.toString(),
            actor.toString(),
            "manufacturer",
            Integer.toString(version),
            amountInr.toPlainString(),
            feeRuleKey,
            Integer.toString(feeRuleVersion),
            verificationStatus == null ? "" : verificationStatus,
            sourceReference == null ? "" : sourceReference,
            note == null ? "" : note));
    }

    static String publicSignup(String fullName, String email, String mobile, UUID keycloakSubject) {
        return canonicalHash(List.of(
            "public_signup",
            email == null ? "" : email,
            mobile == null ? "" : mobile,
            fullName == null ? "" : fullName,
            keycloakSubject == null ? "" : keycloakSubject.toString()));
    }

    static String directorDecision(UUID applicationId, UUID actor, int version, String decision, String note) {
        String trimmedNote = note == null ? "" : note.trim();
        return canonicalHash(List.of(
            "director_decision",
            applicationId.toString(),
            actor.toString(),
            Integer.toString(version),
            decision,
            trimmedNote.isEmpty() ? "" : trimmedNote));
    }

    static String raiseAnomaly(UUID applicationId, UUID actor, String actorRole, int version, String reason) {
        return canonicalHash(List.of(
            "raise_anomaly",
            applicationId.toString(),
            actor.toString(),
            actorRole,
            Integer.toString(version),
            reason == null ? "" : reason.trim()));
    }

    static String resolveAnomaly(UUID applicationId, UUID actor, int version, String resolution, String note) {
        String purpose = "revoked".equals(resolution) ? "revoke" : "resolve_anomaly";
        String trimmedNote = note == null ? "" : note.trim();
        return canonicalHash(List.of(
            purpose,
            applicationId.toString(),
            actor.toString(),
            Integer.toString(version),
            resolution,
            trimmedNote.isEmpty() ? "" : trimmedNote));
    }

    private static String md5Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("MD5").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(32);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
