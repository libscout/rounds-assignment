# Project Structure & Architecture Conventions

## Project Structure

```txt
src
├── tools                         # Infrastructure-level tools
│   ├── config
│   ├── db
│   ├── logger
│   └── events
│
├── lib                           # Pure reusable utilities/libraries
│   ├── dates
│   ├── pagination
│   ├── strings
│   └── objects
│
├── external                      # Third-party service integrations
│   ├── stripe
│   ├── aws
│   ├── telegram
│   └── ...
│
├── modules                       # Business domains / bounded contexts
│   └── [domain-name]
│       ├── consts                # Constants shared across files in this domain
│       ├── controllers           # HTTP/API transport layer
│       ├── dto                   # DTOs and validation schemas
│       ├── entities              # Database entities/models
│       ├── repositories          # Database queries and transactions
│       ├── types                 # Domain types and enums
│       ├── services              # Public domain services / module API
│       └── internal              # Private module implementation
```

---

# Directory Responsibilities

## `tools/`

Infrastructure-level tools used by the application.

Examples:

- database client
- config loader
- logger
- event bus wrapper

Rules:

- no business logic
- no pure helper functions
- may depend on frameworks, SDKs, or runtime configuration

---

## `lib/`

Pure reusable utilities and small libraries.

Examples:

- date helpers
- string helpers
- pagination helpers
- object/array helpers

Rules:

- no business logic
- no framework-specific code
- no runtime side effects
- should be easy to unit test

---

## `external/`

Third-party service integrations.

Examples:

- Stripe
- AWS SDK wrappers
- Telegram
- SendGrid
- Twilio

Rules:

- isolate third-party SDK usage here
- expose application-friendly APIs
- avoid leaking provider-specific types into business modules

---

## `modules/`

Business domains / bounded contexts.

Rules:

- keep leaf modules independent of one another
- business logic belongs here
- modules communicate through public APIs only

---

# Module Structure

Each business module should follow this structure:

```txt
modules/[domain-name]
├── consts
├── controllers
├── dto
├── entities
├── repositories
├── types
├── services
├── internal
└── index.ts
```

## `consts/`

A constant used in only one file can stay in that file. When several files use the same constant, put it in the owning module’s `consts/` folder. Group related shared values in a descriptive `*.const.ts` file, such as `ai-limits.const.ts`. Infrastructure tools and external integrations follow the same convention. Keep values derived from a particular call local to that call.

## `controllers/`

Transport layer only.

Responsibilities:

- parse requests
- validate input
- call services
- return responses

Rules:

- keep controllers thin
- avoid business logic

---

## `dto/`

Typed contracts and validation.

Contains:

- request DTOs
- response DTOs
- validation schemas
- typed payload definitions

---

## `types/`

Define each domain enum as a named TypeScript enum in its own `*.enum.ts` file. Persist enum values in typed `text` columns on the owning table, using `.$type<DomainEnum>()`. Add a database `CHECK` derived from the TypeScript enum values or the subset the column accepts. Expose enums through the leaf `types/index.ts`.

Give each object variant of a union a named interface or type alias. In a discriminated union, give each variant a single discriminator value, even when several variants share payload fields. The variants and their union can live in the same file.

## `entities/`

Persistence layer models.

Contains:

- Drizzle PostgreSQL table definitions
- database table models
- persistence mappings

---

### Drizzle schemas

Prefer Drizzle column builders and typed expression helpers for checks and indexes. Destructure the columns used in the table callback. Use helpers such as `eq`, `between`, `isNull`, and `inArray` for predicates, and name the parts of a compound condition when that makes it easier to read.

For example, write `check('watchlist_attempt_range', between(nextAttemptNo, 1, 3).inlineParams())` and `index('watchlist_due_idx').on(nextDueAt, id).where(active.getSQL())`. Inline fixed schema constants when a helper would emit parameter placeholders in DDL. Use a tagged SQL expression when it expresses a PostgreSQL feature more clearly or Drizzle has no suitable helper.

