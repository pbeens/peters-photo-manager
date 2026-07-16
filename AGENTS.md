# AGENTS

## Purpose

Peter’s Photo Manager is a local-first desktop photo manager for macOS and Windows.

The project is developed incrementally. Each phase must produce a working, testable application without implementing speculative future features.

## Scope

The first target is a runnable prototype that can:

- manage folders selected for scanning
- display scanned folders in a left-side folder view
- display supported photographs as thumbnails
- show basic details for the selected photograph
- remain responsive during scanning
- build toward public testing releases

The initial supported image formats are JPEG, PNG, and WebP.

The intended technical direction is Rust for application logic, Tauri for the desktop shell, TypeScript for the interface, and only the dependencies required by the current milestone.

## Core Rules

- Read this file before beginning work.
- Read `tasks.md` when active work, open questions, or handoff notes are relevant.
- Follow the software specification while respecting the narrower scope of the current phase.
- Build one small, testable feature group at a time.
- Keep the application runnable after every milestone.
- Do not implement future features prematurely.
- Do not add dependencies without a current-milestone justification.
- Keep filesystem, image processing, application state, and interface code separate.
- Keep long-running work off the interface thread.
- Preserve the user’s existing folder structure.
- Do not modify original photographs unless explicitly required and approved.
- Handle inaccessible folders, invalid images, disconnected drives, and scan failures safely.
- Prefer clear, simple implementations over speculative abstractions.

## Folder Map

- `apps/desktop/`: desktop application source.
- `crates/`: Rust modules or crates created when justified by current work.
- `docs/`: architecture, development notes, decisions, and specifications.
- `tests/fixtures/`: small, controlled photo collections for repeatable tests.
- `scripts/`: shared utilities for testing, validation, performance checks, and packaging when needed.
- `skills/`: reusable agent workflows, created only when a repeatable workflow is valuable.
- `output/`, `dist/`, or `exports/`: generated release artifacts, when introduced.
- `software-specification.md`: current product specification.
- `tasks.md`: active plans, next actions, open questions, and useful handoff notes.
- `prompts.md`: project prompt log.

For this project, prompt-log entries do not need to include the computer hostname.

## Organization and Naming

- Use lowercase kebab-case for folders and filenames unless a tool or platform requires another convention.
- Keep files focused on one responsibility.
- Use descriptive names.
- Keep operating-system-specific code behind clear platform abstractions.
- Do not place temporary files, generated artifacts, or machine-specific settings beside source files.
- Do not create top-level folders without a concrete near-term artifact.

## Scripts and Reusable Workflows

Put shared project utilities in `scripts/`, not in the repository root.

Add scripts when they support repeatable work such as test-photo fixture generation, scan or thumbnail performance checks, validation, or release packaging.

Create `skills/` only when a workflow is repeated often enough to justify a reusable agent procedure. A skill should define its purpose, trigger conditions, inputs, outputs, safety requirements, and verification criteria.

Agents should notice repeated manual work and propose a focused script or skill, but should not create speculative automation.

## Tasks and Documentation

Keep this file concise and durable. Do not turn it into a session log or changelog.

Store active plans, changing tasks, open questions, and handoff notes in `tasks.md`.

When behavior, workflow, architecture, or policy changes:

- update the relevant documentation
- update links in the nearest relevant README or index
- record important architectural choices in `docs/decisions/`
- update the current-phase documentation

Ask before making major structural changes, changing the technology direction, or substantially expanding the current milestone.

## Testing and Completion

A feature is complete only when:

- the intended behavior works
- appropriate tests exist
- errors are handled safely
- useful logs are available
- documentation is updated
- the application remains runnable
- performance impact has been considered
- unrelated future features have not been added

Major iterations should be packaged for public testing when the release workflow is available.

## Licensing and Public Feedback

The final license is not yet selected. Do not create a `LICENSE` file until the licensing decision is confirmed.

The public issue or feedback URL will be added to the README and application documentation once available.

> [!NOTE]
> This project was initialized using the agentic master prompt provided by [AgenticProjectInitializer](https://github.com/pbeens/AgenticProjectInitializer/blob/main/master-prompt.md).
