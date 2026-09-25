/**
 * Guard tier sounds — Web Audio synthesis.
 *
 * Three tones, one per operational tier (see docs/phase-8/operational-states.md):
 *   positive → two rising notes (success chime)
 *   warning  → single mid tone (attention)
 *   negative → single low tone (denial)
 *
 * No audio files. Web Audio API synthesises them at runtime, ~2KB of code,
 * zero network. Works offline once the page loads.
 *
 * Autoplay policies block audio until the first user gesture. Guards always
 * tap a digit before any result, so by the time we play, the audio context
 * is unlocked. If it's not, the play() promise rejects silently — the visual
 * result is unaffected.
 */

type Tier = 'positive' | 'warning' | 'negative'

interface TierTone {
  // Sequence of [frequency Hz, duration ms] pairs.
  notes: [number, number][]
  waveType: OscillatorType
  gain: number
}

const TONES: Record<Tier, TierTone> = {
  positive: {
    notes: [
      [660, 110], // E5
      [880, 160], // A5
    ],
    waveType: 'sine',
    gain: 0.12,
  },
  warning: {
    notes: [[440, 220]], // A4
    waveType: 'triangle',
    gain: 0.14,
  },
  negative: {
    notes: [[220, 320]], // A3
    waveType: 'square',
    gain: 0.10,
  },
}

let audioContext: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (audioContext) return audioContext
  type AudioContextCtor = typeof AudioContext
  const w = window as Window & {
    AudioContext?: AudioContextCtor
    webkitAudioContext?: AudioContextCtor
  }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  if (!Ctor) return null
  audioContext = new Ctor()
  return audioContext
}

function playTone(ctx: AudioContext, tone: TierTone): void {
  const now = ctx.currentTime
  let cursor = now

  for (const [freq, durationMs] of tone.notes) {
    const duration = durationMs / 1000

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = tone.waveType
    osc.frequency.value = freq

    // Attack + release envelope to avoid clicks.
    gain.gain.setValueAtTime(0, cursor)
    gain.gain.linearRampToValueAtTime(tone.gain, cursor + 0.01)
    gain.gain.setValueAtTime(tone.gain, cursor + duration - 0.02)
    gain.gain.linearRampToValueAtTime(0, cursor + duration)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(cursor)
    osc.stop(cursor + duration)

    cursor += duration
  }
}

/**
 * Play the sound for a tier. Silently no-ops if the browser blocks audio.
 * Never throws — the visual result must not be affected by audio failure.
 */
export function playTierSound(tier: Tier): void {
  try {
    const ctx = getContext()
    if (!ctx) return

    // Resume if the context was suspended (autoplay policy).
    if (ctx.state === 'suspended') {
      void ctx.resume().then(() => playTone(ctx, TONES[tier])).catch(() => {})
    } else {
      playTone(ctx, TONES[tier])
    }
  } catch {
    // Never propagate audio failures.
  }
}
