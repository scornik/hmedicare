-- Local only: a second database for integration tests run with TEST_DATABASE_URL against compose.
CREATE DATABASE IF NOT EXISTS hmedic_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci;
GRANT ALL PRIVILEGES ON hmedic_test.* TO 'hmedic_app'@'%';
