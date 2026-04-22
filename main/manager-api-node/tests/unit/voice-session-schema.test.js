const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'prisma/schema.prisma');
const migrationPath = path.join(
  repoRoot,
  'prisma/migrations/20260422_add_voice_sessions/migration.sql'
);

describe('voice session schema', () => {
  it('declares durable voice session, message, summary, and per-session usage models', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');

    expect(schema).toContain('model voice_sessions');
    expect(schema).toContain('model voice_session_messages');
    expect(schema).toContain('model voice_session_summaries');
    expect(schema).toContain('model device_token_usage_session');
    expect(schema).toContain('@@unique([session_id], map: "uq_voice_sessions_session_id")');
    expect(schema).toContain('@@unique([session_id, sequence], map: "uq_voice_session_messages_session_sequence")');
    expect(schema).toContain('@@unique([idempotency_key], map: "uq_voice_session_messages_idempotency")');
    expect(schema).toContain('@@unique([session_id], map: "uq_device_token_usage_session_session_id")');
  });

  it('declares durable per-device workspace artifact storage', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');

    expect(schema).toContain('model device_workspace_artifacts');
    expect(schema).toContain('relative_path');
    expect(schema).toContain('@@unique([mac_address, relative_path], map: "uq_device_workspace_artifacts_mac_path")');
    expect(schema).toContain('@@index([mac_address, updated_at(sort: Desc)], map: "idx_device_workspace_artifacts_mac_updated")');
  });

  it('creates the runtime tables with indexes for the planned access paths', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('CREATE TABLE "voice_sessions"');
    expect(migration).toContain('CREATE TABLE "voice_session_messages"');
    expect(migration).toContain('CREATE TABLE "voice_session_summaries"');
    expect(migration).toContain('CREATE TABLE "device_token_usage_session"');
    expect(migration).toContain('CHECK ("status" IN (\'active\', \'ended\', \'failed\', \'interrupted\'))');
    expect(migration).toContain('CREATE INDEX "idx_voice_sessions_mac_started" ON "voice_sessions"("mac_address", "started_at" DESC)');
    expect(migration).toContain('CREATE INDEX "idx_voice_session_messages_session_created" ON "voice_session_messages"("session_id", "created_at")');
    expect(migration).toContain('CREATE INDEX "idx_device_token_usage_session_mac_date" ON "device_token_usage_session"("mac_address", "usage_date" DESC)');
  });

  it('creates the workspace artifact runtime table and access-path indexes', () => {
    const artifactMigration = fs.readFileSync(
      path.join(repoRoot, 'prisma/migrations/20260422_add_workspace_artifacts/migration.sql'),
      'utf8'
    );

    expect(artifactMigration).toContain('CREATE TABLE "device_workspace_artifacts"');
    expect(artifactMigration).toContain('CONSTRAINT "uq_device_workspace_artifacts_mac_path" UNIQUE ("mac_address", "relative_path")');
    expect(artifactMigration).toContain('CREATE INDEX "idx_device_workspace_artifacts_mac_updated" ON "device_workspace_artifacts"("mac_address", "updated_at" DESC)');
    expect(artifactMigration).toContain('CREATE INDEX "idx_device_workspace_artifacts_session" ON "device_workspace_artifacts"("session_id")');
  });
});
