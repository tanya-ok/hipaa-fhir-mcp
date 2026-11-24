import { Agent } from "node:https";
import axios, { type AxiosInstance } from "axios";
import type { z } from "zod";
import type { Config } from "../config.js";
import {
  loadPrivateKey,
  SmartAuthError,
  SmartBackendTokens,
  StaticToken,
  safeHttpsUrl,
  type TokenSource,
} from "../security/smart-backend.js";
import {
  type AllergyIntolerance,
  AllergyIntoleranceSchema,
  type Condition,
  ConditionSchema,
  type Encounter,
  EncounterSchema,
  type Immunization,
  ImmunizationSchema,
  MAX_PAGES,
  MAX_RESPONSE_BYTES,
  MAX_RESULTS,
  MedicationRequestSchema,
  ObservationSchema,
  PAGE_SIZE,
  PatientIdSchema,
  PatientSchema,
  SearchBundleSchema,
} from "./schemas.js";
import type { MedicationRequest, Observation, Patient } from "./types.js";

function tokenSourceFrom(config: Config, base: URL): TokenSource | undefined {
  if (config.FHIR_AUTH_TOKEN) return new StaticToken(config.FHIR_AUTH_TOKEN);
  if (
    !config.SMART_CLIENT_ID ||
    !config.SMART_KEY_ID ||
    !config.SMART_PRIVATE_KEY_FILE
  )
    return undefined;
  return new SmartBackendTokens({
    fhirBase: base,
    clientId: config.SMART_CLIENT_ID,
    keyId: config.SMART_KEY_ID,
    privateKey: loadPrivateKey(config.SMART_PRIVATE_KEY_FILE),
    scope: config.SMART_SCOPE,
    tokenUrl: config.SMART_TOKEN_URL
      ? safeHttpsUrl(config.SMART_TOKEN_URL)
      : undefined,
    timeoutMs: config.REQUEST_TIMEOUT_MS,
  });
}

const bySubject = (r: { subject: { reference: string } }) =>
  r.subject.reference;
const byPatient = (r: { patient: { reference: string } }) =>
  r.patient.reference;

export class FhirError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "FhirError";
  }
}

export interface FhirClient {
  getPatient(patientId: string): Promise<Patient>;
  searchObservations(patientId: string, code: string): Promise<Observation[]>;
  getMedicationRequests(patientId: string): Promise<MedicationRequest[]>;
  getConditions(patientId: string): Promise<Condition[]>;
  getAllergies(patientId: string): Promise<AllergyIntolerance[]>;
  getImmunizations(patientId: string): Promise<Immunization[]>;
  getEncounters(patientId: string, since?: string): Promise<Encounter[]>;
  findPatients(identifier: string): Promise<Patient[]>;
}

export class HttpFhirClient implements FhirClient {
  private readonly http: AxiosInstance;
  private readonly base: URL;

  private readonly tokens?: TokenSource;

  constructor(config: Config, tokens?: TokenSource) {
    this.base = new URL(`${config.FHIR_BASE_URL.replace(/\/+$/, "")}/`);
    if (
      this.base.protocol !== "https:" ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash
    )
      throw new FhirError("Invalid FHIR endpoint");
    const headers: Record<string, string> = {
      Accept: "application/fhir+json",
      Prefer: "handling=strict",
    };
    this.tokens = tokens ?? tokenSourceFrom(config, this.base);
    this.http = axios.create({
      timeout: config.REQUEST_TIMEOUT_MS,
      headers,
      httpsAgent: new Agent({ minVersion: "TLSv1.2" }),
      maxRedirects: 0,
      proxy: false,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
    });
  }

  async getPatient(patientId: string): Promise<Patient> {
    this.assertPatientId(patientId);
    const url = new URL(`Patient/${encodeURIComponent(patientId)}`, this.base);
    const patient = this.parse(PatientSchema, await this.request(url));
    if (patient.id !== patientId)
      throw new FhirError("Unexpected FHIR subject");
    return patient;
  }

  async searchObservations(
    patientId: string,
    code: string,
  ): Promise<Observation[]> {
    return this.search(
      "Observation",
      ObservationSchema,
      patientId,
      { code },
      bySubject,
    );
  }

  async getMedicationRequests(patientId: string): Promise<MedicationRequest[]> {
    const resources = await this.search(
      "MedicationRequest",
      MedicationRequestSchema,
      patientId,
      { status: "active" },
      bySubject,
    );
    return resources.filter((resource) => resource.status === "active");
  }

