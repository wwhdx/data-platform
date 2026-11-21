import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Body = { title: string };
type Listener = (event: Record<string, unknown>) => void;
interface NodeStub {
  innerHTML: string; scrollTop: number; hidden: boolean; tabIndex: number;
  dataset: Record<string, string>; attributes: Map<string, string>; listeners: Map<string, Listener>;
  addEventListener(type: string, listener: Listener): void;
  setAttribute(key: string, value: string): void;
  removeAttribute(key: string): void;
  querySelector(): null;
}
const mocks = vi.hoisted(() => ({
  nodes: new Map<string, NodeStub>(), params: new URLSearchParams(), api: vi.fn(),
  renderDocument: vi.fn(), bodyError: vi.fn(),
  state: {
    dataset: { id: "snapshot", label: "Snapshot", documents: "1" }, sources: [],
    page: null as { rows: { key: string }[] } | null, selected: null as string | null,
    document: null as Body | null, tab: "body", versions: null, series: null, pageStack: [],
    request: null as AbortController | null, bodyRequest: null as AbortController | null,
  },
}));
vi.mock("../../../library-ui/assets/state.js", () => ({
  $: (id: string) => {
    if (!mocks.nodes.has(id)) {
      const attributes = new Map<string, string>(), listeners = new Map<string, Listener>();
      mocks.nodes.set(id, { innerHTML: "", scrollTop: 0, hidden: false, tabIndex: 0, dataset: {}, attributes, listeners,
        addEventListener: (type, listener) => { listeners.set(type, listener); },
        setAttribute: (key, value) => { attributes.set(key, value); },
        removeAttribute: key => { attributes.delete(key); }, querySelector: () => null });
    }
    return mocks.nodes.get(id)!;
  },
  state: mocks.state, api: mocks.api, queryParams: () => mocks.params,
  urlParams: () => new URLSearchParams(), count: String, time: String,
  announce: vi.fn(), formFromUrl: vi.fn(), updateUrl: vi.fn(),
}));
vi.mock("../../../library-ui/assets/list.js", () => ({
  renderSources: vi.fn(), renderPage: vi.fn(), markSelected: vi.fn(), renderOverview: vi.fn(),
}));
vi.mock("../../../library-ui/assets/reader.js", () => ({
  renderDocument: (body: Body) => {
    mocks.renderDocument(body); mocks.state.document = body; mocks.nodes.get("reader")!.innerHTML = body.title;
  },
  renderTab: vi.fn(), bodyError: mocks.bodyError,
}));
vi.mock("../../../library-ui/assets/versions.js", () => ({ renderVersions: vi.fn(), renderSeries: vi.fn() }));

beforeEach(async () => {
  vi.resetModules(); mocks.nodes.clear(); mocks.params = new URLSearchParams();
  Object.assign(mocks.state, { dataset: { id: "snapshot", label: "Snapshot", documents: "1" },
    sources: [], page: null, selected: null, document: null, tab: "body", versions: null, series: null,
    pageStack: [], request: null, bodyRequest: null });
  mocks.renderDocument.mockClear(); mocks.bodyError.mockClear();
  mocks.api.mockReset().mockImplementation(async (kind: string) => kind === "bootstrap"
    ? { dataset: mocks.state.dataset, rows: [] } : kind === "documents"
      ? { dataset: mocks.state.dataset, rows: [{ key: "initial" }], hasMore: false } : { title: "Initial record" });
  vi.stubGlobal("document", { addEventListener: vi.fn(),
    body: { classList: { add: vi.fn(), remove: vi.fn(), contains: () => false } },
    documentElement: { style: { setProperty: vi.fn() } } });
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  vi.stubGlobal("history", { state: {} });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
  vi.stubGlobal("FormData", class { *[Symbol.iterator]() { yield ["q", "no-match"]; } });
  // @ts-expect-error Browser assets are native JavaScript modules.
  await import("../../../library-ui/assets/app.js");
  await vi.waitFor(() => expect(mocks.renderDocument).toHaveBeenCalledOnce());
  mocks.renderDocument.mockClear();
});
afterEach(() => { mocks.state.request?.abort(); mocks.state.bodyRequest?.abort(); vi.unstubAllGlobals(); });

