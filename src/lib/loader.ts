/**
 * Server-only: deploy / upgrade the Clout Perps program from the CI-built .so
 * using Solana's upgradeable BPF loader, signed by the house wallet.
 * Every step is idempotent so it can be driven by repeated calls.
 */
import "server-only";
import { createHash } from "crypto";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { connection, houseKeypair, perpsProgramKeypair } from "./house";
import { Connection } from "@solana/web3.js";
import { RPC_URL } from "./config";

export const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const SO_URL = "https://raw.githubusercontent.com/HATWHY4041/clout/main/program-build/clout_perps.so";
const CHUNK = 950;
const BUFFER_META = 37;
const PROGRAMDATA_META = 45;

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

export async function fetchSo(): Promise<{ so: Buffer; sha: string }> {
  const r = await fetch(`${SO_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Program build not found (${r.status}). Has CI finished?`);
  const so = Buffer.from(await r.arrayBuffer());
  return { so, sha: createHash("sha256").update(so).digest("hex") };
}

export function programDataAddress(program: PublicKey) {
  return PublicKey.findProgramAddressSync([program.toBuffer()], LOADER)[0];
}

async function bufferAddress(sha: string) {
  const seed = `cp-${sha.slice(0, 16)}`;
  return { seed, address: await PublicKey.createWithSeed(houseKeypair().publicKey, seed, LOADER) };
}

function chunksNeeded(so: Buffer, existing: Buffer | null, offset: number): number[] {
  const out: number[] = [];
  for (let i = 0; i * CHUNK < so.length; i++) {
    const a = so.subarray(i * CHUNK, (i + 1) * CHUNK);
    const b = existing ? existing.subarray(offset + i * CHUNK, offset + i * CHUNK + a.length) : null;
    if (!b || !a.equals(b)) out.push(i);
  }
  return out;
}

export async function status() {
  const { so, sha } = await fetchSo();
  const program = perpsProgramKeypair().publicKey;
  const pd = programDataAddress(program);
  const [progInfo, pdInfo] = await connection.getMultipleAccountsInfo([program, pd]);
  const deployed = !!progInfo?.executable;
  const upToDate = !!pdInfo && pdInfo.data.length >= PROGRAMDATA_META + so.length &&
    pdInfo.data.subarray(PROGRAMDATA_META, PROGRAMDATA_META + so.length).equals(so);
  const { address: buffer } = await bufferAddress(sha);
  const bufInfo = await connection.getAccountInfo(buffer);
  const missing = bufInfo ? chunksNeeded(so, bufInfo.data, BUFFER_META).length : null;
  return {
    program: program.toBase58(), soBytes: so.length, sha, deployed, upToDate,
    buffer: buffer.toBase58(), bufferExists: !!bufInfo, chunksTotal: Math.ceil(so.length / CHUNK), chunksMissing: missing,
    programDataBytes: pdInfo ? pdInfo.data.length - PROGRAMDATA_META : 0,
  };
}

export async function createBuffer() {
  const s = await status();
  if (s.upToDate) return { skipped: "program already up to date" };
  if (s.bufferExists) return { skipped: "buffer exists" };
  const house = houseKeypair();
  const { seed, address } = await bufferAddress(s.sha);
  const space = BUFFER_META + s.soBytes;
  const lamports = await connection.getMinimumBalanceForRentExemption(space);
  const tx = new Transaction().add(
    SystemProgram.createAccountWithSeed({ fromPubkey: house.publicKey, newAccountPubkey: address, basePubkey: house.publicKey, seed, lamports, space, programId: LOADER }),
    new TransactionInstruction({ programId: LOADER, keys: [
      { pubkey: address, isSigner: false, isWritable: true },
      { pubkey: house.publicKey, isSigner: false, isWritable: false },
    ], data: u32(0) }),
  );
  return { signature: await sendAndConfirmTransaction(connection, tx, [house], { commitment: "confirmed" }), buffer: address.toBase58() };
}

