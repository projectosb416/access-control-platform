/**
 * /platform — placeholder dashboard.
 *
 * Will render the platform owner dashboard: overview stats, payment
 * confirmation queue, recent payments, organizations list, recent
 * signups. Replaced in the next commit.
 */

export default function PlatformHomePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Platform overview
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Dashboard coming soon.
        </p>
      </header>
    </div>
  )
}
