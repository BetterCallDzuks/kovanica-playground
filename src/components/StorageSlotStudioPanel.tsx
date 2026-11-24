import { useMemo, useState } from "react";
import { decodeAddress } from "kovanica-sdk";
import {
  bytesToHex,
  derivePrefixedStorageSlot,
  deriveStorageSlotHex,
  hexToBytes,
  readContractStorage,
  type ContractLogKind,
  type ContractStorageReadResult,
  type ContractStorageTarget,
  type ReadContractStorageClient,
  type StorageSlotContract,
} from "../wallet-interop";

export type SlotDeriverMode = "canonical" | "prefixed" | "raw";
export type PrefixedKeyEncoding = "utf8" | "hex" | "none";
export type StorageDecoderOption = "auto" | "none" | ContractLogKind;

export const CANONICAL_SLOT_CONTRACTS: ReadonlyArray<{
  value: StorageSlotContract;
  label: string;
  keyKind: "none" | "hex32" | "u64" | "utf8";
  keyPlaceholder?: string;
  keyHint?: string;
}> = [
  { value: "state", label: "state — blake3(\"kvnc/v1/state\")", keyKind: "none" },
  { value: "token", label: "token — blake3(\"kvnc/v1/state\")", keyKind: "none" },
  { value: "token_pool", label: "token_pool — blake3(\"kvnc/v1/pool\")", keyKind: "none" },
  {
    value: "token_lp",
    label: "token_lp — blake3(\"kvnc/v1/lp/\" || address32)",
    keyKind: "hex32",
    keyPlaceholder: "0x<64-hex> or kvnc...dag / tknc...dag",
    keyHint: "32-byte account pubkey hex or PRO-21 address",
  },
  { value: "nft", label: "nft — blake3(\"kvnc/v1/state\")", keyKind: "none" },
  { value: "multisig", label: "multisig — blake3(\"kvnc/v1/state\")", keyKind: "none" },
  {
    value: "multisig_tx",
    label: "multisig_tx — blake3(\"kvnc/v1/mtx/\" || u64le(txId))",
    keyKind: "u64",
    keyPlaceholder: "0",
    keyHint: "Non-negative u64 transaction ID",
  },
  {
    value: "htlc",
    label: "htlc — blake3(\"kvnc/v1/htlc/\" || swapId32)",
    keyKind: "hex32",
    keyPlaceholder: "0x<64-hex>",
    keyHint: "32-byte HTLC swap ID (64 hex chars)",
  },
  {
    value: "vault",
    label: "vault — blake3(\"kvnc/v1/vault/\" || vaultId32)",
    keyKind: "hex32",
    keyPlaceholder: "0x<64-hex>",
    keyHint: "32-byte Vault ID (64 hex chars)",
  },
  {
    value: "name",
    label: "name — blake3(\"kvnc/v1/name/\" || utf8(lowercaseName))",
    keyKind: "utf8",
    keyPlaceholder: "alice",
    keyHint: "UTF-8 registry name (normalized to lowercase)",
  },
  {
    value: "escrow",
    label: "escrow — blake3(\"kvnc/v1/escrow/\" || escrowId32)",
    keyKind: "hex32",
    keyPlaceholder: "0x<64-hex>",
    keyHint: "32-byte Escrow ID (64 hex chars)",
  },
];

export const STORAGE_DECODER_OPTIONS: ReadonlyArray<{
  value: StorageDecoderOption;
  label: string;
}> = [
  { value: "auto", label: "Auto (default for canonical kind)" },
  { value: "none", label: "None (raw hex only)" },
  { value: "name", label: "name — NameRecord" },
  { value: "token_metadata", label: "token_metadata — TokenMetadata" },
  { value: "nft_metadata", label: "nft_metadata — NftMetadata" },
  { value: "escrow", label: "escrow — EscrowRecord" },
  { value: "htlc", label: "htlc — HtlcRecord" },
  { value: "vault", label: "vault — VaultRecord" },
  { value: "multisig_state", label: "multisig_state — MultisigState" },
];

