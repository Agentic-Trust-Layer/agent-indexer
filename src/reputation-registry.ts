import { BigInt, ipfs, Value, json } from "@graphprotocol/graph-ts";
import {
  NewFeedback as NewFeedbackEvent,
  FeedbackRevoked as FeedbackRevokedEvent,
  ResponseAppended as ResponseAppendedEvent
} from "../generated/ReputationRegistry/ReputationRegistry";
import {
  RepFeedback,
  RepFeedbackRevoked,
  RepResponseAppended
} from "../generated/schema";

function extractIpfsPath(uri: string): string | null {
  if (uri.startsWith("ipfs://")) return uri.replace("ipfs://", "");
  const ipfsIdx = uri.indexOf("/ipfs/");
  if (ipfsIdx >= 0) {
    return uri.substr(ipfsIdx + 6); // after '/ipfs/'
  }
  // Subdomain gateways: https://<cid>.ipfs.<domain>/<optional path>
  const schemeIdx = uri.indexOf("://");
  if (schemeIdx >= 0) {
    const rest = uri.substr(schemeIdx + 3);
    const slashIdx = rest.indexOf("/");
    const host = slashIdx >= 0 ? rest.substr(0, slashIdx) : rest;
    const afterHost = slashIdx >= 0 ? rest.substr(slashIdx + 1) : "";
    const ipfsDotIdx = host.indexOf(".ipfs.");
    if (ipfsDotIdx > 0) {
      const cid = host.substr(0, ipfsDotIdx);
      return afterHost.length > 0 ? cid + "/" + afterHost : cid;
    }
  }
  return null;
}

export function handleNewFeedback(e: NewFeedbackEvent): void {
  const id = e.transaction.hash.toHex() + "-" + e.logIndex.toString();
  const entity = new RepFeedback(id);
  entity.agentId = e.params.agentId;
  entity.clientAddress = e.params.clientAddress;
  entity.score = e.params.score;
  entity.tag1 = e.params.tag1;
  entity.tag2 = e.params.tag2;
  entity.feedbackUri = e.params.feedbackUri;
  // If IPFS (ipfs:// or gateway), store raw JSON as string
  const furi = e.params.feedbackUri;
  const fpath = furi != null ? extractIpfsPath(furi) : null;
  if (fpath) {
    let data = ipfs.cat(fpath);
    if (data !== null) {
      const raw = data.toString();
      entity.set("feedbackJson", Value.fromString(raw));
      // Parse known fields from feedback JSON
      const parsed = json.try_fromString(raw);
      if (!parsed.isError) {
        const obj = parsed.value.toObject();
        const t = obj.get("type");
        if (t && !t.isNull()) entity.set("feedbackType", Value.fromString(t.toString()));
        const d = obj.get("domain");
        if (d && !d.isNull()) entity.set("domain", Value.fromString(d.toString()));
        const c = obj.get("comment");
        if (c && !c.isNull()) entity.set("comment", Value.fromString(c.toString()));
        const ts = obj.get("timestamp");
        if (ts && !ts.isNull()) entity.set("feedbackTimestamp", Value.fromString(ts.toString()));
        const rp = obj.get("ratingPct");
        if (rp && !rp.isNull()) entity.set("ratingPct", Value.fromI32(rp.toI64() as i32));
      }
    }
  }
  entity.feedbackHash = e.params.feedbackHash;
  entity.txHash = e.transaction.hash;
  entity.blockNumber = e.block.number;
  entity.timestamp = e.block.timestamp;
  entity.save();
}

export function handleFeedbackRevoked(e: FeedbackRevokedEvent): void {
  const id = e.transaction.hash.toHex() + "-" + e.logIndex.toString();
  const entity = new RepFeedbackRevoked(id);
  entity.agentId = e.params.agentId;
  entity.clientAddress = e.params.clientAddress;
  entity.feedbackIndex = e.params.feedbackIndex as BigInt;
  entity.txHash = e.transaction.hash;
  entity.blockNumber = e.block.number;
  entity.timestamp = e.block.timestamp;
  entity.save();
}

export function handleResponseAppended(e: ResponseAppendedEvent): void {
  const id = e.transaction.hash.toHex() + "-" + e.logIndex.toString();
  const entity = new RepResponseAppended(id);
  entity.agentId = e.params.agentId;
  entity.clientAddress = e.params.clientAddress;
  entity.feedbackIndex = e.params.feedbackIndex as BigInt;
  entity.responder = e.params.responder;
  entity.responseUri = e.params.responseUri;
  const ruri = e.params.responseUri;
  const rpath = ruri != null ? extractIpfsPath(ruri) : null;
  if (rpath) {
    let data = ipfs.cat(rpath);
    if (data !== null) {
      entity.set("responseJson", Value.fromString(data.toString()));
    }
  }
  entity.responseHash = e.params.responseHash;
  entity.txHash = e.transaction.hash;
  entity.blockNumber = e.block.number;
  entity.timestamp = e.block.timestamp;
  entity.save();
}


