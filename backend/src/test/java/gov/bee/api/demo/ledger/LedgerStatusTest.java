package gov.bee.api.demo.ledger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.demo.ledger.LedgerStatus.Link;
import gov.bee.api.demo.ledger.LedgerStatus.Tx;
import java.util.List;
import org.junit.jupiter.api.Test;

class LedgerStatusTest {

    static String h(char c) {
        return String.valueOf(c).repeat(64);
    }

    @Test
    void statusIsDerivedFromTheTransactions() {
        assertEquals("not_submitted", LedgerStatus.of(List.of()));
        assertEquals("pending", LedgerStatus.of(List.of(new Tx(1, "issue", "pending"))));
        assertEquals("failed", LedgerStatus.of(List.of(new Tx(1, "issue", "failed"))));
        assertEquals("pending", LedgerStatus.of(List.of(new Tx(1, "issue", "failed"), new Tx(2, "issue", "pending"))));
        assertEquals("active", LedgerStatus.of(List.of(new Tx(1, "issue", "committed"))));
        assertEquals("active", LedgerStatus.of(List.of(new Tx(1, "issue", "committed"), new Tx(2, "amend", "pending"))));
        assertEquals("amended", LedgerStatus.of(List.of(new Tx(1, "issue", "committed"), new Tx(2, "amend", "committed"))));
        assertEquals("active", LedgerStatus.of(List.of(new Tx(1, "issue", "committed"), new Tx(2, "revoke", "pending"))));
        assertEquals("revoked", LedgerStatus.of(List.of(new Tx(1, "issue", "committed"), new Tx(2, "amend", "committed"), new Tx(3, "revoke", "committed"))));
        assertEquals("revoke", LedgerStatus.pendingKind(List.of(new Tx(1, "issue", "committed"), new Tx(2, "revoke", "pending"))));
    }

    @Test
    void chainMatchesOnlyWhenLinkedAndRecomputed() {
        var ok = List.of(new Link(1, LedgerStatus.GENESIS, h('a'), h('a')), new Link(2, h('a'), h('b'), h('b')));
        assertTrue(LedgerStatus.verify(ok).match());
        var tampered = List.of(new Link(1, LedgerStatus.GENESIS, h('a'), h('a')), new Link(2, h('a'), h('b'), h('c')));
        var r = LedgerStatus.verify(tampered);
        assertFalse(r.match());
        assertEquals(2, r.firstBadSeq());
        var broken = List.of(new Link(1, LedgerStatus.GENESIS, h('a'), h('a')), new Link(2, h('z'), h('b'), h('b')));
        assertFalse(LedgerStatus.verify(broken).match());
        assertNull(LedgerStatus.verify(ok).firstBadSeq());
    }
}
