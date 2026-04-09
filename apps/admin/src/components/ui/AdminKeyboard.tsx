'use client'
/**
 * AdminKeyboard — global on-screen keyboard for admin portal touch screens.
 *
 * Wrap your layout with <AdminKeyboardProvider>.
 * Any component can then call:
 *   const kb = useAdminKeyboard()
 *   kb.open(currentValue, 'text', newVal => setState(newVal), 'Field label')
 */
import React, { createContext, useCallback, useContext, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

export type KbMode = 'numeric' | 'text' | 'postcode'

interface KbSession {
  value: string
  mode: KbMode
  label: string
  commit: (v: string) => void
  onDone?: () => void
}

interface AdminKeyboardCtx {
  open: (val: string, mode: KbMode, commit: (v: string) => void, label?: string, onDone?: () => void) => void
  close: () => void
}

const Ctx = createContext<AdminKeyboardCtx>({ open: () => {}, close: () => {} })
export const useAdminKeyboard = () => useContext(Ctx)

// ── Layouts ──────────────────────────────────────────────────────────────────

const NUM_ROWS = [['7','8','9'],['4','5','6'],['1','2','3'],['.','0','⌫']]

const TXT_ROWS = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M','⌫'],
  ['@','.','SPACE','-','_','CLEAR'],
]

const PC_ROWS = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M','⌫'],
  ['SPACE','CLEAR'],
]

// ── Key ──────────────────────────────────────────────────────────────────────

function Key({ k, onPress, wide, numeric }: { k: string; onPress: (k: string) => void; wide?: boolean; numeric?: boolean }) {
  const isBs = k === '⌫'; const isCl = k === 'CLEAR'; const isSp = k === 'SPACE'
  return (
    <motion.button
      type="button" whileTap={{ scale: 0.82 }} onPointerDown={() => onPress(k)}
      className="rounded-xl font-black flex items-center justify-center select-none"
      style={{
        flex: wide ? 2 : 1, minWidth: wide ? 56 : 28,
        height: numeric ? 52 : 42,
        fontSize: isSp || isCl ? 10 : numeric ? 20 : 14,
        background: isBs ? '#3b1515' : isCl ? '#2a1e00' : numeric ? '#1a0a0a' : '#1e1010',
        color: isBs ? '#ef4444' : isCl ? '#d97706' : '#fff',
        border: `1.5px solid ${isBs ? '#7f1d1d' : isCl ? '#78350f' : '#3a1a1a'}`,
      }}
    >
      {isSp ? 'SPC' : k}
    </motion.button>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

function Panel({ s, live, setLive, onClose }: {
  s: KbSession; live: string; setLive: (v: string) => void; onClose: () => void
}) {
  const press = useCallback((k: string) => {
    let next = live
    if (k === '⌫')     next = live.slice(0, -1)
    else if (k === 'CLEAR') next = ''
    else if (k === 'SPACE') next = live + ' '
    else                    next = live + k
    setLive(next)
    s.commit(next)
  }, [live, s, setLive])

  const done = () => { s.onDone?.(); onClose() }

  const rows = s.mode === 'numeric' ? NUM_ROWS : s.mode === 'postcode' ? PC_ROWS : TXT_ROWS
  const isNum = s.mode === 'numeric'

  return (
    <motion.div
      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 34, stiffness: 400 }}
      className="fixed bottom-0 left-0 right-0 z-[9999]"
      style={{ background: '#0d0505', borderTop: '2px solid #B91C1C', boxShadow: '0 -8px 40px rgba(0,0,0,0.7)' }}
    >
      {/* Value bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5">
        <span className="text-white/35 text-xs font-bold uppercase tracking-wider flex-shrink-0 w-24 truncate">{s.label}</span>
        <div className="flex-1 bg-white/5 rounded-xl px-4 py-2 font-mono text-white font-bold text-lg min-h-[38px] flex items-center">
          {live || <span className="text-white/20 text-sm font-normal">Type below…</span>}
        </div>
        <motion.button whileTap={{ scale: 0.94 }} onPointerDown={done}
          className="px-5 py-2 rounded-xl font-black text-white text-sm flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
          Done ✓
        </motion.button>
      </div>

      {/* Keys */}
      <div className={`mx-auto px-2 py-2 flex flex-col gap-1.5 ${isNum ? 'max-w-[260px]' : 'max-w-3xl'}`}>
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-1.5">
            {row.map(k => <Key key={k} k={k} onPress={press} wide={k === 'SPACE' || k === 'CLEAR'} numeric={isNum} />)}
            {ri === rows.length - 1 && (
              <motion.button whileTap={{ scale: 0.92 }} onPointerDown={done}
                className="rounded-xl font-black text-white flex items-center justify-center"
                style={{ flex: 2, minWidth: 56, height: isNum ? 52 : 42, fontSize: 13,
                  background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
                DONE
              </motion.button>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AdminKeyboardProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<KbSession | null>(null)
  const [live, setLiveInner] = useState('')

  const setLive = useCallback((v: string) => setLiveInner(v), [])

  const open = useCallback((val: string, mode: KbMode, commit: (v: string) => void, label = 'Input', onDone?: () => void) => {
    setLiveInner(val)
    setSession({ value: val, mode, label, commit, onDone })
  }, [])

  const close = useCallback(() => setSession(null), [])

  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      <AnimatePresence>
        {session && (
          <>
            <motion.div key="overlay" initial={{ opacity: 0 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9998]" onClick={close} />
            <Panel key="panel" s={session} live={live} setLive={setLive} onClose={close} />
          </>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  )
}
