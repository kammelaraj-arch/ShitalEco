// Voice announcements for the Quick Donation kiosk ("Sairam", decline/timeout
// prompts). The app runs inside Capacitor's Android WebView, where the Web
// Speech API has two well-known gotchas that make it silently do nothing:
//
//   1. It must be "unlocked" by a real user gesture before any programmatic
//      speak() works. Our success/decline prompts fire from async poll
//      callbacks (no gesture), so without a prior gesture-triggered speak the
//      engine refuses them. Fix: prime it once on the first touch anywhere.
//   2. Calling speechSynthesis.cancel() immediately before speak() races and
//      drops the just-queued utterance on Android. Fix: cancel, then speak on
//      a short timeout; and resume() in case the engine is paused.
//
// All of this is pure web code, so it ships with the live bundle the device
// loads — no APK re-flash needed.

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

/**
 * Attach one-time listeners that unlock the speech engine on the first user
 * interaction. Safe to call on every mount — it self-deduplicates.
 */
export function unlockVoiceOnFirstGesture(): void {
  const s = synth()
  if (!s || unlocked) return

  const prime = () => {
    if (unlocked) return
    unlocked = true
    try {
      // Warm the voice list (Android loads it lazily).
      s.getVoices()
      // A near-silent utterance inside the gesture satisfies the WebView's
      // autoplay/gesture policy so later async speaks are allowed.
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      s.speak(u)
    } catch { /* ignore — best effort */ }
    window.removeEventListener('pointerdown', prime)
    window.removeEventListener('touchstart', prime)
    window.removeEventListener('click', prime)
    window.removeEventListener('keydown', prime)
  }

  window.addEventListener('pointerdown', prime, { once: false })
  window.addEventListener('touchstart', prime, { once: false })
  window.addEventListener('click', prime, { once: false })
  window.addEventListener('keydown', prime, { once: false })
}

/**
 * Speak a phrase. De-dupes identical phrases within 3s so a 1s poll loop that
 * keeps reporting the same state doesn't stutter, but the same phrase can play
 * again on a later, separate event.
 */
export function speak(text: string): void {
  const s = synth()
  if (!s) return

  const now = Date.now()
  if (text === lastText && now - lastAt < 3000) return
  lastText = text
  lastAt = now

  const utter = () => {
    try {
      s.resume() // engine can get stuck 'paused' in the WebView
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 0.95
      u.pitch = 1.0
      u.volume = 1.0
      u.lang = 'en-GB'
      const v = pickVoice(s)
      if (v) u.voice = v
      // Cancel any in-flight prompt, then speak on a short delay so the
      // cancel() doesn't race-drop this utterance (Android quirk).
      s.cancel()
      setTimeout(() => { try { s.speak(u) } catch { /* ignore */ } }, 60)
    } catch { /* speech unavailable — silent fallback */ }
  }

  // If voices haven't loaded yet, wait for them once, then speak.
  if ((s.getVoices() || []).length === 0) {
    const onVoices = () => { s.removeEventListener('voiceschanged', onVoices); utter() }
    s.addEventListener('voiceschanged', onVoices)
    // Fallback in case the event never fires.
    setTimeout(utter, 250)
  } else {
    utter()
  }
}
