export type DomChild = Node | string | number | false | null | undefined

export type ElAttrs = {
  onClick?: (event: MouseEvent) => void
  onChange?: (event: Event) => void
  onInput?: (event: Event) => void
  [key: string]:
    | string
    | boolean
    | number
    | undefined
    | null
    | ((event: MouseEvent) => void)
    | ((event: Event) => void)
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: ElAttrs,
  ...children: DomChild[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) {
        continue
      }
      if (key === 'onClick' && typeof value === 'function') {
        node.addEventListener('click', value as EventListener)
        continue
      }
      if (key === 'onChange' && typeof value === 'function') {
        node.addEventListener('change', value as EventListener)
        continue
      }
      if (key === 'onInput' && typeof value === 'function') {
        node.addEventListener('input', value as EventListener)
        continue
      }
      if (key === 'className') {
        node.className = String(value)
        continue
      }
      if (value === true) {
        node.setAttribute(key, '')
      } else {
        node.setAttribute(key, String(value))
      }
    }
  }
  appendChildren(node, children)
  return node
}

export function appendChildren(parent: Element, children: DomChild[]): void {
  for (const child of children) {
    if (child === undefined || child === null || child === false) {
      continue
    }
    if (typeof child === 'string' || typeof child === 'number') {
      parent.appendChild(document.createTextNode(String(child)))
    } else {
      parent.appendChild(child)
    }
  }
}

export function replaceContent(target: Element, ...children: DomChild[]): void {
  target.replaceChildren()
  appendChildren(target, children)
}

export function createSwitchControl(input: {
  checked: boolean
  disabled?: boolean
  pending?: boolean
  label: string
  onToggle: () => void
}): HTMLButtonElement {
  const btn = el(
    'button',
    {
      type: 'button',
      role: 'switch',
      className: `sm-switch${input.checked ? ' is-on' : ''}${input.pending ? ' is-pending' : ''}`,
      'aria-checked': String(input.checked),
      'aria-label': input.label,
      ...(input.pending ? { 'aria-busy': 'true' } : {}),
      disabled: Boolean(input.disabled || input.pending),
      onClick: () => input.onToggle()
    },
    el('span', { className: 'sm-switch-thumb' })
  )
  return btn
}

export async function copyTextSafe(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fallback below
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  textarea.remove()
  return copied
}
