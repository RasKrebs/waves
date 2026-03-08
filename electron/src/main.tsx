import React from "react"
import ReactDOM from "react-dom/client"
import { RouterProvider, createRouter, createHashHistory } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"
import { ThemeProvider } from "../components/theme-provider"
import "./globals.css"

const hashHistory = createHashHistory()
const router = createRouter({ routeTree, history: hashHistory })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </React.StrictMode>,
)