---

## `repositories/`

Put application database reads, writes, and transactions in injectable repository classes under the owning module’s `repositories/` folder. Name each file `*.repository.ts`. Services and workers call repository methods and own the business decisions that determine when to use them.

When several repository operations depend on the same SQL predicate or computed expression, define it once as a named `private static` method on the owning repository. For example, `list()`, `head()`, and `acknowledge()` all use `PollDeliveryRepository.outstanding()` to identify polls awaiting delivery. Keep simple conditions used by a single query inline.

Extract complex SQL operations into named repository methods when doing so makes the transaction easier to follow. Keep each query helper to at most three parameters, including the transaction.

---

## `services/`

Public module services.

Rules:

- represents the public API of the module
- may be used by other modules
- should contain reusable business use-cases
- write each use-case entry point as a sequence of named operations in business order. Delegate validation, mapping, and persistence to the method or collaborator that owns each step. Run independent reads concurrently when their results are combined.
- keep service classes small and focused
- split large services by business responsibility or use-case

---

## `internal/`

Private module implementation.

Contains:

- internal orchestration logic
- helper services
- implementation details

Rules:

- must not be imported directly from other modules
- must not be re-exported by the module

---

# Public APIs & `index.ts`

Use `index.ts` only in leaf folders such as:

- `services/`
- `dto/`
- `entities/`
- `types/`

Avoid module-level barrel exports.

## Good

```ts
import { UserLookupService } from '../users/services';
import { UserResponseDto } from '../users/dto';
import { UserEntity } from '../users/entities';
```

## Bad

```ts
import { UserRegistrationService } from '../users/services/user-registration.service';
```

---

# Architectural Guidelines

## General

- Use the project's ESLint and Prettier configurations to keep code readable and consistently formatted.
- Prefer dependency injection over singletons.
- Use concrete classes and composition for shared behavior. Avoid abstract base classes.
- Use a ternary only as the whole initializer of a named variable or as a direct return value. Give choices passed to a function or embedded in a larger expression a descriptive name. Use explicit branches for nested choices and asynchronous work.
- Aim for functions of at most 30 lines. Split longer functions at distinct operations that can be named.
- Give each validation guard one purpose. Check the input shape before inspecting its contents and name compound conditions when that makes their meaning clearer.
- Keep business logic inside `modules/`.
- Put helpers used by only one class on that class. Use a `private static` method for stateless helpers and a private instance method for helpers that need instance state or injected dependencies.
- Keep controller methods focused on transport and delegate business decisions to services.
- Avoid framework-specific logic inside core business code.
- Put infrastructure-level abstractions in `tools/`.
- Put pure reusable utilities in `lib/`.
- Put third-party provider integrations in `external/`.

---

## Purpose comments

Give each backend implementation class a one-sentence JSDoc comment explaining its responsibility. This includes workers, controllers, clients, Nest modules, services, and repositories. Place the comment immediately above the first class decorator or above the class declaration when there are no class decorators. Purpose comments are optional for DTOs.

Give every repository and service method, including constructors and private helpers, a short JSDoc sentence describing its contract. Mention ordering, retry behavior, side effects, or the meaning of a missing result when callers rely on those details. For example, the description for `PollDeliveryRepository.head()` is “Returns the competitor’s oldest outstanding poll ID, or `undefined` when none is waiting.”

Give each named standalone function a short JSDoc sentence as well, including private helpers and named arrow functions. Describe what the caller receives or what the function changes.

---

## Controllers

- Keep controllers thin.
- Controllers should handle transport concerns only.

---

## Services

- Keep services testable.
- Keep service classes small and focused.
- Split large services by business responsibility or use-case.

Example:

```txt
users/services/
├── user-lookup.service.ts
├── user-registration.service.ts
└── user-password-reset.service.ts
```

---

## Module Boundaries

- Avoid importing internal files from another module.
- Avoid `forwardRef` and circular dependency injection.
- Treat `forwardRef` as a signal that module boundaries should be refactored.
- Prefer extracting shared business behavior into a dedicated module instead of creating cyclic dependencies.

