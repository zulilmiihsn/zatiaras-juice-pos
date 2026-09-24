ALTER TABLE `buku_kas` ADD COLUMN `stock_policy_mode` text CHECK (`stock_policy_mode` IS NULL OR `stock_policy_mode` IN ('tracked', 'ignored'));
--> statement-breakpoint
ALTER TABLE `buku_kas` ADD COLUMN `stock_policy_revision` integer CHECK (`stock_policy_revision` IS NULL OR `stock_policy_revision` >= 0);
--> statement-breakpoint
ALTER TABLE `buku_kas` ADD COLUMN `stock_replay_disposition` text CHECK (`stock_replay_disposition` IS NULL OR `stock_replay_disposition` IN ('normal', 'stale_to_ignored', 'owner_approved_current', 'owner_approved_after_recount'));
--> statement-breakpoint
ALTER TABLE `buku_kas` ADD COLUMN `restored_from_archive` integer NOT NULL DEFAULT 0 CHECK (`restored_from_archive` IN (0, 1));
--> statement-breakpoint
CREATE TABLE `produk_mutasi` (
	`id` text PRIMARY KEY NOT NULL,
	`cabang_id` text NOT NULL,
	`produk_id` text NOT NULL,
	`delta_jumlah` integer NOT NULL CHECK (typeof(`delta_jumlah`) = 'integer' AND `delta_jumlah` <> 0),
	`stok_setelah` integer NOT NULL CHECK (typeof(`stok_setelah`) = 'integer'),
	`sumber` text NOT NULL CHECK (`sumber` IN ('pos', 'void', 'manual', 'reconciliation')),
	`referensi_id` text NOT NULL,
	`dibuat_oleh` text,
	`created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (`cabang_id`, `referensi_id`, `produk_id`, `sumber`)
);
--> statement-breakpoint
CREATE INDEX `idx_produk_mutasi_branch_created` ON `produk_mutasi` (`cabang_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_produk_mutasi_branch_produk` ON `produk_mutasi` (`cabang_id`, `produk_id`);
--> statement-breakpoint
CREATE INDEX `idx_produk_mutasi_branch_reference` ON `produk_mutasi` (`cabang_id`, `referensi_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_buku_kas_stock_policy_pair_guard`
BEFORE INSERT ON `buku_kas`
WHEN (NEW.`stock_policy_mode` IS NULL) <> (NEW.`stock_policy_revision` IS NULL)
BEGIN
	SELECT RAISE(ABORT, 'INVALID_STOCK_POLICY_PROVENANCE');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_buku_kas_stock_policy_pair_update_guard`
BEFORE UPDATE OF `stock_policy_mode`, `stock_policy_revision` ON `buku_kas`
WHEN (NEW.`stock_policy_mode` IS NULL) <> (NEW.`stock_policy_revision` IS NULL)
BEGIN
	SELECT RAISE(ABORT, 'INVALID_STOCK_POLICY_PROVENANCE');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_buku_kas_stock_policy_guard`
BEFORE INSERT ON `buku_kas`
WHEN NEW.`sumber` = 'pos' AND NEW.`restored_from_archive` = 0 AND (
	NEW.`stock_policy_mode` IS NULL
	OR NEW.`stock_policy_revision` IS NULL
	OR (
		EXISTS (SELECT 1 FROM `stock_policy` WHERE `cabang_id` = NEW.`cabang_id`)
		AND NOT EXISTS (
			SELECT 1 FROM `stock_policy`
			WHERE `cabang_id` = NEW.`cabang_id`
				AND `mode` = NEW.`stock_policy_mode`
				AND `revision` = NEW.`stock_policy_revision`
		)
	)
	OR (
		NOT EXISTS (SELECT 1 FROM `stock_policy` WHERE `cabang_id` = NEW.`cabang_id`)
		AND (NEW.`stock_policy_mode` <> 'tracked' OR NEW.`stock_policy_revision` <> 0)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'STOCK_POLICY_CONFLICT');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_produk_mutasi_balance_guard`
BEFORE INSERT ON `produk_mutasi`
WHEN NOT EXISTS (
	SELECT 1 FROM `produk`
	WHERE `cabang_id` = NEW.`cabang_id`
		AND `id` = NEW.`produk_id`
		AND NEW.`stok_setelah` = COALESCE(`stok`, 0) + NEW.`delta_jumlah`
)
BEGIN
	SELECT RAISE(ABORT, 'PRODUCT_STOCK_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_produk_mutasi_product_guard`
BEFORE INSERT ON `produk_mutasi`
WHEN NOT EXISTS (
	SELECT 1 FROM `produk`
	WHERE `cabang_id` = NEW.`cabang_id` AND `id` = NEW.`produk_id`
)
BEGIN
	SELECT RAISE(ABORT, 'PRODUCT_MUTATION_PRODUCT_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_produk_mutasi_pos_guard`
BEFORE INSERT ON `produk_mutasi`
WHEN NEW.`sumber` = 'pos' AND (
	NEW.`delta_jumlah` >= 0
	OR NOT EXISTS (
		SELECT 1 FROM `produk`
		WHERE `cabang_id` = NEW.`cabang_id` AND `id` = NEW.`produk_id` AND `lacak_stok` = 1
	)
)
BEGIN
	SELECT RAISE(ABORT, 'INVALID_PRODUCT_POS_MUTATION');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_produk_mutasi_void_guard`
BEFORE INSERT ON `produk_mutasi`
WHEN NEW.`sumber` = 'void' AND (
	NEW.`delta_jumlah` <= 0
	OR NOT EXISTS (
		SELECT 1 FROM `produk_mutasi` original
		WHERE original.`cabang_id` = NEW.`cabang_id`
			AND original.`produk_id` = NEW.`produk_id`
			AND original.`referensi_id` = NEW.`referensi_id`
			AND original.`sumber` = 'pos'
			AND NEW.`delta_jumlah` = -original.`delta_jumlah`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'PRODUCT_VOID_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_produk_mutasi_apply`
AFTER INSERT ON `produk_mutasi`
BEGIN
	UPDATE `produk`
	SET `stok` = COALESCE(`stok`, 0) + NEW.`delta_jumlah`,
		`updated_at` = NEW.`created_at`
	WHERE `cabang_id` = NEW.`cabang_id` AND `id` = NEW.`produk_id`;
END;
