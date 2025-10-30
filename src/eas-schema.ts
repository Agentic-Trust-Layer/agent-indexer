import { Address, BigInt } from "@graphprotocol/graph-ts";
import { Registered as RegisteredEvent, SchemaRegistry } from "../generatedEas/SchemaRegistry/SchemaRegistry";
import { Schema } from "../generatedEas/schema";

// SchemaRegistry Registered(uid, registrant)
export function handleSchemaRegistered(e: RegisteredEvent): void {
  const uidHex = e.params.uid.toHex();
  let s = new Schema(uidHex);
  s.uid = e.params.uid;
  s.registrant = e.params.registerer;
  // Try to enrich using getSchema(uid)
  const reg = SchemaRegistry.bind(e.address as Address);
  const res = reg.try_getSchema(e.params.uid);
  if (!res.reverted) {
    const tup = res.value;
    s.revocable = tup.revocable;
    s.schema = tup.schema;
  } else {
    s.revocable = false;
    s.schema = "";
  }
  s.createdAt = BigInt.fromI32(0);
  s.txHash = e.transaction.hash;
  s.blockNumber = e.block.number;
  s.timestamp = e.block.timestamp;
  s.save();
}

