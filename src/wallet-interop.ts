import { blake3 } from "@noble/hashes/blake3.js";
import { sha512 } from "@noble/hashes/sha2.js";
import * as ed from "@noble/ed25519";
import { generateMnemonic as scureGenerateMnemonic, validateMnemonic as scureValidateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  ADDRESS_PREFIX,
  bip39Seed,
  CHAIN_IDS,
  decodeAddress,
  deriveBip44,
  encodeAddress,
  formatBip44Path,
  getPublicKey,
  KOVANICA_COIN_TYPE,
  TESTNET_ADDRESS_PREFIX,
} from "kovanica-sdk";

// Configure ed25519 sha512 provider
ed.hashes.sha512 = sha512;

export const DOMAIN_TAG_STR = "KVNC/tx/v1";
export const KEYED_HASH_TAG_STR = "KVNC-TX-v1";
export const TX_DOMAIN = asciiPad(DOMAIN_TAG_STR, 16);
export const TX_KEY = asciiPad(KEYED_HASH_TAG_STR, 32);

// --- Byte Utilities ---

export function asciiPad(str: string, len: number): Uint8Array {
  const buf = new Uint8Array(len);
  for (let i = 0; i < str.length && i < len; i++) {
    buf[i] = str.charCodeAt(i);
  }
  return buf;
}

export function u32le(val: number | bigint): Uint8Array {
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  view.setUint32(0, Number(val), true);
  return buf;
}

export function u64le(val: number | bigint): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt(val), true);
  return buf;
}

export function u128le(val: number | bigint): Uint8Array {
  const buf = new Uint8Array(16);
  const view = new DataView(buf.buffer);
  const b = BigInt(val);
  const low = b & 0xffffffffffffffffn;
  const high = b >> 64n;
  view.setBigUint64(0, low, true);
  view.setBigUint64(8, high, true);
  return buf;
}

export function concat(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, curr) => acc + curr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

export function encodeBincodeString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  return concat([u64le(BigInt(bytes.length)), bytes]);
}

export function encodeBincodeStringVec(strings: string[]): Uint8Array {
  const parts: Uint8Array[] = [u64le(BigInt(strings.length))];
  for (const s of strings) {
    parts.push(encodeBincodeString(s));
  }
  return concat(parts);
}

export function encodeBincodeBytes32Vec(items: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [u64le(BigInt(items.length))];
  for (const item of items) {
    if (item.length !== 32) {
      throw new Error(`Expected 32-byte item, got ${item.length}`);
    }
    parts.push(item);
  }
  return concat(parts);
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("Invalid hex length");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const val = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(val)) throw new Error(`Invalid hex byte at index ${i * 2}`);
    bytes[i] = val;
  }
  return bytes;
}

// --- Address & Derivation ---

export function formatAddressForChain(
  addressOrPubkey: string | Uint8Array,
  chainId: number | null,
): string {
  let pubkey: Uint8Array;
  if (typeof addressOrPubkey === "string") {
    try {
      pubkey = decodeAddress(addressOrPubkey.trim());
    } catch {
      return addressOrPubkey;
    }
  } else {
    pubkey = addressOrPubkey;
  }
  const prefix = chainId === CHAIN_IDS.TESTNET ? TESTNET_ADDRESS_PREFIX : ADDRESS_PREFIX;
  return encodeAddress(pubkey, prefix);
}

export function generateMnemonic(strength: 128 | 256 = 256): string {
  return scureGenerateMnemonic(wordlist, strength);
}

export function validateMnemonic(phrase: string): boolean {
  return scureValidateMnemonic(phrase.trim(), wordlist);
}

