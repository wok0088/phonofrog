/**
 * Migration script from v110 to v111
 * - Adds the built-in Youdao Dictionary translator (`youdao-translate`) to
 *   `providersConfig`, enabled, right after Google Translate / Microsoft Translator
 *   when the config has them and at the end otherwise. Built-in translators have
 *   no settings page, so a config that predates one never gains it any other way.
 * - A config that already has the provider, or its id, is left alone. A provider
 *   already named "Youdao Dictionary" keeps its name; the new entry takes
 *   "Youdao Dictionary 2" (or the next free number), since names must be unique.
 *
 * Idempotent: a config with nothing to add is returned by identity.
 *
 * IMPORTANT: The defaults are hardcoded inline. Migration scripts are frozen
 * snapshots - never import constants, helpers, or shared types.
 */

const YOUDAO_PROVIDER_TYPE = "youdao-translate"
const YOUDAO_DEFAULT_ID = "youdao-translate-default"
const YOUDAO_DEFAULT_NAME = "Youdao Dictionary"
const BUILT_IN_TRANSLATOR_TYPES = new Set(["google-translate", "microsoft-translate"])

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function getFreeName(providers: unknown[]): string {
  const taken = new Set(
    providers.map((provider) => (isRecord(provider) ? provider.name : undefined)),
  )
  if (!taken.has(YOUDAO_DEFAULT_NAME)) return YOUDAO_DEFAULT_NAME
  let suffix = 2
  while (taken.has(`${YOUDAO_DEFAULT_NAME} ${suffix}`)) suffix++
  return `${YOUDAO_DEFAULT_NAME} ${suffix}`
}

export function migrate(oldConfig: any): any {
  if (!isRecord(oldConfig) || !Array.isArray(oldConfig.providersConfig)) {
    return oldConfig
  }

  const providers: unknown[] = oldConfig.providersConfig
  const alreadyThere = providers.some(
    (provider) =>
      isRecord(provider) &&
      (provider.provider === YOUDAO_PROVIDER_TYPE || provider.id === YOUDAO_DEFAULT_ID),
  )
  if (alreadyThere) {
    return oldConfig
  }

  const youdao = {
    id: YOUDAO_DEFAULT_ID,
    name: getFreeName(providers),
    enabled: true,
    provider: YOUDAO_PROVIDER_TYPE,
  }

  let insertAt = providers.length
  providers.forEach((provider, index) => {
    if (isRecord(provider) && BUILT_IN_TRANSLATOR_TYPES.has(provider.provider)) {
      insertAt = index + 1
    }
  })

  return {
    ...oldConfig,
    providersConfig: [...providers.slice(0, insertAt), youdao, ...providers.slice(insertAt)],
  }
}
