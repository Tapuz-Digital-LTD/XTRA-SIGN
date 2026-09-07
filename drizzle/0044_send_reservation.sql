-- One reservation in flight per person, channel and message: the lock-free guard behind the dispatcher. Additive only.
CREATE UNIQUE INDEX IF NOT EXISTS "message_sends_reservation_unique" ON "message_sends" ("lead_id","channel","event") WHERE "error" = 'reserved' AND "lead_id" IS NOT NULL;
