/// <reference types="vite/client" />

import type { AxonAutoAgentBridge } from '@axon-auto-agent/contracts'

declare global {
  interface Window { axonAutoAgent: AxonAutoAgentBridge }
}

export {}
