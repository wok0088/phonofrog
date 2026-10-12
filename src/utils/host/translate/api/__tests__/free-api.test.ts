import { describe, expect, it } from "vitest"
import { googleTranslate, microsoftTranslate, youdaoTranslate } from "../../api"

const describeFreeApi = process.env.SKIP_FREE_API === "true" ? describe.skip : describe

describeFreeApi("googleTranslate", () => {
  it("google translates text to simplified chinese", async () => {
    const result = await googleTranslate("Library", "en", "zh")
    expect(result).toBe("图书馆")
  })
  it("google translates text to traditional chinese", async () => {
    const result = await googleTranslate("Library", "en", "zh-TW")
    expect(result).toBe("圖書館")
  })
})

describeFreeApi("microsoftTranslate", () => {
  it("microsoft translates text to simplified chinese", async () => {
    const result = await microsoftTranslate("Library", "en", "zh")
    expect(result).toBe("图书馆")
  })
  it("microsoft translates text to traditional chinese", async () => {
    const result = await microsoftTranslate("Library", "en", "zh-TW")
    expect(result).toBe("圖書館")
  })
})

describeFreeApi("youdaoTranslate", () => {
  it("youdao translates a word with its first dictionary sense", async () => {
    const result = await youdaoTranslate("Library", "eng", "cmn")
    expect(result).toContain("图书馆")
  })
  it("youdao translates a sentence from chinese to english", async () => {
    const result = await youdaoTranslate("图书馆九点开门。", "cmn", "eng")
    expect(result.toLowerCase()).toContain("library")
  })
})
