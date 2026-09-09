import type {
  AuditId,
  ByteCount,
  CapabilityId,
  CaseId,
  ContractId,
  EjsonValue,
  EvidenceEntryId,
  FaultId,
  HarnessRevision,
  LedgerId,
  Milliseconds,
  NonEmptyReadonlyArray,
  OracleId,
  ProfileId,
  RunId,
  Sha256Digest,
  StepId,
  UInt32,
} from './primitives.js';

export type ChangeStreamObserver = 'changeStreams';
export type DdpTransport = 'sockjs' | 'sockjs-polling' | 'uws';
export type MongoTopology = 'replica_set' | 'sharded_cluster';

export interface CaseCoordinate {
  readonly caseId: CaseId;
  readonly transport: DdpTransport;
  readonly topology: MongoTopology;
  readonly observer: ChangeStreamObserver;
  /** An unsigned 32-bit integer after runtime validation. */
  readonly seed: UInt32;
  readonly faultId?: FaultId;
}

export interface ApplicabilityScope {
  readonly topologies: NonEmptyReadonlyArray<MongoTopology>;
  readonly transports: NonEmptyReadonlyArray<DdpTransport>;
}

export type CapabilityExpectation =
  | 'supported'
  | 'not_supported'
  | 'out_of_scope';

interface CapabilityDefinitionBase {
  readonly id: CapabilityId;
  readonly source: string;
  readonly rationale: string;
}

export type CapabilityDefinition =
  | (CapabilityDefinitionBase & {
      readonly expectation: 'supported';
      readonly requiredCases: NonEmptyReadonlyArray<CaseId>;
      readonly applicability: NonEmptyReadonlyArray<ApplicabilityScope>;
    })
  | (CapabilityDefinitionBase & {
      readonly expectation: 'not_supported' | 'out_of_scope';
      readonly requiredCases: readonly [];
      readonly applicability: readonly ApplicabilityScope[];
    });

export type MeteorSourceIdentity =
  | Readonly<{
      mode: 'release';
      requestedRelease: string;
      actualRelease: string;
      sourceRevision: `release:${string}`;
      fixtureRelease: `METEOR@${string}`;
    }>
  | Readonly<{
      mode: 'checkout';
      requestedCheckout: string;
      sourceRevision: Sha256Digest;
      fixtureRelease: `METEOR@${string}`;
    }>
  | Readonly<{
      mode: 'system';
      executable: string;
      actualRelease: string;
      sourceRevision: Sha256Digest;
      fixtureRelease: `METEOR@${string}`;
    }>;

export interface ReleaseIdentity {
  readonly source: MeteorSourceIdentity;
  readonly packageVersionsDigest: Sha256Digest;
  readonly settingsDigest: Sha256Digest;
}

export interface HarnessIdentity {
  readonly revision: HarnessRevision;
  readonly dirty: boolean;
  readonly contractId: ContractId;
  readonly contractDigest: Sha256Digest;
  readonly executionEnvironment: string;
}

export interface MongoMemberIdentity {
  readonly name: string;
  readonly role: 'primary' | 'secondary' | 'mongos' | 'config';
}

interface MongoEnvironmentIdentityBase {
  readonly serverVersion: string;
  readonly featureCompatibilityVersion: string;
  readonly members: readonly MongoMemberIdentity[];
}

export type MongoEnvironmentIdentity =
  | (MongoEnvironmentIdentityBase & {
      readonly topology: 'replica_set';
      readonly replicaSetName: string;
    })
  | (MongoEnvironmentIdentityBase & {
      readonly topology: 'sharded_cluster';
      readonly clusterName: string;
    });

export interface AuditIdentity {
  readonly auditId: AuditId;
  readonly runId: RunId;
  readonly release: ReleaseIdentity;
  readonly harness: HarnessIdentity;
  readonly mongo: MongoEnvironmentIdentity;
}

export type ExpectedEvidenceProducer = 'expected_model';

export type ObservedEvidenceProducer =
  | 'mongodb'
  | 'ddp_client'
  | 'meteor_probe'
  | 'fault_controller';

export type EvidenceProducer =
  | ExpectedEvidenceProducer
  | ObservedEvidenceProducer;

