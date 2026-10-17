# SNL WP01 — field dictionary

**Status:** Working baseline. No new mandatory fields invented beyond the manual.  
**Governing source:** Annexure 1 (printed pp. 50–53), Annexure 1-A (pp. 52–53), §3.1.1 (pp. 22–23); Annexure 3 (pp. 56–57), §3.1.3 (pp. 23–24).  
**Public form comparison:** https://www.beestarlabel.com/Manufacturer/AgencyRegistration — **not retrieved** (504 Gateway Timeout, 18 Oct 2026). Column **Public form** is **Pending (BL-252)**.

**Legend — current implementation:** `RegistrationForm` / OpenAPI `Registration`; model application types in OpenAPI and model screens.

## 1. Company / brand registration (Annexure 1 and 1-A)

| Object | Field / document | Owner | Required when | Validation / format | Supporting document | Source (printed pp.) | Current implementation | Gap |
|---|---|---|---|---|---|---|---|---|
| Form I | Appliance categories applied for | Applicant | Brand/company registration | Free text in form narrative | — | Annexure 1 §1 (p. 50) | Not captured (only RAC-oriented brand name) | **Major** (WP3) |
| Form I | Full business address | Applicant | Registration | Address lines | Premises auth doc | Annexure 1 §1 (p. 50); 1-A company address (p. 52) | Organisation address exists separately; not on registration application | **Partial** |
| Form I | Firm / company legal name | Applicant | Registration | As per incorporation | Certificate of incorporation | Annexure 1 §1–2 (pp. 50–51); §3.1.1 (p. 22) | Organisation master; not duplicated on brand registration row | **Partial** (A01) |
| Form I | Authorised applicant (name, designation) | Applicant | Registration | Signed declaration | Authorised signatory letter | Annexure 1 §2(a) (p. 50) | Not on form | **Major** |
| Form I | Contact person (name, designation) | Applicant | Registration | — | — | Annexure 1 §2(b) (p. 51) | Not on form | **Major** |
| Form I | Change notification for authorised/contact persons | Applicant | Ongoing | Undertaking | — | Annexure 1 §2(c) (p. 51) | Not implemented | **Major** (WP3) |
| Annexure 1-A | Company name | Applicant | Registration | — | Incorporation / SSI | 1-A §1 (p. 52); §3.1.1 (p. 22) | Organisation | **Partial** |
| Annexure 1-A | Address, pin, state, phone, email, website | Applicant | Registration | — | — | 1-A §1 (p. 52) | Organisation profile (partial) | **Partial** |
| Document | Premises authentication | Applicant | Registration | Yes/No checklist | Upload | 1-A enclosures #1 (p. 52); §3.1.1 (p. 22) | Trade-licence PDF slot (single doc); not full checklist | **Partial** (A05) |
| Document | Trademark certificate (class for appliances) | Applicant | Registration | Valid trademark | Upload | 1-A #2 (p. 52); §3.1.1 (p. 22) | Not required in portal checklist | **Major** |
| Document | Certificate of incorporation / SSI | Applicant | SSI or company | Valid | Upload | 1-A #3 (p. 52); §3.1.1 (p. 22) | Not in checklist | **Major** |
| Document | ISO 9001 QMS certificate | Applicant | Registration | Accredited body | Upload | 1-A #4 (p. 52); §3.1.1 (p. 22) | Not in checklist | **Major** |
| Document | Authorised signatory letter + specimen signature | Applicant | Registration | Stamped | Upload | 1-A #5 (p. 52); §3.1.1 (p. 22) | Not in checklist | **Major** |
| Document | BIS licence | Applicant | If applicable | Valid | Upload | 1-A #6 (p. 52); §3.1.1 (p. 22) | Not in checklist | **Major** |
| Document | Company PAN and GST | Applicant | Registration | — | Upload | §3.1.1 (p. 22) | Not on registration form | **Major** |
| Document | List of authorized retailers | Applicant | Registration | — | Upload | §3.1.1 (p. 22) | Not captured at registration (retailer list §1.3.5(h) annual — WP7) | **Major** |
| Document | Voluntary agreement (INR 100 stamp, 3 years) | Applicant | Voluntary programmes | Agreement | Annexure 2 | §3.1.1 (p. 22); Annexure 2 (pp. 54–55) | Not implemented | **Major** (WP3/WP9) |
| Manufacturing premises | Facility name, address, pin, state/country, contacts | Applicant | Per facility | Table per site | — | 1-A §2 (pp. 52–53) | Not captured | **Major** |
| Portal field | Brand name | Applicant | kind=`brand` | `BRAND_NAME` regex, max 120 | — | §3.1.1 each brand separately (p. 22) | `RegistrationForm` `brandName` | **Partial** (name only) |
| Portal field | Brand choice, authorisation dates | Applicant | kind=`agency` | Date rules | — | **Not in manual** (agency path) | `RegistrationForm` | **Conflict** — implementation-only |
| Fee | Company registration fee | Applicant | On submit | ₹5,000 per §4.1 | Payment receipt | §4.1 (p. 30) | Fee snapshot + Finance confirm | **Partial** (A07, A16) |
| Fee | Label security deposit (per category) | Applicant | Category registration | §4.2 amounts | — | §3.1.2 (p. 23); §4.2 (pp. 30–31) | Not implemented | **Major** (WP3) |
| Outcome | Company registration number (permittee) | BEE | After approval | Unique ID | — | §3.1.1 (p. 22) | Not stored on registration | **Major** (A20) |

## 2. Model registration (Annexure 3)

