import type { AdapterContext, NetworkAdapter } from './types'
import { SimOfferWallAdapter } from './sim-offer-wall'
import { SimSurveyWallAdapter } from './sim-survey-wall'

/**
 * Resolves a network key to its adapter, and builds the context that adapter
 * runs with.
 *
 * Secrets are read from the environment by the NAME stored in
 * `networks.secret_ref`, never from the database. A leaked database dump
 * should not contain live network credentials, and the admin UI should never
 * be able to display them.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, NetworkAdapter>()

  constructor(adapters: NetworkAdapter[] = defaultAdapters()) {
    for (const adapter of adapters) this.adapters.set(adapter.key, adapter)
  }

  register(adapter: NetworkAdapter): void {
    this.adapters.set(adapter.key, adapter)
  }

  get(key: string): NetworkAdapter | undefined {
    return this.adapters.get(key)
  }

  keys(): string[] {
    return [...this.adapters.keys()]
  }

  contextFor(
    network: { key: string; config: Record<string, unknown>; secretRef: string | null },
    log: AdapterContext['log'] = () => {},
  ): AdapterContext {
    const secret = network.secretRef ? process.env[network.secretRef] : undefined

    if (network.secretRef && !secret) {
      log(`network ${network.key}: secret_ref ${network.secretRef} is not set in the environment`)
    }

    return { secret, config: network.config ?? {}, log }
  }
}

export function defaultAdapters(): NetworkAdapter[] {
  return [new SimOfferWallAdapter(), new SimSurveyWallAdapter()]
}
