-- DEMO: the reason a brand is suspended or revoked, written on the brand's note (the register shows it beside the status and on the
-- Manufacturer 360 profile). A suspension or revocation made through the screens keeps its reason in register_status_event instead.
-- Synthetic data only. Idempotent: only a note that still holds the generic seed text is replaced.
BEGIN;
UPDATE brand SET note = 'Suspended while a second applicant disputes ownership of the brand name. The owner has been asked for proof of first use; the suspension stays until the BEE Officer rules on it (synthetic).'
 WHERE name = 'Breezo Home (synthetic)' AND status = 'suspended' AND note LIKE 'Synthetic brand for the register%';
UPDATE brand SET note = 'Suspended because two label-fee reconciliation notices went unanswered for more than 60 days. It can be lifted once the outstanding reconciliation is settled (synthetic).'
 WHERE name = 'Mistral Cool (synthetic)' AND status = 'suspended' AND note LIKE 'Synthetic brand for the register%';
UPDATE brand SET note = 'Revoked after an approved proposal: QR serials issued to this brand were found on products of a model that was never approved for it (synthetic).'
 WHERE name = 'Tundra Line (synthetic)' AND status = 'revoked' AND note LIKE 'Synthetic brand for the register%';
UPDATE brand SET note = 'Revoked at the request of the owner after financial clearance; the brand was withdrawn from the market (synthetic).'
 WHERE name = 'Zephyr Air (synthetic)' AND status = 'revoked' AND note LIKE 'Synthetic brand for the register%';
COMMIT;
