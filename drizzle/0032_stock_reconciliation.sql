CREATE TABLE `stock_reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`cabang_id` text NOT NULL,
	`expected_policy_revision` integer NOT NULL CHECK (`expected_policy_revision` >= 1),
	`status` text NOT NULL CHECK (`status` IN ('draft', 'ready', 'applied', 'cancelled')),
	`inventory_fingerprint` text NOT NULL CHECK (length(`inventory_fingerprint`) > 0),
	`created_by` text NOT NULL CHECK (length(trim(`created_by`)) > 0),
	`created_at` text NOT NULL CHECK (length(trim(`created_at`)) > 0),
	`finalized_at` text,
	CHECK ((`status` = 'applied' AND `finalized_at` IS NOT NULL) OR (`status` <> 'applied' AND `finalized_at` IS NULL))
);
--> statement-breakpoint
CREATE TABLE `stock_reconciliation_items` (
	`job_id` text NOT NULL,
	`cabang_id` text NOT NULL,
	`entity_type` text NOT NULL CHECK (`entity_type` IN ('produk', 'bahan')),
	`entity_id` text NOT NULL,
	`inventory_marker` text NOT NULL,
	`counted_quantity` real CHECK (`counted_quantity` IS NULL OR (`counted_quantity` >= 0 AND typeof(`counted_quantity`) IN ('integer', 'real'))),
	PRIMARY KEY (`job_id`, `entity_type`, `entity_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_stock_reconciliations_one_active_branch`
	ON `stock_reconciliations` (`cabang_id`)
	WHERE `status` IN ('draft', 'ready');
--> statement-breakpoint
CREATE INDEX `idx_stock_reconciliations_branch_status`
	ON `stock_reconciliations` (`cabang_id`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_stock_reconciliations_branch_created`
	ON `stock_reconciliations` (`cabang_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_stock_reconciliation_items_branch_job`
	ON `stock_reconciliation_items` (`cabang_id`, `job_id`);
--> statement-breakpoint
CREATE INDEX `idx_stock_reconciliation_items_branch_entity`
	ON `stock_reconciliation_items` (`cabang_id`, `entity_type`, `entity_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_stock_reconciliation_insert_policy_guard`
BEFORE INSERT ON `stock_reconciliations`
WHEN NEW.`status` NOT IN ('draft', 'ready')
OR NOT EXISTS (
	SELECT 1 FROM `stock_policy`
	WHERE `cabang_id` = NEW.`cabang_id`
		AND `mode` = 'ignored'
		AND `revision` = NEW.`expected_policy_revision`
)
BEGIN
	SELECT RAISE(ABORT, 'STOCK_RECONCILIATION_POLICY_CONFLICT');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_stock_reconciliation_item_insert_guard`
BEFORE INSERT ON `stock_reconciliation_items`
WHEN NOT EXISTS (
	SELECT 1 FROM `stock_reconciliations`
	WHERE `id` = NEW.`job_id`
		AND `cabang_id` = NEW.`cabang_id`
		AND `status` IN ('draft', 'ready')
)
OR (NEW.`entity_type` = 'produk' AND NOT EXISTS (
	SELECT 1 FROM `produk`
	WHERE `cabang_id` = NEW.`cabang_id`
		AND `id` = NEW.`entity_id`
		AND `lacak_stok` = 1
		AND NEW.`inventory_marker` = COALESCE(`updated_at`, '') || char(31)
			|| CAST(COALESCE(`lacak_stok`, 0) AS TEXT) || char(31)
			|| CAST(COALESCE(`is_active`, 1) AS TEXT)
))
OR (NEW.`entity_type` = 'bahan' AND NOT EXISTS (
	SELECT 1 FROM `bahan`
	WHERE `cabang_id` = NEW.`cabang_id`
		AND `id` = NEW.`entity_id`
		AND COALESCE(`is_active`, 1) = 1
		AND NEW.`inventory_marker` = COALESCE(`updated_at`, '') || char(31)
			|| CAST(COALESCE(`is_active`, 1) AS TEXT)
))
BEGIN
	SELECT RAISE(ABORT, 'STOCK_RECONCILIATION_ITEM_CONFLICT');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_stock_reconciliation_item_update_guard`
BEFORE UPDATE ON `stock_reconciliation_items`
WHEN NEW.`job_id` IS NOT OLD.`job_id`
	OR NEW.`cabang_id` IS NOT OLD.`cabang_id`
	OR NEW.`entity_type` IS NOT OLD.`entity_type`
	OR NEW.`entity_id` IS NOT OLD.`entity_id`
	OR NEW.`inventory_marker` IS NOT OLD.`inventory_marker`
	OR NOT EXISTS (
		SELECT 1 FROM `stock_reconciliations`
		WHERE `id` = OLD.`job_id`
			AND `cabang_id` = OLD.`cabang_id`
			AND `status` IN ('draft', 'ready')
	)
	OR (NEW.`entity_type` = 'produk' AND NEW.`counted_quantity` IS NOT NULL
		AND NEW.`counted_quantity` <> CAST(NEW.`counted_quantity` AS INTEGER))
BEGIN
	SELECT RAISE(ABORT, 'STOCK_RECONCILIATION_ITEM_CONFLICT');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_stock_reconciliation_item_delete_guard`
BEFORE DELETE ON `stock_reconciliation_items`
BEGIN
	SELECT RAISE(ABORT, 'STOCK_RECONCILIATION_ITEMS_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_stock_reconciliation_snapshot_guard`
BEFORE UPDATE OF `inventory_fingerprint` ON `stock_reconciliations`
WHEN EXISTS (
	SELECT 1 FROM `produk` p
	WHERE p.`cabang_id` = NEW.`cabang_id` AND p.`lacak_stok` = 1
		AND NOT EXISTS (
			SELECT 1 FROM `stock_reconciliation_items` i
			WHERE i.`job_id` = NEW.`id` AND i.`cabang_id` = NEW.`cabang_id`
				AND i.`entity_type` = 'produk' AND i.`entity_id` = p.`id`
		)
)
OR EXISTS (
	SELECT 1 FROM `stock_reconciliation_items` i
	WHERE i.`job_id` = NEW.`id` AND i.`cabang_id` = NEW.`cabang_id`
		AND i.`entity_type` = 'produk'
		AND NOT EXISTS (
			SELECT 1 FROM `produk` p
			WHERE p.`cabang_id` = NEW.`cabang_id` AND p.`id` = i.`entity_id`
				AND p.`lacak_stok` = 1
				AND i.`inventory_marker` = COALESCE(p.`updated_at`, '') || char(31)
					|| CAST(COALESCE(p.`lacak_stok`, 0) AS TEXT) || char(31)
					|| CAST(COALESCE(p.`is_active`, 1) AS TEXT)
		)
)
OR EXISTS (
	SELECT 1 FROM `bahan` b
	WHERE b.`cabang_id` = NEW.`cabang_id` AND COALESCE(b.`is_active`, 1) = 1
		AND NOT EXISTS (
			SELECT 1 FROM `stock_reconciliation_items` i
			WHERE i.`job_id` = NEW.`id` AND i.`cabang_id` = NEW.`cabang_id`
				AND i.`entity_type` = 'bahan' AND i.`entity_id` = b.`id`
		)
)
OR EXISTS (
	SELECT 1 FROM `stock_reconciliation_items` i
	WHERE i.`job_id` = NEW.`id` AND i.`cabang_id` = NEW.`cabang_id`
		AND i.`entity_type` = 'bahan'
		AND NOT EXISTS (
			SELECT 1 FROM `bahan` b
			WHERE b.`cabang_id` = NEW.`cabang_id` AND b.`id` = i.`entity_id`
				AND COALESCE(b.`is_active`, 1) = 1
				AND i.`inventory_marker` = COALESCE(b.`updated_at`, '') || char(31)
					|| CAST(COALESCE(b.`is_active`, 1) AS TEXT)
		)
)
BEGIN
	SELECT RAISE(ABORT, 'STOCK_RECONCILIATION_FINGERPRINT_CONFLICT');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_stock_reconciliation_status_guard`
BEFORE UPDATE ON `stock_reconciliations`
WHEN NEW.`id` IS NOT OLD.`id`
	OR NEW.`cabang_id` IS NOT OLD.`cabang_id`
	OR NEW.`expected_policy_revision` IS NOT OLD.`expected_policy_revision`
	OR NEW.`inventory_fingerprint` IS NOT OLD.`inventory_fingerprint`
	OR NEW.`created_by` IS NOT OLD.`created_by`
	OR NEW.`created_at` IS NOT OLD.`created_at`
	OR (OLD.`status` = 'draft' AND NEW.`status` NOT IN ('draft', 'ready', 'cancelled'))
	OR (OLD.`status` = 'ready' AND NEW.`status` NOT IN ('draft', 'ready', 'applied', 'cancelled'))
	OR (OLD.`status` = 'cancelled' AND NEW.`status` <> 'cancelled')
	OR (OLD.`status` = 'applied' AND NEW.`status` <> 'applied')
	OR (OLD.`status` = 'applied' AND NEW.`finalized_at` IS NOT OLD.`finalized_at`)
BEGIN
	SELECT RAISE(ABORT, 'INVALID_STOCK_RECONCILIATION_TRANSITION');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_stock_reconciliation_apply_guard`
BEFORE UPDATE OF `status` ON `stock_reconciliations`
WHEN NEW.`status` = 'applied' AND (
	OLD.`status` <> 'ready'
	OR NEW.`finalized_at` IS NULL
	OR EXISTS (
		SELECT 1 FROM `stock_reconciliation_items`
		WHERE `job_id` = OLD.`id` AND `cabang_id` = OLD.`cabang_id`
			AND `counted_quantity` IS NULL
	)
	OR NOT EXISTS (
		SELECT 1 FROM `stock_policy`
		WHERE `cabang_id` = OLD.`cabang_id`
			AND `mode` = 'ignored'
			AND `revision` = OLD.`expected_policy_revision`
	)
	OR EXISTS (
		SELECT 1 FROM `produk` p
		WHERE p.`cabang_id` = OLD.`cabang_id` AND p.`lacak_stok` = 1
			AND NOT EXISTS (
				SELECT 1 FROM `stock_reconciliation_items` i
				WHERE i.`job_id` = OLD.`id` AND i.`cabang_id` = OLD.`cabang_id`
					AND i.`entity_type` = 'produk' AND i.`entity_id` = p.`id`
					AND i.`inventory_marker` = COALESCE(p.`updated_at`, '') || char(31)
						|| CAST(COALESCE(p.`lacak_stok`, 0) AS TEXT) || char(31)
						|| CAST(COALESCE(p.`is_active`, 1) AS TEXT)
			)
	)
	OR EXISTS (
		SELECT 1 FROM `stock_reconciliation_items` i
		WHERE i.`job_id` = OLD.`id` AND i.`cabang_id` = OLD.`cabang_id`
			AND i.`entity_type` = 'produk'
			AND NOT EXISTS (
				SELECT 1 FROM `produk` p
				WHERE p.`cabang_id` = OLD.`cabang_id` AND p.`id` = i.`entity_id`
					AND p.`lacak_stok` = 1
					AND i.`inventory_marker` = COALESCE(p.`updated_at`, '') || char(31)
						|| CAST(COALESCE(p.`lacak_stok`, 0) AS TEXT) || char(31)
						|| CAST(COALESCE(p.`is_active`, 1) AS TEXT)
			)
	)
	OR EXISTS (
		SELECT 1 FROM `bahan` b
		WHERE b.`cabang_id` = OLD.`cabang_id` AND COALESCE(b.`is_active`, 1) = 1
			AND NOT EXISTS (
				SELECT 1 FROM `stock_reconciliation_items` i
				WHERE i.`job_id` = OLD.`id` AND i.`cabang_id` = OLD.`cabang_id`
					AND i.`entity_type` = 'bahan' AND i.`entity_id` = b.`id`
					AND i.`inventory_marker` = COALESCE(b.`updated_at`, '') || char(31)
						|| CAST(COALESCE(b.`is_active`, 1) AS TEXT)
			)
	)
	OR EXISTS (
		SELECT 1 FROM `stock_reconciliation_items` i
		WHERE i.`job_id` = OLD.`id` AND i.`cabang_id` = OLD.`cabang_id`
			AND i.`entity_type` = 'bahan'
			AND NOT EXISTS (
				SELECT 1 FROM `bahan` b
				WHERE b.`cabang_id` = OLD.`cabang_id` AND b.`id` = i.`entity_id`
					AND COALESCE(b.`is_active`, 1) = 1
					AND i.`inventory_marker` = COALESCE(b.`updated_at`, '') || char(31)
						|| CAST(COALESCE(b.`is_active`, 1) AS TEXT)
			)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'STOCK_RECONCILIATION_CONFLICT');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_produk_mutasi_reconciliation_guard`
BEFORE INSERT ON `produk_mutasi`
WHEN NEW.`sumber` = 'reconciliation' AND NOT EXISTS (
	SELECT 1
	FROM `stock_reconciliations` j
	INNER JOIN `stock_reconciliation_items` i
		ON i.`job_id` = j.`id` AND i.`cabang_id` = j.`cabang_id`
	WHERE j.`id` = NEW.`referensi_id`
		AND j.`cabang_id` = NEW.`cabang_id`
		AND j.`status` = 'applied'
		AND i.`entity_type` = 'produk'
		AND i.`entity_id` = NEW.`produk_id`
		AND i.`counted_quantity` = NEW.`stok_setelah`
)
BEGIN
	SELECT RAISE(ABORT, 'INVALID_PRODUCT_RECONCILIATION_MUTATION');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_bahan_mutasi_reconciliation_guard`
BEFORE INSERT ON `bahan_mutasi`
WHEN NEW.`sumber` = 'reconciliation' AND (
	NEW.`delta_jumlah` = 0
	OR NOT EXISTS (
		SELECT 1
		FROM `stock_reconciliations` j
		INNER JOIN `stock_reconciliation_items` i
			ON i.`job_id` = j.`id` AND i.`cabang_id` = j.`cabang_id`
		INNER JOIN `bahan` b
			ON b.`cabang_id` = j.`cabang_id` AND b.`id` = i.`entity_id`
		WHERE j.`id` = NEW.`referensi_id`
			AND j.`cabang_id` = NEW.`cabang_id`
			AND j.`status` = 'applied'
			AND i.`entity_type` = 'bahan'
			AND i.`entity_id` = NEW.`bahan_id`
			AND i.`counted_quantity` = NEW.`stok_setelah`
			AND ABS(NEW.`stok_setelah` - (b.`stok_saat_ini` + NEW.`delta_jumlah`)) <= 0.0000001
	)
)
BEGIN
	SELECT RAISE(ABORT, 'INVALID_INGREDIENT_RECONCILIATION_MUTATION');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_bahan_mutasi_reconciliation_apply`
AFTER INSERT ON `bahan_mutasi`
WHEN NEW.`sumber` = 'reconciliation'
BEGIN
	UPDATE `bahan`
	SET `stok_saat_ini` = NEW.`stok_setelah`, `updated_at` = NEW.`created_at`
	WHERE `cabang_id` = NEW.`cabang_id` AND `id` = NEW.`bahan_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_stock_policy_reconciliation_job_guard`
BEFORE UPDATE ON `stock_policy`
WHEN NEW.`mode` = 'tracked' AND NOT EXISTS (
	SELECT 1 FROM `stock_reconciliations`
	WHERE `id` = NEW.`reconciliation_job_id`
		AND `cabang_id` = NEW.`cabang_id`
		AND `expected_policy_revision` = OLD.`revision`
		AND `status` = 'applied'
		AND `finalized_at` = NEW.`reconciled_at`
)
BEGIN
	SELECT RAISE(ABORT, 'STOCK_RECONCILIATION_POLICY_CONFLICT');
END;
