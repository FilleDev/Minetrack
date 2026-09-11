import { App } from './app'
import { initServerProposalForm } from './proposals'

const app = new App()

document.addEventListener('DOMContentLoaded', () => {
  initServerProposalForm()
  app.init()

  window.addEventListener('resize', function () {
    app.percentageBar.redraw()

    // Delegate to GraphDisplayManager which can check if the resize is necessary
    app.graphDisplayManager.requestResize()

    // Per-server graphs are cheap to resize and have no existing debounce mechanism
    app.serverRegistry.resizeAll()
  }, false)
}, false)
