package gov.bee.api.demo.ledger;

import java.util.List;

/** Pure rules of the simulated ledger: the derived status of a certificate and the check of a hash chain. Demonstration code, not BEE rules. */
public final class LedgerStatus {

    public static final String GENESIS = "0".repeat(64);

    /** One transaction, as far as the rules need it. */
    public record Tx(int seq, String kind, String state) {
    }

    /** One row of a chain check: what is stored, and the hash recomputed from the certificate fields and the stored previous hash. */
    public record Link(int seq, String prevHash, String hash, String expectedHash) {
    }

    public record Check(boolean match, Integer firstBadSeq, String reason) {
    }

    private LedgerStatus() {
    }

    /** not_submitted | pending | failed | active | amended | revoked. Transactions are in seq order. */
    public static String of(List<Tx> txs) {
        if (txs.isEmpty()) {
            return "not_submitted";
        }
        if (txs.stream().anyMatch(t -> t.kind().equals("revoke") && t.state().equals("committed"))) {
            return "revoked";
        }
        Tx lastIssue = null;
        for (Tx t : txs) {
            if (t.kind().equals("issue")) {
                lastIssue = t;
            }
        }
        if (lastIssue == null || !lastIssue.state().equals("committed")) {
            return lastIssue != null && lastIssue.state().equals("failed") ? "failed" : "pending";
        }
        return txs.stream().anyMatch(t -> t.kind().equals("amend") && t.state().equals("committed")) ? "amended" : "active";
    }

    /** The kind of the transaction waiting for a peer, or null. */
    public static String pendingKind(List<Tx> txs) {
        return txs.stream().filter(t -> t.state().equals("pending")).map(Tx::kind).findFirst().orElse(null);
    }

    /** True when each row links to the stored hash of the row before it and its own hash is the recomputed one. */
    public static Check verify(List<Link> chain) {
        String prev = GENESIS;
        for (Link l : chain) {
            if (!l.prevHash().equals(prev)) {
                return new Check(false, l.seq(), "previous hash does not match the earlier transaction");
            }
            if (!l.hash().equals(l.expectedHash())) {
                return new Check(false, l.seq(), "stored hash differs from the hash recomputed from the certificate fields");
            }
            prev = l.hash();
        }
        return new Check(true, null, null);
    }
}
