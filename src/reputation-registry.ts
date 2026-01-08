import { BigInt, ipfs, Value, json, JSONValueKind, Bytes } from "@graphprotocol/graph-ts";
import {
  NewFeedback as NewFeedbackEvent,
  FeedbackRevoked as FeedbackRevokedEvent,
  ResponseAppended as ResponseAppendedEvent
} from "../generated/ReputationRegistry/ReputationRegistry";
import {
  RepFeedback,
  RepFeedbackRevoked,
  RepResponseAppended,
  FeedbackFile,
  AgentStats,
  GlobalStats,
  Tag,
  AgentTag,
  Agent
} from "../generated/schema";

function getOrCreateGlobalStats(ts: BigInt): GlobalStats {
  let g = GlobalStats.load("global");
  if (g == null) {
    g = new GlobalStats("global");
    g.totalAgents = BigInt.zero();
    g.totalFeedback = BigInt.zero();
    g.totalValidations = BigInt.zero();
    g.tags = [];
  }
  g.updatedAt = ts;
  return g as GlobalStats;
}

function getOrCreateAgentStats(agentId: BigInt, ts: BigInt): AgentStats {
  const id = agentId.toString();
  let s = AgentStats.load(id);
  if (s == null) {
    s = new AgentStats(id);
    s.agent = id;
    s.totalFeedback = BigInt.zero();
    s.totalValidations = BigInt.zero();
    s.tags = [];
    s.lastActivity = ts;
  }
  s.updatedAt = ts;
  s.lastActivity = ts;
  return s as AgentStats;
}

function normalizeTag(tag: string): string {
  const t = tag.trim();
  return t.length == 0 ? "" : t.toLowerCase();
}

function addTagToAgentAndGlobal(agentId: BigInt, tagRaw: string, ts: BigInt): void {
  const tag = normalizeTag(tagRaw);
  if (tag.length == 0) return;

  // Global tag
  let t = Tag.load(tag);
  if (t == null) {
    t = new Tag(tag);
    t.count = BigInt.zero();
  }
  t.count = t.count.plus(BigInt.fromI32(1));
  t.updatedAt = ts;
  t.save();

  // GlobalStats.tags (unique list)
  let g = getOrCreateGlobalStats(ts);
  let tags = g.tags;
  let found = false;
  for (let i = 0; i < tags.length; i++) {
    if (tags[i] == tag) { found = true; break; }
  }
  if (!found) {
    tags.push(tag);
    g.tags = tags;
  }
  g.save();

  // AgentStats.tags (unique list)
  let s = getOrCreateAgentStats(agentId, ts);
  let atags = s.tags;
  let found2 = false;
  for (let i = 0; i < atags.length; i++) {
    if (atags[i] == tag) { found2 = true; break; }
  }
  if (!found2) {
    atags.push(tag);
    s.tags = atags;
  }
  s.save();

  // AgentTag count
  const atid = agentId.toString() + ":" + tag;
  let at = AgentTag.load(atid);
  if (at == null) {
    at = new AgentTag(atid);
    at.agent = agentId.toString();
    at.tag = tag;
    at.count = BigInt.zero();
  }
  at.count = at.count.plus(BigInt.fromI32(1));
  at.updatedAt = ts;
  at.save();
}

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
  entity.agent = e.params.agentId.toString();
  entity.clientAddress = e.params.clientAddress;
  entity.feedbackIndex = e.params.feedbackIndex as BigInt;
  entity.score = e.params.score;
  // tag1 is an indexed string, so it's exposed as bytes32(topic hash). Store the topic hex.
  entity.tag1 = e.params.tag1.toHexString();
  entity.tag2 = e.params.tag2;
  entity.endpoint = e.params.endpoint;
  entity.feedbackUri = e.params.feedbackURI;

  // Stats + tags
  const stats = getOrCreateAgentStats(e.params.agentId, e.block.timestamp);
  stats.totalFeedback = stats.totalFeedback.plus(BigInt.fromI32(1));
  stats.save();
  const g = getOrCreateGlobalStats(e.block.timestamp);
  g.totalFeedback = g.totalFeedback.plus(BigInt.fromI32(1));
  g.save();
  addTagToAgentAndGlobal(e.params.agentId, entity.tag1, e.block.timestamp);
  addTagToAgentAndGlobal(e.params.agentId, entity.tag2, e.block.timestamp);

  // If IPFS (ipfs:// or gateway), store raw JSON as string
  const furi = e.params.feedbackURI;
  const fpath = furi != null ? extractIpfsPath(furi) : null;
  if (fpath) {
    let data = ipfs.cat(fpath);
    if (data !== null) {
      const raw = data.toString();
      entity.set("feedbackJson", Value.fromString(raw));

      // Create immutable FeedbackFile (Agent0-style)
      const fid = e.transaction.hash.toHex() + ":" + fpath;
      const ff = new FeedbackFile(fid);
      ff.agent = e.params.agentId.toString();
      ff.clientAddress = Bytes.fromHexString(e.params.clientAddress.toHexString()) as Bytes;
      ff.feedbackIndex = e.params.feedbackIndex as BigInt;
      ff.uri = furi;
      ff.cid = fpath;
      ff.raw = raw;
      ff.tag1 = entity.tag1;
      ff.tag2 = entity.tag2;
      ff.createdAt = e.block.timestamp;
      ff.save();
      entity.file = ff.id;

      // Parse known fields from feedback JSON
      const parsed = json.try_fromString(raw);
      if (!parsed.isError) {
        const obj = parsed.value.toObject();
        const t = obj.get("type");
        if (t && !t.isNull() && t.kind == JSONValueKind.STRING) entity.set("feedbackType", Value.fromString(t.toString()));
        const d = obj.get("domain");
        if (d && !d.isNull() && d.kind == JSONValueKind.STRING) entity.set("domain", Value.fromString(d.toString()));
        const c = obj.get("comment");
        if (c && !c.isNull() && c.kind == JSONValueKind.STRING) entity.set("comment", Value.fromString(c.toString()));
        const ts = obj.get("timestamp");
        if (ts && !ts.isNull() && ts.kind == JSONValueKind.STRING) entity.set("feedbackTimestamp", Value.fromString(ts.toString()));
        const rp = obj.get("ratingPct");
        if (rp && !rp.isNull() && rp.kind == JSONValueKind.NUMBER) entity.set("ratingPct", Value.fromI32(rp.toI64() as i32));
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
  entity.agent = e.params.agentId.toString();
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
  entity.agent = e.params.agentId.toString();
  entity.clientAddress = e.params.clientAddress;
  entity.feedbackIndex = e.params.feedbackIndex as BigInt;
  entity.responder = e.params.responder;
  entity.responseUri = e.params.responseURI;
  const ruri = e.params.responseURI;
  const rpath = extractIpfsPath(ruri);
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


