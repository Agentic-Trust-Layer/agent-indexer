import { BigInt } from "@graphprotocol/graph-ts";
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

export function handleNewFeedback(e: NewFeedbackEvent): void {
  const id = e.transaction.hash.toHex() + "-" + e.logIndex.toString();
  const entity = new RepFeedback(id);
  entity.agentId = e.params.agentId;
  entity.clientAddress = e.params.clientAddress;
  entity.score = e.params.score;
  entity.tag1 = e.params.tag1;
  entity.tag2 = e.params.tag2;
  entity.feedbackUri = e.params.feedbackUri;
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
  entity.responseHash = e.params.responseHash;
  entity.txHash = e.transaction.hash;
  entity.blockNumber = e.block.number;
  entity.timestamp = e.block.timestamp;
  entity.save();
}


