import { useState } from "react";
import {
  DEFAULT_CONTRACT_LOGS_MAX_PAGES,
  DEFAULT_CONTRACT_LOGS_MAX_SPAN,
  bytesToHex,
  queryContractLogsPaginated,
  type ContractLogEntry,
  type ContractLogKind,
  type DecodedPaginatedContractLog,
  type PaginatedContractLogsResult,
  type PaginatedLogsClient,
} from "../wallet-interop";

export interface PaginatedContractLogsPanelProps {
  client: PaginatedLogsClient;
  defaultContractAddress?: string;
}

const CONTRACT_LOG_KINDS: ReadonlyArray<{ value: ContractLogKind; label: string }> = [
  { value: "token_metadata", label: "token_metadata" },
  { value: "token_pool", label: "token_pool" },
  { value: "name", label: "name" },
  { value: "nft_metadata", label: "nft_metadata" },
  { value: "escrow", label: "escrow" },
  { value: "htlc", label: "htlc" },
  { value: "vault", label: "vault" },
  { value: "multisig_state", label: "multisig_state" },
  { value: "multisig_tx", label: "multisig_tx" },
];

function serializeJsonLossless(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => {
      if (typeof v === "bigint") {
        return v.toString();
      }
      if (v instanceof Uint8Array) {
        return `0x${bytesToHex(v)}`;
      }
      return v;
    },
    2,
  );
}

function formatLogDataPreview(data: ContractLogEntry["data"]): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Uint8Array) {
    return `0x${bytesToHex(data)}`;
  }
  if (Array.isArray(data)) {
    return `0x${bytesToHex(Uint8Array.from(data))}`;
  }
  return String(data);
}

function formatBlockQty(value: bigint | number | string | undefined): string {
  if (value === undefined || value === null) {
    return "—";
  }
  return String(value);
}

function parseNonNegativeBigIntInput(raw: string, label: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return BigInt(trimmed);
}

function parsePositiveSafeIntInput(raw: string, label: string): number {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a positive integer`);
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer (>= 1)`);
  }
  return value;
}