export interface EvidenceReference<
  Producer extends EvidenceProducer = EvidenceProducer,
> {
  readonly producer: Producer;
  readonly ledgerId: LedgerId;
  readonly entryId: EvidenceEntryId;
  readonly stepId: StepId | 'cleanup';
}

export interface EvidenceEntry<
  Producer extends EvidenceProducer = EvidenceProducer,
> {
  readonly id: EvidenceEntryId;
  readonly producer: Producer;
  readonly sequence: UInt32;
  readonly capturedAt: string;
  readonly kind: string;
  readonly payload: EjsonValue;
  readonly digest: Sha256Digest;
}

export interface EvidenceLedger<
  Producer extends EvidenceProducer = EvidenceProducer,
> {
  readonly schemaVersion: 1;
  readonly id: LedgerId;
  readonly auditId: AuditId;
  readonly runId: RunId;
  readonly producer: Producer;
  readonly entries: readonly EvidenceEntry<Producer>[];
  readonly digest: Sha256Digest;
  readonly sealed: boolean;
}

export type OracleFamily =
  | 'snapshot_exact'
  | 'event_present'
  | 'event_absent'
  | 'revision_monotonic'
  | 'field_absent'
  | 'change_stream_identity'
  | 'transport_identity'
  | 'session_identity'
  | 'fault_witness'
  | 'cleanup_complete'
  | 'release_identity'
  | 'required_coordinate';

export interface OracleEvaluation {
  readonly oracleId: OracleId;
  readonly family: OracleFamily;
  readonly gate: 'hard' | 'diagnostic';
  readonly status: 'passed' | 'failed' | 'unavailable';
  readonly expected: EvidenceReference<ExpectedEvidenceProducer>;
  readonly observed: EvidenceReference<ObservedEvidenceProducer>;
  readonly reason?: string;
}

export type CleanupResult =
  | Readonly<{
      status: 'complete';
      verifiedEmpty: true;
      evidence: EvidenceReference<ObservedEvidenceProducer>;
    }>
  | Readonly<{
      status: 'failed';
      verifiedEmpty: false;
      evidence?: EvidenceReference<ObservedEvidenceProducer>;
      reasons: NonEmptyReadonlyArray<string>;
    }>;

export interface AuditMeasurements {
  readonly wallClockMs: Milliseconds;
  readonly values: Readonly<Record<string, number>>;
}

export type AuditCaseOutcome =
  | Readonly<{
      status: 'passed';
      reasons: readonly [];
    }>
  | Readonly<{
      status: 'failed';
      reasons: NonEmptyReadonlyArray<string>;
    }>
  | Readonly<{
      status: 'incomplete';
      reasons: NonEmptyReadonlyArray<string>;
    }>
  | Readonly<{
      status: 'not_applicable';
      reasons: NonEmptyReadonlyArray<string>;
    }>;

export interface AuditCaseResultV1 {
  readonly schemaVersion: 1;
  readonly identity: AuditIdentity;
  readonly coordinate: CaseCoordinate;
  readonly profileId: ProfileId;
  readonly caseDefinitionDigest: Sha256Digest;
  readonly compiledPlanDigest: Sha256Digest;
  readonly interpreterVersion: string;
  readonly stepLedgerDigest: Sha256Digest;
  readonly evidenceLedgerDigests: Readonly<
    Partial<Record<ObservedEvidenceProducer, Sha256Digest>>
  >;
  readonly oracles: readonly OracleEvaluation[];
  readonly cleanup: CleanupResult;
  readonly measurements: AuditMeasurements;
  readonly outcome: AuditCaseOutcome;
}

export type AuditRunOutcome =
  | Readonly<{ status: 'passed'; reasons: readonly [] }>
  | Readonly<{
      status: 'failed' | 'incomplete';
      reasons: NonEmptyReadonlyArray<string>;
    }>;

export interface AuditRunResultV1 {
  readonly schemaVersion: 1;
  readonly identity: AuditIdentity;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly cases: readonly AuditCaseResultV1[];
  readonly outcome: AuditRunOutcome;
  readonly artifactDigest: Sha256Digest;
  readonly artifactBytes: ByteCount;
}
