-- For the daily upload quota per user (backend/src/attachments.ts).
CREATE INDEX attachments_uploader_created_at_idx ON attachments (uploader_id, created_at);
