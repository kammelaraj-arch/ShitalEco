export function TemplatesPage() {
  return (
    <div className="p-6">
      <div className="rounded-xl p-8 border border-dashed border-white/10 bg-white/5 max-w-xl">
        <div className="font-bold text-lg">Templates — Phase 1c</div>
        <p className="text-sm opacity-70 mt-2">
          Edit existing email templates at{' '}
          <a href="https://admin.shital.org.uk/admin/email-templates" target="_blank" rel="noreferrer"
             className="underline text-yellow-400">admin.shital.org.uk → Email Templates</a>.
          A tablet-friendly composer lives here next.
        </p>
      </div>
    </div>
  )
}
