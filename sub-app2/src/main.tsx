import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App, { type InteractionProps } from './App.tsx'

declare global {
  interface Window {
    __POWERED_BY_QIANKUN__?: boolean
    [key: string]: unknown
  }
}

/**
 * 宿主下发的 props。container 由 qiankun 注入,其余来自 <MicroApp> 的额外 props
 * (它在 props 变化时调用下面的 update,并会额外塞一个 setLoading,这里用不到)。
 */
type QiankunProps = { container?: Element; setLoading?: (loading: boolean) => void } & Partial<InteractionProps>

/** 由 mount / update 两个生命周期刷新 */
let hostProps: Partial<InteractionProps> = {}
let root: ReturnType<typeof createRoot> | undefined

function render(props: QiankunProps = {}) {
  // when loaded by qiankun, resolve #root inside the host-provided container, not the top document
  const container = props.container?.querySelector('#root') ?? document.getElementById('root')
  if (!container) return

  // 只在首次 mount 时建 root;update 复用同一个 root,所以组件内部 state 不会被重置
  if (!root) root = createRoot(container)
  root.render(
    <StrictMode>
      <App {...hostProps} />
    </StrictMode>,
  )
}

export async function bootstrap() {}

export async function mount(props: QiankunProps) {
  hostProps = props
  render(props)
}

// 宿主 props 变化时走这里:重新下发数据但不重新挂载
export async function update(props: QiankunProps) {
  hostProps = { ...hostProps, ...props }
  render()
}

export async function unmount() {
  root?.unmount()
  root = undefined
  hostProps = {}
}

if (window.__POWERED_BY_QIANKUN__) {
  // classic-mode fallback: expose the lifecycles on window under the REGISTERED app name
  window['sub-app2'] = { bootstrap, mount, update, unmount }
} else {
  // 独立运行:body 属于本应用,打上标记让 index.css 里的 body 规则生效
  document.body.classList.add('micro-app-standalone')
  render()
}
