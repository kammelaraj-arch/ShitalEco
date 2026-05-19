'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import {
  ORG_STRUCTURE, KIND_LABELS, KIND_STYLES, childrenOf, type OrgNode,
} from '@/lib/org-structure'
import { roleLabel } from '@/lib/roles'
import { CODE_OF_CONDUCT, CODE_OF_CONDUCT_PREAMBLE } from '@/lib/code-of-conduct'

/**
 * Organisation Structure — read-only view of the temple's reporting lines as
 * defined in lib/org-structure.ts. The static structure encodes UK Charity
 * Commission best practice (single Board ultimately responsible, CEO as sole
 * executive, audit independent of management, LMCs delegated but accountable
 * upward). Branches are pulled live from /branches so the tree expands as the
 * temple opens new locations without code changes.
 */

interface Branch {
  id: string
  branch_id: string
  name: string
  city: string
}

export default function OrgStructurePage() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<{ branches: Branch[] }>('/branches')
      .then(d => setBranches(d.branches || []))
      .catch(() => { /* page renders fine without live branches */ })
  }, [])

  // Branch + LMC template nodes get expanded into one node per real branch
  // (or kept as the template if no branches exist yet).
  function expandBranchTemplates(nodes: OrgNode[]): OrgNode[] {
    return nodes.flatMap(n => {
      if (n.id === 'branch_template' && branches.length > 0) {
        return branches.map(b => ({
          ...n,
          id:    `branch_${b.branch_id}`,
          label: `Branch Manager — ${b.name}`,
          charter: `Runs the ${b.name}${b.city ? ` (${b.city})` : ''} branch under standardised charity-wide policies. Manages local staff and volunteers, reports monthly KPIs to the CEO.`,
        }))
      }
      if (n.id === 'lmc_template' && branches.length > 0) {
        return branches.map(b => ({
          ...n,
          id:    `lmc_${b.branch_id}`,
          label: `${b.name} LMC`,
          charter: `Local governance for ${b.name}. Sets local events calendar, manages the branch volunteer rota, runs local fundraising. Accountable to the Board via its LMC Chair; operational coordination with ${b.name} Branch Manager.`,
        }))
      }
      return [n]
    })
  }

  // Recursive tree renderer. Branch templates are expanded into real branches
  // before recursion so children of "branch_template" become children of
  // every branch_xyz node.
  function renderNode(node: OrgNode, depth: number) {
    const directChildren = childrenOf(node.id)
    const childrenToRender = node.id === 'branch_template'
      // Children of the branch template (staff, volunteers) get re-parented
      // under each real branch — handled by the recursion when the template
      // node itself is replaced.
      ? []
      : expandBranchTemplates(directChildren)
    const expandedChildren =
      node.id.startsWith('branch_')
        // Real branch — its children are the children of the template.
        ? expandBranchTemplates(
            ORG_STRUCTURE.filter(n => n.reportsTo === 'branch_template')
          )
        : childrenToRender

    const style = KIND_STYLES[node.kind]
    const isOpen = expanded === node.id

    return (
      <div key={node.id} style={{ marginLeft: depth * 20 }} className="mb-2">
        <div
          onClick={() => setExpanded(isOpen ? null : node.id)}
          className={`group cursor-pointer rounded-xl border bg-white/2 hover:bg-white/5 transition-all ${style.border}`}
        >
          <div className="flex items-start gap-3 p-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className="text-white font-bold text-sm">{node.label}</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${style.badge}`}>
                  {KIND_LABELS[node.kind]}
                </span>
                {node.cite && (
                  <span className="text-[10px] text-white/30 font-mono">{node.cite}</span>
                )}
              </div>
              <p className="text-white/50 text-xs mt-1 leading-relaxed">{node.charter}</p>
              {(node.acceptsRoles.length > 0 || node.dottedTo?.length) && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {node.acceptsRoles.map(r => (
                    <span key={r} className="text-[10px] px-1.5 py-0.5 rounded-full bg-saffron-500/15 text-saffron-300 border border-saffron-500/30">
                      {roleLabel(r)}
                    </span>
                  ))}
                  {node.dottedTo?.map(d => (
                    <span key={d} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10">
                      ⇢ dotted to {d.replace(/^cmte_/, '').replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {expandedChildren.length > 0 && (
              <span className="text-white/30 text-xs">{isOpen ? '▼' : '▶'} {expandedChildren.length}</span>
            )}
          </div>
        </div>
        {isOpen && expandedChildren.length > 0 && (
          <div className="border-l border-white/10 ml-3 pl-2 mt-2">
            {expandedChildren.map(c => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const root = ORG_STRUCTURE.find(n => n.id === 'charity')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-white">🏛️ Organisation Structure</h1>
        <p className="text-white/40 mt-1 max-w-3xl text-sm">
          Reporting lines for SHITAL as a single registered charity with branches
          operating under delegated authority. Follows UK Charity Commission
          guidance (CC3, CC8, CC9, CC30, CC50) and best practice for multi-branch
          charities. Click any node to expand its reports.
        </p>
      </div>

      {/* Governance principles panel — hard rules everyone needs to remember */}
      <div className="glass rounded-2xl p-5 border border-temple-border">
        <h2 className="text-saffron-300 font-black text-sm mb-3">Governance Principles</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-white/70">
          {[
            ['1. The Board of Trustees is the sole ultimate decision-maker.',
              'Everything else operates under delegated authority. The Board can revoke any delegation at any time. CC3.'],
            ['2. One charity, one legal entity.',
              'Branches and LMCs are NOT separate registered charities. All money, contracts, and liabilities sit with SHITAL.'],
            ['3. Trustees govern, CEO executes.',
              'The CEO reports to the full Board, never to the Chair personally. No trustee directs staff individually.'],
            ['4. Auditor independence bypasses the CEO.',
              'External auditor reports to the Audit & Risk Committee → Board. Required by Charities Act 2011 §144 over £1m.'],
            ['5. Local autonomy, central control.',
              'LMCs run day-to-day branch life. Finance, HR, safeguarding, IT are centralised so policy is uniform.'],
            ['6. Separation of duties on finance.',
              'No single person can both initiate AND approve a payment. Treasurer reviews; Finance Manager records. CC8.'],
          ].map(([title, body]) => (
            <div key={title as string} className="p-3 rounded-xl bg-white/2 border border-white/5">
              <p className="text-white font-bold text-xs">{title}</p>
              <p className="text-white/50 text-xs mt-1 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* The tree itself */}
      <div className="glass rounded-2xl p-5 border border-temple-border">
        <h2 className="text-saffron-300 font-black text-sm mb-3">Reporting Lines</h2>
        {root ? renderNode(root, 0) : <p className="text-white/40 text-sm">Structure not loaded.</p>}
      </div>

      {/* Code of Conduct — verbatim from the 2022 Roadmap, now adopted as
          binding rules under M&A §34.5 and §38.1. Visible to every admin
          user so the rules cannot be disputed later. */}
      <div className="glass rounded-2xl p-5 border border-red-500/30 bg-red-500/[0.02]">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-rose-300 font-black text-sm">📜 Code of Conduct — Trustees, LMC, Staff</h2>
          <span className="text-white/30 text-[10px]">Source: 2022 Roadmap, adopted under M&amp;A §34.5 + §38.1</span>
        </div>
        <p className="text-white/50 text-xs leading-relaxed mb-4">
          {CODE_OF_CONDUCT_PREAMBLE}
        </p>
        <div className="space-y-2">
          {CODE_OF_CONDUCT.map(r => (
            <div key={r.id} className="p-3 rounded-xl bg-white/2 border border-white/5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-rose-300 font-mono text-[10px] font-bold">{r.id}</span>
                <p className="text-white text-xs font-semibold flex-1">{r.text}</p>
              </div>
              <p className="text-white/50 text-xs mt-1.5 leading-relaxed">
                <span className="text-white/30">In practice — </span>{r.plain}
              </p>
              <p className="text-white/25 text-[10px] mt-1 font-mono">{r.source}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="glass rounded-2xl p-5 border border-temple-border">
        <h2 className="text-saffron-300 font-black text-sm mb-3">Legend</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(KIND_LABELS).map(([k, label]) => {
            const s = KIND_STYLES[k as keyof typeof KIND_STYLES]
            return (
              <span key={k} className={`text-xs font-bold px-2 py-1 rounded-full border ${s.badge}`}>
                {label}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