function clickRecord(key: string): void {
  mocks.nodes.get("records")!.listeners.get("click")!({ preventDefault() {}, target: {
    closest: (selector: string) => selector === "[data-key]" ? { dataset: { key } } : null,
  } });
}
function filterRecords(): void {
  mocks.params = new URLSearchParams("q=no-match");
  mocks.nodes.get("filters")!.listeners.get("submit")!({ preventDefault() {} });
}

describe("library list and detail request ordering", () => {
  it.each(["success", "error"])("keeps empty results when an older detail returns %s", async outcome => {
    let finish!: (body: Body) => void, fail!: (error: Error) => void;
    const detail = new Promise<Body>((resolve, reject) => { finish = resolve; fail = reject; });
    mocks.api.mockImplementation((kind: string) => kind === "document" ? detail
      : Promise.resolve({ dataset: mocks.state.dataset, rows: [], hasMore: false }));
    clickRecord("old-record");
    const oldRequest = mocks.state.bodyRequest!;
    filterRecords();
    await vi.waitFor(() => expect(mocks.state.selected).toBeNull());
    if (outcome === "success") finish({ title: "Late old record" }); else fail(new Error("Late old error"));
    await detail.catch(() => {});
    expect(oldRequest.signal.aborted).toBe(true);
    expect(mocks.nodes.get("reader")!.innerHTML).toContain("当前筛选下没有记录");
    expect(mocks.nodes.get("reader")!.attributes.has("aria-busy")).toBe(false);
    expect(mocks.state.document).toBeNull();
    expect(mocks.renderDocument).not.toHaveBeenCalled();
    expect(mocks.bodyError).not.toHaveBeenCalled();
  });

  it("cancels a detail opened from the retained old list while the new list is loading", async () => {
    let finishList!: (page: unknown) => void, finishDetail!: (body: Body) => void;
    const listing = new Promise(resolve => { finishList = resolve; });
    const detail = new Promise<Body>(resolve => { finishDetail = resolve; });
    mocks.api.mockImplementation((kind: string) => kind === "document" ? detail : listing);
    filterRecords();
    clickRecord("old-record");
    const oldRequest = mocks.state.bodyRequest!;
    finishList({ dataset: mocks.state.dataset, rows: [], hasMore: false });
    await vi.waitFor(() => expect(mocks.state.selected).toBeNull());
    finishDetail({ title: "Late old record" }); await detail;
    expect(oldRequest.signal.aborted).toBe(true);
    expect(mocks.nodes.get("reader")!.attributes.has("aria-busy")).toBe(false);
    expect(mocks.nodes.get("reader")!.innerHTML).toContain("当前筛选下没有记录");
    expect(mocks.renderDocument).not.toHaveBeenCalled();
  });

  it.each(["success", "error"])("preserves the new selected record after an old detail returns %s", async outcome => {
    let finish!: (body: Body) => void, fail!: (error: Error) => void;
    const oldDetail = new Promise<Body>((resolve, reject) => { finish = resolve; fail = reject; });
    mocks.api.mockImplementation((kind: string, params: { key?: string }) => kind === "documents"
      ? Promise.resolve({ dataset: mocks.state.dataset, rows: [{ key: "new-record" }], hasMore: false })
      : params.key === "old-record" ? oldDetail : Promise.resolve({ title: "New record" }));
    clickRecord("old-record"); filterRecords();
    await vi.waitFor(() => expect(mocks.state.document?.title).toBe("New record"));
    if (outcome === "success") finish({ title: "Late old record" }); else fail(new Error("Late old error"));
    await oldDetail.catch(() => {});
    expect(mocks.state.selected).toBe("new-record");
    expect(mocks.nodes.get("reader")!.innerHTML).toBe("New record");
    expect(mocks.renderDocument).toHaveBeenCalledOnce();
    expect(mocks.bodyError).not.toHaveBeenCalled();
  });

  it("retains the last successful list and document when the new list fails", async () => {
    mocks.api.mockRejectedValue(new Error("List unavailable"));
    filterRecords();
    await vi.waitFor(() => expect(mocks.nodes.get("error")!.hidden).toBe(false));
    expect(mocks.state.page?.rows).toEqual([{ key: "initial" }]);
    expect(mocks.state.document?.title).toBe("Initial record");
    expect(mocks.nodes.get("reader")!.innerHTML).toBe("Initial record");
    expect(mocks.nodes.get("reader")!.attributes.has("aria-busy")).toBe(false);
  });
});
