-- Monitoring and alerts use the branch/time index; the path index adds a write for every metric.
DROP INDEX idx_request_metrics_branch_path;
