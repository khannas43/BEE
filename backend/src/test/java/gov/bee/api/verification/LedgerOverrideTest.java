package gov.bee.api.verification;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/** The ledger status is SQL NULL for an active certificate: that row must read as "no override", not throw (found in the demo rehearsal). */
class LedgerOverrideTest {

    @SuppressWarnings("unchecked")
    private PublicVerificationRepository repoReturning(List<String> rows) {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(rows);
        return new PublicVerificationRepository(jdbc);
    }

    @Test
    void anActiveCertificateRowWithANullStatusIsNoOverride() {
        assertNull(repoReturning(Arrays.asList((String) null)).ledgerOverride("BEE/RAC/2026/10101"));
    }

    @Test
    void noLedgerRowsIsNoOverride() {
        assertNull(repoReturning(List.of()).ledgerOverride("BEE/RAC/2026/10101"));
    }

    @Test
    void revokedAndPendingAreReturned() {
        assertEquals("revoked", repoReturning(List.of("revoked")).ledgerOverride("x"));
        assertEquals("pending", repoReturning(List.of("pending")).ledgerOverride("x"));
    }
}
