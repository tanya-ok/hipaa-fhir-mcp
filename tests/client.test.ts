import axios, { type AxiosAdapter, AxiosError, AxiosHeaders } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { FhirError, HttpFhirClient } from "../src/fhir/client.js";
import { MAX_PAGES, MAX_RESULTS } from "../src/fhir/schemas.js";

const patient = { resourceType: "Patient", id: "synthetic-1", active: true };
const observation = {
  resourceType: "Observation",
  id: "o-1",
  status: "final",
  code: {
    coding: [{ code: "8867-4", display: "private-display" }],
    text: "private-text",
  },
  subject: { reference: "Patient/synthetic-1", display: "private-name" },
  valueQuantity: { value: 80, unit: "/min" },
};
const bundle = (resources: unknown[], next?: string) => ({
  resourceType: "Bundle",
  type: "searchset",
  entry: resources.map((resource) => ({ resource })),
  link: next ? [{ relation: "next", url: next }] : [],
});
const originalAdapter = axios.defaults.adapter;
afterEach(() => {
  axios.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
});

function client(responses: unknown[]) {
  const requests: string[] = [];
  const adapter: AxiosAdapter = async (config) => {
    requests.push(config.url ?? "");
    const data = responses.shift();
    if (data instanceof Error) throw data;
    return {
      config,
      data,
      headers: new AxiosHeaders(),
      status: 200,
      statusText: "OK",
    };
  };
  axios.defaults.adapter = adapter;
  const create = vi.spyOn(axios, "create");
  const fhir = new HttpFhirClient(
    ConfigSchema.parse({
      AUDIT_HMAC_KEY: "a".repeat(64),
      FHIR_BASE_URL: "https://example.org/fhir",
      FHIR_AUTH_TOKEN: "synthetic-token",
    }),
  );
  return { fhir, requests, create };
}

