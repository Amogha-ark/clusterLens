// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Resource, Snapshot } from "./types";
import { App } from "./main";
import { readInvestigation } from "./investigation";
function resource(p: Partial<Resource>): Resource {
  return {
    uid: "w",
    kind: "Deployment",
    name: "api",
    namespace: "lab",
    created: new Date().toISOString(),
    labels: {},
    ownerUid: "",
    workloadUid: "",
    status: "Healthy",
    ready: 1,
    desired: 1,
    restarts: 0,
    node: "",
    containers: [],
    related: [],
    usage: { cpu: 0.1, memory: 1048576, timestamp: new Date().toISOString() },
    cpuCapacity: 0,
    memoryCapacity: 0,
    cpuAllocatable: 0,
    memoryAllocatable: 0,
    capacity: 0,
    storageClass: "",
    volume: "",
    accessModes: [],
    conditions: [],
    ...p,
  };
}
const web = {
  name: "web",
  image: "app:v1",
  id: "runtime://one",
  ready: true,
  restarts: 0,
  state: "Running",
  cpuRequest: 0.1,
  cpuLimit: 1,
  memoryRequest: 1048576,
  memoryLimit: 2097152,
  usage: null,
};
const w = resource({ related: ["p", "n", "c"] }),
  p = resource({
    uid: "p",
    name: "api-pod",
    kind: "Pod",
    ownerUid: "rs",
    workloadUid: "w",
    node: "worker",
    containers: [web],
    status: "Running",
    related: ["w", "n", "c"],
  }),
  n = resource({
    uid: "n",
    name: "worker",
    kind: "Node",
    namespace: "",
    status: "Ready",
    related: ["w", "p", "c"],
  }),
  c = resource({
    uid: "c",
    name: "data",
    kind: "PersistentVolumeClaim",
    status: "Bound",
    related: ["w", "p", "n"],
  });
