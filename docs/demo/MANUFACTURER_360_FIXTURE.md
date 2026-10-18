# Manufacturer 360 demo fixture

**Route:** `/app/demo/manufacturer-360`
**Fixture module:** `lib/demo/manufacturer360Fixture.ts`
**UI:** `components/app/demo/Manufacturer360Demo.tsx`

All synthetic values on this page use the disclosure:

**Demonstration preview — synthetic data, not a BEE record.**

## Field → future replacement

| Fixture area | Source today | Planned replacement |
| --- | --- | --- |
| Header KPIs (brands, categories, models, QR, production, fees, renewals, discrepancies) | `MANUFACTURER_360_HEADER` | **WP8** Manufacturer 360 read API / aggregation |
| Organisation / permittee identifier | Synthetic `ORG-NOVA-001` | **WP3** entity master + registration register |
| Lifecycle rail stage facts | `MANUFACTURER_360_STAGES` | **WP3–WP9** respective command/query APIs per stage |
| Timeline states | `MANUFACTURER_360_TIMELINE` | **SNL_WP01_STATE_MODELS** persisted transitions (model + registration) |
| Discrepancy cycle narrative | `MANUFACTURER_360_DISCREPANCY` | **WP2/WP4** return/resubmit/disposition (`workflow_discrepancy_*`) |
| Financial / QR reconciliation numbers | `MANUFACTURER_360_FINANCE` (partial overlap with demo payments **WP5**) | **WP5** payments + **WP6** QR + **WP7** production reconciliation |
| WP9 preview cards (except register revocation link) | `MANUFACTURER_360_WP9_CARDS` | **WP9** renewal, withdrawal, cancellation jobs and APIs |
| Register revocation card | Link to `/app/registrations/register` | **WP4.2b** existing register-revocation API (working) |

Working-screen links point at real portal routes; they do not imply WP3–WP9 production completion.
