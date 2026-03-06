/** @jsxImportSource hono/jsx */

export function Icon({ name, ...props }) {
  const iconName = name.startsWith('lucide:') ? name.slice(7) : name
  return <span class={`icon--lucide icon--lucide--${iconName}`} aria-hidden="true" {...props}></span>
}
