import { useState } from 'react'
import { api } from '../api'

interface AddressLookupProps {
  postcode: string
  address: string
  uprn?: string
  required?: boolean
  // Compact mode skips labels — for use inside referees/emergency-contact
  // blocks where the parent already has its own heading.
  compact?: boolean
  onChange: (next: { postcode: string; address: string; uprn: string }) => void
  // Optional override of the postcode field label (e.g. "Their postcode")
  postcodeLabel?: string
  addressLabel?: string
}

const inp = 'w-full px-4 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 focus:border-saffron-400/50 outline-none text-ivory-100 placeholder-white/30'
const lbl = 'block text-xs font-bold uppercase tracking-widest mb-1.5'

// Reusable postcode → address picker. Replaces every "type your address as
// free text" textarea on the volunteer + contact + gift-aid forms with a
// search-and-select flow backed by /service/postcode-lookup.
//
// The selected formatted string + UPRN are reported back via onChange so
// callers can stash them in their own state — the component is fully
// controlled (no internal address state survives unmount).
export function AddressLookup({
  postcode, address, uprn = '',
  required = false, compact = false,
  postcodeLabel, addressLabel,
  onChange,
}: AddressLookupProps) {
  const [results, setResults] = useState<Array<{ formatted: string; uprn: string }>>([])
  const [looking, setLooking] = useState(false)
  const [err, setErr] = useState('')
  const [manual, setManual] = useState(false)

  async function lookup() {
    setErr('')
    if (!postcode.trim()) {
      setErr('Enter a postcode first')
      return
    }
    setLooking(true)
    try {
      const found = await api.lookupPostcode(postcode)
      setResults(found)
      if (!found.length) setErr('No addresses found — check the postcode.')
    } catch {
      setErr('Lookup failed. Try again, or enter manually.')
    } finally {
      setLooking(false)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        {!compact && (
          <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>
            {postcodeLabel || 'Postcode'}{required ? ' *' : ''}
          </label>
        )}
        <div className="flex gap-2">
          <input value={postcode}
            onChange={e => onChange({ postcode: e.target.value.toUpperCase(), address, uprn })}
            placeholder="HA9 0BB"
            className={inp + ' uppercase flex-1'} />
          <button type="button" onClick={lookup} disabled={looking || !postcode.trim()}
            className="px-4 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
            style={{ background: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.3)', color: '#FFD980' }}>
            {looking ? 'Searching…' : 'Find address'}
          </button>
        </div>
        {err && <p className="text-xs mt-1" style={{ color: '#f87171' }}>{err}</p>}
      </div>

      {results.length > 0 && (
        <div>
          {!compact && (
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>
              {addressLabel || 'Select your address'}{required ? ' *' : ''}
            </label>
          )}
          <select value={address}
            onChange={e => {
              const chosen = results.find(r => r.formatted === e.target.value)
              onChange({
                postcode,
                address: e.target.value,
                uprn: chosen?.uprn ?? '',
              })
            }}
            className={inp}>
            <option value="">— Select —</option>
            {results.map((a, i) => <option key={i} value={a.formatted}>{a.formatted}</option>)}
          </select>
        </div>
      )}

      {address && (
        <p className="text-xs px-3 py-2 rounded-lg"
          style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#86efac' }}>
          ✓ {address}
          {uprn && <span className="opacity-60 ml-2 font-mono">UPRN {uprn}</span>}
        </p>
      )}

      {!address && !results.length && !manual && (
        <button type="button" onClick={() => setManual(true)}
          className="text-xs underline"
          style={{ color: 'rgba(255,248,220,0.4)' }}>
          Can't find your address? Enter manually
        </button>
      )}

      {manual && !address && (
        <textarea value={address}
          onChange={e => onChange({ postcode, address: e.target.value, uprn: '' })}
          rows={2} placeholder="House number / name, street, town"
          className={inp + ' resize-none'} />
      )}
    </div>
  )
}
