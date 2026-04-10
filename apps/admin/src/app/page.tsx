import { redirect } from 'next/navigation'

// Root → redirect to dashboard.
// Use absolute path to avoid basePath ambiguity with Next.js 15 RSC redirects.
export default function RootPage() {
  redirect('/admin/dashboard')
}
