import type {
  ApplicabilityScope,
  ChangeStreamObserver,
  DdpTransport,
  EvidenceProducer,
  MongoTopology,
  ObservedEvidenceProducer,
  OracleFamily,
} from './audit.js';
import type {
  ByteCount,
  CaseId,
  ContractId,
  EjsonValue,
  FaultId,
  LedgerId,
  Milliseconds,
  NonEmptyReadonlyArray,
  OracleId,
  ParameterName,
  PositiveInteger,
  ProfileId,
  RunId,
  Sha256Digest,
  StepId,
  UInt32,
} from './primitives.js';

export type DeclarativeValueReference =
  | Readonly<{ kind: 'literal'; value: EjsonValue }>
  | Readonly<{ kind: 'parameter'; name: ParameterName }>
  | Readonly<{
      kind: 'coordinate';
      field: 'seed' | 'transport' | 'topology' | 'observer';
    }>
  | Readonly<{ kind: 'run'; field: 'runId' }>
  | Readonly<{ kind: 'fixture'; field: 'documents' | 'subscriberIds' }>
  | Readonly<{ kind: 'step'; stepId: StepId; output: string }>;

export type ParameterDefinition =
  | Readonly<{
      type: 'integer';
      default: number;
      minimum: number;
      maximum: number;
    }>
  | Readonly<{
      type: 'enum';
      default: string;
      values: NonEmptyReadonlyArray<string>;
    }>
  | Readonly<{ type: 'boolean'; default: boolean }>;

export type DeclarativeSelector =
  | Readonly<{ kind: 'fixture_document'; index: UInt32 }>
  | Readonly<{
      kind: 'field_equals';
      field: string;
      value: DeclarativeValueReference;
    }>;

export type DeclarativeQuery =
  | Readonly<{ kind: 'unordered' }>
  | Readonly<{
      kind: 'selector';
      selector: DeclarativeSelector;
    }>
  | Readonly<{
      kind: 'projection';
      fields: NonEmptyReadonlyArray<string>;
    }>
  | Readonly<{
      kind: 'multiple_projections';
      projections: NonEmptyReadonlyArray<NonEmptyReadonlyArray<string>>;
    }>;

export type DeclarativeMutation =
  | Readonly<{
      kind: 'set' | 'push';
      path: NonEmptyReadonlyArray<string>;
      value: DeclarativeValueReference;
    }>
  | Readonly<{
      kind: 'unset';
      path: NonEmptyReadonlyArray<string>;
    }>
  | Readonly<{
      kind: 'increment';
      path: NonEmptyReadonlyArray<string>;
      amount: DeclarativeValueReference;
    }>
  | Readonly<{ kind: 'fixture_document'; index: UInt32 }>
  | Readonly<{ kind: 'generated_document'; generator: string }>
  | Readonly<{ kind: 'projection_variant'; variant: string }>
  | Readonly<{ kind: 'none' }>;

export type DeclarativeTransition =
  | Readonly<{ kind: 'insert' | 'replace' | 'delete' }>
  | Readonly<{
      kind: 'set_field' | 'append_array';
      path: NonEmptyReadonlyArray<string>;
      value: DeclarativeValueReference;
    }>
  | Readonly<{
      kind: 'remove_field';
      path: NonEmptyReadonlyArray<string>;
    }>
  | Readonly<{
      kind: 'increment_field';
      path: NonEmptyReadonlyArray<string>;
      amount: DeclarativeValueReference;
    }>
  | Readonly<{ kind: 'projection_variant'; variant: string }>;

interface DeclarativeStepBase {
  readonly id: StepId;
  readonly timeoutMs?: Milliseconds;
  readonly onFailure: 'fail_case' | 'incomplete_case';
  readonly concurrencyGroup?: string;
}

export type DeclarativeStep =
  | (DeclarativeStepBase &
      Readonly<{
        kind: 'subscribe';
        query: DeclarativeQuery;
        clients: DeclarativeValueReference;
      }>)
  | (DeclarativeStepBase &
      Readonly<{
        kind: 'mongo_write';
        operation:
          | 'insert_one'
          | 'insert_many'
          | 'update_one'
          | 'replace_one'
          | 'delete_one'
          | 'delete_many';
        selector: DeclarativeSelector;
        mutation: DeclarativeMutation;
        expectedTransition: DeclarativeTransition;
      }>)
  | (DeclarativeStepBase &
      Readonly<{
        kind: 'wait';
        predicate: string;
        inputs: Readonly<Record<string, DeclarativeValueReference>>;
      }>)
  | (DeclarativeStepBase &
      Readonly<{
        kind: 'barrier';
        barrier: string;
        schedule: 'serialized' | 'concurrent' | 'burst';
        participants: DeclarativeValueReference;
      }>)
  | (DeclarativeStepBase &
      Readonly<{
        kind: 'client_lifecycle';
        action:
          | 'connect'
          | 'disconnect'
          | 'reconnect'
          | 'resume'
          | 'stop_subscription'
          | 'shutdown';
        clients: DeclarativeValueReference;
      }>)
  | (DeclarativeStepBase &
      Readonly<{
        kind: 'fault';
        operation: 'activate' | 'restore';
        controller: FaultController;
        faultId: FaultId;
      }>)
  | (DeclarativeStepBase &
      Readonly<{
        kind: 'snapshot';
        producer: EvidenceProducer;
        scope: 'expected' | 'mongodb' | 'ddp' | 'all';
      }>)
  | (DeclarativeStepBase & Readonly<{ kind: 'seal_evidence' }>);

