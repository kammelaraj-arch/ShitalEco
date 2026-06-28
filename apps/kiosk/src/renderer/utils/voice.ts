// Voice announcements for the kiosk ("Sairam" on success, decline/cancel
// prompts). Mirrors apps/quick-donation/src/lib/voice.ts.
//
// The kiosk runs in Electron (Chromium — full speechSynthesis support) AND in
// Capacitor's Android WebView, where the Web Speech API has two gotchas:
//   1. It must be unlocked by a real user gesture before programmatic speak()
//      works; our prompts fire from async poll callbacks / screen mounts.
//   2. cancel() immediately before speak() race-drops the new utterance on
//      Android.
// This helper handles both, and is a harmless no-op where speech is
// unavailable. It does NOT touch any card-reader logic.

let unlocked = false
let lastText = ''
let lastAt = 0

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  return window.speechSynthesis
}

function pickVoice(s: SpeechSynthesis): SpeechSynthesisVoice | undefined {
  const voices = s.getVoices() || []
  return (
    voices.find(v => v.lang === 'en-GB') ||
    voices.find(v => v.lang && v.lang.startsWith('en')) ||
    voices[0]
  )
}

/** Unlock the speech engine on the first user interaction. Safe to call on
 *  every mount — it self-deduplicates. */
export function unlockVoiceOnFirstGesture(): void {
  const s = synth()
  if (!s || unlocked) return

  const prime = () => {
    if (unlocked) return
    unlocked = true
    try {
      s.getVoices()
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      s.speak(u)
    } catch { /* best effort */ }
    window.removeEventListener('pointerdown', prime)
    window.removeEventListener('touchstart', prime)
    window.removeEventListener('mousedown', prime)
    window.removeEventListener('click', prime)
    window.removeEventListener('keydown', prime)
  }

  window.addEventListener('pointerdown', prime)
  window.addEventListener('touchstart', prime)
  window.addEventListener('mousedown', prime)
  window.addEventListener('click', prime)
  window.addEventListener('keydown', prime)
}

/** Speak a phrase. De-dupes identical phrases within 3s. */
export function speak(text: string): void {
  const s = synth()
  if (!s) return

  const now = Date.now()
  if (text === lastText && now - lastAt < 3000) return
  lastText = text
  lastAt = now

  const utter = () => {
    try {
      s.resume()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 0.95
      u.pitch = 1.0
      u.volume = 1.0
      u.lang = 'en-GB'
      const v = pickVoice(s)
      if (v) u.voice = v
      s.cancel()
      setTimeout(() => { try { s.speak(u) } catch { /* ignore */ } }, 60)
    } catch { /* speech unavailable — silent fallback */ }
  }

  if ((s.getVoices() || []).length === 0) {
    const onVoices = () => { s.removeEventListener('voiceschanged', onVoices); utter() }
    s.addEventListener('voiceschanged', onVoices)
    setTimeout(utter, 250)
  } else {
    utter()
  }
}
