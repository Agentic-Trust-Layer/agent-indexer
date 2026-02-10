import { AgentRegistry8122Template } from "../generated/templates";
import { RegistryDeployed as RegistryDeployedEvent } from "../generated/AgentRegistryFactory8122/AgentRegistryFactory8122";
import { RegistryAgent8122Deployment } from "../generated/schema";

export function handleRegistryDeployed(e: RegistryDeployedEvent): void {
  const registryAddr = e.params.registry;
  const id = registryAddr.toHexString();

  // Prevent duplicate template creations if reorgs / multiple events ever occur
  const existing = RegistryAgent8122Deployment.load(id);
  if (existing != null) return;

  const dep = new RegistryAgent8122Deployment(id);
  dep.factory = e.address;
  dep.admin = e.params.admin;
  dep.salt = e.params.salt;
  dep.deployedAt = e.block.timestamp;
  dep.txHash = e.transaction.hash;
  dep.blockNumber = e.block.number;
  dep.timestamp = e.block.timestamp;
  dep.save();

  AgentRegistry8122Template.create(registryAddr);
}

