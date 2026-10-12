import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getYoudaoScriptLang,
  getYoudaoTerm,
  lookupYoudaoTerm,
  parseYoudaoPage,
  splitIntoChunks,
  youdaoTranslate,
} from "../youdao"

// Trimmed from real dict.youdao.com/search result pages.
function entryPage(header: string, senses: string): string {
  return `<html><body><div id="results-contents">
    <div id="phrsListTab" class="trans-wrapper clearfix">
      <div class="img-list"><a><img src="x.jpg" alt=""></a></div>
      <h2 class="wordbook-js">${header}</h2>
      <div class="trans-container">
        <ul>${senses}</ul>
        <a class='more-example' href="/example/x">在例句中比较</a>
      </div>
    </div>
    <div id="webTrans" class="trans-wrapper trans-tab">
      <div class="trans-container"><ul><li>web sense</li></ul></div>
    </div>
  </div></body></html>`
}

function fanyiPage(source: string, translation: string): string {
  return `<html><body><div id="results-contents">
    <div id="fanyiToggle">
      <div class="trans-container">
        <p>${source}</p>
        <p>${translation}</p>
        <p>以上为机器翻译结果，长、整句建议使用 <a class="viaInner" href="#" target=_blank>人工翻译</a> 。</p>
      </div>
    </div>
  </div></body></html>`
}

function pronounce(label: string, phonetic: string, rel: string): string {
  return `<span class="pronounce">${label}
    <span class="phonetic">[${phonetic}]</span>
    <a href="#" title="真人发音" class="sp dictvoice voice-js log-js" data-rel="${rel}" data-4log="x"></a>
  </span>`
}

const BLOSSOM_PAGE = entryPage(
  `<span class="keyword">blossom</span>
  <div class="baav">
    ${pronounce("英", "ˈblɒsəm", "blossom&type=1")}
    ${pronounce("美", "ˈblɑːsəm", "blossom&amp;type=2")}
  </div>`,
  `<li>n. （树木的）花，花簇；开花，花期</li>
  <li>v. 开花；成长，繁盛，兴旺</li>`,
)

const NI_HAO_PAGE = entryPage(
  `<span class="keyword">你好</span> <span class="phonetic">[nǐ hǎo]</span>`,
  `<p class="wordGroup">
    <span class="contentTitle"><a class="search-js" href="/w/hello/">hello</a>
      <span style="font-weight: bold; color: #959595;"> ;</span></span>
    <span class="contentTitle"><a class="search-js" href="/w/hi/">hi</a>
      <span style="font-weight: bold; color: #959595;"> ;</span></span>
    <span class="contentTitle"><a class="search-js" href="/w/how do you do/">how do you do</a></span>
  </p>`,
)

// Inflected forms and some phrases get a voice link but no transcription.
const KIND_OF_PAGE = entryPage(
  `<span class="keyword">kind of</span>
  <div class="baav"><span class="pronounce">
    <a href="#" title="发音" class="sp dictvoice voice-js log-js" data-rel="kind+of"></a>
  </span></div>`,
  `<li>adv. 有点儿，在某种程度上</li>`,
)

const EMPTY_PAGE = `<html><body><div id="results-contents"></div></body></html>`

