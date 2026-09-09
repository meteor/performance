import type {
  AuditCaseOutcome,
  ByteCount,
  CaseCoordinate,
  CaseDefinitionV1,
  CaseId,
  EvidenceEntryId,
  EvidenceReference,
  LedgerId,
  Milliseconds,
  OracleId,
  ParameterName,
  PositiveInteger,
  Sha256Digest,
  StepId,
  UInt32,
} from '../../reliability/contracts/index.js';

const caseId = 'event.insert' as CaseId;
const stepId = 'subscribe' as StepId;
const oracleId = 'snapshot.matches' as OracleId;
const ledgerId = 'mongodb' as LedgerId;
const digest = 'digest' as Sha256Digest;
const seed = 1 as UInt32;
const duration = 1_000 as Milliseconds;
const count = 1 as PositiveInteger;
const payloadBytes = 1_024 as ByteCount;
const parameterName = 'documents' as ParameterName;

const caseDefinition = {
  schemaVersion: 1,
  id: caseId,
  title: 'Insert reaches one subscriber',
  source: 'design review',
  rationale: 'Proves the smallest end-to-end change-stream behavior.',
  applicability: [
    {
      topologies: ['replica_set'],
      transports: ['sockjs'],
    },
  ],
  parameters: {
    [parameterName]: {
      type: 'integer',
      default: 1,
      minimum: 1,
      maximum: 10,
    },
  },
  fixture: {
    collection: 'reliabilityDocuments',
    publication: 'reliability.documents',
    generator: 'minimal-document',
    subscribers: { kind: 'literal', value: 1 },
    documents: { kind: 'parameter', name: parameterName },
    payloadBytes: { kind: 'literal', value: 64 },
  },
  preconditions: [
    { kind: 'change_stream_available' },
  ],
  steps: [
    {
      id: stepId,
      kind: 'subscribe',
      query: { kind: 'unordered' },
      clients: { kind: 'fixture', field: 'subscriberIds' },
      onFailure: 'fail_case',
    },
  ],
  evidence: {
    requiredProducers: ['mongodb', 'ddp_client', 'meteor_probe'],
    changeStream: {
      driver: 'changeStreams',
      selectionEvidence: 'required',
      lifecycleEvidence: 'required',
    },
    transportIdentity: 'required',
    fault: null,
    ledgers: [ledgerId],
  },
  oracles: [
    {
      id: oracleId,
      family: 'snapshot_exact',
      producer: 'mongodb',
      expected: { kind: 'fixture', field: 'documents' },
      observed: { producer: 'mongodb', stepId, ledgerId },
      failureReason: 'mongodb_snapshot_mismatch',
      gate: 'hard',
    },
  ],
  diagnostics: [{ kind: 'propagation_latency', fromStep: stepId }],
  cleanup: { kind: 'run_scoped', verifyEmpty: true },
  budget: {
    maximumSteps: count,
    maximumDocuments: count,
    maximumSubscribers: count,
    maximumPayloadBytes: payloadBytes,
    maximumEvidenceEntries: count,
    stepTimeoutMs: duration,
    caseTimeoutMs: duration,
    maximumRetries: 0,
  },
  sharing: 'isolated',
} satisfies CaseDefinitionV1;

void caseDefinition;
void digest;
void seed;

const passingOutcome = {
  status: 'passed',
  reasons: [],
} satisfies AuditCaseOutcome;

void passingOutcome;

const observedReference = {
  producer: 'ddp_client',
  ledgerId,
  entryId: 'entry-1' as EvidenceEntryId,
  stepId,
} satisfies EvidenceReference<'ddp_client'>;

void observedReference;

// @ts-expect-error A passing result cannot include failure reasons.
const invalidPassingOutcome: AuditCaseOutcome = {
  status: 'passed',
  reasons: ['unexpected event'],
};

void invalidPassingOutcome;

const invalidObservedReference: EvidenceReference<'mongodb'> = {
  // @ts-expect-error Observed evidence cannot claim expected-model provenance.
  producer: 'expected_model',
  ledgerId,
  entryId: 'entry-2' as EvidenceEntryId,
  stepId,
};

void invalidObservedReference;

const invalidOrderedQuery: CaseDefinitionV1['steps'][number] = {
  id: stepId,
  kind: 'subscribe',
  // @ts-expect-error Ordered observers are outside the change-stream audit.
  query: { kind: 'ordered', sort: [{ field: '_id', direction: 'ascending' }] },
  clients: { kind: 'fixture', field: 'subscriberIds' },
  onFailure: 'fail_case',
};

void invalidOrderedQuery;

const invalidLegacyObserver: CaseCoordinate = {
  caseId,
  transport: 'sockjs',
  topology: 'replica_set',
  // @ts-expect-error The audit has no legacy oplog-driver coordinate.
  observer: 'oplog',
  seed,
};

void invalidLegacyObserver;

const invalidStandaloneTopology: CaseCoordinate = {
  caseId,
  transport: 'sockjs',
  // @ts-expect-error Standalone MongoDB cannot provide change streams.
  topology: 'standalone',
  observer: 'changeStreams',
  seed,
};

void invalidStandaloneTopology;
