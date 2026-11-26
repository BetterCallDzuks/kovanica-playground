# kovanica-playground

A lightweight, accessible developer console and read-only JSON-RPC explorer for the **Kovanica (KVNC)** Layer-1 blockchain, powered by `kovanica-sdk`.

> [!IMPORTANT]
> **Developer Console Boundaries:**
> - This is a specialized developer console and RPC explorer, **not** a replacement for `kovanica-web`'s block explorer, staking UI, or wallet application.
> - **Zero Private Key Handling:** This console does not import seed phrases, hold keys, sign transactions, claim faucet tokens, or submit mining solutions.
> - **Direct Browser Connectivity:** All RPC requests are dispatched directly from your browser without an intermediary server-side proxy.

---

## Visual DNA

Kovanica Playground reflects the established Kovanica design system:
- **Backgrounds:** Deep dark zinc (`#09090b` canvas, `#121214` card surface, `#1a1a1e` elevated surface, `#2a2a30` border).
- **Accents:** Restrained Kovanica Gold (`#F2A900`).
- **Typography:** IBM Plex Sans / Inter system font for crisp readability and IBM Plex Mono for addresses, hashes, and integer quantities.

---

## Features

1. **Network & Endpoint Selector & Ecosystem Switcher:**
   - Choose between the canonical Kovanica networks: Mainnet (`1`, official network tag `1-f35df34c92001436`), Testnet (`2`, official network tag `2-24cdb5fadd98b207`), and Devnet (`3`).
   - Configurable RPC URL (defaults to local loopback node `http://127.0.0.1:8545/rpc`) with 1-click presets (`Testnet RPC` -> `https://rpc-testnet.kovanica.online/rpc`, `Mainnet RPC (Read-Only)` -> `https://rpc.kovanica.online/rpc`, and `Local 127.0.0.1:8545` -> `http://127.0.0.1:8545/rpc`).
   - Header and footer **Ecosystem Switcher** linking to `kovanica.online`, `testnet.kovanica.online`, Explorer, Wallet, Swap & Pools, RWA, and Docs.
   - **Chain Mismatch Warning:** Alerts the developer immediately if the connected node reports a Chain ID that does not match the active target network.
   - **Honest Connectivity Diagnostics:** Surfaces detailed connection failure diagnostics explaining possible root causes (node offline, port closed, network unreachable, CORS) without falsely claiming CORS is confirmed without evidence.

2. **Allowlisted Read-Only RPC Method Explorer:**
   - Category filtering across Chain, Account, Transaction, Staking, Diagnostics, and Mining.
   - Dynamic parameter forms with live chain-aware validation (enforcing canonical 64-character PRO-21 base32 address format `kvnc...dag` strictly on Mainnet (1) and Testnet (2), while allowing legacy hex on Devnet (3)).
   - Formatted request payload, response payload, and millisecond execution timer.
   - Cancellation support via `AbortController`.

3. **Node Diagnostics & Hybrid PoW (Chains 1 & 2) Panels:**
   - Distinct node synchronization states: **Catching Up**, **Synced** (SDK-confirmed), **Unknown** (indeterminate/unconfirmed), and **Connection Error**. A successful RPC response alone is not treated as proof of synchronization.
   - Preserves explicit zeros (`0`, `0n`) and full 64-bit integer precision (`bigint`). Missing or uninitialized quantities render clearly as `—` rather than misleading zeros.
   - Dedicated Hybrid PoW & DAG panel for Mainnet (Chain 1) and Testnet (Chain 2) displaying target block time (4000 ms), GHOSTDAG K (5), mining difficulty, target bits, and active DAG tips. Shows clear fallback notice on non-hybrid development chain (Devnet Chain 3).

4. **Resource-Conscious Polling & Endpoint Isolation:**
   - Listens to `document.visibilityState`: pauses background polling whenever the browser tab is hidden or minimized, resuming immediately upon returning.
   - Aborts in-flight requests when switching methods or endpoints.
   - Instantly clears stale network and mining diagnostics upon endpoint change, and discards delayed in-flight responses from prior endpoints.

