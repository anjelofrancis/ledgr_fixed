-- Records which daily jobs have run on which day, so a restart doesn't run them twice.
CREATE TABLE IF NOT EXISTS job_runs (
  job VARCHAR(50) NOT NULL,
  run_on DATE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job, run_on)
);
