export function AudiencesPage() {
  return (
    <div className="p-6">
      <EmptyState
        title="Audiences — Phase 1c"
        blurb="Saved segments over contacts, donations and recurring giving. Give a segment a name and a filter, reuse it in every campaign."
      />
    </div>
  )
}

function EmptyState({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="rounded-xl p-8 border border-dashed border-white/10 bg-white/5 max-w-xl">
      <div className="font-bold text-lg">{title}</div>
      <p className="text-sm opacity-70 mt-2">{blurb}</p>
    </div>
  )
}
