# Stage Task Template

Every stage executor receives a `task.json` matching this template.

```jsonc
{
  // --- Identity ---
  "run_id": "<uuid>",           // Parent run identifier
  "stage_id": "<string>",       // Pipeline stage name
  "attempt": 1,                 // 1-based attempt number

  // --- Executor ---
  "executor": "<string>",       // Agent or process executing this stage
  "runtime_agent": "<string>",  // Runtime agent identifier
  "skill": "<string>",          // Skill that defines this stage's logic

  // --- I/O ---
  "input_paths": [              // Absolute or run-relative paths to input artifacts
    "<path>"
  ],
  "output_dir": "<path>",       // Directory where the executor writes result.json and artifacts

  // --- Acceptance criteria ---
  "acceptance": {
    "required_outputs": [       // Paths (relative to output_dir) that must exist on success
      "result.json"
    ],
    "schema_validations": [     // Schema kinds that output files must validate against
      "result"
    ]
  },

  // --- Restrictions ---
  "restrictions": {
    "read_only_inputs": true,   // Executor must not modify input paths
    "no_network": false,        // Whether network access is forbidden
    "max_duration_ms": 120000   // Soft timeout hint
  },

  // --- Failure policy ---
  "failure_policy": {
    "on_error": "write_result_and_halt",  // Write a FAILED result.json, do not retry
    "max_attempts": 1,                     // Total attempts allowed
    "retry_delay_ms": 0                    // Delay between retries
  }
}
```

## Required fields

All fields listed above are required. Executors MUST validate their input against this shape before proceeding.

## Output

The executor writes:
- `result.json` in `output_dir` -- validated against `schemas/result.schema.json`.
- Any additional artifacts referenced in `result.json.outputs[].path`.

All writes MUST use atomic write (`writeJsonAtomic`) to prevent partial files.

## Failure policy

- `write_result_and_halt` (default): Write a `result.json` with `status: FAILED`, include error details in `summary`, then exit. The orchestrator will not retry.
- `retry`: Write a `FAILED` result, then re-enter the stage with `attempt` incremented. Only allowed when `max_attempts > 1`.
- `abort_run`: Write a `FAILED` result and signal the orchestrator to abort the entire run.