describe("HTTP FHIR boundary", () => {
  it("projects allowlisted patient fields and pins network limits", async () => {
    const { fhir, create, requests } = client([
      {
        ...patient,
        name: [{ text: "private-name" }],
        text: { div: "private-narrative" },
        extension: [{ valueString: "private-extension" }],
      },
    ]);
    expect(await fhir.getPatient("synthetic-1")).toEqual(patient);
    expect(requests).toEqual(["https://example.org/fhir/Patient/synthetic-1"]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRedirects: 0,
        proxy: false,
        maxContentLength: 1048576,
        maxBodyLength: 1048576,
      }),
    );
  });
  it.each([
    null,
    { resourceType: "Observation", id: "synthetic-1" },
    { ...patient, active: "yes" },
    { ...patient, id: "another-subject" },
  ])("refuses invalid or mismatched patient %#", async (response) => {
    const { fhir } = client([response]);
    await expect(fhir.getPatient("synthetic-1")).rejects.toBeInstanceOf(
      FhirError,
    );
  });
  it("refuses dot-segment identifiers without a request", async () => {
    const { fhir, requests } = client([]);
    await expect(fhir.getPatient("..")).rejects.toBeInstanceOf(FhirError);
    await expect(
      fhir.searchObservations("..", "8867-4"),
    ).rejects.toBeInstanceOf(FhirError);
    await expect(
      fhir.getMedicationRequests("x".repeat(65)),
    ).rejects.toBeInstanceOf(FhirError);
    expect(requests).toEqual([]);
  });
  it("follows bounded same-base pagination and strips nested free text", async () => {
    const { fhir, requests } = client([
      bundle([observation], "?page=2"),
      bundle([{ ...observation, id: "o-2" }]),
    ]);
    const result = await fhir.searchObservations("synthetic-1", "8867-4");
    expect(result.map((item) => item.id)).toEqual(["o-1", "o-2"]);
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(requests[1]).toBe("https://example.org/fhir/Observation?page=2");
  });
  it.each([
    "https://other.example.org/fhir?page=2",
    "http://example.org/fhir?page=2",
    "https://example.org/other?page=2",
    "https://user:pass@example.org/fhir/?page=2",
    "/fhir/%2fother",
    "https://example.org/fhir/../other",
  ])("never follows unsafe next link %s", async (next) => {
    const { fhir, requests } = client([bundle([observation], next)]);
    await expect(
      fhir.searchObservations("synthetic-1", "8867-4"),
    ).rejects.toBeInstanceOf(FhirError);
    expect(requests).toHaveLength(1);
  });
  it.each([
    {},
    { resourceType: "Patient", id: "synthetic-1" },
    { resourceType: "Bundle", type: "collection" },
    bundle([null]),
    bundle([patient]),
    bundle([
      { ...observation, subject: { reference: "Patient/another-subject" } },
    ]),
    { ...bundle([]), entry: [{}] },
  ])("refuses malformed or mixed-subject search %#", async (response) => {
    const { fhir } = client([response]);
    await expect(
      fhir.searchObservations("synthetic-1", "8867-4"),
    ).rejects.toBeInstanceOf(FhirError);
  });
  it("rejects cycles without returning partial success", async () => {
    const { fhir, requests } = client([
      bundle([], "?page=2"),
      bundle([], "?page=2"),
    ]);
    await expect(fhir.searchObservations("synthetic-1", "x")).rejects.toThrow(
      "FHIR pagination cycle",
    );
    expect(requests).toHaveLength(2);
  });
  it("bounds empty-page chains", async () => {
    const { fhir, requests } = client(
      Array.from({ length: MAX_PAGES }, (_, i) => bundle([], `?page=${i + 2}`)),
    );
    await expect(fhir.searchObservations("synthetic-1", "x")).rejects.toThrow(
      "FHIR page limit exceeded",
    );
    expect(requests).toHaveLength(MAX_PAGES);
  });
  it("bounds aggregate results even when each page is within its limit", async () => {
    const page = Array.from({ length: MAX_RESULTS }, (_, i) => ({
      ...observation,
      id: `o-${i}`,
    }));
    const { fhir } = client([
      bundle(page, "?page=2"),
      bundle([{ ...observation, id: "overflow" }]),
    ]);
    await expect(fhir.searchObservations("synthetic-1", "x")).rejects.toThrow(
      "FHIR result limit exceeded",
    );
  });
  it("filters inactive medications even if upstream ignores the filter", async () => {
    const med = {
      resourceType: "MedicationRequest",
      id: "m-1",
      status: "active",
      intent: "order",
      subject: { reference: "Patient/synthetic-1" },
      medicationCodeableConcept: { coding: [{ code: "synthetic" }] },
      note: [{ text: "private-note" }],
    };
    const { fhir, requests } = client([
      bundle([med, { ...med, id: "m-2", status: "stopped" }]),
    ]);
    const result = await fhir.getMedicationRequests("synthetic-1");
    expect(result.map((item) => item.id)).toEqual(["m-1"]);
    expect(JSON.stringify(result)).not.toContain("private-note");
    expect(requests[0]).toContain("status=active");
  });
  it.each([
    { ...bundle([]), total: MAX_RESULTS + 1 },
    {
      ...bundle([]),
      link: [
        { relation: "next", url: "?page=2" },
        { relation: "next", url: "?page=3" },
      ],
    },
    bundle([observation, observation]),
  ])(
    "rejects oversized totals, ambiguous continuation and duplicate resources %#",
    async (response) => {
      const { fhir } = client([response]);
      await expect(
        fhir.searchObservations("synthetic-1", "x"),
      ).rejects.toBeInstanceOf(FhirError);
    },
  );
  it("accepts a same-base root continuation used by paging servers", async () => {
    const { fhir, requests } = client([
      bundle([], "https://example.org/fhir?_getpages=synthetic"),
      bundle([]),
    ]);
    expect(await fhir.searchObservations("synthetic-1", "x")).toEqual([]);
    expect(requests).toHaveLength(2);
  });
  it("discards upstream error text and response body", async () => {
    const error = new AxiosError("private-patient-error");
    error.response = {
      status: 403,
      statusText: "private",
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() },
      data: { diagnostics: "private-patient" },
    };
    const { fhir } = client([error]);
    await expect(fhir.getPatient("synthetic-1")).rejects.toMatchObject({
      message: "FHIR request failed",
      statusCode: 403,
    });
    expect(FhirError.prototype).not.toHaveProperty("outcome");
  });
});
