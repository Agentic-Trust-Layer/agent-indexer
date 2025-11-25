import { BigInt, ipfs, Value, json, JSONValueKind } from "@graphprotocol/graph-ts";
import {
  ValidationRequest as ValidationRequestEvent,
  ValidationResponse as ValidationResponseEvent
} from "../generated/ValidationRegistry/ValidationRegistry";
import {
  ValidationRequest,
  ValidationResponse
} from "../generated/schema";

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
  entity.agentId = e.params.agentId;
  entity.requestUri = e.params.requestUri;
  entity.requestHash = e.params.requestHash;
  entity.txHash = e.transaction.hash;
  entity.blockNumber = e.block.number;
  entity.timestamp = e.block.timestamp;

  // If IPFS (ipfs:// or gateway), store raw JSON as string
  const ruri = e.params.requestUri;
  const rpath = ruri != null ? extractIpfsPath(ruri) : null;
  if (rpath) {
    let data = ipfs.cat(rpath);
    if (data !== null) {
      entity.set("requestJson", Value.fromString(data.toString()));
    }
  }

  entity.save();
}

export function handleValidationResponse(e: ValidationResponseEvent): void {
  const id = e.transaction.hash.toHex() + "-" + e.logIndex.toString();
  const entity = new ValidationResponse(id);
  entity.validatorAddress = e.params.validatorAddress;
  entity.agentId = e.params.agentId;
  entity.requestHash = e.params.requestHash;
  entity.response = e.params.response;
  entity.responseUri = e.params.responseUri;
  entity.responseHash = e.params.responseHash;
  entity.tag = e.params.tag;
  entity.txHash = e.transaction.hash;
  entity.blockNumber = e.block.number;
  entity.timestamp = e.block.timestamp;

  // If IPFS (ipfs:// or gateway), store raw JSON as string
  const ruri = e.params.responseUri;
  const rpath = ruri != null ? extractIpfsPath(ruri) : null;
  if (rpath) {
    let data = ipfs.cat(rpath);
    if (data !== null) {
      entity.set("responseJson", Value.fromString(data.toString()));
    }
  }

  entity.save();
}

