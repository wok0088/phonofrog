import type { LangCodeISO6393 } from "@read-frog/definitions"
import type { PhoneticAccent } from "@/utils/host/translate/api/youdao"
import { Icon } from "@iconify/react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/base-ui/button"
import {
  getYoudaoScriptLang,
  getYoudaoTerm,
  lookupYoudaoTerm,
} from "@/utils/host/translate/api/youdao"
import { i18n } from "@/utils/i18n"

const ACCENT_LABEL_KEYS = {
  uk: "translationHub.youdao.uk",
  us: "translationHub.youdao.us",
  pinyin: "translationHub.youdao.pinyin",
} as const satisfies Record<PhoneticAccent, string>

const ACCENT_PLAY_KEYS = {
  uk: "translationHub.youdao.playUk",
  us: "translationHub.youdao.playUs",
} as const

interface YoudaoEntryProps {
  inputText: string
  targetLanguage: LangCodeISO6393
  /** Youdao's plain translation, shown for sentences and for words with no entry. */
  translation: string
}

/**
 * What the Youdao card shows in the Hub for a word or short phrase: its phonetics with
 * pronunciation clips and, when Youdao's senses are in the target language, every
 * sense instead of only the first.
 */
export function YoudaoEntry({ inputText, targetLanguage, translation }: YoudaoEntryProps) {
  const term = getYoudaoTerm(inputText)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // The translation already fetched this page, so this reads it from the cache.
  const { data: entry } = useQuery({
    queryKey: ["translation-hub-youdao-entry", term],
    queryFn: ({ signal }) => (term ? lookupYoudaoTerm(term, signal) : null),
    enabled: term !== null,
    staleTime: Infinity,
    retry: false,
    meta: { suppressToast: true },
  })

  useEffect(() => () => audioRef.current?.pause(), [])

  if (!term || !entry) return translation

  // Senses are Chinese for an English headword and English for a Chinese one.
  const termLang = getYoudaoScriptLang(term)
  const sensesMatchTarget =
    (termLang === "en" && (targetLanguage === "cmn" || targetLanguage === "cmn-Hant")) ||
    (termLang === "zh" && targetLanguage === "eng")

  const playAudio = (url: string) => {
    audioRef.current?.pause()
    const audio = new Audio(url)
    audioRef.current = audio
    // A failed pronunciation clip leaves the phonetics readable; nothing to report.
    audio.play().catch(() => undefined)
  }

  return (
    <div className="space-y-2 whitespace-normal">
      {entry.pronunciations.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="font-semibold break-all">{entry.headword}</span>
          {entry.pronunciations.map(({ accent, phonetic, audioUrl }) => (
            <span
              key={`${accent}-${phonetic}`}
              className="inline-flex min-w-0 items-center gap-1.5 text-sm"
            >
              <span className="text-muted-foreground">{i18n.t(ACCENT_LABEL_KEYS[accent])}</span>
              <span className="break-all">{accent === "pinyin" ? phonetic : `/${phonetic}/`}</span>
              {audioUrl && accent !== "pinyin" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => playAudio(audioUrl)}
                  title={i18n.t(ACCENT_PLAY_KEYS[accent])}
                  aria-label={i18n.t(ACCENT_PLAY_KEYS[accent])}
                >
                  <Icon icon="tabler:volume" className="size-3.5" />
                </Button>
              )}
            </span>
          ))}
        </div>
      )}
      {sensesMatchTarget && entry.definitions.length > 0 ? (
        <ul className="space-y-1">
          {entry.definitions.map((definition) => (
            <li key={definition} className="break-words">
              {definition}
            </li>
          ))}
        </ul>
      ) : (
        <div className="break-words whitespace-pre-wrap">{translation}</div>
      )}
    </div>
  )
}
