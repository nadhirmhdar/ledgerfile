@AGENTS.md

## Who does what

Rule from the owner, 2026-11-15. Keep it always.

- Fable is not used for building.
- Sonnet sessions build every slice and every fix.
- Opus does the review and the corrections.
- The main (Fable) session runs only for the final review. It merges only when the owner says so in that session.

## How work lands

- One slice per branch, cut from main.
- Tests go in with each slice.
- Open a pull request against main. Never stack pull requests.
- Merge only on the owner's explicit yes.
