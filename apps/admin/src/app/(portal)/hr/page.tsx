'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'

const MOCK_EMPLOYEES = [
  { id: '1', name: 'Arjun Patel', role: 'Temple Priest', dept: 'Religious', type: 'FULL_TIME', status: 'Active', start: '2019-03-01', salary: '£32,000' },
  { id: '2', name: 'Sunita Sharma', role: 'Finance Manager', dept: 'Finance', type: 'FULL_TIME', status: 'Active', start: '2020-07-15', salary: '£42,000' },
  { id: '3', name: 'Dev Kumar', role: 'Operations Manager', dept: 'Operations', type: 'FULL_TIME', status: 'Active', start: '2021-01-10', salary: '£38,000' },
  { id: '4', name: 'Priya Mehta', role: 'Office Administrator', dept: 'Admin', type: 'PART_TIME', status: 'Active', start: '2022-04-20', salary: '£16,000' },
  { id: '5', name: 'Rahul Nair', role: 'Youth Coordinator', dept: 'Community', type: 'FULL_TIME', status: 'Active', start: '2023-09-01', salary: '£28,000' },
]

const TYPE_BADGE: Record<string, string> = {
  FULL_TIME: 'badge-green', PART_TIME: 'badge-blue', CONTRACTOR: 'badge-yellow', VOLUNTEER: 'badge-orange',
}

export default function HRPage() {
  const [search, setSearch] = useState('')

  const filtered = MOCK_EMPLOYEES.filter(
    (e) => e.name.toLowerCase().includes(search.toLowerCase()) ||
            e.dept.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Human Resources</h1>
          <p className="text-white/40 mt-1">Employees, Leave & Timesheets</p>
        </div>
        <div className="flex gap-3">
          <a href="/hr/leave" className="btn-secondary">Leave Requests</a>
          <button className="btn-primary">+ New Employee</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Employees', value: '24', icon: '👥', color: 'from-blue-600 to-indigo-500' },
          { label: 'Full-Time', value: '18', icon: '💼', color: 'from-green-600 to-emerald-500' },
          { label: 'Leave Today', value: '3', icon: '🌴', color: 'from-amber-600 to-orange-500' },
          { label: 'Pending Reviews', value: '5', icon: '⏳', color: 'from-purple-600 to-violet-500' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="glass rounded-2xl p-5 stat-card relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-lg mb-3`}>{s.icon}</div>
            <p className="text-white/50 text-xs font-medium">{s.label}</p>
            <p className="text-3xl font-black text-white mt-1">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Employee table */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass rounded-2xl overflow-hidden">
        <div className="p-5 flex items-center justify-between border-b border-white/5">
          <h2 className="text-white font-bold">All Employees</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees..."
            className="input-field w-64 text-sm py-2"
          />
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th>Type</th>
              <th>Salary</th>
              <th>Start Date</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp) => (
              <tr key={emp.id}>
                <td>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-saffron-gradient flex items-center justify-center text-white text-sm font-bold">
                      {emp.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <p className="text-white font-semibold">{emp.name}</p>
                      <p className="text-white/40 text-xs">{emp.role}</p>
                    </div>
                  </div>
                </td>
                <td>{emp.dept}</td>
                <td><span className={`badge ${TYPE_BADGE[emp.type]}`}>{emp.type.replace('_', ' ')}</span></td>
                <td className="font-mono font-semibold text-white">{emp.salary}</td>
                <td className="text-white/50">{new Date(emp.start).toLocaleDateString('en-GB')}</td>
                <td><span className="badge badge-green">{emp.status}</span></td>
                <td>
                  <button className="text-saffron-400 text-sm hover:text-saffron-300">View →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>
    </div>
  )
}
