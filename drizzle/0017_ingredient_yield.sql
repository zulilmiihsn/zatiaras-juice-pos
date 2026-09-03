ALTER TABLE `bahan` ADD COLUMN `yield_persen` real DEFAULT 100 NOT NULL;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_bahan_yield_insert`
BEFORE INSERT ON `bahan`
WHEN NEW.`yield_persen` <= 0 OR NEW.`yield_persen` > 100
BEGIN
	SELECT RAISE(ABORT, 'INVALID_INGREDIENT_YIELD');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_bahan_yield_update`
BEFORE UPDATE OF `yield_persen` ON `bahan`
WHEN NEW.`yield_persen` <= 0 OR NEW.`yield_persen` > 100
BEGIN
	SELECT RAISE(ABORT, 'INVALID_INGREDIENT_YIELD');
END;