// Not a real Response: vitest.setup.ts swaps in a TextEncoder that keeps one byte per
// UTF-16 unit, so `new Response("中文")` would hand back mangled text.
function htmlResponse(body: string, init: { status?: number; statusText?: string } = {}) {
  const status = init.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? "OK",
    text: async () => body,
  } as Response
}
describe("parseYoudaoPage", () => {
  it("reads UK and US phonetics, their clips and an English headword's senses", () => {
    expect(parseYoudaoPage(BLOSSOM_PAGE)).toEqual({
      headword: "blossom",
      pronunciations: [
        {
          accent: "uk",
          phonetic: "ˈblɒsəm",
          audioUrl: "https://dict.youdao.com/dictvoice?audio=blossom&type=1",
        },
        {
          accent: "us",
          phonetic: "ˈblɑːsəm",
          audioUrl: "https://dict.youdao.com/dictvoice?audio=blossom&type=2",
        },
      ],
      definitions: ["n. （树木的）花，花簇；开花，花期", "v. 开花；成长，繁盛，兴旺"],
      machineTranslation: null,
    })
  })

  it("reads pinyin and the English equivalents of a Chinese headword", () => {
    expect(parseYoudaoPage(NI_HAO_PAGE)).toMatchObject({
      headword: "你好",
      pronunciations: [{ accent: "pinyin", phonetic: "nǐ hǎo", audioUrl: null }],
      definitions: ["hello; hi; how do you do"],
    })
  })

  it("skips voice links that have no transcription", () => {
    expect(parseYoudaoPage(KIND_OF_PAGE)).toMatchObject({
      pronunciations: [],
      definitions: ["adv. 有点儿，在某种程度上"],
    })
  })

  it("reads the machine translation and decodes its entities", () => {
    expect(
      parseYoudaoPage(fanyiPage("Tom &amp; Jerry", "汤姆&amp;杰瑞")).machineTranslation,
    ).toEqual({
      source: "Tom & Jerry",
      translation: "汤姆&杰瑞",
    })
  })

  it("returns an empty page when Youdao found nothing", () => {
    expect(parseYoudaoPage(EMPTY_PAGE)).toEqual({
      headword: null,
      pronunciations: [],
      definitions: [],
      machineTranslation: null,
    })
  })
})

describe("getYoudaoTerm and getYoudaoScriptLang", () => {
  it("treats words and short phrases as dictionary terms", () => {
    expect(getYoudaoTerm("  give   up ")).toBe("give up")
    expect(getYoudaoTerm("don't")).toBe("don't")
    expect(getYoudaoTerm("你好")).toBe("你好")
    expect(getYoudaoTerm("I love you very much.")).toBeNull()
    expect(getYoudaoTerm("我今天很高兴见到你们大家")).toBeNull()
    expect(getYoudaoTerm("iPhone 15")).toBeNull()
  })

  it("tells English from Chinese by script and refuses other scripts", () => {
    expect(getYoudaoScriptLang("blossom")).toBe("en")
    expect(getYoudaoScriptLang("我爱 iPhone 手机")).toBe("zh")
    expect(getYoudaoScriptLang("今日はとても暑いですね")).toBeNull()
    expect(getYoudaoScriptLang("오늘 날씨")).toBeNull()
    expect(getYoudaoScriptLang("12:30")).toBeNull()
  })
})