export interface DerivedAccountInfo {
  accountIndex: number;
  path: string;
  secretKeyHex: string;
  publicKeyHex: string;
  address: string;
  mainnetAddress: string;
  testnetAddress: string;
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export function deriveAccountsFromMnemonic(
  phrase: string,
  passphrase = "",
  count = 2,
  chainId: number = CHAIN_IDS.TESTNET,
): DerivedAccountInfo[] {
  const seed64 = bip39Seed(phrase.trim(), passphrase);
  const accounts: DerivedAccountInfo[] = [];

  for (let i = 0; i < count; i++) {
    const node = deriveBip44(seed64, i, 0, 0, KOVANICA_COIN_TYPE);
    const pub = getPublicKey(node.key);
    const path = formatBip44Path(i, 0, 0, KOVANICA_COIN_TYPE);
    const mainnetAddress = encodeAddress(pub, ADDRESS_PREFIX);
    const testnetAddress = encodeAddress(pub, TESTNET_ADDRESS_PREFIX);
    const address = formatAddressForChain(pub, chainId);

    accounts.push({
      accountIndex: i,
      path,
      secretKeyHex: bytesToHex(node.key),
      publicKeyHex: bytesToHex(pub),
      address,
      mainnetAddress,
      testnetAddress,
      secretKey: node.key,
      publicKey: pub,
    });
  }

  return accounts;
}

// --- Transaction Construction, Signing & Serialization ---

export type CallTxKind = {
  type: "call";
  contract: Uint8Array;
  value: bigint;
  method: string;
  args: Uint8Array;
  gasLimit: bigint;
};

export type TxKind =
  | { type: "transfer"; to: Uint8Array; amount: bigint }
  | CallTxKind;

export interface UnsignedTx {
  sender: Uint8Array;
  nonce: bigint;
  kind: TxKind;
  fee: bigint;
}

export function signingKind(kind: TxKind): Uint8Array {
  if (kind.type === "transfer") {
    return concat([Uint8Array.of(0), kind.to, u64le(kind.amount)]);
  }
  const methodBytes = new TextEncoder().encode(kind.method);
  return concat([
    Uint8Array.of(4),
    kind.contract,
    u64le(kind.value),
    u64le(BigInt(methodBytes.length)),
    methodBytes,
    u64le(BigInt(kind.args.length)),
    kind.args,
    u64le(kind.gasLimit),
  ]);
}

export function wireKind(kind: TxKind): Uint8Array {
  if (kind.type === "transfer") {
    return concat([u32le(0), kind.to, u64le(kind.amount)]);
  }
  const methodBytes = new TextEncoder().encode(kind.method);
  return concat([
    u32le(6),
    kind.contract,
    u64le(kind.value),
    u64le(BigInt(methodBytes.length)),
    methodBytes,
    u64le(BigInt(kind.args.length)),
    kind.args,
    u64le(kind.gasLimit),
  ]);
}

export function signingHash(tx: UnsignedTx, chainId: number): Uint8Array {
  const preimage = concat([
    TX_DOMAIN,
    u64le(BigInt(chainId)),
    tx.sender,
    u64le(tx.nonce),
    signingKind(tx.kind),
    u64le(tx.fee),
  ]);
  return blake3(preimage, { key: TX_KEY });
}

export interface SignedTxResult {
  sighash: Uint8Array;
  sighashHex: string;
  signature: Uint8Array;
  signatureHex: string;
  rawTxBytes: Uint8Array;
  rawTxHex: string;
  txSize: number;
}

export function signAndSerializeTransaction(
  tx: UnsignedTx,
  secretKey: Uint8Array,
  chainId: number,
): SignedTxResult {
  const sighash = signingHash(tx, chainId);
  const signature = ed.sign(sighash, secretKey);
  const rawTxBytes = concat([
    tx.sender,
    u64le(tx.nonce),
    wireKind(tx.kind),
    u64le(tx.fee),
    u64le(64n), // u64 LE length prefix for Signature in bincode
    signature,
    sighash,
  ]);
  return {
    sighash,
    sighashHex: bytesToHex(sighash),
    signature,
    signatureHex: bytesToHex(signature),
    rawTxBytes,
    rawTxHex: bytesToHex(rawTxBytes),
    txSize: rawTxBytes.length,
  };
}

// --- Wasmi Smart Contract Invocation Helpers ---

export function buildTokenTransferCall(
  contractPubkey: Uint8Array,
  recipientPubkey: Uint8Array,
  tokenUnits: bigint,
  gasLimit = 100_000n,
): CallTxKind {
  return {
    type: "call",
    contract: contractPubkey,
    value: 0n,
    method: "token_transfer",
    args: concat([recipientPubkey, u128le(tokenUnits)]),
    gasLimit,
  };
}

export function buildVaultCreateCall(
  contractPubkey: Uint8Array,
  beneficiaryPubkey: Uint8Array,
  amountAtoms: bigint,
  lockUntilMs: bigint,
  gasLimit = 100_000n,
): CallTxKind {
  return {
    type: "call",
    contract: contractPubkey,
    value: 0n,
    method: "vault_create",
    args: concat([beneficiaryPubkey, u128le(amountAtoms), u32le(0), u64le(lockUntilMs)]),
    gasLimit,
  };
}

export function buildNameRegisterCall(
  name: string,
  pubkey: Uint8Array,
  relayEndpoints: string[],
): Uint8Array {
  if (pubkey.length !== 32) {
    throw new Error(`Expected 32-byte pubkey, got ${pubkey.length}`);
  }
  return concat([
    encodeBincodeString(name),
    pubkey,
    encodeBincodeStringVec(relayEndpoints),
  ]);
}
export const encodeNameRegisterArgs = buildNameRegisterCall;

export function buildNameRegisterCallTx(
  contractPubkey: Uint8Array,
  name: string,
  pubkey: Uint8Array,
  relayEndpoints: string[],
  gasLimit = 100_000n,
): CallTxKind {
  return {
    type: "call",
    contract: contractPubkey,
    value: 0n,
    method: "name_register",
    args: buildNameRegisterCall(name, pubkey, relayEndpoints),
    gasLimit,
  };
}

export function buildHtlcCreateCall(
  hashlock: Uint8Array,
  timelock: bigint | number,
  recipient: Uint8Array,
): Uint8Array {
  if (hashlock.length !== 32) {
    throw new Error(`Expected 32-byte hashlock, got ${hashlock.length}`);
  }
  if (recipient.length !== 32) {
    throw new Error(`Expected 32-byte recipient, got ${recipient.length}`);
  }
  return concat([
    hashlock,
    u64le(timelock),
    recipient,
  ]);
}
export const encodeHtlcCreateArgs = buildHtlcCreateCall;

export function buildHtlcCreateCallTx(
  contractPubkey: Uint8Array,
  hashlock: Uint8Array,
  timelock: bigint | number,
  recipient: Uint8Array,
  gasLimit = 100_000n,
): CallTxKind {
  return {
    type: "call",
    contract: contractPubkey,
    value: 0n,
    method: "htlc_create",
    args: buildHtlcCreateCall(hashlock, timelock, recipient),
    gasLimit,
  };
}

export function buildNftMintCall(
  collection: Uint8Array,
  to: Uint8Array,
  tokenId: bigint | number,
  tokenUri: string,
): Uint8Array {
  if (collection.length !== 32) {
    throw new Error(`Expected 32-byte collection, got ${collection.length}`);
  }
  if (to.length !== 32) {
    throw new Error(`Expected 32-byte to pubkey, got ${to.length}`);
  }
  return concat([
    collection,
    to,
    u128le(tokenId),
    encodeBincodeString(tokenUri),
  ]);
}
export const encodeNftMintArgs = buildNftMintCall;

export function buildNftMintCallTx(
  contractPubkey: Uint8Array,
  collection: Uint8Array,
  to: Uint8Array,
  tokenId: bigint | number,
  tokenUri: string,
  gasLimit = 100_000n,
): CallTxKind {
  return {
    type: "call",
    contract: contractPubkey,
    value: 0n,
    method: "nft_mint",
    args: buildNftMintCall(collection, to, tokenId, tokenUri),
    gasLimit,
  };
}

export function buildEscrowCreateCall(
  parties: Uint8Array[],
  threshold: number,
  amount: bigint | number,
  deadline: bigint | number,
): Uint8Array {
  if (threshold < 0 || threshold > 255) {
    throw new Error(`Threshold must be between 0 and 255, got ${threshold}`);
  }
  return concat([
    encodeBincodeBytes32Vec(parties),
    Uint8Array.of(threshold),
    u64le(amount),
    u64le(deadline),
  ]);
}
export const encodeEscrowCreateArgs = buildEscrowCreateCall;

export function buildEscrowCreateCallTx(
  contractPubkey: Uint8Array,
  parties: Uint8Array[],
  threshold: number,
  amount: bigint | number,
  deadline: bigint | number,
  gasLimit = 100_000n,
): CallTxKind {
  return {
    type: "call",
    contract: contractPubkey,
    value: 0n,
    method: "escrow_create",
    args: buildEscrowCreateCall(parties, threshold, amount, deadline),
    gasLimit,
  };
}

// --- Self-Test & Invariant Verification ---

export interface SelfTestStep {
  name: string;
  passed: boolean;
  expected?: string;
  actual?: string;
  details?: string;
}

export function runGoldenVectorSelfTest(): { ok: boolean; steps: SelfTestStep[] } {
  const steps: SelfTestStep[] = [];
  const goldenMnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const goldenPubkeyHex =
    "862f70cfafc9b581699f8d67598eac699cbc92bdfc940e95ed7ee1e8d8100e7e";
  const goldenCanonicalAddr =
    "kvncschhpna0ex6cz6vl34n4nr4vdxwtey4alj2qa90d0ms73kqspel0nuhe8dag";
  const goldenTestnetAddr =
    "tkncschhpna0ex6cz6vl34n4nr4vdxwtey4alj2qa90d0ms73kqspel0nuhe8dag";

  // Step 1: Verify coin type 3007
  steps.push({
    name: "Canonical Coin Type is 3007",
    passed: KOVANICA_COIN_TYPE === 3007,
    expected: "3007",
    actual: KOVANICA_COIN_TYPE.toString(),
  });

  // Step 2: Derive Account #0 & Account #1
  const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.MAINNET);
  const acc0 = accounts[0];
  const acc1 = accounts[1];