---

# File Naming Conventions

Define each data schema in its own TypeScript file. Give each request or response DTO a `*.dto.ts` file, each standalone validation schema a `*.schema.ts` file, each Drizzle table a `*.table.ts` file, and each domain enum a `*.enum.ts` file. Name the file after the definition, such as `create-competitor.dto.ts` or `watchlist.table.ts`. A leaf `index.ts` may re-export several definitions.

- `*.module.ts` — Nest.js module definition.
  <br><br>
- `*.controller.ts` — controller implementation.
- `*.controller.spec.ts` — controller test suite.
  <br><br>
- `*.service.ts` — service implementation.
- `*.service.spec.ts` — service test suite.
  <br><br>
- `*.dto.ts` — request/response DTOs and validation schemas.
- `*.table.ts` — Drizzle table definition and inferred row types.
  <br><br>
- `*.config.ts` — typed configuration factory/section.
- `*.schema.ts` — validation schema.
  <br><br>
- `*.types.ts` — TypeScript type definitions.
- `*.enum.ts` — a domain enum in the owning module’s `types/` folder.
- `*.const.ts` — related constants shared across files in the owning module.

---

# Testing Conventions

Every service and controller file must have a corresponding test suite in the same directory.

Examples:

```txt
src/modules/users/services/user-lookup.service.ts
src/modules/users/services/user-lookup.service.spec.ts
```

```txt
src/modules/users/controllers/users.controller.ts
src/modules/users/controllers/users.controller.spec.ts
```

---

# Controller Testing

Controller tests should focus on controller-level behavior.

The purpose of controller tests is to verify:

- controller-local interceptors and guards
- validation/transformation pipelines
- response DTO mapping/serialization

Use `supertest` for controller testing to ensure the real HTTP pipeline is exercised.

Mock services/business logic dependencies while testing controllers.

---

# Database & Integration Testing

- Use a real database when testing repository queries, including through a service.
- Exercise Drizzle queries and migrations against PostgreSQL.
- Prefer using real infrastructure for integration tests.
- Prefer using Testcontainers to spin up PostgreSQL.
- Prefer using shared test helpers from the `test/` folder to set up the test environment.
- Do not use `test/` helper functions in files that do not end with `*.spec.ts`.
- Prefer isolated test data per test case.
- Clean up database state between tests.
- Mock external systems only when real infrastructure is impractical or unnecessary for the test scope.

---

## Controller DTOs & Response Serialization

Use DTOs to describe the public API contract, not database/entity table definitions.

### Request DTOs

Use DTOs for all controller inputs:

- `@Query()`
- `@Param()`
- `@Body()`

Rules:

- controller inputs must go through validation and transformation pipelines
- request DTOs should validate and normalize incoming data
- keep request DTOs inside the related module `dto/` folder

---

### Response DTOs

Rules:

- use explicit response DTOs for all controller responses.
- use ISO 8601 UTC strings for dates

---

# Internal Service Communication

Internal service-to-service requests must propagate request context headers.

Required headers:

```txt
x-request-id
x-user-id
```

### `x-request-id`

`x-request-id` is used to correlate logs and traces across services.

Rules:

- reuse the incoming `x-request-id` when calling another internal service
- generate a new `x-request-id` only if the incoming request does not have one
- include `x-request-id` in all logs related to the request (done inside of pino setup)

### `x-user-id`

`x-user-id` identifies the authenticated user context.

Rules:

- propagate `x-user-id` when the request is performed on behalf of a user
- do not invent `x-user-id` for system/background jobs
- omit `x-user-id` for unauthenticated or system-level requests

### Example

```http
GET /internal/orders/123 HTTP/1.1
Host: orders-service
x-request-id: req_123
x-user-id: user_456
```

### Notes

Services should treat these headers as context propagation only.

Authentication and authorization must still be handled explicitly by the receiving service.
