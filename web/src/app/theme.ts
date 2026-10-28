import { useEffect } from "react"

// Follow the system's light or dark setting. The class goes on <html> so popovers (portalled to <body>) match too.
export function useSystemDark() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const root = document.documentElement
    const apply = () => root.classList.toggle("dark", mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => { mq.removeEventListener("change", apply); root.classList.remove("dark") }
  }, [])
}
