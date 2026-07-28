-- Frozen from schema v0.1.16-report-framework at commit
-- 301849c34c8c900ddf1ba73f1b309f03646305ad. This fixture intentionally does
-- not import the current schema or the M4 production SQL helper.

CREATE INDEX IF NOT EXISTS idx_assessment_session_student_task_status
  ON assessment_session(student_id, task_code, status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_one_open_session_per_student_task_strategy
  ON assessment_session(student_id, task_code, strategy_type)
  WHERE status IN ('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED', 'OFFLINE_PENDING');

CREATE INDEX IF NOT EXISTS idx_training_session_student_task_status
  ON training_session(student_id, task_code, status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_training_one_open_session_per_student_task
  ON training_session(student_id, task_code)
  WHERE status IN ('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED');

CREATE INDEX IF NOT EXISTS idx_safety_incident_student_task_status
  ON safety_incident(student_id, task_code, status, requires_review_before_next_session);

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_redline_incident_same_student_task_insert
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident si
       WHERE si.incident_id = NEW.redline_incident_id
         AND si.student_id = NEW.student_id
         AND si.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'assessment_session redline_incident_id must belong to same student_id and task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_redline_incident_same_student_task_update
BEFORE UPDATE ON assessment_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident si
       WHERE si.incident_id = NEW.redline_incident_id
         AND si.student_id = NEW.student_id
         AND si.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'assessment_session redline_incident_id must belong to same student_id and task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_redline_incident_same_student_task_insert
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident si
       WHERE si.incident_id = NEW.redline_incident_id
         AND si.student_id = NEW.student_id
         AND si.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'training_session redline_incident_id must belong to same student_id and task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_redline_incident_same_student_task_update
BEFORE UPDATE ON training_session
FOR EACH ROW
WHEN NEW.status = 'REDLINE_HALTED'
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident si
       WHERE si.incident_id = NEW.redline_incident_id
         AND si.student_id = NEW.student_id
         AND si.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'training_session redline_incident_id must belong to same student_id and task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_assessment_session_block_unresolved_safety_incident
BEFORE INSERT ON assessment_session
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM safety_incident si
  WHERE si.student_id = NEW.student_id
    AND si.task_code = NEW.task_code
    AND si.requires_review_before_next_session = 1
    AND si.status IN ('PENDING_DETAIL', 'CONFIRMED')
)
BEGIN
  SELECT RAISE(ABORT, 'unresolved safety incident blocks new assessment_session');
END;

CREATE TRIGGER IF NOT EXISTS trg_training_session_block_unresolved_safety_incident
BEFORE INSERT ON training_session
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM safety_incident si
  WHERE si.student_id = NEW.student_id
    AND si.task_code = NEW.task_code
    AND si.requires_review_before_next_session = 1
    AND si.status IN ('PENDING_DETAIL', 'CONFIRMED')
)
BEGIN
  SELECT RAISE(ABORT, 'unresolved safety incident blocks new training_session');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_replacement_same_student_task_insert
BEFORE INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.replacement_incident_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident r
       WHERE r.incident_id = NEW.replacement_incident_id
         AND r.student_id = NEW.student_id AND r.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'replacement safety_incident must have same student_id + task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_replacement_same_student_task_update
BEFORE UPDATE ON safety_incident
FOR EACH ROW
WHEN NEW.replacement_incident_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM safety_incident r
       WHERE r.incident_id = NEW.replacement_incident_id
         AND r.student_id = NEW.student_id AND r.task_code = NEW.task_code
     )
BEGIN
  SELECT RAISE(ABORT, 'replacement safety_incident must have same student_id + task_code');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_bind_open_assessments
AFTER INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.status IN ('PENDING_DETAIL', 'CONFIRMED')
BEGIN
  INSERT OR IGNORE INTO safety_incident_binding (
    binding_id, incident_id, aggregate_type, aggregate_id,
    pre_status, post_status, halt_event_id, created_at
  )
  SELECT
    NEW.incident_id || ':ASSESSMENT_SESSION:' || s.session_id,
    NEW.incident_id, 'ASSESSMENT_SESSION', s.session_id,
    s.status, 'REDLINE_HALTED', NEW.trigger_event_id, datetime('now')
  FROM assessment_session s
  WHERE s.student_id = NEW.student_id AND s.task_code = NEW.task_code
    AND s.status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED','OFFLINE_PENDING');

  UPDATE assessment_session
  SET status = 'REDLINE_HALTED',
      redline_incident_id = NEW.incident_id,
      level_result = 'LEVEL_FAIL_BY_SAFETY',
      report_type = 'SAFETY_TERMINATION_REPORT',
      completed_at = COALESCE(completed_at, datetime('now')),
      updated_at = datetime('now'),
      last_status_event_id = NEW.trigger_event_id,
      last_applied_event_id = NEW.trigger_event_id
  WHERE student_id = NEW.student_id AND task_code = NEW.task_code
    AND status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED','OFFLINE_PENDING');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_incident_bind_open_trainings
AFTER INSERT ON safety_incident
FOR EACH ROW
WHEN NEW.status IN ('PENDING_DETAIL', 'CONFIRMED')
BEGIN
  INSERT OR IGNORE INTO safety_incident_binding (
    binding_id, incident_id, aggregate_type, aggregate_id,
    pre_status, post_status, halt_event_id, created_at
  )
  SELECT
    NEW.incident_id || ':TRAINING_SESSION:' || t.training_session_id,
    NEW.incident_id, 'TRAINING_SESSION', t.training_session_id,
    t.status, 'REDLINE_HALTED', NEW.trigger_event_id, datetime('now')
  FROM training_session t
  WHERE t.student_id = NEW.student_id AND t.task_code = NEW.task_code
    AND t.status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED');

  UPDATE training_session
  SET status = 'REDLINE_HALTED',
      redline_incident_id = NEW.incident_id,
      completed_at = COALESCE(completed_at, datetime('now')),
      updated_at = datetime('now'),
      last_status_event_id = NEW.trigger_event_id,
      last_applied_event_id = NEW.trigger_event_id
  WHERE student_id = NEW.student_id AND task_code = NEW.task_code
    AND status IN ('INIT','ACTIVE','EMOTION_INTERRUPTED','SUSPENDED_REVIEW_REQUIRED');
END;
