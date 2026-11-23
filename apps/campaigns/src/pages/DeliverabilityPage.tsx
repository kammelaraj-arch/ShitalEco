export function DeliverabilityPage() {
  return (
    <div className="p-6">
      <div className="rounded-xl p-8 border border-dashed border-white/10 bg-white/5 max-w-xl">
        <div className="font-bold text-lg">Deliverability — Phase 1c</div>
        <p className="text-sm opacity-70 mt-2">
          Bounce rate, opens, clicks and unsubscribes per channel. Sends land in the existing{' '}
          <a href="https://admin.shital.org.uk/admin/email-templates/sent" target="_blank" rel="noreferrer"
             className="underline text-yellow-400">/admin/email-templates/sent</a>{' '}
          audit view meanwhile.
        </p>
      </div>
    </div>
  )
}