export interface StorageSlotStudioPanelProps {
  client: ReadContractStorageClient;
  defaultContractAddress?: string;
}

export type DerivedSlotOutcome =
  | {
      ok: true;
      slotHex: string;
      targetBase:
        | { kind: StorageSlotContract; key?: Uint8Array | string | bigint }
        | { prefix: string; key?: Uint8Array | string }
        | { slotHex: string };
    }
  | {
      ok: false;
      error: string;
    };

function safeFormatJson(data: unknown): string {
  if (data === undefined) return "undefined";
  return JSON.stringify(
    data,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
}

function normalize32ByteKey(raw: string): Uint8Array | string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("A 32-byte key (64 hex chars or PRO-21 address) is required");
  }
  if (/^(kvnc|tknc)[a-z0-9]+dag$/i.test(trimmed)) {
    return decodeAddress(trimmed);
  }
  const cleanHex = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
    throw new Error("Expected 64 hex characters (32 bytes) or a valid PRO-21 address");
  }
  return cleanHex.toLowerCase();
}

export function computeStorageSlotDerivation(params: {
  mode: SlotDeriverMode;
  canonicalContract: StorageSlotContract;
  canonicalKey: string;
  prefix: string;
  prefixedKeyEncoding: PrefixedKeyEncoding;
  prefixedKey: string;
  rawSlotHex: string;
}): DerivedSlotOutcome {
  try {
    if (params.mode === "canonical") {
      const meta =
        CANONICAL_SLOT_CONTRACTS.find((c) => c.value === params.canonicalContract) ??
        CANONICAL_SLOT_CONTRACTS[0];
      if (meta.keyKind === "none") {
        const hex = deriveStorageSlotHex(params.canonicalContract);
        return {
          ok: true,
          slotHex: `0x${hex}`,
          targetBase: { kind: params.canonicalContract },
        };
      }
      if (meta.keyKind === "utf8") {
        const keyStr = params.canonicalKey.trim();
        if (!keyStr) {
          return { ok: false, error: "UTF-8 key is required for this canonical contract slot" };
        }
        const hex = deriveStorageSlotHex(params.canonicalContract, keyStr);
        return {
          ok: true,
          slotHex: `0x${hex}`,
          targetBase: { kind: params.canonicalContract, key: keyStr },
        };
      }
      if (meta.keyKind === "u64") {
        const trimmed = params.canonicalKey.trim();
        if (!/^\d+$/.test(trimmed)) {
          return { ok: false, error: "Transaction ID must be a non-negative integer (u64)" };
        }
        const txId = BigInt(trimmed);
        const hex = deriveStorageSlotHex(params.canonicalContract, txId);
        return {
          ok: true,
          slotHex: `0x${hex}`,
          targetBase: { kind: params.canonicalContract, key: txId },
        };
      }
      // hex32
      const parsedKey = normalize32ByteKey(params.canonicalKey);
      const hex = deriveStorageSlotHex(params.canonicalContract, parsedKey);
      return {
        ok: true,
        slotHex: `0x${hex}`,
        targetBase: { kind: params.canonicalContract, key: parsedKey },
      };
    }

    if (params.mode === "prefixed") {
      if (params.prefix.length === 0) {
        return { ok: false, error: "Storage key prefix cannot be empty" };
      }
      if (params.prefixedKeyEncoding === "none") {
        const bytes = derivePrefixedStorageSlot(params.prefix);
        return {
          ok: true,
          slotHex: `0x${bytesToHex(bytes)}`,
          targetBase: { prefix: params.prefix },
        };
      }
      if (params.prefixedKeyEncoding === "utf8") {
        const bytes = derivePrefixedStorageSlot(params.prefix, params.prefixedKey);
        return {
          ok: true,
          slotHex: `0x${bytesToHex(bytes)}`,
          targetBase: { prefix: params.prefix, key: params.prefixedKey },
        };
      }
      // hex mapping key
      const trimmedHex = params.prefixedKey.trim();
      const cleanHex =
        trimmedHex.startsWith("0x") || trimmedHex.startsWith("0X")
          ? trimmedHex.slice(2)
          : trimmedHex;
      if (cleanHex.length === 0 || cleanHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(cleanHex)) {
        return { ok: false, error: "Hex mapping key must be a non-empty even-length hex string" };
      }
      const keyBytes = hexToBytes(cleanHex);
      const bytes = derivePrefixedStorageSlot(params.prefix, keyBytes);
      return {
        ok: true,
        slotHex: `0x${bytesToHex(bytes)}`,
        targetBase: { prefix: params.prefix, key: keyBytes },
      };
    }

    // Raw 32-byte hex slot
    const trimmedRaw = params.rawSlotHex.trim();
    const cleanRaw =
      trimmedRaw.startsWith("0x") || trimmedRaw.startsWith("0X")
        ? trimmedRaw.slice(2)
        : trimmedRaw;
    if (!/^[0-9a-fA-F]{64}$/.test(cleanRaw)) {
      return {
        ok: false,
        error: "Raw storage slot must be exactly 32 bytes (64 hex characters, optional 0x prefix)",
      };
    }
    const normalized = `0x${cleanRaw.toLowerCase()}`;
    return {
      ok: true,
      slotHex: normalized,
      targetBase: { slotHex: normalized },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function StorageSlotStudioPanel({
  client,
  defaultContractAddress,
}: StorageSlotStudioPanelProps) {
  const [mode, setMode] = useState<SlotDeriverMode>("canonical");
  const [canonicalContract, setCanonicalContract] = useState<StorageSlotContract>("name");
  const [canonicalKey, setCanonicalKey] = useState<string>("alice");
  const [prefix, setPrefix] = useState<string>("kvnc/v1/name/");
  const [prefixedKeyEncoding, setPrefixedKeyEncoding] = useState<PrefixedKeyEncoding>("utf8");
  const [prefixedKey, setPrefixedKey] = useState<string>("alice");
  const [rawSlotHex, setRawSlotHex] = useState<string>("0x" + "00".repeat(32));

  const [contractAddress, setContractAddress] = useState<string>(defaultContractAddress ?? "");
  const [decoderOption, setDecoderOption] = useState<StorageDecoderOption>("auto");
  const [isReading, setIsReading] = useState<boolean>(false);
  const [readResult, setReadResult] = useState<ContractStorageReadResult<unknown> | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [copiedSlot, setCopiedSlot] = useState<boolean>(false);

  const canonicalMeta = useMemo(
    () =>
      CANONICAL_SLOT_CONTRACTS.find((c) => c.value === canonicalContract) ??
      CANONICAL_SLOT_CONTRACTS[0],
    [canonicalContract],
  );

  const derivation = useMemo(
    () =>
      computeStorageSlotDerivation({
        mode,
        canonicalContract,
        canonicalKey,
        prefix,
        prefixedKeyEncoding,
        prefixedKey,
        rawSlotHex,
      }),
    [mode, canonicalContract, canonicalKey, prefix, prefixedKeyEncoding, prefixedKey, rawSlotHex],
  );

  const handleCopySlot = () => {
    if (!derivation.ok) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(derivation.slotHex);
    }
    setCopiedSlot(true);
    setTimeout(() => setCopiedSlot(false), 1800);
  };

  const handleReadStorage = async () => {
    setReadError(null);
    setReadResult(null);

    if (!derivation.ok) {
      setReadError(derivation.error);
      return;
    }

    const trimmedContract = contractAddress.trim();
    if (!trimmedContract) {
      setReadError("Contract address is required to query kovanica_getStorageAt");
      return;
    }

    let target: ContractStorageTarget<unknown>;
    if (decoderOption === "none") {
      target = { slotHex: derivation.slotHex };
    } else if (decoderOption === "auto") {
      target = derivation.targetBase;
    } else {
      target = { ...derivation.targetBase, decoder: decoderOption };
    }

    setIsReading(true);
    try {
      const result = await readContractStorage(client, trimmedContract, target);
      setReadResult(result);
    } catch (err: unknown) {
      setReadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsReading(false);
    }
  };

  return (
    <div
      data-testid="storage-slot-studio-panel"
      className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">
            Storage Slot Deriver Studio (BLAKE3 &amp; Live <code className="font-mono text-gold">getStorageAt</code>)
          </h2>
          <p className="text-xs text-muted">
            Derive canonical Wasmi contract slots via <code className="font-mono text-fg">deriveStorageSlotHex</code>,
            prefixed UTF-8 / raw hex mapping keys, and optionally read live state via{" "}
            <code className="font-mono text-fg">readContractStorage</code>.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {(
            [
              { id: "canonical", label: "Canonical Slot" },
              { id: "prefixed", label: "Prefixed Mapping" },
              { id: "raw", label: "Raw Hex Slot" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-testid={`storage-slot-mode-${tab.id}`}
              onClick={() => {
                setMode(tab.id);
                setReadResult(null);
                setReadError(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                mode === tab.id
                  ? "bg-gold text-bg font-semibold"
                  : "bg-surface-2 text-muted hover:text-fg border border-border"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mode Inputs */}
      {mode === "canonical" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="storage-slot-canonical-contract"
              className="text-xs font-medium text-muted"
            >
              Canonical Contract Slot
            </label>
            <select
              id="storage-slot-canonical-contract"
              data-testid="storage-slot-canonical-contract"
              value={canonicalContract}
              onChange={(e) => {
                setCanonicalContract(e.target.value as StorageSlotContract);
                setReadResult(null);
                setReadError(null);
              }}
              className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            >
              {CANONICAL_SLOT_CONTRACTS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          {canonicalMeta.keyKind !== "none" && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="storage-slot-canonical-key"
                className="text-xs font-medium text-muted"
              >
                Mapping Key ({canonicalMeta.keyKind})
              </label>
              <input
                id="storage-slot-canonical-key"
                data-testid="storage-slot-canonical-key"
                type="text"
                value={canonicalKey}
                onChange={(e) => setCanonicalKey(e.target.value)}
                placeholder={canonicalMeta.keyPlaceholder}
                className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
              {canonicalMeta.keyHint && (
                <span className="text-[11px] text-muted">{canonicalMeta.keyHint}</span>
              )}
            </div>
          )}
        </div>
      )}

      {mode === "prefixed" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="storage-slot-prefix-input" className="text-xs font-medium text-muted">
              UTF-8 Prefix
            </label>
            <input
              id="storage-slot-prefix-input"
              data-testid="storage-slot-prefix-input"
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="kvnc/v1/name/"
              className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="storage-slot-key-encoding-select"
              className="text-xs font-medium text-muted"
            >
              Key Encoding
            </label>
            <select
              id="storage-slot-key-encoding-select"
              data-testid="storage-slot-key-encoding-select"
              value={prefixedKeyEncoding}
              onChange={(e) => setPrefixedKeyEncoding(e.target.value as PrefixedKeyEncoding)}
              className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            >
              <option value="utf8">UTF-8 string</option>
              <option value="hex">Raw hex bytes</option>
              <option value="none">Prefix only (no key)</option>
            </select>
          </div>

          {prefixedKeyEncoding !== "none" && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="storage-slot-prefixed-key-input"
                className="text-xs font-medium text-muted"
              >
                Key Value ({prefixedKeyEncoding})
              </label>
              <input
                id="storage-slot-prefixed-key-input"
                data-testid="storage-slot-prefixed-key-input"
                type="text"
                value={prefixedKey}
                onChange={(e) => setPrefixedKey(e.target.value)}
                placeholder={prefixedKeyEncoding === "hex" ? "0xdeadbeef..." : "alice"}
                className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>
          )}
        </div>
      )}

      {mode === "raw" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="storage-slot-raw-hex-input" className="text-xs font-medium text-muted">
            Raw 32-Byte Storage Slot Hex
          </label>
          <input
            id="storage-slot-raw-hex-input"
            data-testid="storage-slot-raw-hex-input"
            type="text"
            value={rawSlotHex}
            onChange={(e) => setRawSlotHex(e.target.value)}
            placeholder="0x0000... (64 hex chars)"
            className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />
        </div>
      )}

      {/* Derived Slot Output */}
      {derivation.ok ? (
        <div className="bg-surface-2/80 border border-border rounded-lg p-3.5 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">
              Derived 32-Byte Storage Slot Hex
            </span>
            <button
              type="button"
              data-testid="storage-slot-copy-btn"
              onClick={handleCopySlot}
              className="px-2.5 py-1 rounded bg-surface hover:bg-border border border-border text-[11px] text-muted hover:text-fg transition-colors"
            >
              {copiedSlot ? "Copied!" : "Copy Slot Hex"}
            </button>
          </div>
          <code
            data-testid="storage-slot-derived-hex"
            className="text-xs font-mono text-gold break-all"
          >
            {derivation.slotHex}
          </code>
        </div>
      ) : (
        <div
          data-testid="storage-slot-derive-error"
          className="bg-amber-950/40 border border-amber-700/50 rounded-lg p-3 text-xs font-mono text-amber-200"
        >
          {derivation.error}
        </div>
      )}

      {/* Live readContractStorage / kovanica_getStorageAt Controls */}
      <div className="border-t border-border/70 pt-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-6 flex flex-col gap-1">
            <label
              htmlFor="storage-slot-contract-address"
              className="text-xs font-medium text-muted"
            >
              Contract Address (for live <code className="font-mono text-fg">kovanica_getStorageAt</code>)
            </label>
            <input
              id="storage-slot-contract-address"
              data-testid="storage-slot-contract-address"
              type="text"
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value)}
              placeholder="kvnc...dag or tknc...dag"
              className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
          </div>

          <div className="md:col-span-4 flex flex-col gap-1">
            <label htmlFor="storage-slot-decoder-select" className="text-xs font-medium text-muted">
              Bincode Decoder
            </label>
            <select
              id="storage-slot-decoder-select"
              data-testid="storage-slot-decoder-select"
              value={decoderOption}
              onChange={(e) => setDecoderOption(e.target.value as StorageDecoderOption)}
              className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            >
              {STORAGE_DECODER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <button
              type="button"
              data-testid="storage-slot-read-btn"
              onClick={handleReadStorage}
              disabled={isReading || !derivation.ok}
              className="w-full px-4 py-2 bg-gold hover:bg-gold/90 text-bg font-semibold rounded-lg text-xs transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {isReading ? "Reading..." : "Read Storage"}
            </button>
          </div>
        </div>

        {readError && (
          <div
            data-testid="storage-slot-read-error"
            className="bg-red-950/40 border border-red-700/50 rounded-lg p-3 text-xs font-mono text-red-200 break-all"
          >
            {readError}
          </div>
        )}

        {readResult && (
          <div
            data-testid="storage-slot-read-result"
            className="bg-surface-2/80 border border-border rounded-lg p-4 flex flex-col gap-3 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-fg">Storage Read Result</span>
                <span
                  data-testid="storage-slot-empty-badge"
                  className={`px-2 py-0.5 rounded font-mono text-[11px] border ${
                    readResult.isEmpty
                      ? "bg-surface border-border text-muted"
                      : "bg-emerald-950/60 border-emerald-700/50 text-emerald-300"
                  }`}
                >
                  {readResult.isEmpty ? "Empty Slot" : `Populated (${readResult.rawBytes.length}B)`}
                </span>
              </div>
              <span className="font-mono text-[11px] text-muted">
                Contract: {readResult.contract}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-muted">Raw Storage Value Hex</span>
              <code
                data-testid="storage-slot-raw-value"
                className="bg-surface p-2.5 rounded border border-border/60 font-mono text-fg break-all"
              >
                {readResult.rawHex}
              </code>
            </div>

            {readResult.decoded !== undefined && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-emerald-300 font-medium">
                  Decoded Bincode Record
                </span>
                <pre
                  data-testid="storage-slot-decoded-value"
                  className="bg-emerald-950/20 p-3 rounded border border-emerald-800/40 font-mono text-emerald-200 overflow-x-auto"
                >
                  {safeFormatJson(readResult.decoded)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
