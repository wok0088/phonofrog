import type { LangCodeISO6393 } from "@read-frog/definitions"
import type { TranslationTextFormat } from "@/types/config/translate"
import { decodeHTML } from "entities"

// Youdao has no free translation API. Its JSON dictionary endpoints reject any request
// that carries an Origin header, which every fetch from an extension does, so this reads
// the dictionary's HTML result page: it holds the phonetics and senses of a headword
// and, for text the dictionary has no entry for, a machine translation. `/search?q=`
// keeps characters like "/" that the `/w/<text>` path form drops. The page is parsed
// with regular expressions because page translation runs in the background service
// worker, which has no DOMParser.
const YOUDAO_SEARCH_URL = "https://dict.youdao.com/search"
const YOUDAO_VOICE_URL = "https://dict.youdao.com/dictvoice"

/** The page silently cuts its machine translation off near 600 characters. */
const MAX_CHUNK_LENGTH = 300
const MAX_CHUNKS = 8
export const MAX_YOUDAO_TEXT_LENGTH = 1500
const PAGE_CACHE_SIZE = 50

const MAX_TERM_WORDS = 4
const MAX_TERM_LENGTH = 40
const MAX_HAN_TERM_CHARS = 8

const LATIN_WORD_REGEX = /^[a-z]+(?:['’-][a-z]+)*$/i
const HAN_REGEX = /\p{Script=Han}/u
const HAN_ONLY_REGEX = /^\p{Script=Han}+$/u
const LATIN_REGEX = /\p{Script=Latin}/u
const CJK_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const KANA_HANGUL_REGEX = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const LATIN_DIACRITIC_REGEX = /[À-ɏ]/u
const SENTENCE_END_REGEX = /(?<=[.!?。！？；;])\s*/u
const ASCII_END_REGEX = /[!-~]$/
const LETTER_OR_DIGIT_REGEX = /[\p{L}\p{N}]/gu

// Youdao reads all Latin-script text as English and badly mistranslates French or
// German, so text whose function words are mostly another language's is refused.
const ENGLISH_FUNCTION_WORDS = new Set(
  (
    "a an the is are was were be been am do does did have has had will would can could " +
    "should i you he she it we they this that of to in and or for with not my your what how why"
  ).split(" "),
)
const OTHER_FUNCTION_WORDS = new Set(
  (
    "ich du er sie wir ihr der die das und ist nicht ein eine mit von zu je tu il nous vous " +
    "ils le la les et est une des du pas que qui yo él ella el los las es son una por para " +
    "pero di che il lo gli sono non ik het een niet"
  ).split(" "),
)

export type YoudaoLang = "en" | "zh"

export type PhoneticAccent = "uk" | "us" | "pinyin"

export interface Pronunciation {
  accent: PhoneticAccent
  /** Without the surrounding brackets, e.g. `ˈblɒsəm` or `nǐ hǎo`. */
  phonetic: string
  audioUrl: string | null
}

export interface YoudaoTermEntry {
  headword: string
  pronunciations: Pronunciation[]
  definitions: string[]
}

export interface YoudaoPage {
  headword: string | null
  pronunciations: Pronunciation[]
  definitions: string[]
  machineTranslation: { source: string; translation: string } | null
}
/* ──────────────────────────────
  Parsing the result page
  ────────────────────────────── */

function textOf(html: string): string {
  return decodeHTML(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

function cleanPhonetic(html: string | undefined): string {
  return textOf(html ?? "")
    .replace(/^\[|\]$/g, "")
    .trim()
}

/** The markup from `start` up to the first `end` after it, or "" when `start` is absent. */
function sliceBetween(html: string, start: RegExp, end: string): string {
  const match = start.exec(html)
  if (!match) return ""
  const from = match.index + match[0].length
  const to = html.indexOf(end, from)
  return html.slice(from, to === -1 ? undefined : to)
}

function buildAudioUrl(rel: string | undefined): string | null {
  // `data-rel` holds the dictvoice query string, e.g. `give+up&amp;type=2`.
  if (!rel) return null
  const url = new URL(YOUDAO_VOICE_URL)
  url.search = `audio=${decodeHTML(rel)}`
  return url.searchParams.get("audio") ? url.toString() : null
}

function getAccent(rel: string | undefined, label: string): "uk" | "us" | null {
  const type = new URLSearchParams(decodeHTML(rel ?? "")).get("type")
  if (type === "1" || label.startsWith("英")) return "uk"
  if (type === "2" || label.startsWith("美")) return "us"
  return null
}

function parsePronunciations(header: string): Pronunciation[] {
  const pronunciations: Pronunciation[] = []
  const baav = sliceBetween(header, /<div class="baav">/, "</div>")

  for (const block of baav.split(/<span class="pronounce">/).slice(1)) {
    const phonetic = cleanPhonetic(/<span class="phonetic">([\s\S]*?)<\/span>/.exec(block)?.[1])
    if (!phonetic) continue

    const rel = /class="[^"]*\bdictvoice\b[^"]*"[^>]*\bdata-rel="([^"]*)"/.exec(block)?.[1]
    const accent = getAccent(rel, textOf(block.split("<")[0] ?? ""))
    if (!accent) continue

    pronunciations.push({ accent, phonetic, audioUrl: buildAudioUrl(rel) })
  }

  // Chinese headwords carry their pinyin directly in the header, with no voice link.
  if (pronunciations.length === 0) {
    const outsideBaav = header.replace(/<div class="baav">[\s\S]*?<\/div>/, "")
    const pinyin = cleanPhonetic(/<span class="phonetic">([\s\S]*?)<\/span>/.exec(outsideBaav)?.[1])
    if (pinyin) pronunciations.push({ accent: "pinyin", phonetic: pinyin, audioUrl: null })
  }

  return pronunciations
}

/** Reads a Youdao dictionary result page. */
export function parseYoudaoPage(html: string): YoudaoPage {
  const entry = sliceBetween(html, /<div id="phrsListTab"[^>]*>/, '<div id="webTrans"')
  const header = sliceBetween(entry, /<h2[^>]*>/, "</h2>")

  // English headwords list one sense per <li>; Chinese ones list English equivalents
  // as one `.wordGroup` paragraph per part of speech.
  const senses = /<div class="trans-container">\s*<ul>([\s\S]*?)<\/ul>/.exec(entry)?.[1] ?? ""
  const definitions = [
    ...senses.matchAll(/<li>([\s\S]*?)<\/li>|<p class="wordGroup">([\s\S]*?)<\/p>/g),
  ]
    .map((match) => textOf(match[1] ?? match[2] ?? "").replace(/\s+;/g, ";"))
    .filter(Boolean)

  const fanyi = sliceBetween(
    html,
    /<div id="fanyiToggle">\s*<div class="trans-container">/,
    "</div>",
  )
  const [source, translation] = [...fanyi.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((match) =>
    textOf(match[1] ?? ""),
  )

  return {
    headword: textOf(/<span class="keyword">([\s\S]*?)<\/span>/.exec(header)?.[1] ?? "") || null,
    pronunciations: parsePronunciations(header),
    definitions,
    machineTranslation: translation ? { source: source ?? "", translation } : null,
  }
}
/* ──────────────────────────────
  Requests
  ────────────────────────────── */

// A word looked up in the Translation Hub is fetched once by the translation and once
// by the dictionary entry beside it; both get this page.
const pageCache = new Map<string, YoudaoPage>()

/**
 * The page HTML-escapes the query and then escapes the result again before its
 * machine translation reads it, so `'` `"` `<` `>` `&` reach the translator as
 * `&amp;#x27;` and the like and come back as garbage. Look-alikes get through intact.
 */
function sanitizeQuery(text: string): string {
  return text
    .replace(/'/g, "’")
    .replace(/"/g, "”")
    .replace(/</g, "＜")
    .replace(/>/g, "＞")
    .replace(/&/g, "＆")
}

async function fetchYoudaoPage(text: string, signal?: AbortSignal): Promise<YoudaoPage> {
  const query = sanitizeQuery(text)
  const cached = pageCache.get(query)
  if (cached) return cached

  const url = new URL(YOUDAO_SEARCH_URL)
  url.searchParams.set("q", query)
  const resp = await fetch(url.toString(), {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal,
  }).catch((error: unknown) => {
    throw new Error(
      `Network error during Youdao translation: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  })
  if (!resp.ok) {
    throw new Error(`Youdao translation request failed: ${resp.status} ${resp.statusText}`)
  }

  const page = parseYoudaoPage(await resp.text())
  pageCache.set(query, page)
  if (pageCache.size > PAGE_CACHE_SIZE) {
    pageCache.delete(pageCache.keys().next().value!)
  }
  return page
}

/* ──────────────────────────────
  Languages and terms
  ────────────────────────────── */

/** English or Chinese by the script the text is written in, or null for anything else. */
export function getYoudaoScriptLang(text: string): YoudaoLang | null {
  if (HAN_REGEX.test(text) && !KANA_HANGUL_REGEX.test(text)) return "zh"
  if (LATIN_REGEX.test(text) && !CJK_REGEX.test(text)) return "en"
  return null
}

function hasLetters(text: string): boolean {
  return /\p{L}/u.test(text)
}

function isClearlyNotEnglish(text: string): boolean {
  if (LATIN_DIACRITIC_REGEX.test(text)) return true
  const words = text.toLowerCase().split(/[^a-zäöüßàâçéèêëîïôûùÿñ']+/)
  const english = words.filter((word) => ENGLISH_FUNCTION_WORDS.has(word)).length
  const other = words.filter((word) => OTHER_FUNCTION_WORDS.has(word)).length
  return other > english
}

/** Youdao only translates between English and Mandarin; its Chinese is simplified. */
function toYoudaoLang(code: LangCodeISO6393): YoudaoLang | null {
  if (code === "eng") return "en"
  if (code === "cmn" || code === "cmn-Hant") return "zh"
  return null
}

/**
 * The text as a dictionary headword (trimmed onto one line), or null when it is a
 * sentence rather than a word or short phrase.
 */
export function getYoudaoTerm(text: string): string | null {
  const term = text.trim().replace(/\s+/g, " ")
  if (!term) return null
  // Common Han characters are one UTF-16 unit each; a rare one counting double only
  // tightens the limit.
  if (HAN_ONLY_REGEX.test(term)) return term.length <= MAX_HAN_TERM_CHARS ? term : null

  const words = term.split(" ")
  return term.length <= MAX_TERM_LENGTH &&
    words.length <= MAX_TERM_WORDS &&
    words.every((word) => LATIN_WORD_REGEX.test(word))
    ? term
    : null
}

/**
 * A dictionary sense as a plain translation, without its part of speech, its
 * alternatives and its usage notes: `n. （树木的）花，花簇；开花` → `花，花簇`.
 */
function senseToTranslation(sense: string): string {
  const first = sense
    .replace(/^(?:\s*[a-z]{1,5}\.\s*)+/i, "")
    .split(/[;；]/)[0]
    ?.split(/[:：]/)[0]
    ?.replace(/^（[^）]*）|（[^）]*）$/g, "")
    .trim()
  return first || sense
}
/* ──────────────────────────────
  Translation
  ────────────────────────────── */

function sliceEvery(text: string, size: number): string[] {
  const slices: string[] = []
  for (let start = 0; start < text.length; start += size) {
    slices.push(text.slice(start, start + size))
  }
  return slices
}

/**
 * Splits text into pieces the page translates in full: one per line, with long lines
 * broken at sentence ends. Blank lines stay as empty strings so the joined translation
 * keeps the paragraph breaks.
 */
export function splitIntoChunks(text: string): string[] {
  const chunks: string[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length <= MAX_CHUNK_LENGTH) {
      chunks.push(line)
      continue
    }

    // A single sentence longer than a chunk is cut wherever it reaches the limit.
    const pieces = line
      .split(SENTENCE_END_REGEX)
      .filter(Boolean)
      .flatMap((sentence) => sliceEvery(sentence, MAX_CHUNK_LENGTH))

    let current = ""
    for (const piece of pieces) {
      // English sentences were separated by a space; Chinese ones by nothing.
      const joined = current
        ? `${current}${ASCII_END_REGEX.test(current) ? " " : ""}${piece}`
        : piece
      if (joined.length > MAX_CHUNK_LENGTH) {
        chunks.push(current)
        current = piece
      } else {
        current = joined
      }
    }
    if (current) chunks.push(current)
  }

  return chunks
}

function countLettersAndDigits(text: string): number {
  return text.match(LETTER_OR_DIGIT_REGEX)?.length ?? 0
}

async function translateChunk(
  chunk: string,
  sourceLang: YoudaoLang,
  targetLang: YoudaoLang,
  signal?: AbortSignal,
): Promise<string> {
  // Lines already in the target language, or with no words at all, stay as they are.
  const chunkLang = getYoudaoScriptLang(chunk)
  if (!chunkLang && !hasLetters(chunk)) return chunk
  if (chunkLang === targetLang) return chunk
  if (chunkLang !== sourceLang) {
    throw new Error(`Youdao cannot translate this line into ${targetLang}: ${chunk.slice(0, 40)}`)
  }

  const page = await fetchYoudaoPage(chunk, signal)
  const result = page.machineTranslation
  if (result) {
    // The page echoes the text it translated; a shorter echo means it was cut off.
    if (countLettersAndDigits(result.source) < countLettersAndDigits(chunk) * 0.9) {
      throw new Error("Youdao translated only part of the text")
    }
    return result.translation
  }

  // Text the dictionary knows gets an entry instead of a machine translation.
  const sense = page.definitions[0]
  if (sense) return senseToTranslation(sense)

  // A name or code word the dictionary does not know reads the same translated.
  if (getYoudaoTerm(chunk)) return chunk
  throw new Error("Youdao returned no translation")
}

/**
 * Translates plain text between English and Chinese through Youdao Dictionary's result
 * page. Source text in the target language comes back unchanged.
 */
export async function youdaoTranslate(
  text: string,
  sourceCode: LangCodeISO6393 | "auto",
  targetCode: LangCodeISO6393,
  options?: { textFormat?: TranslationTextFormat; signal?: AbortSignal },
): Promise<string> {
  if (options?.textFormat === "html") {
    throw new Error("Youdao translator does not support HTML fragments")
  }

  const targetLang = toYoudaoLang(targetCode)
  if (!targetLang) {
    throw new Error(`Youdao only translates between English and Chinese, not into ${targetCode}`)
  }

  // Numbers and symbols alone need no translation.
  if (!hasLetters(text)) return text

  const sourceLang = sourceCode === "auto" ? getYoudaoScriptLang(text) : toYoudaoLang(sourceCode)
  if (!sourceLang) {
    throw new Error(
      `Youdao only translates between English and Chinese, not from ${sourceCode === "auto" ? "this language" : sourceCode}`,
    )
  }
  if (sourceLang === targetLang) return text

  const mayBeOtherLatinLanguage =
    sourceLang === "en" && sourceCode === "auto" && !getYoudaoTerm(text)
  if (mayBeOtherLatinLanguage && isClearlyNotEnglish(text)) {
    throw new Error(
      "Youdao only translates English and Chinese; this text looks like another language",
    )
  }

  const chunks = splitIntoChunks(text)
  if (text.length > MAX_YOUDAO_TEXT_LENGTH || chunks.filter(Boolean).length > MAX_CHUNKS) {
    throw new Error(`Youdao translates text up to ${MAX_YOUDAO_TEXT_LENGTH} characters`)
  }

  const translations = await Promise.all(
    chunks.map((chunk) =>
      chunk ? translateChunk(chunk, sourceLang, targetLang, options?.signal) : Promise.resolve(""),
    ),
  )
  return translations.join("\n")
}

/**
 * The dictionary entry for a word or short phrase, or null for a sentence or a term
 * Youdao has no phonetics or senses for.
 */
export async function lookupYoudaoTerm(
  text: string,
  signal?: AbortSignal,
): Promise<YoudaoTermEntry | null> {
  const term = getYoudaoTerm(text)
  if (!term || !getYoudaoScriptLang(term)) return null

  const page = await fetchYoudaoPage(term, signal)
  if (page.pronunciations.length === 0 && page.definitions.length === 0) return null
  return {
    headword: page.headword ?? term,
    pronunciations: page.pronunciations,
    definitions: page.definitions,
  }
}
