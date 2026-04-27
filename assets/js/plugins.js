export function uPlotTooltipPlugin (onHover) {
  let element

  return {
    hooks: {
      init: u => {
        element = u.root.querySelector('.u-over') || u.root.querySelector('.over')

        if (!element) {
          return
        }

        element.onmouseenter = () => onHover()
        element.onmouseleave = () => onHover()
      },
      setCursor: u => {
        if (!element) {
          return
        }

        const { left, top, idx } = u.cursor

        if (idx === null) {
          onHover(undefined, undefined, u)
        } else {
          const bounds = element.getBoundingClientRect()

          onHover({
            left: bounds.left + left + window.pageXOffset,
            top: bounds.top + top + window.pageYOffset
          }, idx, u)
        }
      }
    }
  }
}
