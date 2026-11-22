import { useCallback, useEffect, useRef, useState } from "react";

export type SubscriptionChannel = "newHeads" | "committedLeaders" | "logs";

export type WsConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface LogsFilter {
  address?: string | string[];
  topics?: string[];
}

export interface ActiveSubscription {
  id: string;
  channel: SubscriptionChannel;
  filter?: LogsFilter;
  subscribedAt: string;
}

export interface WsEventEntry {
  uid: string;
  receivedAt: string;
  subscriptionId: string;
  channel: SubscriptionChannel | "unknown";
  payload: unknown;
  rawJson: string;
}

export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => unknown) | null;
  onmessage: ((ev: { data: unknown }) => unknown) | null;
  onerror: ((ev: unknown) => unknown) | null;
  onclose: ((ev: { code?: number; reason?: string }) => unknown) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface WsSubscriptionConsoleProps {
  rpcUrl: string;
  WebSocketImpl?: WebSocketConstructor;
  maxEvents?: number;
}

export const DEFAULT_MAX_EVENTS = 200;

const WS_OPEN_STATE = 1;

interface PendingRpcRequest {
  method: "kovanica_subscribe" | "kovanica_unsubscribe";
  channel?: SubscriptionChannel;
  filter?: LogsFilter;
  subscriptionId?: string;
}

