/compact <details=context>

/rewind - roll back conversation/changes

/goal set target conditions
/goal clear - cancel target result condition

/loop plan some actions (skiils) for scheduler


Steer with compaction:
- /compact summarizes the conversation, uses the summary as new context, deletes old messages
- Risk: something important gets dropped and Claude drifts
- Add instructions after the command to shape the summary (e.g., "/compact Focus on the --version flag implementation")

Rewind (recover from wrong paths):
- Every user prompt creates a checkpoint; double-tap escape on an empty prompt opens the rewind menu
- Options: restore code and conversation, restore conversation only, restore code only
- "Summarize from here" compresses everything after a checkpoint (good for side conversations)
- "Summarize up to here" compresses everything before it (good for long setup phases)

Autonomous options:
- /goal sets a completion condition - Claude keeps working across turns until a fast evaluator confirms the condition is met (e.g., "/goal all tests in src/billing pass, and the type checker reports zero errors"); /goal clear cancels
- Constraint: the evaluator only reads the transcript, so conditions must be checkable from output Claude produces (like test results)
- Loop runs a prompt on an interval between turns (fixed or self-paced) - useful for polling external state like CI or deploys; escape stops it

Parallel work with worktrees:
- Multiple sessions on one codebase conflict; worktrees give each session its own independent file tree
- Clean worktrees are auto-removed when a session exits
- A .worktreeinclude file at the repo root lists git-ignored files (env files, local config) to copy into each worktree

Essential Points:
- Scope first, then steer
- Direct compaction so summaries keep what matters
- Rewind to course-correct instead of prompting your way out
- Set a goal when you can describe "done" better than the steps
- Run parallel work in worktrees
