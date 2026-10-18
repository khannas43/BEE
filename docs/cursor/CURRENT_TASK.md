# Current Cursor task

**Holder:** claude compatibility baton (ChatGPT review complete), 18 October 2026.

- Brief: **C2 — WP3 automatic manufacturer activation and 15-day observation**
- Branch: `cursor/wp3-auto-activation`
- Worktree: `/Users/sameerkhanna/Developer/BEE-wp3-auto-activation`
- Base: `cursor/demo-wp3-onboarding-final` @ `9b3a3bd`
- Public demo: `https://nicola-habited-barb.ngrok-free.dev`

## Owner-approved behaviour

1. Applicant submits the manufacturer application.
2. Payment and automated document/eligibility checks run automatically.
3. A successful result activates the manufacturer immediately; there is no Director pre-approval.
4. Director, Programme and Finance receive information and can raise an anomaly only during the 15-day observation window.
5. An anomaly places the registration on immediate hold. Director may clear it or revoke the registration.
6. If no unresolved anomaly remains at the deadline, the scheduled job closes observation and the manufacturer remains active.

## Implementation

- V77 changes submit to automatic activation, starts the observation window, allocates the permittee number and notifies the three official roles.
- V77 limits the expedited anomaly command to `active_observation` and adds the trusted scheduled close command.
- Spring scheduling calls the trusted close command daily in Asia/Kolkata.
- Director UI is an information/oversight view; manual Approve/Reject controls are removed.
- Demo fixture, journey script, WP3 design, implementation plan and backlog are aligned.

## Gates

| Gate | Result |
| --- | --- |
| Default backend suite | **161/161** |
| Full database suite | **591/591** |
| WP3 database proofs | **28/28** |
| TypeScript | pass |
| ESLint (changed frontend/demo files) | pass |
| Web tests | **264/264** |
| UI tests | **239/239** |
| Production build | pass |
| Coordinated live onboarding journey | **23/23** |
| WP3–WP9 reliability check | **21/21** |
| Public ngrok route | **HTTP 200** |

## Handback

- V77 is installed on the coordinated `app` schema and the public demo is running from this worktree.
- Live evidence: `.local/run/c1-journey-evidence.json` (gitignored).
- Guest self-service account creation and email/mobile OTP remain a separate follow-up; C2 changes the already-authenticated onboarding flow.