| Object | Field | Owner | Required when | Validation | Supporting document | Source (printed pp.) | Current implementation | Gap |
|---|---|---|---|---|---|---|---|---|
| §1 | Company name | Applicant | Model apply | Match registered company | — | Annexure 3 §1(i) (p. 56) | From organisation context | **Partial** |
| §1 | Brand name | Applicant | Model apply | Registered brand | — | §1(ii) (p. 56) | Brand linkage in model flow | **Partial** |
| §1 | Registered address | Applicant | Model apply | — | — | §1(iii) (p. 56) | Organisation | **Partial** |
| §1 | BEE User ID | Applicant | Model apply | Portal account | — | §1(iv) (p. 56) | Auth subject (implicit) | **Partial** |
| §1 | Contact person, designation, email, mobile, landline | Applicant | Model apply | — | — | §1(v)–(ix) (p. 56) | Partial contact in org/user | **Partial** |
| §2 | Appliance category | Applicant | Model apply | Official category list | — | §2(i) (p. 56); §3.1.3 (p. 23) | RAC only (A4) | **Partial** |
| §2 | Sub-category / type | Applicant | Model apply | Category-specific | — | §2(ii) (p. 56) | Partial in model schema | **Partial** (WP4) |
| §2 | Model name / number / code | Applicant | Model apply | Unique per brand/category | — | §2(iii) (p. 56) | Model application fields | **Partial** |
| §2 | Rated capacity / output | Applicant | Model apply | Schedule-specific | — | §2(iv) (p. 56) | Category fields | **Partial** |
| §2 | Manufacturing location | Applicant | Model apply | — | — | §2(v) (p. 56) | Not fully mapped | **Partial** |
| §2 | Country of origin | Applicant | Model apply | Declare foreign if imported | — | §2(vi) (p. 56); §5(f) (p. 33) | May be partial | **Partial** |
| §2 | Cost of appliance | Applicant | If available | Optional | — | §2(vii) (p. 56) | Not captured | **Minor** |
| §3 | Test standard name, number, year | Applicant | Model apply | Matches test report | Test report | §3(i) (p. 56) | Standard selection (M2/A3) | **Partial** |
| §3 | Laboratory name, address | Applicant | Model apply | Accredited | Lab cert | §3(ii)–(iii) (p. 56) | Laboratory picker (B2) | **Partial** |
| §3 | Accreditation status (ILAC/APAC/NABL) | Applicant | Model apply | In scope | Lab cert | §3(iv) (p. 56) | Accreditation check on test date | **Partial** |
| §3 | Lab scope for standard | Applicant | Model apply | — | — | §3(v) (p. 56) | Partial | **Partial** |
| §3 | In-house vs 3rd party lab | Applicant | Model apply | — | — | §3(vi) (p. 56) | Not explicit field | **Minor** |
| §3 | Date of test | Applicant | Model apply | Not future; max age 3 years (5 transformers) | Test report | §3(vii) (p. 56); §3.1.3 (p. 23) | Test date + max age config | **Partial** |
| §4 | Notification / schedule number | Applicant | Model apply | — | — | §4(i) (p. 56) | Not mapped | **Partial** (WP4) |
| §4 | Test mode details | Applicant | Model apply | — | Test report | §4(ii) (p. 56) | Not mapped | **Partial** |
| §4 | Energy performance parameter(s) | Applicant | Model apply | — | Test report | §4(iii) (p. 56) | Rating inputs | **Partial** |
| §4 | Rated star label | Applicant | Model apply | — | — | §4(iv) (p. 56) | Computed rating step | **Partial** |
| §4 | Measured / specified values, tolerance | Applicant | Model apply | Schedule rules | Test report | §4(v)–(vii) (pp. 56–57) | Partial ISEER path | **Partial** |
| §5 doc 1 | Signed model registration form | Applicant | Submit | Signed/stamped | Upload | §5 #1 (p. 57) | Online form substitute | **Partial** (A19) |
| §5 doc 2 | Test report (≤3 years) | Applicant | Submit | NABL/ILAC/APLAC | Upload | §5 #2 (p. 57); §3.1.3 (p. 23) | Required test report doc | **Aligns** (B1) |
| §5 doc 3 | Family of models declaration | Applicant | If family | — | Upload | §5 #3 (p. 57) | Families not in scope (B4) | **Gap** if families required |
| §5 doc 4 | Lab accreditation certificate | Applicant | Submit | — | Upload | §5 #4 (p. 57) | Partial | **Partial** |
| §5 doc 5 | BIS certificate | Applicant | If applicable | — | Upload | §5 #5 (p. 57) | Not in checklist | **Partial** |
| §5 doc 6 | Sample BEE label | Applicant | Submit | Per schedule | Upload | §5 #6 (p. 57) | Label preview elsewhere | **Partial** |
| §5 doc 7 | Application fee payment receipt | Applicant | After pay | ₹5,000 model fee | Upload | §5 #7 (p. 57); §4.3 (p. 31) | Payment record vs receipt upload | **Partial** |
| §5 doc 8 | Other schedule documents | Applicant | As required | Configurable | Upload | §5 #8 (p. 57) | A05 configurable docs | **Partial** |
| §6 | Authorised signatory declaration | Applicant | Submit | Seal + signature | — | §6 (p. 57) | Submit action | **Partial** |

## 3. Cross-reference

- Traceability and packages: [SNL_WP01_BASELINE.md](SNL_WP01_BASELINE.md) §3.  
- Document configuration assumption: **A05**, **A06**, **A19** in [docs/BEE_DECISIONS.md](../BEE_DECISIONS.md) (18 October 2026).  
- Next implementation: full Annexure 1 checklist and entity master (**WP3**); Annexure 3 field schema (**WP4**).