const snap: Snapshot = {
  cluster: "test",
  timestamp: new Date().toISOString(),
  connected: true,
  connectionError: "",
  sources: ["Node", "Pod", "PersistentVolumeClaim"].map((kind) => ({
    kind,
    synced: true,
    error: "",
  })),
  metrics: {
    available: true,
    error: "",
    lastSuccess: new Date().toISOString(),
  },
  resources: [w, p, n, c],
  deletedResources: [],
  events: [],
  truncated: false,
  historyDropped: 0,
};
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.history.replaceState(null, "", "#view=Overview&namespace=all");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} },
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: () => {},
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(String(input), "http://localhost");
    let data: unknown = snap;
    if (url.pathname.endsWith("history")) {
      const uid = url.searchParams.get("uid") || "cluster";
      data = {
        points: [
          {
            uid,
            cpu: 0.1,
            memory: 1000,
            timestamp: new Date(Date.now() - 15000).toISOString(),
          },
          { uid, cpu: 0.2, memory: 2000, timestamp: new Date().toISOString() },
        ],
      };
    } else if (url.pathname.endsWith("logs"))
      data = {
        text: "2026-10-31T10:00:00Z real-format test fixture",
        timestamp: new Date().toISOString(),
        source: "kubernetes-pod-log-api",
        persisted: false,
        truncated: false,
        maxLines: 500,
        maxBytes: 262144,
      };
    return { ok: true, json: async () => data };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function start() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /api.*cores/ }));
  return screen.findByRole("dialog", { name: "Deployment api details" });
}
describe("connected investigation journeys", () => {
  it("does not carry an old resource history error into the next resource", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: string) => {
      const url = new URL(String(input), "http://localhost");
      if (
        url.pathname.endsWith("history") &&
        url.searchParams.get("uid") === "w"
      )
        throw new Error("old-workload-denied");
      if (
        url.pathname.endsWith("history") &&
        url.searchParams.get("uid") === "p"
      )
        return new Promise(() => {});
      return original(input);
    });
    let drawer = await start();
    fireEvent.click(within(drawer).getByRole("tab", { name: "Metrics" }));
    await screen.findByText(/old-workload-denied/);
    fireEvent.change(
      within(drawer).getByLabelText("Follow a related resource"),
      { target: { value: "p" } },
    );
    drawer = await screen.findByRole("dialog", { name: "Pod api-pod details" });
    expect(within(drawer).queryByText(/old-workload-denied/)).toBeNull();
  });
  it("preserves metric tab/window through workload → pod → node → workload", async () => {
    let drawer = await start();
    fireEvent.click(within(drawer).getByRole("tab", { name: "Metrics" }));
    fireEvent.change(
      within(drawer).getByLabelText("Investigation time window"),
      { target: { value: "3600" } },
    );
    await waitFor(() =>
      expect(readInvestigation(window.location.hash).range).toBe(3600),
    );
    fireEvent.change(
      within(drawer).getByLabelText("Follow a related resource"),
      { target: { value: "p" } },
    );
    drawer = await screen.findByRole("dialog", { name: "Pod api-pod details" });
    expect(
      within(drawer)
        .getByRole("tab", { name: "Metrics" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.change(
      within(drawer).getByLabelText("Follow a related resource"),
      { target: { value: "n" } },
    );
    drawer = await screen.findByRole("dialog", { name: "Node worker details" });
    expect(readInvestigation(window.location.hash).trail).toEqual([
      "w",
      "p",
      "n",
    ]);
    expect(
      within(drawer)
        .getByLabelText("Investigation time window")
        .getAttribute("aria-label"),
    ).toBeTruthy();
    const trail = within(drawer).getByRole("navigation", {
      name: "Investigation trail",
    });
    fireEvent.click(within(trail).getByRole("button", { name: "api" }));
    drawer = await screen.findByRole("dialog", {
      name: "Deployment api details",
    });
    expect(readInvestigation(window.location.hash).trail).toEqual(["w"]);
    expect(readInvestigation(window.location.hash).range).toBe(3600);
    expect(
      within(drawer)
        .getByRole("tab", { name: "Metrics" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
  it("preserves selected pod/container when switching evidence and following its PVC", async () => {
    let drawer = await start();
    fireEvent.click(within(drawer).getByRole("tab", { name: "Logs" }));
    await waitFor(() =>
      expect(readInvestigation(window.location.hash).pod).toBe("p"),
    );
    expect(readInvestigation(window.location.hash).container).toBe("web");
    fireEvent.click(within(drawer).getByRole("tab", { name: "Metrics" }));
    await waitFor(() =>
      expect(readInvestigation(window.location.hash).tab).toBe("Metrics"),
    );
    fireEvent.click(within(drawer).getByRole("tab", { name: "Logs" }));
    await waitFor(() =>
      expect(readInvestigation(window.location.hash).tab).toBe("Logs"),
    );
    fireEvent.change(
      within(drawer).getByLabelText("Follow a related resource"),
      { target: { value: "c" } },
    );
    drawer = await screen.findByRole("dialog", {
      name: "PersistentVolumeClaim data details",
    });
    expect(
      within(drawer)
        .getByRole("tab", { name: "Logs" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(readInvestigation(window.location.hash).pod).toBe("p");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            String(url).includes("logs?") &&
            String(url).includes("uid=p") &&
            String(url).includes("container=web"),
        ),
      ).toBe(true),
    );
  });
  it("does not silently use a different window for logs", async () => {
    const drawer = await start();
    fireEvent.change(
      within(drawer).getByLabelText("Investigation time window"),
      { target: { value: "86400" } },
    );
    await waitFor(() =>
      expect(readInvestigation(window.location.hash).range).toBe(86400),
    );
    fireEvent.click(within(drawer).getByRole("tab", { name: "Logs" }));
    await screen.findByText("Logs support up to six hours");
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Use last 6 hours" }),
    );
    await waitFor(() =>
      expect(readInvestigation(window.location.hash).range).toBe(21600),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("sinceSeconds=21600"),
        ),
      ).toBe(true),
    );
  });
});

it("opens the same investigation in a new tab with scope and selections intact", async () => {
  const drawer = await start();
  fireEvent.change(within(drawer).getByLabelText("Investigation time window"), {target:{value:"3600"}});
  fireEvent.click(within(drawer).getByRole("tab",{name:"Logs"}));
  await waitFor(()=>expect(readInvestigation(window.location.hash).container).toBe("web"));
  const link=within(drawer).getByRole("link",{name:"Open resource in new tab"}) as HTMLAnchorElement;
  expect(link.target).toBe("_blank");expect(link.rel).toContain("noopener");
  expect(readInvestigation(new URL(link.href).hash)).toEqual(readInvestigation(window.location.hash));
});
