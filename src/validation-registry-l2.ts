import { BigInt, ipfs, Value, json, JSONValueKind } from "@graphprotocol/graph-ts";
import {
  ValidationRequest as ValidationRequestEvent,
  ValidationResponse as ValidationResponseEvent
} from "../generatedL2/ValidationRegistry/ValidationRegistry";
import {
  ValidationRequest,
  ValidationResponse,
  ValidationFile,
  AgentStats,
  GlobalStats
} from "../generatedL2/schema";

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

function extractIpfsPath(uri: string): string | null {
  if (uri.startsWith("ipfs://")) return uri.replace("ipfs://", "");
  const ipfsIdx = uri.indexOf("/ipfs/");
  if (ipfsIdx >= 0) {
    return uri.substr(ipfsIdx + 6);
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

export function handleValidationRequest(e: ValidationRequestEvent): void {
  const id = e.transaction.hash.toHex() + "-" + e.logIndex.toString();
  const entity = new ValidationRequest(id);
  entity.validatorAddress = e.params.validatorAddress;
  entity.agent = e.params.agentId.toString();
  entity.requestUri = e.params.requestURI;
  entity.requestHash = e.params.requestHash;
  entity.txHash = e.transaction.hash;
  entity.blockNumber = e.block.number;
  entity.timestamp = e.block.timestamp;

  // If IPFS (ipfs:// or gateway), store raw JSON as string
  const ruri = e.params.requestURI;
  const rpath = extractIpfsPath(ruri);
  if (rpath) {
    let data = ipfs.cat(rpath);
    if (data !== null) {
      const raw = data.toString();
      entity.set("requestJson", Value.fromString(raw));

      const vid = e.transaction.hash.toHex() + ":" + rpath;
      let vf = ValidationFile.load(vid);
      if (vf == null) {
        vf = new ValidationFile(vid);
        vf.agent = e.params.agentId.toString();
        vf.validatorAddress = e.params.validatorAddress;
        vf.requestHash = e.params.requestHash;
        vf.createdAt = e.block.timestamp;
      }
      vf.requestUri = ruri;
      vf.cid = rpath;
      vf.requestRaw = raw;
      vf.save();
      entity.file = vf.id;
    }
  }

  entity.save();
}

export function handleValidationResponse(e: ValidationResponseEvent): void {
  const id = e.transaction.hash.toHex() + "-" + e.logIndex.toString();
  const entity = new ValidationResponse(id);
  entity.validatorAddress = e.params.validatorAddress;
  entity.agent = e.params.agentId.toString();
  entity.requestHash = e.params.requestHash;
  entity.response = e.params.response;
  entity.responseUri = e.params.responseURI;
  entity.responseHash = e.params.responseHash;
  entity.tag = e.params.tag;
  entity.txHash = e.transaction.hash;
  entity.blockNumber = e.block.number;
  entity.timestamp = e.block.timestamp;

  // If IPFS (ipfs:// or gateway), store raw JSON as string
  const ruri = e.params.responseURI;
  const rpath = ruri != null ? extractIpfsPath(ruri) : null;
  if (rpath) {
    let data = ipfs.cat(rpath);
    if (data !== null) {
      const raw = data.toString();
      entity.set("responseJson", Value.fromString(raw));

      const vid = e.transaction.hash.toHex() + ":" + rpath;
      let vf = ValidationFile.load(vid);
      if (vf == null) {
        vf = new ValidationFile(vid);
        vf.agent = e.params.agentId.toString();
        vf.validatorAddress = e.params.validatorAddress;
        vf.requestHash = e.params.requestHash;
        vf.createdAt = e.block.timestamp;
      }
      vf.responseUri = ruri;
      vf.cid = rpath;
      vf.responseRaw = raw;
      vf.tag = e.params.tag;
      vf.save();
      entity.file = vf.id;
    }
  }

  const stats = getOrCreateAgentStats(e.params.agentId, e.block.timestamp);
  stats.totalValidations = stats.totalValidations.plus(BigInt.fromI32(1));
  stats.save();
  const g = getOrCreateGlobalStats(e.block.timestamp);
  g.totalValidations = g.totalValidations.plus(BigInt.fromI32(1));
  g.save();

  entity.save();
}

