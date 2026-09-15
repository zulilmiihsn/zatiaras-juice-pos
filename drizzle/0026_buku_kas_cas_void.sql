-- F03/F04: CAS ledger POS + penanda void permanen + tolak replay checkout.
-- Operator: backup tiap shard dulu. Satu urutan nomor migrasi; jangan duplikat.
ALTER TABLE `buku_kas` ADD COLUMN `revision` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `buku_kas` ADD COLUMN `mutation_token` text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pos_void_markers` (
	`cabang_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`idempotency_key` text,
	`request_fingerprint` text,
	`actor` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (`cabang_id`, `transaction_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pos_void_markers_branch_key` ON `pos_void_markers` (`cabang_id`, `idempotency_key`);
--> statement-breakpoint
DROP TRIGGER IF EXISTS `trg_buku_kas_block_void_replay`;
--> statement-breakpoint
CREATE TRIGGER `trg_buku_kas_block_void_replay`
BEFORE INSERT ON `buku_kas`
WHEN NEW.`sumber` = 'pos' AND (
	(NEW.`transaction_id` IS NOT NULL AND EXISTS (
		SELECT 1 FROM `pos_void_markers`
		WHERE `cabang_id` = NEW.`cabang_id` AND `transaction_id` = NEW.`transaction_id`
	)) OR (
		NEW.`idempotency_key` IS NOT NULL AND EXISTS (
			SELECT 1 FROM `pos_void_markers`
			WHERE `cabang_id` = NEW.`cabang_id` AND `idempotency_key` = NEW.`idempotency_key`
		)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'TRANSACTION_VOIDED');
END;
