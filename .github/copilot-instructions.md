# Copilot Review Instructions

## Role

This project uses Claude Code for implementation and self-review. Copilot serves as the final quality gate, focusing on areas that automated self-review may miss.

## Focus Areas (Priority Order)

### 1. Logic Correctness

- Edge cases: null/undefined, empty arrays/strings, boundary values (0, negative, max)
- Race conditions and concurrent access issues
- Off-by-one errors in loops and array indexing
- Incorrect boolean logic or missing conditions

### 2. Test Coverage

- Missing error/exception test cases
- Untested boundary values
- Mock objects that diverge from actual implementation behavior
- Assertions that don't verify the intended behavior

### 3. Design & Architecture

- Single Responsibility violations (functions/modules doing too much)
- Incorrect dependency direction (lower modules importing from higher ones)
- Overly broad public interfaces (exposing internal details)
- Unnecessary coupling between modules

### 4. Type Safety (TypeScript projects)

- Usage of `any` type (should use specific types or `unknown`)
- Missing or incorrect type annotations on public interfaces
- Type assertions (`as`) that may hide type errors
- Unsafe type narrowing without proper guards

### 5. Security

- OWASP Top 10 vulnerabilities (injection, XSS, broken auth, etc.)
- API key or secret exposure in code or config
- Missing input validation at system boundaries
- Insecure data handling (PII, encryption, RLS)

## Skip These

The following categories should NOT be flagged in reviews. The guiding principle: **skip stylistic preferences; flag issues that affect correctness, security, reliability, type safety, testability, or architecture/design.**

### Formatting & Style

- Whitespace, indentation style, trailing commas, semicolons
- Import ordering or grouping
- Naming conventions (e.g., camelCase vs snake_case) — covered by self-review and, where applicable, linter/tooling
- Comment style, JSDoc completeness, or documentation wording
- Minor refactoring suggestions that don't affect correctness (e.g., "extract this into a helper")

### Document & Markdown Consistency

These are style preferences, NOT correctness issues:

- **Heading hierarchy variations**: e.g., a section using 4 subsections vs 5 subsections, or `###` vs `####` for similar content — these do not affect functionality
- **Reference path style mixing**: e.g., full path (`docs/specs/jwt-auth.md`) vs short name (`jwt-auth.md`) within the same document — both are valid if the target is unambiguous
- **Markdown formatting differences**: e.g., fenced code block style (`` ``` `` vs `~~~`), list marker style (`-` vs `*`), emphasis style (`**` vs `__`)

### Diff Display Artifacts

- **Do not assume escaped characters in diffs are rendering artifacts.** In standard git/GitHub diffs, displayed content should normally be treated as the actual file content for that commit, and sequences such as `\"` or `\\n` often legitimately appear in string literals, serialized JSON, or other escaped contexts.
- False positives here are limited to cases where a viewer/rendering layer is ambiguous or where the diff is showing JSON-inside-a-string or another nested escaped representation. If you suspect that, verify using GitHub's **View file** or raw view for the same commit before dismissing or flagging the escaping as a bug.

### Boundary: When Consistency IS a Valid Finding

Flag consistency issues ONLY when they cause one of the following:

- **Broken references**: a path, link, or cross-reference that points to a non-existent target
- **Contradictory statements**: two sections that make incompatible claims about the same behavior
- **Misleading examples**: a code example that would fail if copy-pasted (syntax errors, missing imports, wrong API usage)

## Commit Conventions

- Prefix required: `feat:`, `fix:`, `refactor:`, `ui:`, `docs:`, `chore:`, `test:`
- Japanese commit messages are acceptable
