# Walkthrough: one application from draft to approved, on your own Mac

**A local demonstration on provisional rules, not a BEE system.** The fee (₹24,000), the star bands, the laboratory and the standard are stand-ins. The star rating is labelled "not a BEE rating" on screen. Nothing here is accepted by BEE.

## Start it

```
cd /Users/sameerkhanna/Documents/Projects/BEE
npm run local:up        # PostgreSQL and Keycloak in Docker; the Spring API and the Next.js portal as normal processes
npm run local:seed      # puts the four sample applications and the sample people in place
npm run local:health    # all four should say UP
```

Open **http://127.0.0.1:3100**. Stop everything with `npm run local:down` (the data is kept).

## Signing in

- Click **Sign in**. You land on Keycloak.
- Password for every sample person: the value of `BEE_DEV_USER_PASSWORD` in `local/local.env` (a local-only default).
- Every person must also give a **one-time code**. The first time a person signs in, Keycloak shows a QR code: scan it with an authenticator app (Google Authenticator, Authy, 1Password…) and type the 6-digit code. After that, each sign-in asks for the current code. A code works once, so if you sign in again within the same 30 seconds, wait for the next one.
- Use a separate browser profile, or a private window, for each person you want signed in at the same time.

## The people

| Sign in as | Role | What they do |
| --- | --- | --- |
| `nova.applicant` | Manufacturer (Nova Appliances) | Files the application, sees why it was returned or rejected, edits and resubmits |
| `bee.finance` | Finance | Confirms the fee was received |
| `iame.officer` | IAME officer | Checks the test report; recommends, returns or rejects |
| `bee.reviewer` | BEE Reviewer | Forwards to rating; returns or rejects |
| `bee.programme` | Programme | Computes the (demonstration) star rating; rejects |
| `bee.director` | Program Director | Recommends approval; returns or rejects |
| `bee.secretary` | Secretary | Gives final approval; returns or rejects |

## The journey (about ten minutes)

1. **`nova.applicant`** → *New model application*. Pick the brand *Nova Cool*, type a model number (any new one), choose laboratory *LAB*, a test date in the past, and an efficiency of **4.5**. **Save draft**, then click **Edit draft first**: there you can upload any small **PDF** as the test report. Then **Review submit and provisional fee** → **Submit**. It is now *fee due*.
2. **`bee.finance`** → *Finance queue* → open it → type any receipt reference and the date received; the amount is prefilled (₹24,000) → **Confirm fee received**.
3. **`iame.officer`** → *IAME scrutiny* → open it → read the test report, choose a finding, write a note → **Record finding and forward**. (To see the other paths instead: **Return to the applicant**, or **Reject permanently**.)
4. **`bee.reviewer`** → *BEE scrutiny* → open it. The **History** at the bottom now shows the IAME officer's finding and note → write a note → **Forward to rating**.
5. **`bee.programme`** → *Rating calculation* → type the efficiency you verified (for example **4.62**) → **Compute and record rating**. Four stars, shown as a local demonstration.
6. **`bee.director`** → *Approval* → see the rating, the figures and every earlier note → write a note → **Recommend approval**. (In this demonstration the Director's recommendation is *not* final for room air conditioners, so it goes to the Secretary.)
7. **`bee.secretary`** → *Approval* → **Give final approval**. The application is now **approved**.
8. **`nova.applicant`** → *My model applications* → open it → the **History** tab shows every step in order. You will see the roles and organisations, the notes addressed to you, and "Internal note, not shown to you" on the officers' working steps.

## Things worth trying

- **Return and resubmit.** At step 3, 4, 6 or 7 use **Return to the applicant** with a reason. As `nova.applicant`, open the application: the reason is shown, the brand and model number are locked, you can correct the evidence and **Resubmit**. It goes back to the officer who returned it. If you change the declared efficiency after the rating exists and it was returned from the Director or Secretary, it goes **back through rating** and the earlier rating is kept as version 1.
- **Reject.** **Reject permanently** needs a reason and a tick. The application is then final: nobody can change it, the applicant sees the reason, and the same model number can be used for a new application.
- **Try to cheat.** Sign in as `nova.applicant` and open the Finance queue or the IAME screen by address (for example `/app/finance/finance-queue`): the portal shows nothing, because the server decides what each person may see. A person who took one step cannot take a later one on the same application.
- **A ready-made case.** `LOCAL-MA-0003` is already waiting for the IAME officer, so you can start at step 3 without filing anything.

## If something looks wrong

- `npm run local:health` tells you which of the four parts is down; `npm run local:up` is safe to run again.
- To go back to the sample data, `npm run local:seed`.
- Please do not run `npm run local:check` while you are looking: it signs in as test accounts, creates and deletes applications, and briefly switches off the real IAME officer's and Reviewer's roles.
