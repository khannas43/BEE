import "server-only";

/**
 * The demonstration sign-in (docs/demo/DEMO_WORK_PLAN.md): a plain username and password page with no authenticator code. It exists only
 * when the deployment sets BEE_DEMO_LOGIN=1 (together with BEE_MFA_REQUIRED=false for the API and the Keycloak setup script
 * scripts/demo/login-setup.cjs). Anything else leaves the normal sign-in with the one-time code as the only way in, and the route answers 404.
 */
export const demoLoginEnabled = () => process.env.BEE_DEMO_LOGIN === "1";
