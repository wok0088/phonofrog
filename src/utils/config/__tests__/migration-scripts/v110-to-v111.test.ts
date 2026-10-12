import { describe, expect, it } from "vitest"
import { migrate } from "../../migration-scripts/v110-to-v111"

const YOUDAO = {
  id: "youdao-translate-default",
  name: "Youdao Dictionary",
  enabled: true,
  provider: "youdao-translate",
}

function provider(id: string, providerType: string, name = id) {
  return { id, name, enabled: true, provider: providerType }
}

describe("v110-to-v111 migration", () => {
  it("adds Youdao right after the built-in translators", () => {
    const oldConfig = {
      providersConfig: [
        provider("openai-default", "openai"),
        provider("microsoft-translate-default", "microsoft-translate"),
        provider("google-translate-default", "google-translate"),
        provider("deeplx-default", "deeplx"),
      ],
    }
    const snapshot = structuredClone(oldConfig)

    const migrated = migrate(oldConfig)

    expect(migrated.providersConfig.map((p: { id: string }) => p.id)).toEqual([
      "openai-default",
      "microsoft-translate-default",
      "google-translate-default",
      "youdao-translate-default",
      "deeplx-default",
    ])
    expect(migrated.providersConfig[3]).toEqual(YOUDAO)
    expect(oldConfig).toEqual(snapshot)
    expect(migrate(migrated)).toBe(migrated)
  })

  it("adds Youdao last when the config has no built-in translator", () => {
    const migrated = migrate({ providersConfig: [provider("openai-default", "openai")] })

    expect(migrated.providersConfig).toEqual([provider("openai-default", "openai"), YOUDAO])
  })

  it("takes the next free name when one is already used", () => {
    const migrated = migrate({
      providersConfig: [
        provider("a", "openai", "Youdao Dictionary"),
        provider("b", "deepseek", "Youdao Dictionary 2"),
      ],
    })

    expect(migrated.providersConfig[2]).toEqual({ ...YOUDAO, name: "Youdao Dictionary 3" })
  })

  it("leaves a config that already has the provider or its id alone", () => {
    const withProvider = { providersConfig: [{ ...YOUDAO, id: "mine", enabled: false }] }
    const withId = { providersConfig: [provider("youdao-translate-default", "openai")] }

    expect(migrate(withProvider)).toBe(withProvider)
    expect(migrate(withId)).toBe(withId)
  })

  it("leaves malformed config shapes unchanged", () => {
    expect(migrate(null)).toBeNull()
    expect(migrate([])).toEqual([])
    expect(migrate({})).toEqual({})
    expect(migrate({ providersConfig: null })).toEqual({ providersConfig: null })
  })
})
