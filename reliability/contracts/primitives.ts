/**
 * Compile-time primitives for the change-stream audit contract.
 *
 * Brands prevent accidental cross-assignment inside typed code. They do not
 * validate untrusted runtime values; a future boundary parser must do that.
 */
export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type AuditId = Brand<string, 'AuditId'>;
export type CaseId = Brand<string, 'CaseId'>;
export type CapabilityId = Brand<string, 'CapabilityId'>;
export type ContractId = Brand<string, 'ContractId'>;
export type EvidenceEntryId = Brand<string, 'EvidenceEntryId'>;
export type FaultId = Brand<string, 'FaultId'>;
export type HarnessRevision = Brand<string, 'HarnessRevision'>;
export type LedgerId = Brand<string, 'LedgerId'>;
export type OracleId = Brand<string, 'OracleId'>;
export type ParameterName = Brand<string, 'ParameterName'>;
export type ProfileId = Brand<string, 'ProfileId'>;
export type RunId = Brand<string, 'RunId'>;
export type Sha256Digest = Brand<string, 'Sha256Digest'>;
export type StepId = Brand<string, 'StepId'>;

export type ByteCount = Brand<number, 'ByteCount'>;
export type Milliseconds = Brand<number, 'Milliseconds'>;
export type PositiveInteger = Brand<number, 'PositiveInteger'>;
export type UInt32 = Brand<number, 'UInt32'>;

export type EjsonScalar = null | boolean | number | string;

export type EjsonValue =
  | EjsonScalar
  | readonly EjsonValue[]
  | { readonly [key: string]: EjsonValue };

export type NonEmptyReadonlyArray<Value> = readonly [Value, ...Value[]];
