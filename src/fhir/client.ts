import axios, { type AxiosError, type AxiosInstance } from "axios";
import type { Config } from "../config.js";
import type {
  Bundle,
  MedicationRequest,
  Observation,
  OperationOutcome,
  Patient,
} from "./types.js";

export class FhirError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly outcome?: OperationOutcome,
  ) {
    super(message);
    this.name = "FhirError";
  }
}

export interface FhirClient {
  getPatient(patientId: string): Promise<Patient>;
  searchObservations(patientId: string, code: string): Promise<Observation[]>;
  getMedicationRequests(patientId: string): Promise<MedicationRequest[]>;
}

export class HttpFhirClient implements FhirClient {
  private readonly http: AxiosInstance;

  constructor(config: Config) {
    const headers: Record<string, string> = {
      Accept: "application/fhir+json",
    };
    if (config.FHIR_AUTH_TOKEN) {
      headers.Authorization = `Bearer ${config.FHIR_AUTH_TOKEN}`;
    }

    this.http = axios.create({
      baseURL: config.FHIR_BASE_URL,
      timeout: config.REQUEST_TIMEOUT_MS,
      headers,
      // Axios follows redirects by default; FHIR servers should not
      // redirect for read operations, but we keep the default behavior
      // for compatibility with proxies.
    });
  }

  async getPatient(patientId: string): Promise<Patient> {
    return this.request<Patient>(
      "GET",
      `/Patient/${encodeURIComponent(patientId)}`,
    );
  }

  async searchObservations(
    patientId: string,
    code: string,
  ): Promise<Observation[]> {
    const bundle = await this.request<Bundle<Observation>>(
      "GET",
      "/Observation",
      { patient: patientId, code },
    );
    return extractResources(bundle);
  }

  async getMedicationRequests(patientId: string): Promise<MedicationRequest[]> {
    const bundle = await this.request<Bundle<MedicationRequest>>(
      "GET",
      "/MedicationRequest",
      { patient: patientId },
    );
    return extractResources(bundle);
  }

  private async request<T>(
    method: "GET",
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    try {
      const response = await this.http.request<T>({
        method,
        url: path,
        params,
      });
      return response.data;
    } catch (err) {
      throw toFhirError(err, method, path);
    }
  }
}

function extractResources<T>(bundle: Bundle<T>): T[] {
  if (!bundle.entry) {
    return [];
  }
  const out: T[] = [];
  for (const entry of bundle.entry) {
    if (entry.resource) {
      out.push(entry.resource);
    }
  }
  return out;
}

function toFhirError(err: unknown, method: string, path: string): FhirError {
  const axiosErr = err as AxiosError<OperationOutcome>;
  const status = axiosErr.response?.status;
  const outcome = axiosErr.response?.data;
  const label = status !== undefined ? String(status) : "no-response";
  return new FhirError(
    `FHIR ${method} ${path} failed (${label})`,
    status,
    outcome,
  );
}
