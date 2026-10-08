import { lazy, Suspense } from 'react'

/*
 * 模型页的懒加载入口。
 *
 * 为什么要单独拆一层：
 *   models.json 有 396KB（467 个模型）。若在 App 里静态 import 模型页，
 *   这份数据会进首屏 bundle——实测主 chunk 从 451KB 涨到 877KB，
 *   gzip 205KB。而绝大多数访客是来看 Agent 的，根本不会点模型页，
 *   替他们白下载一半体积没有道理。
 *
 *   所以这里用 React.lazy：只有真正切到「模型」标签页时，
 *   浏览器才会去下载 ModelsView 那个 chunk。
 *
 * 副作用也要注意：
 *   - 首屏 CSS 不含模型页样式，切过去会有一次极短的样式应用（无感知）；
 *   - 加载失败要兜住，否则白屏且用户不知道发生了什么。
 */
const ModelsView = lazy(() => import('./ModelsView'))

export function ModelsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-center">
            <div
              className="mx-auto size-6 animate-spin rounded-full border-2 border-edge border-t-brand"
              aria-hidden
            />
            <p className="mt-3 text-xs text-muted">正在加载模型数据…</p>
          </div>
        </div>
      }
    >
      <ModelsView />
    </Suspense>
  )
}