'use client'
import { motion } from 'framer-motion'

const COMPLIANCE_ITEMS = [
  { title: 'Charity Registration', status: 'compliant', icon: '🏛️', desc: 'Registered with Charity Commission England & Wales', detail: 'Reg No: 123456', reviewed: '2024-04-01', action: 'View Certificate' },
  { title: 'Gift Aid Registration', status: 'compliant', icon: '🇬🇧', desc: 'HMRC Gift Aid scheme registered and active', detail: 'HMRC Ref: XY12345', reviewed: '2024-03-15', action: 'Submit Claims' },
  { title: 'GDPR Compliance', status: 'attention', icon: '🔒', desc: 'Data protection policies under annual review', detail: 'Review due April 2026', reviewed: '2025-04-01', action: 'Review Policy' },
  { title: 'Annual Return', status: 'compliant', icon: '📋', desc: 'Charity Commission annual return filed', detail: 'Filed for 2024-25', reviewed: '2025-01-15', action: 'File Next Return' },
  { title: 'Public Liability Insurance', status: 'compliant', icon: '🛡️', desc: 'Public liability and employers liability covered', detail: 'Expires: Dec 2026', reviewed: '2026-01-01', action: 'Renew Insurance' },
  { title: 'DBS Checks', status: 'attention', icon: '✅', desc: 'DBS checks for staff working with vulnerable adults', detail: '2 renewals due', reviewed: '2025-11-01', action: 'Manage DBS' },
]

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string; icon: string }> = {
  compliant: { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/30', label: 'Compliant', icon: '✓' },
  attention: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', label: 'Attention', icon: '⚠' },
  overdue:   { bg: 'bg-red-500/15',   text: 'text-red-400',   border: 'border-red-500/30',   label: 'Overdue',   icon: '✗' },
}

const RISKS = [
  { area: 'Data Breach', severity: 'medium', mitigation: 'Encrypted storage, access controls, regular audits', owner: 'IT' },
  { area: 'Financial Fraud', severity: 'low', mitigation: 'Dual authorisation, quarterly audit reviews', owner: 'Finance' },
  { area: 'Health & Safety', severity: 'low', mitigation: 'Regular risk assessments, trained first aiders on site', owner: 'Operations' },
  { area: 'Reputational', severity: 'low', mitigation: 'Social media policy, communications guidelines', owner: 'Admin' },
]

const SEV: Record<string, string> = {
  high: 'bg-red-500/20 text-red-400 border-red-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-green-500/20 text-green-400 border-green-500/30',
}

export default function CompliancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-white">Compliance</h1>
        <p className="text-white/40 mt-1">Regulatory compliance and risk management</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {COMPLIANCE_ITEMS.map((item, i) => {
          const s = STATUS_STYLES[item.status]
          return (
            <motion.div key={item.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className={`glass rounded-2xl p-5 border ${s.border}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{item.icon}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${s.bg} ${s.text} ${s.border}`}>
                    {s.icon} {s.label}
                  </span>
                </div>
                <span className="text-white/20 text-xs">Reviewed: {new Date(item.reviewed).toLocaleDateString('en-GB')}</span>
              </div>
              <h3 className="text-white font-bold text-base">{item.title}</h3>
              <p className="text-white/40 text-sm mt-1">{item.desc}</p>
              <p className="text-white/20 text-xs mt-1">{item.detail}</p>
              <button className="mt-3 text-saffron-400 text-xs font-semibold hover:text-saffron-300 transition-colors">
                {item.action} →
              </button>
            </motion.div>
          )
        })}
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass rounded-2xl p-6">
        <h2 className="text-white font-bold text-lg mb-4">Risk Register</h2>
        <div className="overflow-x-auto"><table className="w-full">
          <thead>
            <tr className="border-b border-white/5">
              {['Risk Area', 'Severity', 'Mitigation', 'Owner'].map(h => (
                <th key={h} className="text-left py-3 text-white/40 text-xs font-semibold uppercase tracking-wider pr-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RISKS.map((risk, i) => (
              <tr key={i} className="border-b border-white/5 hover:bg-white/3">
                <td className="py-3 text-white font-medium text-sm pr-4">{risk.area}</td>
                <td className="py-3 pr-4">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${SEV[risk.severity]}`}>{risk.severity}</span>
                </td>
                <td className="py-3 text-white/50 text-sm pr-4">{risk.mitigation}</td>
                <td className="py-3 text-white/50 text-sm">{risk.owner}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </motion.div>
    </div>
  )
}