export function PaginatedContractLogsPanel({
  client,
  defaultContractAddress,
}: PaginatedContractLogsPanelProps) {
  const [contractAddress, setContractAddress] = useState<string>(defaultContractAddress ?? "");
  const [fromBlockStr, setFromBlockStr] = useState<string>("0");
  const [toBlockStr, setToBlockStr] = useState<string>("1000");
  const [maxSpanStr, setMaxSpanStr] = useState<string>(String(DEFAULT_CONTRACT_LOGS_MAX_SPAN));
  const [maxPagesStr, setMaxPagesStr] = useState<string>(String(DEFAULT_CONTRACT_LOGS_MAX_PAGES));
  const [topicFilter, setTopicFilter] = useState<string>("");
  const [decodeEnabled, setDecodeEnabled] = useState<boolean>(false);
  const [logKind, setLogKind] = useState<ContractLogKind>("token_metadata");

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PaginatedContractLogsResult | null>(null);

  const runQuery = async (resumeCursor?: string) => {
    setError(null);

    let fromBlock: bigint;
    let toBlock: bigint;
    let maxSpan: number;
    let maxPages: number;
    try {
      fromBlock = parseNonNegativeBigIntInput(fromBlockStr, "fromBlock");
      toBlock = parseNonNegativeBigIntInput(toBlockStr, "toBlock");
      if (fromBlock > toBlock) {
        throw new Error(`fromBlock (${fromBlock}) must be <= toBlock (${toBlock})`);
      }
      maxSpan = parsePositiveSafeIntInput(maxSpanStr, "maxSpan");
      maxPages = parsePositiveSafeIntInput(maxPagesStr, "maxPages");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    const trimmedAddress = contractAddress.trim();
    const parsedTopics = topicFilter
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    setIsLoading(true);
    try {
      const pageResult = await queryContractLogsPaginated(
        client,
        {
          fromBlock,
          toBlock,
          ...(trimmedAddress.length > 0 ? { address: trimmedAddress } : {}),
          ...(parsedTopics.length > 0 ? { topics: parsedTopics } : {}),
        },
        {
          maxSpan,
          maxPages,
          ...(resumeCursor ? { cursor: resumeCursor } : {}),
          ...(decodeEnabled ? { decode: true, kind: logKind } : { decode: false }),
        },
      );

      if (resumeCursor && result) {
        const offset = result.logs.length;
        const mergedDecoded: Array<DecodedPaginatedContractLog> | undefined =
          result.decodedLogs || pageResult.decodedLogs
            ? [
                ...(result.decodedLogs ?? []),
                ...(pageResult.decodedLogs ?? []).map((d) => ({
                  ...d,
                  index: d.index + offset,
                })),
              ]
            : undefined;

        setResult({
          logs: [...result.logs, ...pageResult.logs],
          ...(mergedDecoded !== undefined ? { decodedLogs: mergedDecoded } : {}),
          nextCursor: pageResult.nextCursor,
          hasMore: pageResult.hasMore,
          pagesFetched: result.pagesFetched + pageResult.pagesFetched,
          chunksScanned: result.chunksScanned + pageResult.chunksScanned,
        });
      } else {
        setResult(pageResult);
      }
    } catch (err: unknown) {
      if (!resumeCursor) {
        setResult(null);
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const decodedByIndex = new Map<number, DecodedPaginatedContractLog>();
  if (result?.decodedLogs) {
    for (const item of result.decodedLogs) {
      decodedByIndex.set(item.index, item);
    }
  }

  return (
    <div
      data-testid="paginated-contract-logs-panel"
      className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">
            Paginated Contract Logs Explorer
          </h2>
          <p className="text-xs text-muted">
            Max-span-chunked &amp; cursor-paginated <code>kovanica_getLogs</code> explorer via{" "}
            <code>queryContractLogsPaginated</code> (SDK <code>v0.7.0</code>)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
        <div className="md:col-span-6">
          <label
            htmlFor="paginated-logs-address-input"
            className="block text-xs font-medium text-muted mb-1"
          >
            Contract Address (PRO-21 <code>kvnc...dag</code> / <code>tknc...dag</code>, optional)
          </label>
          <input
            id="paginated-logs-address-input"
            data-testid="paginated-logs-address-input"
            type="text"
            value={contractAddress}
            onChange={(e) => setContractAddress(e.target.value)}
            placeholder="kvnc...dag or tknc...dag"
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />
        </div>

        <div className="md:col-span-3">
          <label
            htmlFor="paginated-logs-from-block-input"
            className="block text-xs font-medium text-muted mb-1"
          >
            fromBlock
          </label>
          <input
            id="paginated-logs-from-block-input"
            data-testid="paginated-logs-from-block-input"
            type="text"
            inputMode="numeric"
            value={fromBlockStr}
            onChange={(e) => setFromBlockStr(e.target.value)}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />
        </div>

        <div className="md:col-span-3">
          <label
            htmlFor="paginated-logs-to-block-input"
            className="block text-xs font-medium text-muted mb-1"
          >
            toBlock
          </label>
          <input
            id="paginated-logs-to-block-input"
            data-testid="paginated-logs-to-block-input"
            type="text"
            inputMode="numeric"
            value={toBlockStr}
            onChange={(e) => setToBlockStr(e.target.value)}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />
        </div>

        <div className="md:col-span-2">
          <label
            htmlFor="paginated-logs-max-span-input"
            className="block text-xs font-medium text-muted mb-1"
          >
            maxSpan
          </label>
          <input
            id="paginated-logs-max-span-input"
            data-testid="paginated-logs-max-span-input"
            type="number"
            min={1}
            value={maxSpanStr}
            onChange={(e) => setMaxSpanStr(e.target.value)}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />
        </div>

        <div className="md:col-span-2">
          <label
            htmlFor="paginated-logs-max-pages-input"
            className="block text-xs font-medium text-muted mb-1"
          >
            maxPages
          </label>
          <input
            id="paginated-logs-max-pages-input"
            data-testid="paginated-logs-max-pages-input"
            type="number"
            min={1}
            value={maxPagesStr}
            onChange={(e) => setMaxPagesStr(e.target.value)}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />
        </div>

        <div className="md:col-span-4">
          <label
            htmlFor="paginated-logs-topic-input"
            className="block text-xs font-medium text-muted mb-1"
          >
            Topic Filter (optional, comma-separated)
          </label>
          <input
            id="paginated-logs-topic-input"
            data-testid="paginated-logs-topic-input"
            type="text"
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value)}
            placeholder="0x... or topic string"
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />
        </div>

        <div className="md:col-span-2 flex flex-col gap-1">
          <label className="flex items-center gap-2 text-xs text-fg cursor-pointer select-none">
            <input
              type="checkbox"
              data-testid="paginated-logs-decode-toggle"
              checked={decodeEnabled}
              onChange={(e) => setDecodeEnabled(e.target.checked)}
              className="rounded border-border bg-surface-2 accent-gold"
            />
            Decode Bincode
          </label>
          {decodeEnabled && (
            <select
              aria-label="Contract log kind"
              data-testid="paginated-logs-kind-select"
              value={logKind}
              onChange={(e) => setLogKind(e.target.value as ContractLogKind)}
              className="w-full bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            >
              {CONTRACT_LOG_KINDS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            data-testid="paginated-logs-query-btn"
            disabled={isLoading}
            onClick={() => runQuery()}
            className="w-full px-3 py-2 bg-gold/20 hover:bg-gold/30 disabled:opacity-50 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
          >
            {isLoading ? "Querying..." : "Query Logs"}
          </button>
        </div>
      </div>

      {error && (
        <div
          data-testid="paginated-logs-error"
          className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
        >
          {error}
        </div>
      )}

      {result && (
        <div data-testid="paginated-logs-result" className="flex flex-col gap-3 text-xs">
          <div
            data-testid="paginated-logs-telemetry"
            className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center justify-between gap-2 text-muted"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                Logs: <strong data-testid="paginated-logs-count" className="text-fg">{result.logs.length}</strong>
              </span>
              <span>
                chunksScanned:{" "}
                <strong data-testid="paginated-logs-chunks-scanned" className="text-fg">
                  {result.chunksScanned}
                </strong>
              </span>
              <span>
                pagesFetched:{" "}
                <strong data-testid="paginated-logs-pages-fetched" className="text-fg">
                  {result.pagesFetched}
                </strong>
              </span>
              <span>
                nextCursor:{" "}
                <strong data-testid="paginated-logs-next-cursor" className="text-gold">
                  {result.nextCursor ?? "null"}
                </strong>
              </span>
              <span>
                Status:{" "}
                <strong
                  data-testid="paginated-logs-has-more"
                  className={result.hasMore ? "text-amber-300" : "text-emerald-400"}
                >
                  {result.hasMore ? "More pages available" : "Complete"}
                </strong>
              </span>
            </div>

            {result.hasMore && result.nextCursor && (
              <button
                type="button"
                data-testid="paginated-logs-next-page-btn"
                disabled={isLoading}
                onClick={() => runQuery(result.nextCursor ?? undefined)}
                className="px-3 py-1 bg-gold/20 hover:bg-gold/30 disabled:opacity-50 rounded border border-gold/40 text-gold font-semibold transition-colors"
              >
                {isLoading ? "Loading..." : "Load Next Page"}
              </button>
            )}
          </div>

          {result.logs.length === 0 ? (
            <div
              data-testid="paginated-logs-empty"
              className="bg-surface-2/50 border border-border rounded-lg p-4 text-center text-muted font-mono"
            >
              No contract logs found for the specified block range and filters.
            </div>
          ) : (
            <div
              data-testid="paginated-logs-list"
              className="flex flex-col gap-2 max-h-80 overflow-y-auto"
            >
              {result.logs.map((log, idx) => {
                const decoded = decodedByIndex.get(idx);
                return (
                  <div
                    key={`${formatBlockQty(log.blockNumber)}-${formatBlockQty(log.logIndex)}-${idx}`}
                    data-testid="paginated-log-row"
                    className="bg-surface-2 border border-border rounded-lg p-3 font-mono flex flex-col gap-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-gold font-semibold">
                          Block #{formatBlockQty(log.blockNumber)}
                        </span>
                        <span className="text-muted">
                          logIndex: {formatBlockQty(log.logIndex)}
                        </span>
                        {decoded && (
                          <span
                            data-testid="paginated-log-decoded-badge"
                            className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-800/50"
                          >
                            decoded: {decoded.kind}
                          </span>
                        )}
                      </div>
                      {log.transactionHash && (
                        <span className="text-muted break-all">
                          tx: <span className="text-fg">{log.transactionHash}</span>
                        </span>
                      )}
                    </div>

                    {log.address && (
                      <div className="text-[11px] text-muted break-all">
                        Contract: <span className="text-fg">{log.address}</span>
                      </div>
                    )}

                    {log.topics && log.topics.length > 0 && (
                      <div className="text-[11px] text-muted break-all">
                        Topics: <span className="text-fg">{log.topics.join(", ")}</span>
                      </div>
                    )}

                    <div className="text-[11px] text-muted break-all">
                      Data: <span className="text-fg">{formatLogDataPreview(log.data)}</span>
                    </div>

                    {decoded && (
                      <pre
                        data-testid="paginated-log-decoded-json"
                        className="mt-1 p-2 rounded bg-surface border border-border/70 text-[11px] text-emerald-200 overflow-x-auto"
                      >
                        {serializeJsonLossless(decoded.record)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
