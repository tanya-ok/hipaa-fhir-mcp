import axios, { AxiosHeaders } from "axios";

axios.defaults.adapter = async (config) => {
  const url = new URL(config.url ?? "");
  if (url.pathname.endsWith("synthetic-error"))
    throw new Error("synthetic-private-error");
  const data = url.pathname.endsWith("synthetic-wrong")
    ? { resourceType: "Observation", id: "synthetic-wrong" }
    : {
        resourceType: "Patient",
        id: "synthetic-ok",
        text: { div: "synthetic-private-narrative" },
      };
  return {
    config,
    data,
    status: 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
  };
};
