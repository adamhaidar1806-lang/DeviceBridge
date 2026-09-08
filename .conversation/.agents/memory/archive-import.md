---
name: Imported project archives
description: Replit project handoff behavior and preview setup for uploaded nested project archives.
---

When an uploaded project archive is handed into a Replit Project, its files may remain under the conversation-workspace files area while the Project root still contains a starter workspace. Restore the original project at the root and register its main web artifact before relying on Project workflows.

**Why:** The frontend can appear healthy in a temporary shell while the Project preview still serves the starter page or lacks the imported app workflow; the API may also need its existing database schema applied before startup.

**How to apply:** Preserve the original archive/source, restore the main app without editing its source, use the artifact-managed workflow for preview, and initialize only the database schema required by the imported backend.