/** Write missing chunks (random order) for up to ~40s, pacing under public RPC limits. */
export async function writeChunks(max = 400) {
  const started = Date.now();
  const { so, sha } = await fetchSo();
  const house = houseKeypair();
  const { address } = await bufferAddress(sha);
  const info = await connection.getAccountInfo(address);
  if (!info) throw new Error("Create the buffer first");
  const todo = chunksNeeded(so, info.data, BUFFER_META).sort(() => Math.random() - 0.5).slice(0, max);
  const fast = new Connection(RPC_URL, { commitment: "confirmed", disableRetryOnRateLimit: true });
  let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  let sent = 0, limited = 0;
  for (let i = 0; i < todo.length && Date.now() - started < 40_000; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async (idx) => {
      const bytes = so.subarray(idx * CHUNK, (idx + 1) * CHUNK);
      const data = Buffer.concat([u32(1), u32(idx * CHUNK), u64(bytes.length), bytes]);
      const tx = new Transaction({ feePayer: house.publicKey, blockhash, lastValidBlockHeight }).add(
        new TransactionInstruction({ programId: LOADER, keys: [
          { pubkey: address, isSigner: false, isWritable: true },
          { pubkey: house.publicKey, isSigner: true, isWritable: false },
        ], data }),
      );
      tx.sign(house);
      try { await fast.sendRawTransaction(tx.serialize(), { skipPreflight: true }); sent++; }
      catch { limited++; }
    }));
    await new Promise((r) => setTimeout(r, limited > 0 ? 1500 : 1100));
    if (limited > 20) break;
  }
  await new Promise((r) => setTimeout(r, 5000));
  const after = await connection.getAccountInfo(address, "confirmed");
  return { sent, limited, stillMissing: after ? chunksNeeded(so, after.data, BUFFER_META).length : null, secs: Math.round((Date.now() - started) / 1000) };
}

/** Deploy (first time) or upgrade the program from a fully written buffer. */
export async function deploy() {
  const s = await status();
  if (s.upToDate) return { skipped: "program already up to date", program: s.program };
  if (s.chunksMissing !== 0) throw new Error(`Buffer incomplete (${s.chunksMissing} chunks missing)`);
  const house = houseKeypair();
  const programKp: Keypair = perpsProgramKeypair();
  const program = programKp.publicKey;
  const pd = programDataAddress(program);
  const buffer = new PublicKey(s.buffer);

  if (!s.deployed) {
    const maxLen = Math.ceil(s.soBytes * 1.25);
    const lamports = await connection.getMinimumBalanceForRentExemption(36);
    const tx = new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: house.publicKey, newAccountPubkey: program, lamports, space: 36, programId: LOADER }),
      new TransactionInstruction({ programId: LOADER, keys: [
        { pubkey: house.publicKey, isSigner: true, isWritable: true },
        { pubkey: pd, isSigner: false, isWritable: true },
        { pubkey: program, isSigner: false, isWritable: true },
        { pubkey: buffer, isSigner: false, isWritable: true },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: house.publicKey, isSigner: true, isWritable: false },
      ], data: Buffer.concat([u32(2), u64(maxLen)]) }),
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [house, programKp], { commitment: "confirmed" });
    return { deployed: true, signature: sig, program: program.toBase58() };
  }

  const ixs: TransactionInstruction[] = [];
  if (s.programDataBytes < s.soBytes) {
    ixs.push(new TransactionInstruction({ programId: LOADER, keys: [
      { pubkey: pd, isSigner: false, isWritable: true },
      { pubkey: program, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: house.publicKey, isSigner: true, isWritable: true },
    ], data: Buffer.concat([u32(6), u32(s.soBytes - s.programDataBytes + 1024)]) }));
  }
  ixs.push(new TransactionInstruction({ programId: LOADER, keys: [
    { pubkey: pd, isSigner: false, isWritable: true },
    { pubkey: program, isSigner: false, isWritable: true },
    { pubkey: buffer, isSigner: false, isWritable: true },
    { pubkey: house.publicKey, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: house.publicKey, isSigner: true, isWritable: false },
  ], data: u32(3) }));
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [house], { commitment: "confirmed" });
  return { upgraded: true, signature: sig, program: program.toBase58() };
}
