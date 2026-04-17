'use client'
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export interface BrandingConfig {
  logoUrl: string       // URL to logo image (empty = use text)
  orgName: string
  orgSubtitle: string
  primaryColor: string  // hex, e.g. "#B91C1C"
  accentColor: string   // hex, e.g. "#FFD700"
}

const DEFAULTS: BrandingConfig = {
  logoUrl:      '',
  orgName:      'Shital',
  orgSubtitle:  'Business Portal',
  primaryColor: '#B91C1C',
  accentColor:  '#FFD700',
}

const STORAGE_KEY = 'shital-admin-branding'

const BrandingContext = createContext<{
  branding: BrandingConfig
  setBranding: (b: BrandingConfig) => void
}>({ branding: DEFAULTS, setBranding: () => {} })

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBrandingState] = useState<BrandingConfig>(DEFAULTS)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) setBrandingState({ ...DEFAULTS, ...JSON.parse(stored) })
    } catch {}
  }, [])

  function setBranding(b: BrandingConfig) {
    setBrandingState(b)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(b)) } catch {}
  }

  const P = BrandingContext.Provider as unknown as React.FC<{ value: { branding: BrandingConfig; setBranding: (b: BrandingConfig) => void }; children: ReactNode }>
  return <P value={{ branding, setBranding }}>{children}</P>
}

export function useBranding() {
  return useContext(BrandingContext)
}