5. **Interactive Developer Studios (`kovanica-sdk v0.10.0`):**
   - **4-Group Wallet & Contracts Workspace:** Reorganized into four persistent sub-tabs with quick-jump tool rails:
     1. **HD Wallet & Signer:** Ephemeral SLIP-0010 HD Wallet, Native Transfer Signing Console, Universal Tx Auto-Decoder & Air-Gap Envelope (`kvnc-tx:v1:`) Studio, and Mempool Fee-Tier Estimator.
     2. **Contracts & Codegen:** Wasmi Contract Call Builder + Multi-Call Batch Estimator + cURL/SDK Code Exporter + JSON Presets, and Typed Contract Facades Studio across all 7 canonical clients (`NameRegistryClient`, `TokenClient`, `EscrowClient`, `HtlcClient`, `NftClient`, `VaultClient`, `MultisigClient`).
     3. **Storage & Logs:** Storage Slot Deriver Studio (`deriveStorageSlotHex` & `derivePrefixedStorageSlot`), Contract State Bincode Decoder & Live Storage Slot Fetcher (`kovanica_getStorageAt`), Paginated Contract Logs Explorer (`queryContractLogsPaginated`, `parseContractLogCursor`, `formatContractLogCursor`), and Chunked Contract Log History Explorer (`getContractLogHistory`).
     4. **Verification & Diagnostics:** Raw Wire Tx Decoder & Node Capability Probe, Failover RPC Endpoint Probe (`FailoverHttpTransport`), Address Inspector & Transfer Tx Verifier, Transaction Receipt Poller & Log Decoder, JSON-RPC 2.0 Batch Read Runner, Account History & Watch-Only Inspector, Fee Tiers & Multisig Quorum Inspector, and Golden Vector & Consensus Invariant Runner.
   - **Wave A–D, Native AMM & KVP-106 RWA Studio:** Simulates atomic 1-tx RWA creation batches, EIP-1559 base fee transitions, WebAuthn passkeys, scheduler jobs, bridge initialization, AMM swap quotes/batches, and KVP-106 allowlist/dividend compliance.
   - **KVP-103 Stealth Studio:** Interactive dual-key Ed25519 ECDH stealth workbench powered directly by `kovanica-sdk v0.10.0` (generate/import/mnemonic `st:kvnc:...` meta-addresses, sender one-time derivation, watch-only announcement scanning, one-time spend scalar recovery & RFC 8032 signature self-check).
   - **Inline WS Bincode Log Decoder & Live Block+Receipt Streamer:** Live WebSocket subscription console (`KovanicaWsClient`) with inline Bincode contract event decoding, plus `subscribeNewBlocksWithReceipts` streaming with configurable `maxQueueSize` backpressure cap, receipt status summaries, and `droppedCount` telemetry.

---

## Tested SDK Revision & Immutable Resolution

