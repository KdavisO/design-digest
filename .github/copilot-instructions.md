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

- Code style / formatting (unless it directly impacts readability or correctness)
- Naming conventions (covered by self-review)
- Import ordering
- Comment style or documentation completeness
- Minor refactoring suggestions that don't affect correctness

## Commit Conventions

- Prefix required: `feat:`, `fix:`, `refactor:`, `ui:`, `docs:`, `chore:`, `test:`
- Japanese commit messages are acceptable
