-- The unique branch/date index serves the same lookups and also backs the checkout upsert.
DROP INDEX idx_daily_sales_branch_date_range;
