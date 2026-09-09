# Change-stream audit contract foundation

Status: accepted for initial implementation

Date: 2026-09-08

Project: `performance`

Project root: `/Users/leonardo/Repositories/performance`

## Problem

Meteor needs a correctness audit that can eventually prove change-stream,
publication, DDP, recovery, and cleanup behavior across a bounded matrix. The
first implementation also modeled Meteor's legacy oplog and polling observer
drivers. Its final form added 82 files and roughly 17,900 lines on top of the
benchmark platform, including an executable harness, owned MongoDB and Meteor
processes, a raw DDP client, fixture instrumentation, a declarative interpreter,
a large case catalog, validators, and tests.

That implementation supplied useful design evidence, but it crossed too many
boundaries for an initial review. This change establishes only the durable
language needed to discuss the system: a specification and strict TypeScript
contracts. It deliberately does not claim that an audit can run.

```text
Previous branch
===============

  CLI + catalog + compiler + interpreter + process ownership
          + MongoDB + Meteor + DDP + app probes + 90 cases
                              |
                              v
                    82 files / ~17.9k LOC


This foundation
===============

                  specification
                        |
                        v
              strict type contracts
                        |
                        v
             compile-time examples only
```

## Evidence from the discarded implementation

The discarded implementation demonstrated that the audit has four distinct
contract boundaries:

1. authored intent: capabilities, applicability, cases, steps, and oracles;
2. compiled intent: one immutable plan for one exact coordinate;
3. observed evidence: ledgers produced independently by MongoDB, clients,
   Meteor probes, and fault controllers;
4. reported outcome: pass, fail, incomplete, or not applicable, with identity
   and cleanup attestations.

It also showed that mixing those boundaries creates duplication. The case
catalog repeated applicability, fixtures, steps, evidence requirements, and
budgets. Runtime validators then repeated much of the TypeScript structure.
The initial contract should preserve the distinctions without preserving the
implementation.

```text
                what we ask for                 what happened
              +----------------+              +----------------+
              | authored case  |              | evidence ledger|
              +-------+--------+              +--------+-------+
                      |                                |
                      v                                v
              +-------+--------+              +--------+-------+
              | compiled plan  |------------->| case evaluation|
              +-------+--------+   future     +--------+-------+
                      |                                |
                      +---------------+----------------+
                                      v
                              +-------+-------+
                              | audit result  |
                              +---------------+

  This change types every box and arrow.
  It implements none of the arrows.
```

## Desired outcome

Create a small, reviewable contract package that:

- names the closed dimensions of an audit coordinate;
- fixes change streams as the only observer implementation under audit;
- models authored cases as discriminated unions;
- separates expected state from independently observed evidence;
- represents capability support and applicability without a case catalog;
- makes incomplete execution distinct from a failed correctness assertion;
- carries exact release, topology, harness, and plan identity;
- requires bounded execution budgets and explicit cleanup;
- can evolve without implying runtime validation or compatibility guarantees.

## Scope

### Included

- Compile-time TypeScript contracts under `reliability/contracts/`.
- Branded identifiers and digests to prevent accidental cross-assignment.
- Closed unions for coordinates, steps, faults, evidence, oracles, and status.
- Versioned authored-case, compiled-plan, evidence-ledger, and result envelopes.
- Strict compiler configuration.
- Compile-time fixtures that exercise representative valid and invalid shapes.

### Excluded

- CLI commands or changes to `bench.js`.
- Runtime validators, parsers, normalization, or serialization.
- MongoDB, Meteor, proxy, replica-set, or cluster ownership.
- DDP clients and fixture-application instrumentation.
- Case catalogs, profiles, generated data, and negative-control catalogs.
- Runtime or integration tests.
- Dashboard and result-writer integration.
- Oplog-driver, polling-driver, or observer-fallback correctness coverage.
- Any claim that the future audit is executable.

```text
              IN THIS CHANGE                    LATER CHANGES
        +-------------------------+       +-------------------------+
        | vocabulary              |       | parsing + validation    |
        | discriminated unions    |       | compiler                |
        | boundary envelopes      |       | runtime adapters        |
        | identity relationships  |       | owned environments      |
        | compile-time checks     |       | executable cases        |
        +-------------------------+       +-------------------------+
                    |                                  ^
                    +--------- constrains -------------+
```