describe("splitIntoChunks", () => {
  it("keeps one chunk per line, blank lines included", () => {
    expect(splitIntoChunks("First line.\n\nSecond line.")).toEqual([
      "First line.",
      "",
      "Second line.",
    ])
  })

  it("breaks long lines at sentence ends without going over the chunk size", () => {
    const line = "Read Frog translates web pages paragraph by paragraph for learners. "
      .repeat(10)
      .trim()

    const chunks = splitIntoChunks(line)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 300)).toBe(true)
    expect(chunks.join(" ")).toBe(line)
  })

  it("joins Chinese sentences without spaces and cuts a sentence longer than a chunk", () => {
    const line = `${"我们每天都在公园里散步。".repeat(30)}${"长".repeat(320)}`

    const chunks = splitIntoChunks(line)

    expect(chunks.every((chunk) => chunk.length <= 300)).toBe(true)
    expect(chunks.join("")).toBe(line)
  })
})
describe("youdaoTranslate", () => {
  let pages: Record<string, string>
  const fetchMock = vi.fn<typeof fetch>()

  function queryOf(input: Parameters<typeof fetch>[0]): string {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    return new URL(url).searchParams.get("q") ?? ""
  }

  function requestedQueries(): string[] {
    return fetchMock.mock.calls.map(([input]) => queryOf(input))
  }

  beforeEach(() => {
    pages = {}
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input) => htmlResponse(pages[queryOf(input)] ?? EMPTY_PAGE))
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("translates a word with its first sense and requests without cookies or referrer", async () => {
    pages.blossom = BLOSSOM_PAGE
    const controller = new AbortController()

    await expect(
      youdaoTranslate("blossom", "auto", "cmn", { signal: controller.signal }),
    ).resolves.toBe("花，花簇")
    expect(fetchMock).toHaveBeenCalledWith("https://dict.youdao.com/search?q=blossom", {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    })
  })

  it("translates a Chinese word into English", async () => {
    pages["你好"] = NI_HAO_PAGE

    await expect(youdaoTranslate("你好", "cmn", "eng")).resolves.toBe("hello")
  })

  it("swaps the characters the page would double-escape for look-alikes", async () => {
    const sanitized = "He said ”I don’t know ＆ a ＜ b”"
    pages[sanitized] = fanyiPage(sanitized, "他说“我不知道，a ＜ b”")

    await expect(youdaoTranslate(`He said "I don't know & a < b"`, "auto", "cmn")).resolves.toBe(
      "他说“我不知道，a ＜ b”",
    )
    expect(requestedQueries()).toEqual([sanitized])
  })

  it("translates each paragraph and keeps the blank lines between them", async () => {
    pages["First line here."] = fanyiPage("First line here.", "第一行。")
    pages["Second line there."] = fanyiPage("Second line there.", "第二行。")

    await expect(
      youdaoTranslate("First line here.\n\nSecond line there.", "auto", "cmn"),
    ).resolves.toBe("第一行。\n\n第二行。")
  })

  it("leaves text in the target language, and numbers, as they are", async () => {
    pages["Hello there."] = fanyiPage("Hello there.", "你好。")

    await expect(youdaoTranslate("这是中文", "auto", "cmn")).resolves.toBe("这是中文")
    await expect(youdaoTranslate("2026-10-11 12:30", "auto", "cmn")).resolves.toBe(
      "2026-10-11 12:30",
    )
    // Only the English line of a mixed text is sent.
    await expect(youdaoTranslate("Hello there.\n这是中文", "eng", "cmn")).resolves.toBe(
      "你好。\n这是中文",
    )
    expect(requestedQueries()).toEqual(["Hello there."])
  })

  it("keeps a name the dictionary does not know", async () => {
    await expect(youdaoTranslate("ReadFrog", "auto", "cmn")).resolves.toBe("ReadFrog")
  })

  it("fails instead of showing a translation Youdao cut short", async () => {
    pages["One sentence here. Another sentence there."] = fanyiPage(
      "One sentence here.",
      "一句话。",
    )

    await expect(
      youdaoTranslate("One sentence here. Another sentence there.", "auto", "cmn"),
    ).rejects.toThrow("only part")
  })

  it("refuses languages Youdao would mistranslate or cannot produce", async () => {
    await expect(youdaoTranslate("blossom", "auto", "jpn")).rejects.toThrow("not into jpn")
    await expect(youdaoTranslate("你好", "auto", "yue")).rejects.toThrow("not into yue")
    await expect(youdaoTranslate("bonjour", "fra", "cmn")).rejects.toThrow("not from fra")
    await expect(youdaoTranslate("今日はとても暑いですね。", "auto", "eng")).rejects.toThrow(
      "not from this language",
    )
    await expect(youdaoTranslate("Ich habe heute keine Zeit.", "auto", "cmn")).rejects.toThrow(
      "another language",
    )
    await expect(
      youdaoTranslate("Je voudrais un café, s’il vous plaît.", "auto", "cmn"),
    ).rejects.toThrow("another language")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses HTML and text longer than the limit without sending anything", async () => {
    await expect(
      youdaoTranslate("<b>hello</b>", "auto", "cmn", { textFormat: "html" }),
    ).rejects.toThrow("HTML")
    await expect(youdaoTranslate("word ".repeat(400), "auto", "cmn")).rejects.toThrow("1500")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reports a failed response", async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse("", { status: 503, statusText: "Unavailable" }))

    await expect(youdaoTranslate("unavailable", "auto", "cmn")).rejects.toThrow("503")
  })
})

describe("lookupYoudaoTerm", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns a word's entry and reuses the page the translation fetched", async () => {
    fetchMock.mockImplementation(async () => htmlResponse(KIND_OF_PAGE))

    await expect(youdaoTranslate("kind of", "auto", "cmn")).resolves.toBe("有点儿，在某种程度上")
    await expect(lookupYoudaoTerm("kind of")).resolves.toEqual({
      headword: "kind of",
      pronunciations: [],
      definitions: ["adv. 有点儿，在某种程度上"],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("returns null for sentences and for terms Youdao knows nothing about", async () => {
    fetchMock.mockImplementation(async () => htmlResponse(EMPTY_PAGE))

    await expect(lookupYoudaoTerm("I love you very much.")).resolves.toBeNull()
    await expect(lookupYoudaoTerm("asdfghq")).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