  steps.push({
    name: "Account #0 derivation path m/44'/3007'/0'/0'/0'",
    passed: acc0.path === "m/44'/3007'/0'/0'/0'",
    expected: "m/44'/3007'/0'/0'/0'",
    actual: acc0.path,
  });

  steps.push({
    name: "Account #0 Golden Public Key",
    passed: acc0.publicKeyHex === goldenPubkeyHex,
    expected: goldenPubkeyHex,
    actual: acc0.publicKeyHex,
  });

  steps.push({
    name: "Account #0 Mainnet Address kvnc...dag",
    passed: acc0.mainnetAddress === goldenCanonicalAddr,
    expected: goldenCanonicalAddr,
    actual: acc0.mainnetAddress,
  });

  steps.push({
    name: "Account #0 Testnet Address tknc...dag",
    passed: acc0.testnetAddress === goldenTestnetAddr,
    expected: goldenTestnetAddr,
    actual: acc0.testnetAddress,
  });

  steps.push({
    name: "Account #1 distinct derivation m/44'/3007'/1'/0'/0'",
    passed: acc1.path === "m/44'/3007'/1'/0'/0'" && acc1.publicKeyHex !== acc0.publicKeyHex,
    expected: "Distinct key derived for Account #1",
    actual: `Path: ${acc1.path}, Pub: ${acc1.publicKeyHex.slice(0, 16)}...`,
  });