## Assumptions

- The audit remains experimental and has no stable public API consumers.
- TypeScript contracts are design-time guidance, not a trust boundary.
- Data entering from JSON, processes, sockets, databases, or Meteor must be
  treated as `unknown` until a later runtime-validation layer is implemented.
- A case executes against exactly one transport, topology, profile, seed,
  release identity, and harness revision, using the change-stream driver.
- Evidence producers are independent enough that expected-model output cannot
  masquerade as observed system evidence.
- Cleanup is part of correctness, not a best-effort epilogue.

## Uncertainty

The following choices remain intentionally open:

- the serialization format and runtime schema library;
- the exact first set of executable cases;
- whether a compiler consumes authored objects, JSON, or generated definitions;
- how Meteor exposes authoritative change-stream selection and lifecycle
  evidence;
- how sharded-cluster and multi-instance environments are owned;
- which identities belong in benchmark results versus separate audit artifacts;
- whether the benchmark dashboard should ingest correctness results.

These uncertainties do not prevent agreement on the boundary shapes. They do
prevent treating the shapes as a final compatibility promise.

## Product boundary

MongoDB change streams are the supported application-facing API. They still use
the replica-set oplog as replication infrastructure, so oplog retention and
resume-token availability remain environmental facts. The audit does not
exercise Meteor's separate oplog-tailing observer driver.

```text
                  MongoDB implementation detail
                  =============================

                         replica-set oplog
                                |
                                | supplies history
                                v
  AUDIT BOUNDARY --->   MongoDB Change Stream API
                                |
                                v
                       Meteor change-stream driver
                                |
                                v
                         publication + DDP
                                |
                                v
                          client-observed state

  In scope:  everything from the Change Stream API boundary downward
  Metadata:  oplog-window facts that constrain resume-token availability
  Excluded:  Meteor's legacy direct oplog-tailing observer implementation
```

Meteor 3.5 makes change streams the first-choice reactivity driver, while still
documenting oplog and polling as fallbacks. This audit intentionally has a
narrower goal than Meteor's compatibility matrix: prove the change-stream path
or report that its prerequisites were unavailable.

Primary references:

- <https://docs.meteor.com/performance/change-streams-observer-driver>
- <https://docs.meteor.com/cli/environment-variables#METEOR_REACTIVITY_ORDER>
- <https://www.mongodb.com/docs/manual/changeStreams/>

## Contract model

### Layering

```text
  +---------------------------------------------------------------+
  | reliability/contracts/index.ts                                |
  | public type-only export surface                               |
  +-------------------------------+-------------------------------+
                                  |
                 +----------------+----------------+
                 |                                 |
                 v                                 v
  +------------------------------+  +------------------------------+
  | primitives.ts                |  | audit.ts                     |
  | branded IDs                  |<-| coordinates                  |
  | JSON/EJSON values            |  | capabilities                 |
  | exact identity types         |  | evidence + results           |
  +---------------+--------------+  +---------------+--------------+
                  ^                                 ^
                  |                                 |
                  +----------------+----------------+
                                   |
                                   v
                    +------------------------------+
                    | declarative.ts               |
                    | authored definitions         |
                    | steps + oracles              |
                    | compiled plans               |
                    +------------------------------+
```

All exports are types. Importing the package must emit no JavaScript and cause
no side effects.

### Identity

Identity fields answer different questions and must not be interchangeable.

```text
  AuditId -------- identifies one whole audit invocation
     |
     +-- RunId --- scopes fixtures, evidence, and cleanup
     |
     +-- CaseId -- identifies authored behavior
            |
            +-- coordinate + profile + seed
                         |
                         v
                    PlanDigest

  ReleaseIdentity ---- exact Meteor source and package set
  HarnessIdentity ---- exact contract and harness revisions
  EnvironmentIdentity - exact MongoDB topology and members
```

Identifiers and SHA-256 digests use distinct branded string types. Branding is
compile-time friction only; construction and validation belong to a later
runtime boundary.

### Coordinate

