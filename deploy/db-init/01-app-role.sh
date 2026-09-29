#!/bin/sh
# Runs once, when the database volume is first created.
# Creates the restricted role the application uses at runtime.
# That role is subject to row-level security; the owner role (POSTGRES_USER) is not.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lockred_app') THEN
    CREATE ROLE lockred_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_DB_PASSWORD}';
  ELSE
    ALTER ROLE lockred_app WITH LOGIN PASSWORD '${APP_DB_PASSWORD}';
  END IF;
END
\$\$;
GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO lockred_app;
EOSQL
