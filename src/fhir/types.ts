// Minimal FHIR R4 type surface. Only fields the prototype reads or
// forwards are modeled. A real HealthLake client should replace this
// with generated types from the FHIR StructureDefinitions.

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Reference {
  reference?: string;
  type?: string;
  display?: string;
}

export interface HumanName {
  use?: string;
  text?: string;
  family?: string;
  given?: string[];
}

export interface Patient {
  resourceType: "Patient";
  id: string;
  active?: boolean;
  name?: HumanName[];
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string;
}

export interface Quantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}

export interface Observation {
  resourceType: "Observation";
  id: string;
  status: string;
  code: CodeableConcept;
  subject?: Reference;
  effectiveDateTime?: string;
  issued?: string;
  valueQuantity?: Quantity;
  valueCodeableConcept?: CodeableConcept;
  valueString?: string;
}

export interface MedicationRequest {
  resourceType: "MedicationRequest";
  id: string;
  status: string;
  intent: string;
  subject: Reference;
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  authoredOn?: string;
}

export interface BundleEntry<T> {
  fullUrl?: string;
  resource?: T;
}

export interface Bundle<T> {
  resourceType: "Bundle";
  type: string;
  total?: number;
  entry?: BundleEntry<T>[];
}

export interface OperationOutcomeIssue {
  severity: "fatal" | "error" | "warning" | "information";
  code: string;
  diagnostics?: string;
}

export interface OperationOutcome {
  resourceType: "OperationOutcome";
  issue: OperationOutcomeIssue[];
}
