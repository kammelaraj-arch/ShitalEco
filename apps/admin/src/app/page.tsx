import { redirect } from 'next/navigation'

// Root → redirect to dashboard.
// Next.js automatically prepends basePath (/admin), so use path without it.
export default function RootPage() {
  redirect('/dashboard')
}