```text
                         +----------------+
                         | CaseCoordinate |
                         +-------+--------+
                                 |
          +-----------+----------+----------+-----------+
          |           |                     |           |
          v           v                     v           v
      transport   topology              observer      seed
       sockjs     replica_set        changeStreams    uint32
   sockjs-polling standalone
         uws      sharded_cluster
```

The type system closes the vocabulary but cannot enforce numeric bounds,
non-empty arrays, uniqueness, or whether the actual observer is the requested
change-stream driver. Those are documented invariants for future runtime
validation.

### Authored case

```text
  CaseDefinitionV1
  |
  +-- metadata -------- title, rationale, source
  +-- applicability --- allowed coordinates
  +-- parameters ------ typed defaults and bounds
  +-- fixture --------- collection, publication, generator, sizing refs
  +-- preconditions --- availability required before execution
  +-- steps ----------- closed discriminated union
  +-- evidence -------- independent producers and ledger names
  +-- oracles --------- expected ref <-> observed ref
  +-- diagnostics ----- explicitly non-gating measurements
  +-- cleanup --------- run-scoped and verified
  +-- budget ---------- hard resource and time ceilings
  +-- sharing --------- isolated
```

Steps are declarative instructions, not callbacks or shell fragments:

```text
 subscribe       mongo_write       wait          barrier
     |                |              |               |
     +----------------+--------------+---------------+
                              |
                              v
                       DeclarativeStep
                              ^
     +----------------+--------------+---------------+
     |                |              |               |
 client_lifecycle    fault        snapshot      seal_evidence
```

Every step carries an ID, a timeout policy, and a failure disposition. The
closed union prevents an implementation from silently accepting arbitrary
executable code.

### Evidence independence

Expected state and observed state must have different provenance.

```text
  mutation description ---> expected-model ledger ----+
                                                       |
                                                       v
                                                   +--------+
  MongoDB query ---------> mongodb ledger -------->| oracle |
  DDP observation -------> ddp-client ledger ----->| compare|
  Meteor internals ------> meteor-probe ledger --->|        |
  fault lifecycle -------> fault ledger ---------->|        |
                                                   +---+----+
                                                       |
                                           +-----------+-----------+
                                           |                       |
                                           v                       v
                                      hard gate               diagnostic
```

An oracle names one expected reference and one observed reference. A hard gate
can fail the case; a diagnostic can explain behavior but cannot turn failure
into success.

### Outcome semantics

```text
                         case started
                              |
               +--------------+--------------+
               |                             |
               v                             v
        precondition false             execution attempted
               |                             |
               v                    +--------+--------+
        not_applicable               |                 |
                                     v                 v
                              evidence complete   evidence incomplete
                                     |                 |
                              +------+-----+           v
                              |            |       incomplete
                              v            v
                           passed        failed
```

- `passed`: all required hard oracles pass and cleanup is attested.
- `failed`: required evidence exists and at least one hard oracle fails.
- `incomplete`: required evidence or cleanup attestation is missing.
- `not_applicable`: declared preconditions exclude the coordinate before the
  behavioral assertion is attempted.

Infrastructure failure must never become a correctness pass.

### Version flow

```text
  CaseDefinitionV1
          |
          | future compiler
          v
  CompiledCasePlanV1
          |
          | future interpreter
          v
  EvidenceLedgerV1 -----> AuditCaseResultV1
                                |
                                v
                         AuditRunResultV1
```

Each envelope has a literal `schemaVersion`. A future incompatible shape gets
a new named type; it does not widen the existing version with optional fields.

## Type-level invariants

The initial implementation must encode these invariants:

- discriminants select the valid fields for every value reference, parameter,
  precondition, step, change-stream expectation, and outcome;
- expected-model evidence is distinct from system-observed evidence;
- a plan contains resolved values, not unresolved authored parameters;
- case and run results carry exact coordinate and identity objects;
- cleanup has an explicit result and evidence reference;
- failures and incomplete outcomes carry non-empty reason tuples;
- successful outcomes cannot carry failure reasons;
- all collections and nested records are readonly;
- extension data is absent from core contracts rather than admitted through
  broad string index signatures.

The following require future runtime validation:

