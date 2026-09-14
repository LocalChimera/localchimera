import { provisionGolem } from './golem.js';
import { provisionSpheron } from './spheron.js';
import { provisionBtfs } from './btfs.js';
import { provisionCrust } from './crust.js';
import { provisionMysterium } from './mysterium.js';
import { provisionAnyone } from './anyone.js';
import { provisionSentinel } from './sentinel.js';
import { provisionBttAi } from './btt-ai.js';
import { provisionInfernet } from './infernet.js';

const provisioners = {
  'golem-compute': provisionGolem,
  'golem-deployment-alpine': provisionGolem,
  'golem-deployment-nginx': provisionGolem,
  'spheron-compute': provisionSpheron,
  'btfs-storage': provisionBtfs,
  'crust-storage': provisionCrust,
  'mysterium-bandwidth': provisionMysterium,
  'anyone-bandwidth': provisionAnyone,
  'sentinel-bandwidth': provisionSentinel,
  'btt-ai-inference': provisionBttAi,
  'infernet-inference': provisionInfernet,
};

export async function provisionResource(resourceType, params) {
  const provisioner = provisioners[resourceType];
  if (!provisioner) {
    throw new Error(`No provisioner for resource type: ${resourceType}`);
  }
  return provisioner(params);
}
