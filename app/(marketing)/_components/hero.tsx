'use client'

import Link from 'next/link'
import { motion } from 'motion/react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Marketing hero — animated.
 *
 * Client Component. The only animated surface on the landing page;
 * everything below the fold is static Server-rendered content.
 *
 * Choreography (on mount, no scroll trigger):
 *   1. Headline, subhead, CTAs stagger up.
 *   2. Phone mockup fades in with slight scale + rotation.
 *   3. Four floating status cards stagger in around the phone.
 *   4. Each floating card then enters a slow infinite y-axis float —
 *      phases offset so they do not move in lockstep.
 *
 * Motion is imported from `motion/react` (the modern package name;
 * framer-motion is the legacy alias). The package is `motion@^14`.
 *
 * The phone mockup is illustrative only. It mirrors the visual shape
 * of app/guard/entry — a status title, six dot indicators, and a
 * three-by-four digit keypad. It is not interactive.
 */

const FADE_UP = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

const STAGGER = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
}

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Background flourish — very subtle radial glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06]"
        style={{
          backgroundImage:
            'radial-gradient(60% 40% at 50% 0%, var(--color-foreground) 0%, transparent 70%)',
        }}
      />

      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-6 py-20 sm:py-28 lg:grid-cols-2 lg:gap-16">
        {/* ---------- Left column — copy ---------- */}
        <motion.div
          variants={STAGGER}
          initial="hidden"
          animate="visible"
          className="flex flex-col gap-6"
        >
          <motion.p
            variants={FADE_UP}
            className="text-muted-foreground text-xs font-medium uppercase tracking-wide"
          >
            Physical access control for residential estates
          </motion.p>

          <motion.h1
            variants={FADE_UP}
            className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl"
          >
            Every entry. Every exit.{' '}
            <span className="text-muted-foreground">On the record.</span>
          </motion.h1>

          <motion.p
            variants={FADE_UP}
            className="text-muted-foreground max-w-xl text-base sm:text-lg"
          >
            e-shomer is server-authoritative access control for residential
            estates. Guards process gate traffic with 6-digit PINs. Every
            attempt is logged. No fabricated exits. No unresolved visits
            quietly swept away.
          </motion.p>

          <motion.div
            variants={FADE_UP}
            className="mt-2 flex flex-wrap items-center gap-3"
          >
            <Link
              href="/admin/signup"
              className={cn(buttonVariants({ size: 'lg' }), 'h-11 px-6 text-base')}
            >
              Create your estate
            </Link>
            <Link
              href="#how-it-works"
              className={cn(
                buttonVariants({ size: 'lg', variant: 'outline' }),
                'h-11 px-6 text-base',
              )}
            >
              See how it works
            </Link>
          </motion.div>

          <motion.p
            variants={FADE_UP}
            className="text-muted-foreground mt-2 text-xs"
          >
            Built for Nigerian residential estates. Server-authoritative
            by design — every gate action is verified before it is written.
          </motion.p>
        </motion.div>

        {/* ---------- Right column — phone mockup + floating cards ---------- */}
        <div className="relative mx-auto flex h-[520px] w-full max-w-md items-center justify-center lg:h-[560px]">
          {/* Floating status cards */}
          <FloatingCard
            delay={0.55}
            phase={0}
            className="-top-2 left-0 sm:left-4"
            tone="emerald"
            title="ENTRY granted"
            meta="Unit 4B · 19:04"
          />
          <FloatingCard
            delay={0.7}
            phase={1.4}
            className="top-24 -right-2 sm:right-0"
            tone="muted"
            title="Guest PIN issued"
            meta="expires in 6h"
          />
          <FloatingCard
            delay={0.85}
            phase={2.6}
            className="bottom-20 -left-2 sm:left-0"
            tone="muted"
            title="EXIT recorded"
            meta="19:42 · gate 2"
          />
          <FloatingCard
            delay={1.0}
            phase={3.8}
            className="-bottom-2 right-2 sm:right-6"
            tone="amber"
            title="Unusual access flagged"
            meta="guard notified"
          />

          {/* Phone mockup */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94, rotate: -2 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
            className="relative z-10 w-[260px]"
          >
            <div className="border-border/60 bg-background rounded-[2.25rem] border p-2 shadow-2xl">
              <div className="bg-foreground overflow-hidden rounded-[1.75rem]">
                <div className="bg-background flex aspect-[9/19] flex-col px-5 pt-6 pb-5">
                  {/* Status */}
                  <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                    Shift active · Gate 1
                  </p>

                  {/* Title */}
                  <h3 className="mt-3 text-lg font-semibold tracking-tight">
                    Enter visitor PIN
                  </h3>
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    6-digit credential issued by the resident
                  </p>

                  {/* Dots */}
                  <div className="mt-6 flex justify-center gap-2">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <span
                        key={i}
                        className={cn(
                          'h-2.5 w-2.5 rounded-full',
                          i < 2 ? 'bg-foreground' : 'bg-muted',
                        )}
                      />
                    ))}
                  </div>

                  {/* Keypad */}
                  <div className="mt-auto grid grid-cols-3 gap-2 pt-8">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map(
                      (k, i) => (
                        <div
                          key={i}
                          className={cn(
                            'flex h-10 items-center justify-center rounded-md text-sm font-medium',
                            k === '' ? '' : 'bg-muted',
                          )}
                        >
                          {k}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Floating status card
// ---------------------------------------------------------------------------

const TONE_CLASS: Record<string, string> = {
  emerald:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200',
  amber:
    'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200',
  muted: 'border-border bg-background',
}

function FloatingCard({
  delay,
  phase,
  className,
  tone,
  title,
  meta,
}: {
  delay: number
  phase: number
  className?: string
  tone: keyof typeof TONE_CLASS
  title: string
  meta: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.5,
        ease: [0.22, 1, 0.36, 1],
        delay,
      }}
      className={cn('absolute z-20', className)}
    >
      <motion.div
        animate={{ y: [0, -6, 0, 6, 0] }}
        transition={{
          duration: 9,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: phase,
        }}
        className={cn(
          'rounded-lg border px-3 py-2 shadow-lg backdrop-blur',
          TONE_CLASS[tone],
        )}
      >
        <p className="text-xs font-medium leading-tight">{title}</p>
        <p className="mt-0.5 text-[10px] opacity-80">{meta}</p>
      </motion.div>
    </motion.div>
  )
}