`kovanica-playground` consumes `kovanica-sdk` at the pinned, immutable git revision [`dbffb2509137d96d898e9edadb90ddc1d7ec6c63`](https://github.com/BetterCallDzuks/kovanica-sdk/commit/dbffb2509137d96d898e9edadb90ddc1d7ec6c63):

- **Manifest Metadata (`package.json`):** Recorded in `kovanicaSdk.testedRevision` (`dbffb2509137d96d898e9edadb90ddc1d7ec6c63`) and linked via `"kovanica-sdk": "file:../kovanica-sdk"` in `package.json` and `package-lock.json`.
- **Automated Verification (`scripts/prepare-sdk.mjs`):** Running `npm run prepare:sdk` (also invoked automatically during `npm run build`) verifies that `../kovanica-sdk` exists, is checked out at the exact pinned 40-character SHA `dbffb2509137d96d898e9edadb90ddc1d7ec6c63` (never following a moving `main`), and has compiled `dist/index.js`. If `../kovanica-sdk` is on a different branch or dirty, it materializes the pinned revision into `node_modules/kovanica-sdk` from an isolated worktree without modifying the sibling checkout.
- **CI Enforcement (`.github/workflows/ci.yml` & `tests/methods.test.ts`):** GitHub Actions explicitly checks out `BetterCallDzuks/kovanica-sdk` at `ref: dbffb2509137d96d898e9edadb90ddc1d7ec6c63`, and unit tests assert that `package.json`, `.github/workflows/ci.yml`, and the resolved `node_modules/kovanica-sdk` match this SHA.

---

## Local Integration & Build Workflow

```bash
# 1. Verify/clone and build ../kovanica-sdk at pinned SHA dbffb2509137d96d898e9edadb90ddc1d7ec6c63
npm run prepare:sdk

# 2. Install playground dependencies cleanly from lockfile
npm ci

# 3. Install headless Chromium for browser acceptance tests
npx playwright install chromium

# 4. Run typecheck, lint, production build, and test suites
npm run typecheck
npm run lint
npm run build
npm test
npm run test:browser
```

---

## Testing & Verification Modes (Offline, Browser Fixtures, Optional Live, Required Live)

Verification is separated into four explicit, non-conflated layers:

1. **Deterministic Offline Unit & Browser Fixture Tests (`npm test` / `npm run test:browser`):**
   - `tests/methods.test.ts`, `tests/diagnostics-ui.test.tsx`, `tests/live-readiness-modes.test.ts`: SDK pin verification, allowlist checks, and JSDOM regressions.
   - `tests/browser-rpc.test.ts`: Serves the production `dist/` bundle over an ephemeral local HTTP server and drives real Headless Chromium via Playwright with deterministic JSON-RPC route fixtures covering:
     - Genesis / zero-peer state (`0` preserved, badge `Unknown`, availability is not sync)
     - Populated state and lossless `u64::MAX` (`18446744073709551615`) rendering
     - Unknown / missing fields (`—` and `Unknown`, never coerced to `0` or `No`)
     - Nonzero reported `committedHeight` with `0` peers (`Unknown` sync state; reported height is not treated as executed-state evidence)
     - Actively catching-up state (`Catching Up`, `Active`, `behindBy` rounds)
     - Malformed HTTP 200 payloads, JSON-RPC errors, unsupported methods (`-32601`), and unreachable endpoints (honest failure banner without claiming CORS without evidence)
     - Endpoint switch race conditions (delayed Endpoint A cannot overwrite newer Endpoint B), overlapping refreshes, late errors after newer successes, in-flight cancellation, and method-switch abort cleanup
     - Hidden-tab polling pause and visible-tab resume without multiplying intervals
     - Keyboard navigation (`Tab` / `Enter`)

2. **Default / Optional Live Mode (`npm run test:live` / `npm run test:browser:live`):**
   - Connects to `KOVANICA_RPC_URL` (or `LIVE_RPC_URL`, defaulting to `http://127.0.0.1:8545/rpc`).
   - When the live node prerequisite is unavailable, produces a **genuine test skip** (`[skipped]`), separately reported from passing assertions.

3. **Required-Live Mode (`npm run test:live:required` / `npm run test:browser:live:required`):**
   - Enforces live verification (`KOVANICA_REQUIRE_LIVE=1`).
   - Verifies genuine JSON-RPC 2.0 readiness (HTTP 200 alone is insufficient; unreachable endpoints, invalid HTML/JSON payloads, or RPC error objects produce a non-zero exit code).
   - Separates **Basic Read-Only Interoperability** (works on valid genesis / 0-peer nodes) from **Stronger Synced Acceptance** (`committedHeight > 0n`, `peerCount > 0`, `catchingUp === false`, `isNodeSynced(status) === true`).

```bash
# Run deterministic unit + headless Chromium browser fixture tests
npm test
npm run test:browser

# Run optional live RPC & live browser verification (skips if node is unavailable)
npm run test:live
npm run test:browser:live

# Enforce required-live verification (fails with non-zero exit if unavailable or unsynced)
npm run test:live:required
npm run test:browser:live:required
```

---

## Chain-ID Inventory

See [`docs/chain-id-inventory.md`](docs/chain-id-inventory.md) for the complete inventory of canonical chain-ID definitions (`1` Mainnet with frozen network tag `1-f35df34c92001436`, `2` Testnet with frozen network tag `2-24cdb5fadd98b207`, and `3` Devnet) across `kovanica-playground`, `kovanica-sdk`, and L1.

---

## CI / Clean Checkout Workflow

In CI or isolated environments, the SDK is checked out at the exact pinned revision before building:

```bash
git clone https://github.com/BetterCallDzuks/kovanica-sdk.git
cd kovanica-sdk
git checkout dbffb2509137d96d898e9edadb90ddc1d7ec6c63
npm ci
npm run build

cd ..
git clone https://github.com/BetterCallDzuks/kovanica-playground.git
cd kovanica-playground
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

---

## KVP & RFC Standards Reference

> The `001`–`008` numbers belong to the companion **`RFC-001`–`RFC-008`** specs (ordered sequentially below); protocol proposals use **`KVP-101`–`KVP-106`** (plus **`KVP-20`** and **`PRO-21`**).

| RFC | KVP | Name | Purpose |
| :--- | :--- | :--- | :--- |
| **`RFC-001`** | `KVP-101` | Multisig Wallets | M-of-N shared custody & spend proposals (`MultisigClient`) |
| **`RFC-002`** | `KVP-102` | Native Multi-Asset Tokens | On-chain fungible tokens, balances, transfers & AMM pools (`TokenClient`) |
| **`RFC-003`** | `KVP-103` | Stealth Addresses | Privacy-preserving one-time stealth addresses |
| **`RFC-004`** | `KVP-104` | HTLC Atomic Swaps | Hash Time-Locked Contracts (`HtlcClient`) |
| **`RFC-005`** | `KVP-105` | Time-Lock Vaults | CLTV / CSV vaults & treasury vesting (`VaultClient`) |
| **`RFC-006`** | — | Fee Floor & Wave B Base Fee | Atoms/byte fee floor + EIP-1559 dynamic base fee |
| **`RFC-007`** | `KVP-106` | Real-World Assets (RWA) & Native NFTs | Institutional RWA (`WaveARwaStudio`, allowlist/freeze/coupons) & Native NFTs (`NftClient`) |
| **`RFC-008`** | — | On-Chain Name Registry | Human-readable name resolution (`NameRegistryClient`; no KVP #) |
| — | **`KVP-20`** | Fungible Contract Token | Standard `approve`/`transfer`/`transfer_from` interface for AMM DEX & bridge tokens |
| — | **`PRO-21`** | Canonical Address Format | 64-char `kvnc…dag` (Ed25519 + 29-bit BLAKE3 checksum) |

---

## Ecosystem Repositories

| Repository | Role |
| :--- | :--- |
| **[BetterCallDzuks/kovanica-l1](https://github.com/BetterCallDzuks/kovanica-l1)** | Rust Layer-1 node, Hybrid PoW + GHOSTDAG consensus, Wasmi runtime, RPC, Stratum, Faucet, Indexer, Lightnode & CLI |
| **[BetterCallDzuks/kovanica-sdk](https://github.com/BetterCallDzuks/kovanica-sdk)** | Official TypeScript SDK (`v0.10.0`) — browser & Node.js client, failover transport, facades, offline codecs, paginated log streamer, air-gap envelopes, Wave A–D / AMM / RWA helpers & WS block+receipt streaming |
| **[BetterCallDzuks/kovanica-web](https://github.com/BetterCallDzuks/kovanica-web)** | Public site, BlockDAG Explorer, AMM DEX, RWA Portal, Mining Pool, Faucet, API Reference & Pricing (`kovanica.online`) |
| **[BetterCallDzuks/kovanica-apps](https://github.com/BetterCallDzuks/kovanica-apps)** | Client apps — `wallet-web`, `browser-extension` (MV3), `console-desktop`, `node-desktop`, `desktop`, Android & iOS |
| **[BetterCallDzuks/kovanica-playground](https://github.com/BetterCallDzuks/kovanica-playground)** | Interactive developer RPC console & `kovanica-sdk v0.10.0` developer studios |
| **[BetterCallDzuks/Kovanica-Vault](https://github.com/BetterCallDzuks/Kovanica-Vault)** | Interactive Obsidian Vault presentation (Canvases, Bubble Graph, Pitch Deck & Standards Registry) |

---

## License

MIT License (`LICENSE`).
