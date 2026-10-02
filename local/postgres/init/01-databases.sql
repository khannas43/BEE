-- Runs once, when the project volume is first created (psql, via the postgres entrypoint).
-- A .sql file rather than .sh: Rancher Desktop bind mounts report files as executable,
-- which makes the entrypoint try to exec a script and fail.
-- bee_app (Spring) and keycloak (identity) are separate databases with separate
-- owners. The bee_app login cannot connect to the keycloak database, so an
-- application reset running as bee_app cannot touch identity data.
\set ON_ERROR_STOP on
\getenv app_pw BEE_APP_DB_PASSWORD
\getenv maint_pw BEE_MAINT_DB_PASSWORD
\getenv kc_pw BEE_KC_DB_PASSWORD

CREATE ROLE bee_app LOGIN PASSWORD :'app_pw';
CREATE ROLE bee_local_maint LOGIN PASSWORD :'maint_pw';
CREATE ROLE keycloak LOGIN PASSWORD :'kc_pw';
ALTER ROLE bee_app SET search_path = app;
CREATE DATABASE bee_app OWNER bee_app;
CREATE DATABASE keycloak OWNER keycloak;
REVOKE CONNECT ON DATABASE keycloak FROM PUBLIC;
REVOKE CONNECT ON DATABASE bee_app FROM PUBLIC;
GRANT CONNECT ON DATABASE keycloak TO keycloak;
GRANT CONNECT ON DATABASE bee_app TO bee_app;
GRANT CONNECT ON DATABASE bee_app TO bee_local_maint;

\connect bee_app
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA app AUTHORIZATION bee_app;
ALTER ROLE bee_local_maint SET search_path = app;
