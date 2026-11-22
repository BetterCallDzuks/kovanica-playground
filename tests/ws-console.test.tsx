import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  deriveWsUrl,
  WsSubscriptionConsole,
  type WebSocketLike,
} from "../src/components/WsSubscriptionConsole";

class MockWebSocket implements WebSocketLike {
  static instances: MockWebSocket[] = [];

  public readonly url: string;
  public readyState = 0; // CONNECTING
  public sentMessages: string[] = [];
  public closeCalls: Array<{ code?: number; reason?: string }> = [];

  public onopen: ((ev: unknown) => unknown) | null = null;
  public onmessage: ((ev: { data: unknown }) => unknown) | null = null;
  public onerror: ((ev: unknown) => unknown) | null = null;
  public onclose: ((ev: { code?: number; reason?: string }) => unknown) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = 1; // OPEN
    this.onopen?.({});
  }

  simulateMessage(payload: unknown): void {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.onmessage?.({ data });
  }

  simulateClose(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

describe("WsSubscriptionConsole", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("derives ws:// and wss:// endpoints from HTTP/HTTPS RPC URLs", () => {
    expect(deriveWsUrl("http://127.0.0.1:8545/rpc")).toBe("ws://127.0.0.1:8545/ws");
    expect(deriveWsUrl("https://rpc.kovanica.org/rpc")).toBe("wss://rpc.kovanica.org/ws");
    expect(deriveWsUrl("http://127.0.0.1:8545")).toBe("ws://127.0.0.1:8545/ws");
    expect(deriveWsUrl("https://node.kovanica.org:8545/v1/rpc")).toBe(
      "wss://node.kovanica.org:8545/v1/ws",
    );
  });

  it("connects, subscribes to newHeads & logs with filters, and receives notifications", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <WsSubscriptionConsole
        rpcUrl="http://127.0.0.1:8545/rpc"
        WebSocketImpl={MockWebSocket}
      />,
    );

    const urlInput = screen.getByLabelText("WebSocket Endpoint URL") as HTMLInputElement;
    expect(urlInput.value).toBe("ws://127.0.0.1:8545/ws");
    expect(screen.getByTestId("ws-connection-status").textContent).toBe("disconnected");

    // Connect
    fireEvent.click(screen.getByTestId("ws-connect-btn"));
    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe("ws://127.0.0.1:8545/ws");
    expect(screen.getByTestId("ws-connection-status").textContent).toBe("connecting");

    act(() => {
      ws.simulateOpen();
    });
    expect(screen.getByTestId("ws-connection-status").textContent).toBe("connected");

    // Subscribe to newHeads (default)
    fireEvent.click(screen.getByTestId("ws-subscribe-btn"));
    expect(ws.sentMessages).toHaveLength(1);
    const subReq1 = JSON.parse(ws.sentMessages[0]);
    expect(subReq1).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "kovanica_subscribe",
      params: ["newHeads"],
    });

    // Server acknowledges newHeads subscription
    act(() => {
      ws.simulateMessage({ jsonrpc: "2.0", id: 1, result: "0xsub-heads" });
    });
    expect(screen.getByTestId("ws-sub-0xsub-heads")).toBeDefined();

    // Switch channel to logs with address and topic filters
    fireEvent.change(screen.getByLabelText("Subscription Channel"), {
      target: { value: "logs" },
    });
    fireEvent.change(screen.getByLabelText(/Contract Address Filter/i), {
      target: { value: "0xabc123" },
    });
    fireEvent.change(screen.getByLabelText(/Topics Filter/i), {
      target: { value: "0xtopic0, 0xtopic1" },
    });
    fireEvent.click(screen.getByTestId("ws-subscribe-btn"));

    expect(ws.sentMessages).toHaveLength(2);
    const subReq2 = JSON.parse(ws.sentMessages[1]);
    expect(subReq2).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "kovanica_subscribe",
      params: [
        "logs",
        {
          address: "0xabc123",
          topics: ["0xtopic0", "0xtopic1"],
        },
      ],
    });

    act(() => {
      ws.simulateMessage({ jsonrpc: "2.0", id: 2, result: "0xsub-logs" });
    });
    expect(screen.getByTestId("ws-sub-0xsub-logs")).toBeDefined();

    // Receive notification for newHeads
    act(() => {
      ws.simulateMessage({
        jsonrpc: "2.0",
        method: "kovanica_subscription",
        params: {
          subscription: "0xsub-heads",
          result: { height: 42, hash: "0xdeadbeef" },
        },
      });
    });

    const items = screen.getAllByTestId("ws-event-item");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("newHeads");
    expect(items[0].textContent).toContain("0xdeadbeef");
    expect(items[0].textContent).toContain("42");

    // Copy JSON for the event
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('"hash": "0xdeadbeef"');
    expect(screen.getByRole("button", { name: "Copied!" })).toBeDefined();
  });

  it("buffers events while paused and flushes them on resume, honoring maxEvents cap", () => {
    render(
      <WsSubscriptionConsole
        rpcUrl="https://rpc.kovanica.org/rpc"
        WebSocketImpl={MockWebSocket}
        maxEvents={3}
      />,
    );

    fireEvent.click(screen.getByTestId("ws-connect-btn"));
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe("wss://rpc.kovanica.org/ws");

    act(() => {
      ws.simulateOpen();
    });

    // Subscribe to committedLeaders
    fireEvent.change(screen.getByLabelText("Subscription Channel"), {
      target: { value: "committedLeaders" },
    });
    fireEvent.click(screen.getByTestId("ws-subscribe-btn"));
    act(() => {
      ws.simulateMessage({ jsonrpc: "2.0", id: 1, result: "0xsub-leaders" });
    });

    // Push 1 event before pausing
    act(() => {
      ws.simulateMessage({
        jsonrpc: "2.0",
        method: "kovanica_subscription",
        params: { subscription: "0xsub-leaders", result: { round: 1 } },
      });
    });
    expect(screen.getAllByTestId("ws-event-item")).toHaveLength(1);

    // Pause stream
    fireEvent.click(screen.getByTestId("ws-pause-resume-btn"));
    expect(screen.getByTestId("ws-pause-resume-btn").textContent).toBe("Resume");
    expect(screen.getByTestId("ws-paused-badge").textContent).toBe("Paused (0 buffered)");

    // Push 3 more events while paused
    act(() => {
      ws.simulateMessage({
        jsonrpc: "2.0",
        method: "kovanica_subscription",
        params: { subscription: "0xsub-leaders", result: { round: 2 } },
      });
      ws.simulateMessage({
        jsonrpc: "2.0",
        method: "kovanica_subscription",
        params: { subscription: "0xsub-leaders", result: { round: 3 } },
      });
      ws.simulateMessage({
        jsonrpc: "2.0",
        method: "kovanica_subscription",
        params: { subscription: "0xsub-leaders", result: { round: 4 } },
      });
    });

    // Visible stream still shows only the 1 pre-pause event
    expect(screen.getAllByTestId("ws-event-item")).toHaveLength(1);
    expect(screen.getByTestId("ws-paused-badge").textContent).toBe("Paused (3 buffered)");

    // Resume stream: buffered events flush and cap at maxEvents=3 (rounds 4, 3, 2)
    fireEvent.click(screen.getByTestId("ws-pause-resume-btn"));
    expect(screen.queryByTestId("ws-paused-badge")).toBeNull();

    const items = screen.getAllByTestId("ws-event-item");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('"round": 4');
    expect(items[1].textContent).toContain('"round": 3');
    expect(items[2].textContent).toContain('"round": 2');

    // Clear Log empties the stream
    fireEvent.click(screen.getByTestId("ws-clear-log-btn"));
    expect(screen.queryAllByTestId("ws-event-item")).toHaveLength(0);
    expect(screen.getByTestId("ws-empty-stream")).toBeDefined();
  });

  it("sends kovanica_unsubscribe and removes subscription upon acknowledgement", () => {
    render(
      <WsSubscriptionConsole
        rpcUrl="http://127.0.0.1:8545/rpc"
        WebSocketImpl={MockWebSocket}
      />,
    );

    fireEvent.click(screen.getByTestId("ws-connect-btn"));
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.simulateOpen();
    });

    fireEvent.click(screen.getByTestId("ws-subscribe-btn"));
    act(() => {
      ws.simulateMessage({ jsonrpc: "2.0", id: 1, result: "0xsub-99" });
    });
    expect(screen.getByTestId("ws-sub-0xsub-99")).toBeDefined();

    // Click Unsubscribe
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(ws.sentMessages).toHaveLength(2);
    const unsubReq = JSON.parse(ws.sentMessages[1]);
    expect(unsubReq).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "kovanica_unsubscribe",
      params: ["0xsub-99"],
    });

    // Server confirms unsubscribe
    act(() => {
      ws.simulateMessage({ jsonrpc: "2.0", id: 2, result: true });
    });
    expect(screen.queryByTestId("ws-sub-0xsub-99")).toBeNull();
  });

  it("cleans up WebSocket connection on Disconnect and on component unmount", () => {
    const { unmount } = render(
      <WsSubscriptionConsole
        rpcUrl="http://127.0.0.1:8545/rpc"
        WebSocketImpl={MockWebSocket}
      />,
    );

    // Connect and subscribe
    fireEvent.click(screen.getByTestId("ws-connect-btn"));
    const ws1 = MockWebSocket.instances[0];
    act(() => {
      ws1.simulateOpen();
    });
    fireEvent.click(screen.getByTestId("ws-subscribe-btn"));
    act(() => {
      ws1.simulateMessage({ jsonrpc: "2.0", id: 1, result: "0xsub-1" });
    });
    expect(screen.getByTestId("ws-sub-0xsub-1")).toBeDefined();

    // Disconnect
    fireEvent.click(screen.getByTestId("ws-disconnect-btn"));
    expect(ws1.closeCalls).toHaveLength(1);
    expect(screen.getByTestId("ws-connection-status").textContent).toBe("disconnected");
    expect(screen.queryByTestId("ws-sub-0xsub-1")).toBeNull();

    // Reconnect and then unmount to verify unmount cleanup closes the socket
    fireEvent.click(screen.getByTestId("ws-connect-btn"));
    const ws2 = MockWebSocket.instances[1];
    act(() => {
      ws2.simulateOpen();
    });
    expect(ws2.closeCalls).toHaveLength(0);

    unmount();
    expect(ws2.closeCalls).toHaveLength(1);
  });
});