export type FaultController =
  | 'catchup_timeout'
  | 'change_stream_error'
  | 'change_stream_close'
  | 'ddp_client_disconnect'
  | 'meteor_mongo_interruption'
  | 'mongodb_primary_step_down'
  | 'replica_set_election'
  | 'snapshot_pause'
  | 'stream_restart'
  | 'watch_setup_pause';

export type CasePrecondition =
  | Readonly<{ kind: 'change_stream_available' }>
  | Readonly<{
      kind: 'topology_available' | 'topology_matches_coordinate';
      topology: MongoTopology;
    }>
  | Readonly<{
      kind: 'transport_available';
      transport: DdpTransport;
    }>
  | Readonly<{
      kind: 'fault_controller_available';
      controller: FaultController;
    }>;

export interface ChangeStreamEvidenceRequirement {
  readonly driver: ChangeStreamObserver;
  readonly selectionEvidence: 'required';
  readonly lifecycleEvidence: 'required' | 'diagnostic';
}

export interface CaseEvidenceRequirements {
  readonly requiredProducers: NonEmptyReadonlyArray<ObservedEvidenceProducer>;
  readonly changeStream: ChangeStreamEvidenceRequirement;
  readonly transportIdentity: 'required' | 'diagnostic';
  readonly fault: Readonly<{
    kind: 'activated_and_restored';
    controller: FaultController;
  }> | null;
  readonly ledgers: NonEmptyReadonlyArray<LedgerId>;
}

export interface DeclarativeOracle {
  readonly id: OracleId;
  readonly family: OracleFamily;
  readonly producer: ObservedEvidenceProducer;
  readonly expected: DeclarativeValueReference;
  readonly observed: Readonly<{
    producer: ObservedEvidenceProducer;
    stepId: StepId | 'cleanup';
    ledgerId: LedgerId;
  }>;
  readonly failureReason: string;
  readonly gate: 'hard' | 'diagnostic';
}

export interface ExecutionBudget {
  readonly maximumSteps: PositiveInteger;
  readonly maximumDocuments: PositiveInteger;
  readonly maximumSubscribers: PositiveInteger;
  readonly maximumPayloadBytes: ByteCount;
  readonly maximumEvidenceEntries: PositiveInteger;
  readonly stepTimeoutMs: Milliseconds;
  readonly caseTimeoutMs: Milliseconds;
  readonly maximumRetries: 0 | 1;
}

export interface CaseDefinitionV1 {
  readonly schemaVersion: 1;
  readonly id: CaseId;
  readonly title: string;
  readonly source: string;
  readonly rationale: string;
  readonly applicability: NonEmptyReadonlyArray<ApplicabilityScope>;
  readonly parameters: Readonly<Record<ParameterName, ParameterDefinition>>;
  readonly fixture: Readonly<{
    collection: 'reliabilityDocuments';
    publication: 'reliability.documents';
    generator: string;
    subscribers: DeclarativeValueReference;
    documents: DeclarativeValueReference;
    payloadBytes: DeclarativeValueReference;
  }>;
  readonly preconditions: readonly CasePrecondition[];
  readonly steps: NonEmptyReadonlyArray<DeclarativeStep>;
  readonly evidence: CaseEvidenceRequirements;
  readonly oracles: NonEmptyReadonlyArray<DeclarativeOracle>;
  readonly diagnostics: readonly Readonly<{
    kind: 'propagation_latency' | 'event_counts' | 'resource_usage';
    fromStep?: StepId;
  }>[];
  readonly cleanup: Readonly<{ kind: 'run_scoped'; verifyEmpty: true }>;
  readonly budget: ExecutionBudget;
  readonly sharing: 'isolated';
}

export interface AuditProfileV1 {
  readonly schemaVersion: 1;
  readonly id: ProfileId;
  readonly title: string;
  readonly parameters: Readonly<Record<ParameterName, EjsonValue>>;
  readonly caseTimeoutMs: Milliseconds;
}

export interface CompiledCasePlanV1 {
  readonly schemaVersion: 1;
  readonly contractId: ContractId;
  readonly contractDigest: Sha256Digest;
  readonly caseDefinitionDigest: Sha256Digest;
  readonly profileId: ProfileId;
  readonly runId: RunId;
  readonly coordinate: Readonly<{
    caseId: CaseId;
    transport: DdpTransport;
    topology: MongoTopology;
    observer: ChangeStreamObserver;
    seed: UInt32;
    faultId?: FaultId;
  }>;
  readonly resolvedParameters: Readonly<Record<ParameterName, EjsonValue>>;
  readonly steps: NonEmptyReadonlyArray<DeclarativeStep>;
  readonly budget: ExecutionBudget;
  readonly digest: Sha256Digest;
}
