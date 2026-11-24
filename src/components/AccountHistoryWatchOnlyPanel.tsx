import { useState } from "react";
import { CHAIN_IDS } from "kovanica-sdk";
import {
  DEFAULT_ACCOUNT_TX_HISTORY_LIMIT,
  MAX_ACCOUNT_TX_HISTORY_LIMIT,
  fetchAccountTxHistorySummary,
  inspectWatchOnlyAccount,
  type AccountTxDirection,
  type AccountTxHistoryClient,
  type AccountTxHistorySummary,
  type WatchOnlyAccount,
} from "../wallet-interop";

export interface AccountHistoryWatchOnlyPanelProps {
  client: AccountTxHistoryClient;
  selectedChainId: number;
  defaultAddress?: string;
}

export function AccountHistoryWatchOnlyPanel({
  client,
  selectedChainId,
  defaultAddress,
}: AccountHistoryWatchOnlyPanelProps) {
  // Watch-Only Account Inspector state
  const [watchAddressInput, setWatchAddressInput] = useState<string>(defaultAddress ?? "");
  const [watchChainChoice, setWatchChainChoice] = useState<string>(String(selectedChainId));
  const [watchAccount, setWatchAccount] = useState<WatchOnlyAccount | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);

  // Account Tx History Explorer state
  const [historyAddressInput, setHistoryAddressInput] = useState<string>(defaultAddress ?? "");
  const [direction, setDirection] = useState<AccountTxDirection>("all");
  const [limitStr, setLimitStr] = useState<string>(String(DEFAULT_ACCOUNT_TX_HISTORY_LIMIT));
  const [maxPagesStr, setMaxPagesStr] = useState<string>("1");
  const [isFetchingHistory, setIsFetchingHistory] = useState<boolean>(false);
  const [historySummary, setHistorySummary] = useState<AccountTxHistorySummary | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const handleInspectWatchOnly = () => {
    setWatchError(null);
    const parsedChainId =
      watchChainChoice === "auto" ? undefined : Number.parseInt(watchChainChoice, 10);
    const res = inspectWatchOnlyAccount(
      watchAddressInput,
      Number.isFinite(parsedChainId) ? parsedChainId : undefined,
    );
    if (res.ok) {
      setWatchAccount(res.account);
    } else {
      setWatchAccount(null);
      setWatchError(res.error);
    }
  };

  const parsePositiveIntInput = (raw: string, label: string, min: number, max: number): number => {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`${label} must be an integer between ${min} and ${max}`);
    }
    const val = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(val) || val < min || val > max) {
      throw new Error(`${label} must be between ${min} and ${max}`);
    }
    return val;
  };

  const runHistoryFetch = async (cursor?: string) => {
    setHistoryError(null);
    const trimmedAddress = historyAddressInput.trim();
    if (trimmedAddress.length === 0) {
      setHistoryError("Account address is required to fetch transaction history");
      return;
    }

    let limit: number;
    let maxPages: number;
    try {
      limit = parsePositiveIntInput(limitStr, "Limit", 1, MAX_ACCOUNT_TX_HISTORY_LIMIT);
      maxPages = parsePositiveIntInput(maxPagesStr, "Max pages", 1, 20);
    } catch (err: unknown) {
      setHistoryError(err instanceof Error ? err.message : String(err));
      return;
    }

    setIsFetchingHistory(true);
    try {
      const next = await fetchAccountTxHistorySummary(client, {
        address: trimmedAddress,
        direction,
        limit,
        maxPages,
        ...(cursor ? { cursor } : {}),
      });
      if (cursor && historySummary && historySummary.address === next.address && historySummary.direction === next.direction) {
        setHistorySummary({
          ...next,
          items: [...historySummary.items, ...next.items],
          pagesFetched: historySummary.pagesFetched + next.pagesFetched,
        });
      } else {
        setHistorySummary(next);
      }
    } catch (err: unknown) {
      if (!cursor) {
        setHistorySummary(null);
      }
      setHistoryError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFetchingHistory(false);
    }
  };

  return (
    <div
      data-testid="account-history-watch-only-panel"
      className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">
            Account History &amp; Watch-Only Inspector
          </h2>
          <p className="text-xs text-muted">
            Inspect read-only PRO-21 accounts via <code>createWatchOnlyAccount</code> and explore
            lossless paginated history via <code>getAccountTxHistory</code>
          </p>
        </div>
        {defaultAddress && (
          <button
            type="button"
            data-testid="use-active-account-btn"
            onClick={() => {
              setWatchAddressInput(defaultAddress);
              setHistoryAddressInput(defaultAddress);
              setWatchChainChoice(String(selectedChainId));
            }}
            className="px-3 py-1.5 text-xs bg-surface-2 hover:bg-border rounded-lg border border-border text-fg transition-colors"
          >
            Fill Active Account
          </button>
        )}
      </div>

      {/* Watch-Only Account Inspector */}
      <div
        data-testid="watch-only-inspector-section"
        className="flex flex-col gap-3"
      >
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
          Watch-Only Account Inspector
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-7">
            <label
              htmlFor="watch-only-address-input"
              className="block text-xs font-medium text-muted mb-1"
            >
              PRO-21 Address (<code>kvnc...dag</code> or <code>tknc...dag</code>)
            </label>
            <input
              id="watch-only-address-input"
              data-testid="watch-only-address-input"
              type="text"
              value={watchAddressInput}
              onChange={(e) => setWatchAddressInput(e.target.value)}
              placeholder="kvnc...dag or tknc...dag"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
          </div>

          <div className="md:col-span-3">
            <label
              htmlFor="watch-only-chain-select"
              className="block text-xs font-medium text-muted mb-1"
            >
              Target Chain
            </label>
            <select
              id="watch-only-chain-select"
              data-testid="watch-only-chain-select"
              value={watchChainChoice}
              onChange={(e) => setWatchChainChoice(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            >
              <option value="auto">Auto (from prefix)</option>
              <option value={String(CHAIN_IDS.MAINNET)}>Mainnet (Chain 1)</option>
              <option value={String(CHAIN_IDS.TESTNET)}>Testnet (Chain 2)</option>
              <option value={String(CHAIN_IDS.DEVNET)}>Devnet (Chain 3)</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <button
              type="button"
              data-testid="watch-only-inspect-btn"
              onClick={handleInspectWatchOnly}
              className="w-full px-3 py-2 bg-gold/20 hover:bg-gold/30 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
            >
              Inspect
            </button>
          </div>
        </div>

        {watchError && (
          <div
            data-testid="watch-only-error"
            className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
          >
            {watchError}
          </div>
        )}

        {watchAccount && (
          <div
            data-testid="watch-only-result"
            className="bg-surface-2/80 border border-border rounded-lg p-3 flex flex-col gap-2 text-xs font-mono"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
                <span
                  data-testid="watch-only-badge"
                  className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-700/60 text-amber-300 font-semibold"
                >
                  READ-ONLY · canSign: {String(watchAccount.canSign)}
                </span>
                <span>
                  Network:{" "}
                  <strong data-testid="watch-only-network" className="text-gold uppercase">
                    {watchAccount.network}
                  </strong>
                </span>
                <span>
                  Chain ID:{" "}
                  <strong data-testid="watch-only-chain-id" className="text-fg">
                    {watchAccount.chainId}
                  </strong>
                </span>
                <span>
                  Format: <strong className="text-fg">{watchAccount.format}</strong>
                </span>
              </div>

              <button
                type="button"
                data-testid="watch-only-load-history-btn"
                onClick={() => setHistoryAddressInput(watchAccount.address)}
                className="px-2.5 py-1 text-xs bg-surface hover:bg-border rounded border border-border text-fg transition-colors"
              >
                Use in History Explorer
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-muted pt-1 border-t border-border/60">
              <div className="break-all">
                Mainnet: <span className="text-fg">{watchAccount.canonicalMainnet}</span>
              </div>
              <div className="break-all">
                Testnet: <span className="text-fg">{watchAccount.canonicalTestnet}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Account Tx History Explorer */}
      <div
        data-testid="tx-history-explorer-section"
        className="flex flex-col gap-3 border-t border-border pt-4"
      >
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
          Account Transaction History Explorer (<code>kovanica_getTransactionHistory</code>)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-5">
            <label
              htmlFor="tx-history-address-input"
              className="block text-xs font-medium text-muted mb-1"
            >
              History Target Address
            </label>
            <input
              id="tx-history-address-input"
              data-testid="tx-history-address-input"
              type="text"
              value={historyAddressInput}
              onChange={(e) => setHistoryAddressInput(e.target.value)}
              placeholder="kvnc...dag or tknc...dag"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
          </div>

          <div className="md:col-span-2">
            <label
              htmlFor="tx-history-direction-select"
              className="block text-xs font-medium text-muted mb-1"
            >
              Direction
            </label>
            <select
              id="tx-history-direction-select"
              data-testid="tx-history-direction-select"
              value={direction}
              onChange={(e) => setDirection(e.target.value as AccountTxDirection)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            >
              <option value="all">all</option>
              <option value="sent">sent</option>
              <option value="received">received</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label
              htmlFor="tx-history-limit-input"
              className="block text-xs font-medium text-muted mb-1"
            >
              Limit (1-{MAX_ACCOUNT_TX_HISTORY_LIMIT})
            </label>
            <input
              id="tx-history-limit-input"
              data-testid="tx-history-limit-input"
              type="number"
              min={1}
              max={MAX_ACCOUNT_TX_HISTORY_LIMIT}
              value={limitStr}
              onChange={(e) => setLimitStr(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
          </div>

          <div className="md:col-span-1">
            <label
              htmlFor="tx-history-max-pages-input"
              className="block text-xs font-medium text-muted mb-1"
            >
              Pages
            </label>
            <input
              id="tx-history-max-pages-input"
              data-testid="tx-history-max-pages-input"
              type="number"
              min={1}
              max={20}
              value={maxPagesStr}
              onChange={(e) => setMaxPagesStr(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="button"
              data-testid="tx-history-fetch-btn"
              disabled={isFetchingHistory}
              onClick={() => runHistoryFetch()}
              className="w-full px-3 py-2 bg-gold/20 hover:bg-gold/30 disabled:opacity-50 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
            >
              {isFetchingHistory ? "Loading..." : "Fetch History"}
            </button>
          </div>
        </div>

        {historyError && (
          <div
            data-testid="tx-history-error"
            className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
          >
            {historyError}
          </div>
        )}

        {historySummary && (
          <div data-testid="tx-history-result" className="flex flex-col gap-3 text-xs">
            <div
              data-testid="tx-history-pagination-status"
              className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center justify-between gap-2 text-muted"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  Loaded: <strong className="text-fg">{historySummary.items.length}</strong> tx(s)
                </span>
                <span>
                  Pages Fetched:{" "}
                  <strong className="text-fg">{historySummary.pagesFetched}</strong>
                </span>
                <span>
                  Direction:{" "}
                  <strong className="text-gold uppercase">{historySummary.direction}</strong>
                </span>
                <span>
                  Status:{" "}
                  <strong
                    data-testid="tx-history-has-more"
                    className={historySummary.hasMore ? "text-amber-300" : "text-emerald-400"}
                  >
                    {historySummary.hasMore ? "More pages available" : "End of history"}
                  </strong>
                </span>
                {historySummary.nextCursor && (
                  <span data-testid="tx-history-next-cursor">
                    Next Cursor: <strong className="text-fg">{historySummary.nextCursor}</strong>
                  </span>
                )}
              </div>

              {historySummary.hasMore && historySummary.nextCursor && (
                <button
                  type="button"
                  data-testid="tx-history-next-page-btn"
                  disabled={isFetchingHistory}
                  onClick={() => runHistoryFetch(historySummary.nextCursor ?? undefined)}
                  className="px-3 py-1 bg-gold/20 hover:bg-gold/30 disabled:opacity-50 rounded border border-gold/40 text-gold font-semibold transition-colors"
                >
                  {isFetchingHistory ? "Loading..." : "Load Next Page"}
                </button>
              )}
            </div>

            {historySummary.items.length === 0 ? (
              <div
                data-testid="tx-history-empty"
                className="bg-surface-2/50 border border-border rounded-lg p-4 text-center text-muted font-mono"
              >
                No transactions found for this account and direction filter.
              </div>
            ) : (
              <div
                data-testid="tx-history-list"
                className="flex flex-col gap-2 max-h-80 overflow-y-auto"
              >
                {historySummary.items.map((tx) => (
                  <div
                    key={`${tx.hash}-${tx.height}`}
                    data-testid="tx-history-row"
                    className="bg-surface-2 border border-border rounded-lg p-3 font-mono flex flex-col gap-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                            tx.status === "success"
                              ? "bg-emerald-950/60 text-emerald-300 border border-emerald-800/50"
                              : "bg-red-950/60 text-red-300 border border-red-800/50"
                          }`}
                        >
                          {tx.status}
                        </span>
                        <span className="text-gold uppercase text-[11px] font-semibold">
                          {tx.kind}
                        </span>
                        <span className="text-muted text-[11px]">Height #{tx.height}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[11px]">
                        <span className="text-fg">
                          Amount: <strong>{tx.amountKvnc} KVNC</strong>{" "}
                          <span className="text-muted">({tx.amountAtoms} atoms)</span>
                        </span>
                        <span className="text-muted">
                          Fee: <strong className="text-fg">{tx.feeKvnc} KVNC</strong>{" "}
                          <span>({tx.feeAtoms} atoms)</span>
                        </span>
                      </div>
                    </div>
                    <div className="text-[11px] text-muted break-all">
                      Hash: <span className="text-fg">{tx.hash}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-[11px] text-muted break-all">
                      <div>
                        From: <span className="text-fg">{tx.from}</span>
                      </div>
                      <div>
                        To: <span className="text-fg">{tx.to ?? "—"}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
