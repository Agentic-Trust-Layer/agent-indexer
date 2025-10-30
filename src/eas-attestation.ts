import { Bytes, BigInt } from "@graphprotocol/graph-ts";
import { Attested as AttestedEvent, Revoked as RevokedEvent } from "../generatedEas/EAS/EAS";
import { Attestation } from "../generatedEas/schema";

// EAS Attested(recipient, attester, schema, uid)
export function handleAttested(e: AttestedEvent): void {
  const id = e.params.uid.toHex();
  let a = new Attestation(id);
  a.uid = e.params.uid;
  a.schema = e.params.schema;
  a.recipient = e.params.recipient;
  a.attester = e.params.attester;
  // Defaults (not present in this event signature)
  a.time = BigInt.zero();
  a.expirationTime = BigInt.zero();
  a.refUID = Bytes.fromHexString("0x") as Bytes;
  a.data = Bytes.fromHexString("0x") as Bytes;
  a.revocable = false;
  a.revoked = false;
  a.revocationTime = null;
  a.txHash = e.transaction.hash;
  a.blockNumber = e.block.number;
  a.timestamp = e.block.timestamp;
  a.save();
}

// EAS Revoked(recipient, attester, schema, uid)
export function handleRevoked(e: RevokedEvent): void {
  const id = e.params.uid.toHex();
  let a = Attestation.load(id);
  if (a) {
    a.revoked = true;
    a.revocationTime = e.block.timestamp;
    a.save();
  }
}

