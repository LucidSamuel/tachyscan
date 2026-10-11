import type { ComponentChildren } from 'preact';

export function ExplorerLink({ href, onNavigate, children, class: className, title }: {
  href: string;
  onNavigate: (path: string) => void;
  children: ComponentChildren;
  class?: string;
  title?: string;
}) {
  return (
    <a class={className} href={href} title={title} onClick={(event) => {
      // Leave modified clicks to the browser so permalinks also work in new tabs.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onNavigate(href);
    }}>{children}</a>
  );
}
