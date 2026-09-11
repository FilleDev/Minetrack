export function initServerProposalForm () {
  const toggle = document.getElementById('server-proposal-toggle')
  const form = document.getElementById('server-proposal-form')

  // The proposal UI is rendered only when a webhook has been configured.
  if (!toggle || !form) {
    return
  }

  const panel = document.getElementById('server-proposal')
  const backdrop = document.getElementById('server-proposal-backdrop')
  const cancel = document.getElementById('server-proposal-cancel')
  const status = document.getElementById('server-proposal-status')
  const submit = document.getElementById('server-proposal-submit')

  const setPanelOpen = (isOpen) => {
    panel.hidden = !isOpen
    backdrop.hidden = !isOpen

    if (isOpen) {
      document.getElementById('server-proposal-name').focus()
    }
  }

  toggle.addEventListener('click', () => {
    setPanelOpen(panel.hidden)
  })

  cancel.addEventListener('click', () => {
    setPanelOpen(false)
    status.textContent = ''
  })

  backdrop.addEventListener('click', () => setPanelOpen(false))

  form.addEventListener('submit', async (event) => {
    event.preventDefault()

    const formData = new FormData(form)
    const payload = Object.fromEntries(formData.entries())

    submit.disabled = true
    status.textContent = ''

    try {
      const response = await fetch('/api/server-proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`)
      }

      form.reset()
      status.textContent = status.dataset.success
      status.className = 'server-proposal-status is-success'
    } catch (err) {
      console.error('Failed to submit server proposal', err)
      status.textContent = status.dataset.error
      status.className = 'server-proposal-status is-error'
    } finally {
      submit.disabled = false
    }
  })
}
