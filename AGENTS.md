# Repository instructions

## Custom Entities V2 workflow

- Start from `../ItemsAdder/.tasks/custom-entities-v2/STATUS.md` and only the CURRENT acceptance section.
- Locate symbols first. Read relevant methods and dependencies, not whole files or concatenated reports. Default output budget: 120 lines / 8 KB; expand only for a specific correctness need, never to page through everything.
- Do not reread unchanged excerpts already available. Save reusable numerical diagnostics to files and modify them incrementally; do not repeatedly regenerate matrix/quaternion helpers in shell heredocs.
- Save full logs/traces to disk. Print exit status, aggregates and at most three relevant failures; inspect more failure context only when needed. Never suppress failures or truncate evidence to manufacture PASS.
- Record rejected hypotheses briefly and do not repeat them without new evidence.
- Use subagents only for independent scoped work returning compact findings/paths; the coordinator must not duplicate their entire investigation.
- Update STATUS after meaningful results, not after every command.
- Do not redesign tooling or run token-saving benchmarks. Reduce repeated text, not required analysis, test coverage or implementation quality.