  async getConditions(patientId: string): Promise<Condition[]> {
    return this.search("Condition", ConditionSchema, patientId, {}, bySubject);
  }

  async getAllergies(patientId: string): Promise<AllergyIntolerance[]> {
    return this.search(
      "AllergyIntolerance",
      AllergyIntoleranceSchema,
      patientId,
      {},
      byPatient,
    );
  }

  async getImmunizations(patientId: string): Promise<Immunization[]> {
    return this.search(
      "Immunization",
      ImmunizationSchema,
      patientId,
      {},
      byPatient,
    );
  }

  /** Identifier search; the caller filters the matches by its own grant. */
  async findPatients(identifier: string): Promise<Patient[]> {
    return this.search("Patient", PatientSchema, null, { identifier }, null);
  }

  async getEncounters(patientId: string, since?: string): Promise<Encounter[]> {
    return this.search(
      "Encounter",
      EncounterSchema,
      patientId,
      since ? { date: `ge${since}` } : {},
      bySubject,
    );
  }

  private async search<T extends { id: string }>(
    resourceType: string,
    schema: z.ZodType<T>,
    patientId: string | null,
    params: Record<string, string>,
    subjectOf: ((resource: T) => string) | null,
  ): Promise<T[]> {
    if (patientId !== null) this.assertPatientId(patientId);
    let url = new URL(resourceType, this.base);
    url.search = new URLSearchParams({
      ...(patientId !== null ? { patient: patientId } : {}),
      _count: String(PAGE_SIZE),
      ...params,
    }).toString();
    const seen = new Set<string>();
    const ids = new Set<string>();
    const results: T[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      if (seen.has(url.href)) throw new FhirError("FHIR pagination cycle");
      seen.add(url.href);
      const bundle = this.parse(SearchBundleSchema, await this.request(url));
      if (bundle.total !== undefined && bundle.total > MAX_RESULTS)
        throw new FhirError("FHIR result limit exceeded");
      for (const entry of bundle.entry) {
        const resource = this.parse(schema, entry.resource);
        if (patientId !== null && subjectOf !== null) {
          const expected = `Patient/${patientId}`;
          if (
            subjectOf(resource) !== expected &&
            subjectOf(resource) !== new URL(expected, this.base).href
          )
            throw new FhirError("Unexpected FHIR subject");
        }
        if (ids.has(resource.id)) throw new FhirError("Repeated FHIR resource");
        ids.add(resource.id);
        results.push(resource);
      }
      if (results.length > MAX_RESULTS)
        throw new FhirError("FHIR result limit exceeded");
      const next = bundle.link.filter((link) => link.relation === "next");
      if (next.length === 0) return results;
      const continuation = next[0];
      if (next.length !== 1 || !continuation)
        throw new FhirError("Invalid FHIR pagination");
      try {
        url = new URL(continuation.url, url);
      } catch {
        throw new FhirError("Invalid FHIR pagination");
      }
      // Continuation URLs are untrusted; never send the backend credential outside its base.
      if (
        url.origin !== this.base.origin ||
        !(
          url.pathname.startsWith(this.base.pathname) ||
          url.pathname === this.base.pathname.slice(0, -1)
        ) ||
        url.username ||
        url.password ||
        url.hash ||
        /%2f|%5c|%25/i.test(url.pathname)
      )
        throw new FhirError("Invalid FHIR pagination destination");
    }
    throw new FhirError("FHIR page limit exceeded");
  }

  private assertPatientId(patientId: string): void {
    if (!PatientIdSchema.safeParse(patientId).success)
      throw new FhirError("Invalid FHIR identifier");
  }

  private parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
    const result = schema.safeParse(data);
    if (!result.success) throw new FhirError("Invalid FHIR response");
    return result.data;
  }

  private async request(url: URL, retried = false): Promise<unknown> {
    let status: number | undefined;
    try {
      const token = this.tokens ? await this.tokens.token() : undefined;
      const response = await this.http.request<unknown>({
        method: "GET",
        url: url.href,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return response.data;
    } catch (err) {
      if (err instanceof SmartAuthError)
        throw new FhirError("FHIR authorization failed");
      status = axios.isAxiosError(err) ? err.response?.status : undefined;
    }
    // An expired or revoked token gets one fresh token and one retry.
    if (status === 401 && this.tokens && !retried) {
      this.tokens.invalidate();
      return this.request(url, true);
    }
    throw new FhirError("FHIR request failed", status);
  }
}
