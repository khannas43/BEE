-- WP05.1c re-review: only bee_local_maint may register disposable applications for cleanup.
REVOKE INSERT, DELETE, UPDATE ON local_disposable_application FROM bee_app;
REVOKE INSERT, DELETE, UPDATE ON local_disposable_application FROM PUBLIC;