- identifier syntax and digest length;
- numeric ranges and finite values;
- uniqueness and referential integrity;
- maximum collection sizes and nesting depth;
- step ordering and barrier closure;
- plan and ledger digest correctness;
- release, topology, change-stream, and cleanup attestation truth.

```text
  TypeScript can prove                 Runtime must prove
  --------------------                ------------------
  known discriminant                  input is trustworthy
  required field exists               string matches syntax
  union branch is coherent            arrays are bounded/unique
  result state is coherent            references point backward
  readonly consumer view              digest matches bytes
                                      evidence reflects reality
```

## Risks and mitigations

### False confidence

Risk: reviewers mistake exhaustive-looking types for input validation.

Mitigation: the spec and module comments state that untrusted data remains
`unknown`; no parser or `as`-based constructor is exported.

### Premature compatibility

Risk: downstream code adopts an experimental contract as stable.

Mitigation: version envelopes explicitly, keep the package internal, and state
that the first runtime implementation may revise V1 before release.

### Excessive vocabulary

Risk: the types preserve the previous branch's breadth and become a catalog in
disguise.

Mitigation: retain behavior categories and boundary shapes, but omit individual
case IDs, generator IDs, profile data, and capability records.

### Invalid states still representable

Risk: TypeScript cannot express every bounded or relational constraint.

Mitigation: document runtime-only invariants beside the relevant types and make
future parsing an explicit implementation phase.

### Contract drift

Risk: examples and prose diverge from exported types.

Mitigation: compile representative examples with the strict contract
configuration and use `satisfies` so excess or missing fields are detected.

## Recovery and rollback

The pre-reduction branch tip is preserved locally as:

```text
backup/feat-change-stream-audit-pre-reduction-20260908
```

Rollback options:

```text
Need one discarded detail?       git show backup/...:<path>
Need selected commits?           git cherry-pick <commit>
Need the entire old branch?       reset the feature ref to backup/...
Need only the clean foundation?   keep this branch as-is
```

No persisted data, production dependency, or runtime behavior is changed by
this foundation.

## Direct rollout

This is a design foundation, so rollout consists only of merging the spec and
type contracts. No feature flag, data migration, deployment, or operational
coordination is required.

```text
  review spec --> review contracts --> run typecheck --> merge
       |                |                    |
       v                v                    v
   intent sound?   shapes match intent?   compiler clean?
```

## Executable checklist

- [x] Select `upstream/main` as the clean feature base.
- [x] Preserve the discarded feature tip in a local backup ref.
- [x] Add branded primitives and exact identity contracts.
- [x] Add coordinate, capability, evidence, cleanup, and result contracts.
- [x] Add authored-case and compiled-plan contracts.
- [x] Add a type-only public export surface.
- [x] Add strict TypeScript configuration.
- [x] Add compile-time positive and negative examples.
- [x] Run the contract typecheck.
- [x] Run the existing JavaScript unit suite.
- [x] Confirm the final diff contains no runtime audit implementation.
- [x] Make `origin/main` exactly match `upstream/main`.
- [x] Force-push the reduced feature branch.
- [x] Verify both remote ref hashes.

## Acceptance criteria

1. The branch is based directly on the fetched `upstream/main` commit.
2. The diff contains only this specification, type-only contracts, compile-time
   fixtures, and the minimum package/configuration changes needed to typecheck.
3. Importing the contract surface emits no JavaScript and has no side effects.
4. Strict TypeScript compilation accepts representative valid contracts and
   rejects representative invalid discriminated-union branches.
5. Existing JavaScript tests continue to pass.
6. No executable audit command, runtime validator, environment owner, network
   client, application probe, case catalog, or generated definition remains.
7. `origin/main` resolves to the same commit as `upstream/main`.
8. `origin/feat/change-stream-audit` resolves to the reduced branch tip.
9. Audit contracts cannot express oplog or polling as observer implementations;
   those names appear only in historical context and explicit exclusions.

## Review order

```text
  1. Scope and exclusions
           |
           v
  2. Boundary and evidence diagrams
           |
           v
  3. Type-level versus runtime invariants
           |
           v
  4. Exported TypeScript contracts
           |
           v
  5. Compile-time fixtures and configuration
```
