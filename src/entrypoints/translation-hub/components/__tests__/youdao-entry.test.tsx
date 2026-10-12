// @vitest-environment jsdom

import type { LangCodeISO6393 } from "@read-frog/definitions"
import type { YoudaoTermEntry } from "@/utils/host/translate/api/youdao"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { YoudaoEntry } from "@/entrypoints/translation-hub/components/youdao-entry"

const { lookupYoudaoTermMock } = vi.hoisted(() => ({
  lookupYoudaoTermMock:
    vi.fn<(term: string, signal?: AbortSignal) => Promise<YoudaoTermEntry | null>>(),
}))

vi.mock("@/utils/host/translate/api/youdao", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/host/translate/api/youdao")>()),
  lookupYoudaoTerm: lookupYoudaoTermMock,
}))

vi.mock("@/utils/i18n", () => ({
  i18n: { t: (key: string) => key },
}))

class FakeAudio {
  static instances: FakeAudio[] = []
  play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  pause = vi.fn<() => void>()
  constructor(public src: string) {
    FakeAudio.instances.push(this)
  }
}

const RECORD: YoudaoTermEntry = {
  headword: "record",
  pronunciations: [
    { accent: "uk", phonetic: "ˈrekɔːd; rɪˈkɔːd", audioUrl: "https://voice/uk" },
    { accent: "us", phonetic: "ˈrekərd; rɪˈkɔːrd", audioUrl: "https://voice/us" },
  ],
  definitions: ["n. 记录，记载", "v. 录制", "adj. 创纪录的"],
}

function renderEntry(inputText: string, targetLanguage: LangCodeISO6393, translation: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <YoudaoEntry
        inputText={inputText}
        targetLanguage={targetLanguage}
        translation={translation}
      />
    </QueryClientProvider>,
  )
}

describe("YoudaoEntry", () => {
  beforeEach(() => {
    lookupYoudaoTermMock.mockReset()
    FakeAudio.instances = []
    vi.stubGlobal("Audio", FakeAudio)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("shows a word's phonetics and every sense, and plays the chosen accent", async () => {
    lookupYoudaoTermMock.mockResolvedValue(RECORD)

    renderEntry(" record ", "cmn", "记录，记载")

    expect(await screen.findByText("/ˈrekɔːd; rɪˈkɔːd/")).toBeInTheDocument()
    expect(screen.getByText("/ˈrekərd; rɪˈkɔːrd/")).toBeInTheDocument()
    expect(screen.getByText("adj. 创纪录的")).toBeInTheDocument()
    expect(lookupYoudaoTermMock).toHaveBeenCalledWith("record", expect.any(AbortSignal))

    fireEvent.click(screen.getByRole("button", { name: "translationHub.youdao.playUk" }))
    fireEvent.click(screen.getByRole("button", { name: "translationHub.youdao.playUs" }))

    expect(FakeAudio.instances.map((audio) => audio.src)).toEqual([
      "https://voice/uk",
      "https://voice/us",
    ])
    // Starting another clip stops the one already playing.
    expect(FakeAudio.instances[0]!.pause).toHaveBeenCalled()
  })

  it("shows pinyin, without a play button, above a Chinese word's English senses", async () => {
    lookupYoudaoTermMock.mockResolvedValue({
      headword: "你好",
      pronunciations: [{ accent: "pinyin", phonetic: "nǐ hǎo", audioUrl: null }],
      definitions: ["hello; hi; how do you do"],
    })

    renderEntry("你好", "eng", "hello")

    expect(await screen.findByText("nǐ hǎo")).toBeInTheDocument()
    expect(screen.getByText("hello; hi; how do you do")).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("keeps the plain translation under the phonetics when the senses are in another language", async () => {
    lookupYoudaoTermMock.mockResolvedValue(RECORD)

    // English to English: Youdao's senses would be Chinese.
    renderEntry("record", "eng", "record")

    expect(await screen.findByText("/ˈrekɔːd; rɪˈkɔːd/")).toBeInTheDocument()
    expect(screen.queryByText("n. 记录，记载")).toBeNull()
    expect(screen.getByText("record", { selector: "div" })).toBeInTheDocument()
  })

  it("shows only the translation for sentences and for words with no entry", async () => {
    renderEntry("I love you very much.", "cmn", "我非常爱你。")
    expect(screen.getByText("我非常爱你。")).toBeInTheDocument()
    expect(lookupYoudaoTermMock).not.toHaveBeenCalled()

    lookupYoudaoTermMock.mockResolvedValue(null)
    renderEntry("asdfghq", "cmn", "asdfghq")
    await vi.waitFor(() => expect(lookupYoudaoTermMock).toHaveBeenCalledTimes(1))
    expect(screen.getByText("asdfghq")).toBeInTheDocument()
  })
})
