import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decodeContractLog,
  DEFAULT_BLOCK_RECEIPT_CONCURRENCY,
  DEFAULT_WS_MAX_QUEUE_SIZE,
  KovanicaClient,
  KovanicaWsClient,
  subscribeNewBlocksWithReceipts,
  type BlockReceiptErrorContext,
  type BlockReceiptsRpcClient,
  type BlockWithReceiptsEvent,
  type BlockWithReceiptsSubscriptionHandle,
  type ContractLogKind,
  type DecodedContractLog,
  type WsBackpressureDropEvent,
  type WsBackpressureOverflowPolicy,
  type WsLogFilter,
  type WsNewHeadEvent,
} from "kovanica-sdk";

export type SubscriptionChannel = "newHeads" | "committedLeaders" | "logs";

export type WsLogDecoderKind =
  | "off"
  | "name"
  | "token_metadata"
  | "nft_metadata"
  | "escrow"
  | "htlc"
  | "vault"
  | "multisig_state";

export const WS_LOG_DECODER_OPTIONS: ReadonlyArray<{
  value: WsLogDecoderKind;
  label: string;
}> = [
  { value: "off", label: "Off (Raw JSON)" },
  { value: "name", label: "name — NameRecord" },
  { value: "token_metadata", label: "token_metadata — TokenMetadata" },
  { value: "nft_metadata", label: "nft_metadata — NftMetadata" },
  { value: "escrow", label: "escrow — EscrowRecord" },
  { value: "htlc", label: "htlc — HtlcRecord" },
  { value: "vault", label: "vault — VaultRecord" },
  { value: "multisig_state", label: "multisig_state — MultisigState" },
];

export type WsConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type LogsFilter = WsLogFilter;

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

export interface WsBlockReceiptEntry {
  uid: string;
  receivedAt: string;
  heightLabel: string;
  blockHash: string;
  receiptCount: number;
  succeededCount: number;
  failedCount: number;
  droppedBeforeThis: number;
  receiptsJson: string;
}

export interface WsSubscriptionConsoleProps {
  rpcUrl: string;
  rpcClient?: BlockReceiptsRpcClient;
  WebSocketImpl?: WebSocketConstructor;
  maxEvents?: number;
}

export const DEFAULT_MAX_EVENTS = 200;

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

function normalizeLogDataInput(raw: unknown): Uint8Array | string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (raw instanceof Uint8Array) {
    return raw.length > 0 ? raw : null;
  }
  if (Array.isArray(raw) && raw.length > 0 && raw.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255)) {
    return Uint8Array.from(raw);
  }
  return null;
}

function extractLogDataPayloads(payload: unknown): Array<Uint8Array | string> {
  const direct = normalizeLogDataInput(payload);
  if (direct !== null) return [direct];

  const out: Array<Uint8Array | string> = [];
  const collectFromItem = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    const obj = item as Record<string, unknown>;
    if (Array.isArray(obj.events)) {
      for (const ev of obj.events) {
        collectFromItem(ev);
      }
    }
    if (Array.isArray(obj.logs)) {
      for (const log of obj.logs) {
        collectFromItem(log);
      }
    }
    const fieldData = normalizeLogDataInput(obj.data);
    if (fieldData !== null) {
      out.push(fieldData);
    }
  };

  if (Array.isArray(payload)) {
    for (const item of payload) {
      collectFromItem(item);
    }
  } else {
    collectFromItem(payload);
  }

  return out;
}

export interface InlineLogDecodeResult {
  decoded: DecodedContractLog[];
  fallbackReason?: string;
}

