import { redirect } from 'next/navigation'

// Root → redirect to dashboard (AuthGuard will bounce to /login if not authenticated)
export default function RootPage() {
  redirect('/dashboard')
}
