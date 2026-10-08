import { lazy, Suspense } from 'react'

const AlternativesView = lazy(() => import('./AlternativesView'))

export function AlternativesPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-sm text-muted">正在加载国产替代数据…</div>}>
      <AlternativesView />
    </Suspense>
  )
}