export function tryDecodeWsLogPayload(
  payload: unknown,
  decoderKind: WsLogDecoderKind,
): InlineLogDecodeResult | null {
  if (decoderKind === "off") return null;

  const candidates = extractLogDataPayloads(payload);
  if (candidates.length === 0) {
    return {
      decoded: [],
      fallbackReason: "No decodable Bincode data payload found in notification frame; showing raw JSON.",
    };
  }

  const decoded: DecodedContractLog[] = [];
  let lastError: string | undefined;

  for (const data of candidates) {
    try {
      decoded.push(decodeContractLog(data, decoderKind as ContractLogKind));
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  if (decoded.length === 0) {
    return {
      decoded: [],
      fallbackReason: lastError
        ? `Payload did not match "${decoderKind}" schema (${lastError}); showing raw JSON.`
        : `Payload did not match "${decoderKind}" schema; showing raw JSON.`,
    };
  }

  return { decoded };
}

export function WsSubscriptionConsole({
  rpcUrl,
  rpcClient,
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
  const [logDecoderKind, setLogDecoderKind] = useState<WsLogDecoderKind>("off");
  const [activeSubscriptions, setActiveSubscriptions] = useState<ActiveSubscription[]>([]);

  // Event stream state
  const [events, setEvents] = useState<WsEventEntry[]>([]);
  const [bufferedEvents, setBufferedEvents] = useState<WsEventEntry[]>([]);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [totalReceived, setTotalReceived] = useState<number>(0);
  const [copiedUid, setCopiedUid] = useState<string | null>(null);

  // Live Block+Receipt Streamer state (subscribeNewBlocksWithReceipts)
  const [blockMaxQueueInput, setBlockMaxQueueInput] = useState<string>(
    String(DEFAULT_WS_MAX_QUEUE_SIZE),
  );
  const [blockConcurrencyInput, setBlockConcurrencyInput] = useState<string>(
    String(DEFAULT_BLOCK_RECEIPT_CONCURRENCY),
  );
  const [blockOverflowPolicy, setBlockOverflowPolicy] =
    useState<WsBackpressureOverflowPolicy>("drop-oldest");
  const [blockStreamStatus, setBlockStreamStatus] = useState<
    "idle" | "starting" | "streaming" | "error"
  >("idle");
  const [blockStreamSubId, setBlockStreamSubId] = useState<string | null>(null);
  const [blockStreamError, setBlockStreamError] = useState<string | null>(null);
  const [blockDroppedCount, setBlockDroppedCount] = useState<number>(0);
  const [blockPendingCount, setBlockPendingCount] = useState<number>(0);
  const [blockReceiptEntries, setBlockReceiptEntries] = useState<WsBlockReceiptEntry[]>([]);

  // Mutable refs for KovanicaWsClient callbacks
  const wsClientRef = useRef<KovanicaWsClient | null>(null);
  const blockHandleRef = useRef<BlockWithReceiptsSubscriptionHandle | null>(null);
  const blockSeqRef = useRef<number>(1);
  const eventSeqRef = useRef<number>(1);
  const subscriptionsRef = useRef<Map<string, ActiveSubscription>>(new Map());
  const isPausedRef = useRef<boolean>(false);
  const maxEventsRef = useRef<number>(maxEvents);

  const effectiveRpcClient = useMemo<BlockReceiptsRpcClient>(() => {
    if (rpcClient) return rpcClient;
    return new KovanicaClient({
      url: rpcUrl,
      fetch: (input, init) => globalThis.fetch(input, init),
    });
  }, [rpcClient, rpcUrl]);

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

  const pushEvent = useCallback(
    (subscriptionId: string, eventChannel: SubscriptionChannel | "unknown", payload: unknown) => {
      const entry: WsEventEntry = {
        uid: `evt-${eventSeqRef.current++}`,
        receivedAt: new Date().toISOString(),
        subscriptionId,
        channel: eventChannel,
        payload,
        rawJson: safeFormatJson(payload),
      };

      setTotalReceived((prev) => prev + 1);
      const cap = Math.max(1, maxEventsRef.current);

      if (isPausedRef.current) {
        setBufferedEvents((prev) => [entry, ...prev].slice(0, cap));
      } else {
        setEvents((prev) => [entry, ...prev].slice(0, cap));
      }
    },
    [],
  );

  const cleanupClient = useCallback((closeClient: boolean) => {
    const activeBlockHandle = blockHandleRef.current;
    blockHandleRef.current = null;
    if (activeBlockHandle) {
      void activeBlockHandle.unsubscribe().catch(() => {
        // Ignore unsubscribe errors while tearing down socket
      });
    }
    setBlockStreamStatus("idle");
    setBlockStreamSubId(null);
    setBlockPendingCount(0);

    const current = wsClientRef.current;
    wsClientRef.current = null;
    subscriptionsRef.current.clear();
    setActiveSubscriptions([]);

    if (current && closeClient) {
      try {
        current.close();
      } catch {
        // Ignore close errors on already-closing sockets
      }
    }
  }, []);

  // Ensure clean disconnect on unmount
  useEffect(() => {
    return () => {
      cleanupClient(true);
    };
  }, [cleanupClient]);

  const handleDisconnect = useCallback(() => {
    cleanupClient(true);
    setConnectionState("disconnected");
    setStatusMessage("Disconnected");
    setErrorMsg(null);
  }, [cleanupClient]);

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

    // Close any prior client before opening a new one
    cleanupClient(true);
    setErrorMsg(null);
    setStatusMessage(`Connecting to ${targetUrl}...`);
    setConnectionState("connecting");

    let client: KovanicaWsClient;
    try {
      client = new KovanicaWsClient({
        url: targetUrl,
        WebSocketImpl: SocketCtor as unknown as typeof WebSocket,
        onError: (err: Error) => {
          if (wsClientRef.current !== client) return;
          setErrorMsg(err.message);
        },
      });
    } catch (err: unknown) {
      setConnectionState("error");
      setStatusMessage(null);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return;
    }

    wsClientRef.current = client;

    void client
      .connect()
      .then(() => {
        if (wsClientRef.current !== client) return;
        setConnectionState("connected");
        setStatusMessage(`Connected to ${targetUrl}`);
        setErrorMsg(null);
      })
      .catch((err: unknown) => {
        if (wsClientRef.current !== client) return;
        wsClientRef.current = null;
        subscriptionsRef.current.clear();
        setActiveSubscriptions([]);
        setConnectionState("error");
        setStatusMessage(null);
        setErrorMsg(err instanceof Error ? err.message : String(err));
      });
  }, [wsUrl, WebSocketImpl, cleanupClient]);

  const handleSubscribe = useCallback(() => {
    const client = wsClientRef.current;
    if (!client || connectionState !== "connected" || !client.isConnected) {
      setErrorMsg("Connect to a WebSocket endpoint before subscribing.");
      return;
    }

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
      }
    }

    setErrorMsg(null);
    setStatusMessage(`Subscribing to ${channel}...`);

    const subChannel = channel;
    const subFilter = filter;
    let resolvedSubId = "pending";

    const onNotification = (payload: unknown) => {
      if (wsClientRef.current !== client) return;
      pushEvent(resolvedSubId, subChannel, payload);
    };

    const subscribePromise =
      subChannel === "newHeads"
        ? client.subscribeNewHeads(onNotification)
        : subChannel === "committedLeaders"
          ? client.subscribeCommittedLeaders(onNotification)
          : client.subscribeLogs(subFilter, onNotification);

    void subscribePromise
      .then((subId) => {
        if (wsClientRef.current !== client) return;
        resolvedSubId = subId;
        const sub: ActiveSubscription = {
          id: subId,
          channel: subChannel,
          filter: subFilter,
          subscribedAt: new Date().toISOString(),
        };
        subscriptionsRef.current.set(subId, sub);
        setActiveSubscriptions(Array.from(subscriptionsRef.current.values()));
        setStatusMessage(`Subscribed to ${sub.channel} (${subId})`);
        setErrorMsg(null);
      })
      .catch((err: unknown) => {
        if (wsClientRef.current !== client) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
      });
  }, [channel, connectionState, logAddressInput, logTopicsInput, pushEvent]);

  const handleUnsubscribe = useCallback(
    (subscriptionId: string) => {
      const client = wsClientRef.current;
      if (!client || connectionState !== "connected" || !client.isConnected) {
        setErrorMsg("WebSocket is not connected.");
        return;
      }

      setErrorMsg(null);
      setStatusMessage(`Unsubscribing ${subscriptionId}...`);

      void client
        .unsubscribe(subscriptionId)
        .then(() => {
          if (wsClientRef.current !== client) return;
          subscriptionsRef.current.delete(subscriptionId);
          setActiveSubscriptions(Array.from(subscriptionsRef.current.values()));
          setStatusMessage(`Unsubscribed ${subscriptionId}`);
          setErrorMsg(null);
        })
        .catch((err: unknown) => {
          if (wsClientRef.current !== client) return;
          setErrorMsg(err instanceof Error ? err.message : String(err));
        });
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

  const handleStopBlockReceiptStream = useCallback(async () => {
    const handle = blockHandleRef.current;
    blockHandleRef.current = null;
    setBlockStreamSubId(null);
    setBlockPendingCount(0);
    setBlockStreamStatus("idle");
    if (handle) {
      try {
        await handle.unsubscribe();
      } catch (err: unknown) {
        setBlockStreamError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  const handleStartBlockReceiptStream = useCallback(async () => {
    const client = wsClientRef.current;
    if (!client || connectionState !== "connected" || !client.isConnected) {
      setBlockStreamError("Connect to a WebSocket endpoint before starting the Block+Receipt stream.");
      return;
    }

    const parsedQueue = Number.parseInt(blockMaxQueueInput.trim(), 10);
    if (!Number.isSafeInteger(parsedQueue) || parsedQueue < 1) {
      setBlockStreamError("Max Queue Size must be a positive integer.");
      return;
    }

    const parsedConcurrency = Number.parseInt(blockConcurrencyInput.trim(), 10);
    if (!Number.isSafeInteger(parsedConcurrency) || parsedConcurrency < 1) {
      setBlockStreamError("Receipt Concurrency must be a positive integer.");
      return;
    }

    // Stop any previous block+receipt subscription first
    if (blockHandleRef.current) {
      await handleStopBlockReceiptStream();
    }

    setBlockStreamError(null);
    setBlockStreamStatus("starting");

    try {
      const handle = await subscribeNewBlocksWithReceipts(
        client,
        effectiveRpcClient,
        (event: BlockWithReceiptsEvent) => {
          if (wsClientRef.current !== client) return;

          const rawHeight =
            event.head.number ??
            (event.head as Record<string, unknown>).height ??
            event.head.round ??
            event.block?.number;
          const heightLabel =
            rawHeight !== undefined && rawHeight !== null ? String(rawHeight) : "—";
          const blockHash = event.head.hash || event.block?.hash || "unknown";
          const succeededCount = event.receipts.filter((r) => r.success || r.status === 1).length;
          const failedCount = event.receipts.length - succeededCount;

          const item: WsBlockReceiptEntry = {
            uid: `blk-${blockSeqRef.current++}`,
            receivedAt: new Date().toISOString(),
            heightLabel,
            blockHash,
            receiptCount: event.receipts.length,
            succeededCount,
            failedCount,
            droppedBeforeThis: event.droppedBeforeThis,
            receiptsJson: safeFormatJson(event.receipts),
          };

          const cap = Math.max(1, maxEventsRef.current);
          setBlockReceiptEntries((prev) => [item, ...prev].slice(0, cap));

          const activeHandle = blockHandleRef.current;
          if (activeHandle) {
            setBlockDroppedCount(activeHandle.droppedCount);
            setBlockPendingCount(activeHandle.pendingCount);
          } else if (event.droppedBeforeThis > 0) {
            setBlockDroppedCount((prev) => prev + event.droppedBeforeThis);
          }
        },
        {
          maxQueueSize: parsedQueue,
          receiptConcurrency: parsedConcurrency,
          overflowPolicy: blockOverflowPolicy,
          onBackpressureDrop: (drop: WsBackpressureDropEvent<WsNewHeadEvent>) => {
            if (wsClientRef.current !== client) return;
            setBlockDroppedCount(drop.droppedCount);
            setBlockPendingCount(drop.queueSize);
          },
          onError: (err: Error, ctx?: BlockReceiptErrorContext) => {
            if (wsClientRef.current !== client) return;
            const stagePrefix = ctx?.stage ? `[${ctx.stage}] ` : "";
            setBlockStreamError(`${stagePrefix}${err.message}`);
          },
        },
      );

      if (wsClientRef.current !== client) {
        void handle.unsubscribe().catch(() => {});
        return;
      }

      blockHandleRef.current = handle;
      setBlockStreamSubId(handle.subscriptionId);
      setBlockDroppedCount(handle.droppedCount);
      setBlockPendingCount(handle.pendingCount);
      setBlockStreamStatus("streaming");
    } catch (err: unknown) {
      setBlockStreamStatus("error");
      setBlockStreamError(err instanceof Error ? err.message : String(err));
    }
  }, [
    blockConcurrencyInput,
    blockMaxQueueInput,
    blockOverflowPolicy,
    connectionState,
    effectiveRpcClient,
    handleStopBlockReceiptStream,
  ]);

  const handleClearBlockReceipts = useCallback(() => {
    setBlockReceiptEntries([]);
    setBlockDroppedCount(blockHandleRef.current?.droppedCount ?? 0);
    setBlockStreamError(null);
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

      {/* Live Block + Receipt Streamer Card (subscribeNewBlocksWithReceipts) */}
      <div
        data-testid="ws-block-receipts-panel"
        className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              Live Block + Receipt Streamer (SDK v0.6.0{" "}
              <code className="font-mono text-gold">subscribeNewBlocksWithReceipts</code>)
            </h2>
            <p className="text-xs text-muted">
              Subscribes to <code className="font-mono text-fg">newHeads</code> and enriches each block with
              transaction receipts using bounded concurrency and a capped backpressure queue.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              data-testid="ws-block-receipts-status"
              className={`px-2.5 py-1 rounded-md border font-mono capitalize ${
                blockStreamStatus === "streaming"
                  ? "bg-emerald-950/60 border-emerald-700/50 text-emerald-300"
                  : blockStreamStatus === "error"
                  ? "bg-red-950/60 border-red-700/50 text-red-300"
                  : "bg-surface-2 border-border text-muted"
              }`}
            >
              {blockStreamStatus}
              {blockStreamSubId ? ` (${blockStreamSubId})` : ""}
            </span>
            <span
              data-testid="ws-block-receipts-dropped-count"
              className={`px-2.5 py-1 rounded-md border font-mono ${
                blockDroppedCount > 0
                  ? "bg-amber-950/60 border-amber-700/50 text-amber-300"
                  : "bg-surface-2 border-border text-muted"
              }`}
            >
              Dropped: {blockDroppedCount}
            </span>
            <span
              data-testid="ws-block-receipts-pending-count"
              className="px-2.5 py-1 rounded-md bg-surface-2 border border-border font-mono text-muted"
            >
              Queue: {blockPendingCount}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="ws-block-receipts-max-queue-input"
              className="text-xs font-medium text-muted"
            >
              Max Queue Size (backpressure cap)
            </label>
            <input
              id="ws-block-receipts-max-queue-input"
              data-testid="ws-block-receipts-max-queue-input"
              type="number"
              min={1}
              value={blockMaxQueueInput}
              onChange={(e) => setBlockMaxQueueInput(e.target.value)}
              disabled={blockStreamStatus === "streaming" || blockStreamStatus === "starting"}
              className="bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-fg focus:outline-none focus:border-gold disabled:opacity-60"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="ws-block-receipts-concurrency-input"
              className="text-xs font-medium text-muted"
            >
              Receipt Concurrency
            </label>
            <input
              id="ws-block-receipts-concurrency-input"
              data-testid="ws-block-receipts-concurrency-input"
              type="number"
              min={1}
              value={blockConcurrencyInput}
              onChange={(e) => setBlockConcurrencyInput(e.target.value)}
              disabled={blockStreamStatus === "streaming" || blockStreamStatus === "starting"}
              className="bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-fg focus:outline-none focus:border-gold disabled:opacity-60"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="ws-block-receipts-overflow-select"
              className="text-xs font-medium text-muted"
            >
              Overflow Policy
            </label>
            <select
              id="ws-block-receipts-overflow-select"
              data-testid="ws-block-receipts-overflow-select"
              value={blockOverflowPolicy}
              onChange={(e) =>
                setBlockOverflowPolicy(e.target.value as WsBackpressureOverflowPolicy)
              }
              disabled={blockStreamStatus === "streaming" || blockStreamStatus === "starting"}
              className="bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-fg focus:outline-none focus:border-gold disabled:opacity-60"
            >
              <option value="drop-oldest">drop-oldest</option>
              <option value="drop-newest">drop-newest</option>
              <option value="error">error</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            {blockStreamStatus === "streaming" || blockStreamStatus === "starting" ? (
              <button
                type="button"
                data-testid="ws-block-receipts-toggle-btn"
                onClick={() => void handleStopBlockReceiptStream()}
                className="flex-1 px-3 py-1.5 bg-red-950/60 hover:bg-red-900/70 text-red-200 border border-red-700/60 font-semibold rounded-lg text-xs transition-colors whitespace-nowrap"
              >
                Stop Stream
              </button>
            ) : (
              <button
                type="button"
                data-testid="ws-block-receipts-toggle-btn"
                onClick={() => void handleStartBlockReceiptStream()}
                disabled={!isConnected}
                className="flex-1 px-3 py-1.5 bg-gold hover:bg-gold/90 text-bg font-semibold rounded-lg text-xs transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                Start Block+Receipt Stream
              </button>
            )}
            <button
              type="button"
              data-testid="ws-block-receipts-clear-btn"
              onClick={handleClearBlockReceipts}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-2 hover:bg-border border border-border text-muted hover:text-fg transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        {blockStreamError && (
          <div
            data-testid="ws-block-receipts-error"
            className="bg-red-950/40 border border-red-700/50 rounded-lg p-3 text-xs font-mono text-red-200"
          >
            {blockStreamError}
          </div>
        )}

        {blockReceiptEntries.length === 0 ? (
          <div
            data-testid="ws-block-receipts-empty"
            className="bg-surface-2/40 border border-border/60 rounded-lg p-6 text-center text-xs text-muted"
          >
            Connect to WebSocket and click <strong>Start Block+Receipt Stream</strong> to stream enriched blocks with transaction receipts.
          </div>
        ) : (
          <div
            data-testid="ws-block-receipts-list"
            className="flex flex-col gap-2.5 max-h-96 overflow-y-auto pr-1"
          >
            {blockReceiptEntries.map((item) => (
              <div
                key={item.uid}
                data-testid="ws-block-receipt-item"
                className="bg-surface-2 rounded-lg border border-border p-3 flex flex-col gap-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-gold/10 text-gold border border-gold/20 font-mono font-semibold">
                      Height #{item.heightLabel}
                    </span>
                    <span className="font-mono text-fg break-all">{item.blockHash}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                    <span className="px-2 py-0.5 rounded bg-surface border border-border text-fg">
                      {item.receiptCount} receipt{item.receiptCount === 1 ? "" : "s"}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-700/50 text-emerald-300">
                      {item.succeededCount} ok
                    </span>
                    {item.failedCount > 0 && (
                      <span className="px-2 py-0.5 rounded bg-red-950/60 border border-red-700/50 text-red-300">
                        {item.failedCount} failed
                      </span>
                    )}
                    {item.droppedBeforeThis > 0 && (
                      <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-700/50 text-amber-300">
                        +{item.droppedBeforeThis} dropped before
                      </span>
                    )}
                  </div>
                </div>
                {item.receiptCount > 0 && (
                  <pre className="bg-surface p-2.5 rounded border border-border/60 text-[11px] font-mono text-muted overflow-x-auto max-h-40">
                    {item.receiptsJson}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
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

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="ws-log-decoder-select" className="text-xs text-muted whitespace-nowrap">
              Bincode Log Decoder:
            </label>
            <select
              id="ws-log-decoder-select"
              data-testid="ws-log-decoder-select"
              aria-label="Bincode Log Decoder"
              value={logDecoderKind}
              onChange={(e) => setLogDecoderKind(e.target.value as WsLogDecoderKind)}
              className="bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            >
              {WS_LOG_DECODER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
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
            {events.map((entry) => {
              const decodedResult =
                entry.channel === "logs"
                  ? tryDecodeWsLogPayload(entry.payload, logDecoderKind)
                  : null;
              const hasDecodedLogs = decodedResult !== null && decodedResult.decoded.length > 0;
              return (
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
                      {hasDecodedLogs && (
                        <span
                          data-testid="ws-decoded-badge"
                          className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-700/50 font-mono"
                        >
                          decoded: {logDecoderKind}
                        </span>
                      )}
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
                  {hasDecodedLogs && (
                    <pre
                      data-testid="ws-decoded-log"
                      className="bg-emerald-950/20 p-3 rounded border border-emerald-800/40 text-xs font-mono text-emerald-200 overflow-x-auto"
                    >
                      {safeFormatJson(
                        decodedResult.decoded.length === 1
                          ? decodedResult.decoded[0]
                          : decodedResult.decoded,
                      )}
                    </pre>
                  )}
                  {decodedResult?.fallbackReason && (
                    <div
                      data-testid="ws-decode-fallback"
                      className="text-[11px] font-mono text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded px-2.5 py-1.5"
                    >
                      {decodedResult.fallbackReason}
                    </div>
                  )}
                  <pre className="bg-surface p-3 rounded border border-border/60 text-xs font-mono text-fg overflow-x-auto">
                    {entry.rawJson}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
