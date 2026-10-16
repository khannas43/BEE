# After the demonstration: what is decided, what is deferred, and what a real Fabric network needs

Recorded 16 October 2026 from the owner's answers on the "what else could be added" list. The demonstration stays simulated where it says so.

## Decided for the demonstration
- **Payment gateway:** a dummy (simulated) gateway only. A real gateway is chosen and integrated when the project is awarded.
- **Sign-in:** username and password only, no authenticator code (demo-only weakening, on only with `BEE_DEMO_LOGIN=1` for the portal and `BEE_MFA_REQUIRED=false` for the API; never on a non-demo deployment).
- **Mobile:** a phone layout is not required for this application.
- **Notifications:** driven from the database (the triggers of V66 write an outbox). Real e-mail and SMS delivery is connected when the project is awarded.
- **`/api/demo/**` (BL-220):** the demo-only HTTP routes behind the payment, QR, ledger, production, MIS, AI and dashboard screens. They exist only when the API runs with `BEE_DEMO_LOGIN=1`, are described in `docs/demo/API.md` and are deliberately outside the formal API contract. Nothing to do now. When the project is awarded each route is either retired (replaced by the real one) or promoted into the contract (BL-229); the messages routes were promoted already.

## Built for this demonstration, from the same list
- **Exports:** CSV and real Excel (.xlsx) downloads on every list and on the MIS panels, a real PDF of the certificate and star label with a scannable QR code. All checked with real files (an independent spreadsheet reader, a PDF renderer and a QR decoder).
- **Role dashboards:** the Director's dashboard (six figures that drill down to the records behind them) and the Auditor's dashboard (ledger chain verification, two-person proof, AI overrides, payment trail, production reviews, a single activity feed).

## What a real Hyperledger Fabric network needs (not built; replaces the simulated ledger)
1. **Decisions first.** Fabric version and distribution; which organisations run peers (BEE, state agencies, laboratories?) and the ordering service (Raft); one channel or several; hosting (own data centre or cloud); the endorsement policy that stands for today's "a second person must commit"; identity (Fabric CA or the government PKI) and how roles map to certificates.
2. **Network.** Certificate authorities, MSPs, peers, orderers, TLS everywhere, keys in an HSM or a managed key store, backup and disaster recovery, monitoring, and an upgrade process.
3. **Chaincode.** The certificate asset (registration id, manufacturer, model, stars, validity, status), the functions (issue, amend valid-to, revoke, read, history, list by manufacturer), the two-signature rule as state-based endorsement, events, role checks from certificate attributes, a decision on what stays off-chain (personal data; only hashes of documents go on-chain), and a lifecycle for upgrading chaincode.
4. **Integration in Spring.** The Fabric Gateway client and an identity wallet; asynchronous submit with retries and idempotency; a block-event listener that turns real commit events into today's pending, committed and failed states; handling of endorsement failures, read-write conflicts and time-outs; a reconciliation job that compares the database with the ledger.
5. **Data.** The simulated hash-chain tables become an index of on-chain state (transaction id, block number, hash) while the audit tables stay; a migration for existing certificates; verification and the public check read the real ledger (or a signed cache of it).
6. **Screens.** The block explorer and "verify chain" show real transaction ids and block numbers; the two-person flow shows who endorsed.
7. **Security and compliance.** Key custody, mutual TLS, least-privilege invocation, rate limits, an independent security test, data-residency and data-protection review, and the legal standing of an on-chain record.
8. **Testing.** Chaincode unit tests, a local test network in the build, integration tests against it, load and latency tests, failure injection (peer down, orderer down), upgrade drills.
9. **Operations.** Deployment automation, chaincode CI/CD, dashboards and alerts, runbooks, staff training.
10. **Transition.** Put the ledger behind one interface with two implementations, simulated and real, so the demo keeps working while the real network is built; cut over certificate by certificate.

Rough size, for planning only: a small team, about three to four months for a first production-grade network with the integration and testing, longer if several organisations host peers.