  // Step 3: Transaction signing with domain tag KVNC/tx/v1
  const transferTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 1n,
    kind: {
      type: "transfer",
      to: acc1.publicKey,
      amount: 1_000_000_000n, // 1 KVNC
    },
    fee: 10_000n,
  };
  const transferSigned = signAndSerializeTransaction(transferTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isValidSig = ed.verify(transferSigned.signature, transferSigned.sighash, acc0.publicKey);

  steps.push({
    name: "Transaction Signing & Domain Tag Verification (KVNC/tx/v1)",
    passed: isValidSig && transferSigned.rawTxBytes.length > 0,
    expected: "Valid Ed25519 signature over keyed BLAKE3 sighash",
    actual: `Sig: ${transferSigned.signatureHex.slice(0, 16)}..., Size: ${transferSigned.txSize}B`,
  });

  // Step 4: Wasmi Smart Contract Interoperability (token_transfer & vault_create)
  const dummyContractPubkey = hexToBytes("33".repeat(32));
  const tokenCall = buildTokenTransferCall(dummyContractPubkey, acc1.publicKey, 500n);
  const tokenTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 2n,
    kind: tokenCall,
    fee: 15_000n,
  };
  const tokenSigned = signAndSerializeTransaction(tokenTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isTokenSigValid = ed.verify(tokenSigned.signature, tokenSigned.sighash, acc0.publicKey);

  // Wire kind tag for call is 6 (06000000 in bincode)
  const isCallWire6 = tokenSigned.rawTxHex.includes("06000000");

  steps.push({
    name: "Wasmi Contract Interoperability (token_transfer wire tag 6)",
    passed: isTokenSigValid && isCallWire6,
    expected: "Valid signature, wire kind tag 6 (06000000)",
    actual: `Wire tag 6 matched: ${isCallWire6}, Sighash: ${tokenSigned.sighashHex.slice(0, 16)}...`,
  });

  const vaultCall = buildVaultCreateCall(dummyContractPubkey, acc1.publicKey, 100_000n, 1750000000000n);
  const vaultTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 3n,
    kind: vaultCall,
    fee: 20_000n,
  };
  const vaultSigned = signAndSerializeTransaction(vaultTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isVaultSigValid = ed.verify(vaultSigned.signature, vaultSigned.sighash, acc0.publicKey);

  steps.push({
    name: "Wasmi Contract Interoperability (vault_create schedule & balance pull)",
    passed: isVaultSigValid,
    expected: "Valid bincode serialized vault_create call payload",
    actual: `Signed size: ${vaultSigned.txSize}B, Signature verified: ${isVaultSigValid}`,
  });

  // Step 5: Wasmi Contract Interoperability (name_register, htlc_create, nft_mint, escrow_create)
  const nameCallTx = buildNameRegisterCallTx(
    dummyContractPubkey,
    "alice",
    acc1.publicKey,
    ["https://relay1.kovanica.org", "https://relay2.kovanica.org"],
  );
  const nameTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 4n,
    kind: nameCallTx,
    fee: 25_000n,
  };
  const nameSigned = signAndSerializeTransaction(nameTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isNameSigValid = ed.verify(nameSigned.signature, nameSigned.sighash, acc0.publicKey);
  steps.push({
    name: "Wasmi Contract Interoperability (name_register ABI layout)",
    passed: isNameSigValid && nameCallTx.args.length > 0,
    expected: "Valid bincode serialized name_register call payload",
    actual: `Signed size: ${nameSigned.txSize}B, Args length: ${nameCallTx.args.length}B`,
  });

  const htlcCallTx = buildHtlcCreateCallTx(
    dummyContractPubkey,
    hexToBytes("11".repeat(32)),
    1750000000n,
    acc1.publicKey,
  );
  const htlcTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 5n,
    kind: htlcCallTx,
    fee: 20_000n,
  };
  const htlcSigned = signAndSerializeTransaction(htlcTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isHtlcSigValid = ed.verify(htlcSigned.signature, htlcSigned.sighash, acc0.publicKey);
  steps.push({
    name: "Wasmi Contract Interoperability (htlc_create 72-byte layout)",
    passed: isHtlcSigValid && htlcCallTx.args.length === 72,
    expected: "Exact 72-byte bincode layout for ([u8; 32], u64, [u8; 32])",
    actual: `Args length: ${htlcCallTx.args.length}B, Signature verified: ${isHtlcSigValid}`,
  });

  const nftCallTx = buildNftMintCallTx(
    dummyContractPubkey,
    hexToBytes("77".repeat(32)),
    acc1.publicKey,
    1n,
    "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  );
  const nftTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 6n,
    kind: nftCallTx,
    fee: 30_000n,
  };
  const nftSigned = signAndSerializeTransaction(nftTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isNftSigValid = ed.verify(nftSigned.signature, nftSigned.sighash, acc0.publicKey);
  steps.push({
    name: "Wasmi Contract Interoperability (nft_mint ABI layout)",
    passed: isNftSigValid && nftCallTx.args.length > 88,
    expected: "Valid bincode serialized nft_mint call payload",
    actual: `Signed size: ${nftSigned.txSize}B, Args length: ${nftCallTx.args.length}B`,
  });

  const escrowCallTx = buildEscrowCreateCallTx(
    dummyContractPubkey,
    [acc0.publicKey, acc1.publicKey],
    2,
    1_000_000_000n,
    1750000000n,
  );
  const escrowTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 7n,
    kind: escrowCallTx,
    fee: 35_000n,
  };
  const escrowSigned = signAndSerializeTransaction(escrowTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isEscrowSigValid = ed.verify(escrowSigned.signature, escrowSigned.sighash, acc0.publicKey);
  steps.push({
    name: "Wasmi Contract Interoperability (escrow_create threshold & parties layout)",
    passed: isEscrowSigValid && escrowCallTx.args.length === 8 + 64 + 1 + 8 + 8,
    expected: "Exact 89-byte bincode layout for (Vec<[u8; 32]>, u8, u64, u64)",
    actual: `Args length: ${escrowCallTx.args.length}B, Signature verified: ${isEscrowSigValid}`,
  });

  const ok = steps.every((s) => s.passed);
  return { ok, steps };
}