export function deriveWsUrl(rpcUrl: string): string {
  const trimmed = rpcUrl.trim();
  if (!trimmed) return "ws://127.0.0.1:8545/ws";

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:") {
      parsed.protocol = "ws:";
    } else if (parsed.protocol === "https:") {
      parsed.protocol = "wss:";
    }

    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    if (cleanPath === "" || cleanPath === "/rpc") {
      parsed.pathname = "/ws";
    } else if (cleanPath.endsWith("/rpc")) {
      parsed.pathname = `${cleanPath.slice(0, -4)}/ws`;
    } else if (!cleanPath.endsWith("/ws")) {
      parsed.pathname = `${cleanPath}/ws`;
    }

    return parsed.toString();
  } catch {
    const swapped = trimmed
      .replace(/^https:\/\//i, "wss://")
      .replace(/^http:\/\//i, "ws://");
    if (/\/rpc\/?$/i.test(swapped)) {
      return swapped.replace(/\/rpc\/?$/i, "/ws");
    }
    if (/\/ws\/?$/i.test(swapped)) {
      return swapped;
    }
    return `${swapped.replace(/\/+$/, "")}/ws`;
  }
}

function safeFormatJson(data: unknown): string {
  if (data === undefined) return "undefined";
  try {
    return JSON.stringify(
      data,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    );
  } catch {
    return String(data);
  }
}

export function WsSubscriptionConsole({
  rpcUrl,
  WebSocketImpl,
  maxEvents = DEFAULT_MAX_EVENTS,
}: WsSubscriptionConsoleProps) {
  const [wsUrl, setWsUrl] = useState<string>(() => deriveWsUrl(rpcUrl));
  const [isUrlEdited, setIsUrlEdited] = useState<boolean>(false);
  const [connectionState, setConnectionState] = useState<WsConnectionState>("disconnected");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Subscription builder state
  const [channel, setChannel] = useState<SubscriptionChannel>("newHeads");
  const [logAddressInput, setLogAddressInput] = useState<string>("");
  const [logTopicsInput, setLogTopicsInput] = useState<string>("");
  const [activeSubscriptions, setActiveSubscriptions] = useState<ActiveSubscription[]>([]);

  // Event stream state
  const [events, setEvents] = useState<WsEventEntry[]>([]);
  const [bufferedEvents, setBufferedEvents] = useState<WsEventEntry[]>([]);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [totalReceived, setTotalReceived] = useState<number>(0);
  const [copiedUid, setCopiedUid] = useState<string | null>(null);

  // Mutable refs for socket callbacks
  const wsRef = useRef<WebSocketLike | null>(null);
  const rpcIdRef = useRef<number>(1);
  const eventSeqRef = useRef<number>(1);
  const pendingRequestsRef = useRef<Map<number, PendingRpcRequest>>(new Map());
  const subscriptionsRef = useRef<Map<string, ActiveSubscription>>(new Map());
  const isPausedRef = useRef<boolean>(false);
  const maxEventsRef = useRef<number>(maxEvents);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    maxEventsRef.current = maxEvents;
  }, [maxEvents]);

  // Keep WS URL synced with active RPC URL unless the user manually edited it
  useEffect(() => {
    if (!isUrlEdited) {
      setWsUrl(deriveWsUrl(rpcUrl));
    }
  }, [rpcUrl, isUrlEdited]);

  const cleanupSocket = useCallback((closeSocket: boolean) => {
    const current = wsRef.current;
    wsRef.current = null;
    pendingRequestsRef.current.clear();
    subscriptionsRef.current.clear();
    setActiveSubscriptions([]);

    if (current) {
      current.onopen = null;
      current.onmessage = null;
      current.onerror = null;
      current.onclose = null;
      if (closeSocket) {
        try {
          current.close(1000, "Client disconnected");
        } catch {
          // Ignore close errors on already-closing sockets
        }
      }
    }
  }, []);

  // Ensure clean disconnect on unmount
  useEffect(() => {
    return () => {
      cleanupSocket(true);
    };
  }, [cleanupSocket]);

  const handleDisconnect = useCallback(() => {
    cleanupSocket(true);
    setConnectionState("disconnected");
    setStatusMessage("Disconnected");
    setErrorMsg(null);
  }, [cleanupSocket]);

  const handleConnect = useCallback(() => {
    const targetUrl = wsUrl.trim();
    if (!targetUrl) {
      setErrorMsg("WebSocket endpoint URL cannot be empty.");
      return;
    }

    const SocketCtor: WebSocketConstructor | undefined =
      WebSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketConstructor | undefined);

    if (!SocketCtor) {
      setConnectionState("error");
      setErrorMsg("WebSocket API is not available in this environment.");
      return;
    }

    // Close any prior socket before opening a new one
    cleanupSocket(true);
    setErrorMsg(null);
    setStatusMessage(`Connecting to ${targetUrl}...`);
    setConnectionState("connecting");

    let socket: WebSocketLike;
    try {
      socket = new SocketCtor(targetUrl);
    } catch (err: unknown) {
      setConnectionState("error");
      setStatusMessage(null);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return;
    }

    wsRef.current = socket;

    socket.onopen = () => {
      if (wsRef.current !== socket) return;
      setConnectionState("connected");
      setStatusMessage(`Connected to ${targetUrl}`);
      setErrorMsg(null);
    };

    socket.onmessage = (event: { data: unknown }) => {
      if (wsRef.current !== socket) return;

      const rawText = typeof event.data === "string" ? event.data : String(event.data ?? "");
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        setErrorMsg(`Received malformed JSON frame: ${rawText.slice(0, 120)}`);
        return;
      }

      // 1. Handle JSON-RPC response to kovanica_subscribe / kovanica_unsubscribe
      if (typeof parsed.id === "number" && pendingRequestsRef.current.has(parsed.id)) {
        const pending = pendingRequestsRef.current.get(parsed.id)!;
        pendingRequestsRef.current.delete(parsed.id);

        if (parsed.error && typeof parsed.error === "object") {
          const rpcErr = parsed.error as { code?: number; message?: string };
          setErrorMsg(
            `${pending.method} failed (${rpcErr.code ?? "RPC"}): ${rpcErr.message ?? "Unknown error"}`,
          );
          return;
        }

        if (pending.method === "kovanica_subscribe") {
          const subId = typeof parsed.result === "string" ? parsed.result : String(parsed.result ?? "");
          if (!subId) {
            setErrorMsg("kovanica_subscribe returned an empty subscription ID.");
            return;
          }
          const sub: ActiveSubscription = {
            id: subId,
            channel: pending.channel ?? "newHeads",
            filter: pending.filter,
            subscribedAt: new Date().toISOString(),
          };
          subscriptionsRef.current.set(subId, sub);
          setActiveSubscriptions(Array.from(subscriptionsRef.current.values()));
          setStatusMessage(`Subscribed to ${sub.channel} (${subId})`);
          setErrorMsg(null);
          return;
        }

        if (pending.method === "kovanica_unsubscribe" && pending.subscriptionId) {
          subscriptionsRef.current.delete(pending.subscriptionId);
          setActiveSubscriptions(Array.from(subscriptionsRef.current.values()));
          setStatusMessage(`Unsubscribed ${pending.subscriptionId}`);
          setErrorMsg(null);
          return;
        }
      }

      // 2. Handle JSON-RPC subscription notification
      if (
        typeof parsed.method === "string" &&
        (parsed.method === "kovanica_subscription" || parsed.method.endsWith("_subscription")) &&
        parsed.params &&
        typeof parsed.params === "object"
      ) {
        const params = parsed.params as { subscription?: unknown; result?: unknown };
        const subId = typeof params.subscription === "string" ? params.subscription : String(params.subscription ?? "unknown");
        const matchedSub = subscriptionsRef.current.get(subId);
        const entry: WsEventEntry = {
          uid: `evt-${eventSeqRef.current++}`,
          receivedAt: new Date().toISOString(),
          subscriptionId: subId,
          channel: matchedSub?.channel ?? "unknown",
          payload: params.result,
          rawJson: safeFormatJson(params.result),
        };

        setTotalReceived((prev) => prev + 1);
        const cap = Math.max(1, maxEventsRef.current);

        if (isPausedRef.current) {
          setBufferedEvents((prev) => [entry, ...prev].slice(0, cap));
        } else {
          setEvents((prev) => [entry, ...prev].slice(0, cap));
        }
      }
    };

    socket.onerror = () => {
      if (wsRef.current !== socket) return;
      setConnectionState("error");
      setErrorMsg(`WebSocket transport error on ${targetUrl}`);
    };

    socket.onclose = (ev: { code?: number; reason?: string }) => {
      if (wsRef.current !== socket) return;
      wsRef.current = null;
      pendingRequestsRef.current.clear();
      subscriptionsRef.current.clear();
      setActiveSubscriptions([]);
      setConnectionState("disconnected");
      const detail = ev?.reason ? ` (${ev.reason})` : ev?.code ? ` (code ${ev.code})` : "";
      setStatusMessage(`Connection closed${detail}`);
    };
  }, [wsUrl, WebSocketImpl, cleanupSocket]);

  const handleSubscribe = useCallback(() => {
    const socket = wsRef.current;
    if (!socket || connectionState !== "connected" || socket.readyState !== WS_OPEN_STATE) {
      setErrorMsg("Connect to a WebSocket endpoint before subscribing.");
      return;
    }

    const params: unknown[] = [channel];
    let filter: LogsFilter | undefined;

    if (channel === "logs") {
      const addresses = logAddressInput
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const topics = logTopicsInput
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const logFilter: LogsFilter = {};
      if (addresses.length === 1) {
        logFilter.address = addresses[0];
      } else if (addresses.length > 1) {
        logFilter.address = addresses;
      }
      if (topics.length > 0) {
        logFilter.topics = topics;
      }

      if (logFilter.address !== undefined || logFilter.topics !== undefined) {
        filter = logFilter;
        params.push(logFilter);
      }
    }

    const id = rpcIdRef.current++;
    pendingRequestsRef.current.set(id, {
      method: "kovanica_subscribe",
      channel,
      filter,
    });

    try {
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "kovanica_subscribe",
          params,
        }),
      );
      setErrorMsg(null);
      setStatusMessage(`Subscribing to ${channel}...`);
    } catch (err: unknown) {
      pendingRequestsRef.current.delete(id);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [channel, connectionState, logAddressInput, logTopicsInput]);

  const handleUnsubscribe = useCallback(
    (subscriptionId: string) => {
      const socket = wsRef.current;
      if (!socket || connectionState !== "connected" || socket.readyState !== WS_OPEN_STATE) {
        setErrorMsg("WebSocket is not connected.");
        return;
      }

      const id = rpcIdRef.current++;
      pendingRequestsRef.current.set(id, {
        method: "kovanica_unsubscribe",
        subscriptionId,
      });

      try {
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "kovanica_unsubscribe",
            params: [subscriptionId],
          }),
        );
        setErrorMsg(null);
        setStatusMessage(`Unsubscribing ${subscriptionId}...`);
      } catch (err: unknown) {
        pendingRequestsRef.current.delete(id);
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [connectionState],
  );

  const handleTogglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;
      isPausedRef.current = next;
      if (!next) {
        // Resume: flush buffered events into visible stream (newest first, capped)
        setBufferedEvents((pending) => {
          if (pending.length > 0) {
            const cap = Math.max(1, maxEventsRef.current);
            setEvents((current) => [...pending, ...current].slice(0, cap));
          }
          return [];
        });
      }
      return next;
    });
  }, []);

  const handleClearLog = useCallback(() => {
    setEvents([]);
    setBufferedEvents([]);
    setTotalReceived(0);
  }, []);

  const handleCopyEvent = useCallback((entry: WsEventEntry) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(entry.rawJson);
    }
    setCopiedUid(entry.uid);
    setTimeout(() => {
      setCopiedUid((current) => (current === entry.uid ? null : current));
    }, 2000);
  }, []);

  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";

  return (
    <div className="flex flex-col gap-6" data-testid="ws-subscription-console">
      {/* Connection & Subscription Controls Card */}
      <div className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-fg">
              WebSocket Event Stream Console
            </h2>
            <p className="text-xs text-muted">
              Live JSON-RPC 2.0 subscriptions via <code className="font-mono text-fg">kovanica_subscribe</code> &amp;{" "}
              <code className="font-mono text-fg">kovanica_unsubscribe</code>
            </p>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-2 border border-border text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected
                  ? "bg-emerald-400"
                  : isConnecting
                  ? "bg-amber-400 animate-pulse"
                  : connectionState === "error"
                  ? "bg-red-400"
                  : "bg-muted"
              }`}
            />
            <span className="text-muted">WS Status:</span>
            <span data-testid="ws-connection-status" className="font-medium text-fg capitalize">
              {connectionState}
            </span>
          </div>
        </div>

        {/* Endpoint & Connect/Disconnect Row */}
        <div className="flex flex-col md:flex-row items-stretch md:items-end gap-3">
          <div className="flex-1">
            <label htmlFor="ws-endpoint-input" className="block text-xs font-medium text-muted mb-1">
              WebSocket Endpoint URL
            </label>
            <div className="flex gap-2">
              <input
                id="ws-endpoint-input"
                type="text"
                value={wsUrl}
                onChange={(e) => {
                  setWsUrl(e.target.value);
                  setIsUrlEdited(true);
                }}
                disabled={isConnected || isConnecting}
                placeholder="ws://127.0.0.1:8545/ws"
                className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm font-mono text-fg focus:outline-none focus:border-gold disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => {
                  setIsUrlEdited(false);
                  setWsUrl(deriveWsUrl(rpcUrl));
                }}
                disabled={isConnected || isConnecting}
                className="px-3 py-2 text-xs bg-surface-2 hover:bg-border rounded-lg border border-border text-muted hover:text-fg whitespace-nowrap transition-colors disabled:opacity-50"
              >
                Sync from RPC
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected && !isConnecting ? (
              <button
                type="button"
                data-testid="ws-connect-btn"
                onClick={handleConnect}
                className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg font-semibold rounded-lg text-xs transition-colors whitespace-nowrap"
              >
                Connect
              </button>
            ) : (
              <button
                type="button"
                data-testid="ws-disconnect-btn"
                onClick={handleDisconnect}
                className="px-4 py-2 bg-red-950/60 hover:bg-red-900/70 text-red-200 border border-red-700/60 font-semibold rounded-lg text-xs transition-colors whitespace-nowrap"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>

        {/* Status & Error Banners */}
        {errorMsg && (
          <div
            data-testid="ws-error-banner"
            className="bg-red-950/40 border border-red-700/50 rounded-lg p-3 text-xs font-mono text-red-200"
          >
            {errorMsg}
          </div>
        )}
        {statusMessage && !errorMsg && (
          <div
            data-testid="ws-status-message"
            className="text-xs text-muted font-mono bg-surface-2/60 border border-border/60 rounded-lg px-3 py-2"
          >
            {statusMessage}
          </div>
        )}

        {/* Subscription Builder */}
        <div className="bg-surface-2/60 p-4 rounded-lg border border-border/80 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
            <div className="w-full sm:w-64">
              <label htmlFor="ws-channel-select" className="block text-xs font-medium text-muted mb-1">
                Subscription Channel
              </label>
              <select
                id="ws-channel-select"
                aria-label="Subscription Channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value as SubscriptionChannel)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              >
                <option value="newHeads">newHeads — New DAG block headers</option>
                <option value="committedLeaders">committedLeaders — Committed consensus leaders</option>
                <option value="logs">logs — Contract &amp; execution event logs</option>
              </select>
            </div>

            <button
              type="button"
              data-testid="ws-subscribe-btn"
              onClick={handleSubscribe}
              disabled={!isConnected}
              className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg font-semibold rounded-lg text-xs transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              Subscribe
            </button>
          </div>

          {channel === "logs" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border/60">
              <div>
                <label htmlFor="ws-log-address-input" className="block text-xs font-medium text-muted mb-1">
                  Contract Address Filter (optional, comma-separated)
                </label>
                <input
                  id="ws-log-address-input"
                  type="text"
                  value={logAddressInput}
                  onChange={(e) => setLogAddressInput(e.target.value)}
                  placeholder="0x... or kvnc..."
                  className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-fg focus:outline-none focus:border-gold"
                />
              </div>
              <div>
                <label htmlFor="ws-log-topics-input" className="block text-xs font-medium text-muted mb-1">
                  Topics Filter (optional, comma-separated)
                </label>
                <input
                  id="ws-log-topics-input"
                  type="text"
                  value={logTopicsInput}
                  onChange={(e) => setLogTopicsInput(e.target.value)}
                  placeholder="0xtopic0, 0xtopic1"
                  className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-fg focus:outline-none focus:border-gold"
                />
              </div>
            </div>
          )}
        </div>

        {/* Active Subscriptions List */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
              Active Subscriptions ({activeSubscriptions.length})
            </h3>
          </div>

          {activeSubscriptions.length === 0 ? (
            <p className="text-xs text-muted italic">
              No active subscriptions. Connect and subscribe to a channel above.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2" data-testid="ws-active-subscriptions">
              {activeSubscriptions.map((sub) => (
                <div
                  key={sub.id}
                  data-testid={`ws-sub-${sub.id}`}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-xs"
                >
                  <span className="font-semibold text-gold font-mono">{sub.channel}</span>
                  <span className="text-muted font-mono text-[11px]">{sub.id}</span>
                  <button
                    type="button"
                    onClick={() => handleUnsubscribe(sub.id)}
                    className="ml-1 px-2 py-0.5 rounded bg-surface hover:bg-border border border-border text-[11px] text-muted hover:text-fg transition-colors"
                  >
                    Unsubscribe
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Live Event Stream Card */}
      <div className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-fg">Event Stream</h2>
            <span
              data-testid="ws-event-count"
              className="px-2 py-0.5 text-[11px] font-mono rounded bg-surface-2 border border-border text-muted"
            >
              {events.length} / {maxEvents} max ({totalReceived} received)
            </span>
            {isPaused && (
              <span
                data-testid="ws-paused-badge"
                className="px-2 py-0.5 text-[11px] font-mono rounded bg-amber-950/60 border border-amber-700/50 text-amber-300"
              >
                Paused ({bufferedEvents.length} buffered)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="ws-pause-resume-btn"
              onClick={handleTogglePause}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                isPaused
                  ? "bg-gold/20 border-gold/40 text-gold hover:bg-gold/30"
                  : "bg-surface-2 border-border text-fg hover:bg-border"
              }`}
            >
              {isPaused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              data-testid="ws-clear-log-btn"
              onClick={handleClearLog}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-2 hover:bg-border border border-border text-muted hover:text-fg transition-colors"
            >
              Clear Log
            </button>
          </div>
        </div>

        {events.length === 0 ? (
          <div
            data-testid="ws-empty-stream"
            className="bg-surface-2/40 border border-border/60 rounded-lg p-8 text-center text-xs text-muted"
          >
            {isPaused && bufferedEvents.length > 0
              ? `Stream is paused with ${bufferedEvents.length} buffered event(s). Click Resume to view them.`
              : "No events received yet. Connect and subscribe to start streaming live node notifications."}
          </div>
        ) : (
          <div
            data-testid="ws-event-list"
            className="flex flex-col gap-3 max-h-[32rem] overflow-y-auto pr-1"
          >
            {events.map((entry) => (
              <div
                key={entry.uid}
                data-testid="ws-event-item"
                className="bg-surface-2 rounded-lg border border-border p-3 flex flex-col gap-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-gold/10 text-gold border border-gold/20 font-mono font-semibold">
                      {entry.channel}
                    </span>
                    <span className="font-mono text-muted">sub: {entry.subscriptionId}</span>
                    <span className="font-mono text-subtle">{entry.receivedAt}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyEvent(entry)}
                    className="px-2 py-0.5 rounded bg-surface hover:bg-border border border-border text-muted hover:text-fg transition-colors"
                  >
                    {copiedUid === entry.uid ? "Copied!" : "Copy JSON"}
                  </button>
                </div>
                <pre className="bg-surface p-3 rounded border border-border/60 text-xs font-mono text-fg overflow-x-auto">
                  {entry.rawJson}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
